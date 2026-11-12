import { execFileSync } from "node:child_process";
import { z } from "zod";

// P5-W29-S01 (ADR-0040 PROPOSED): Go types for the checker (services/exec), generated
// from the same zod definitions as everything else, with their rules: each type gets a
// Decode function that refuses unknown fields and trailing data, then checks required
// fields, a union's exactly-one variant, bounds and patterns. Sandbox output is
// untrusted (EXEC-4), so Go gets the whole contract, never a hand-kept second copy.
// Only what these contracts use: objects, a union of objects at the root, arrays,
// scalars and any JSON value (kept raw, json.RawMessage, for the checker to compare).
type Node = {
  type?: string;
  properties?: Record<string, Node>;
  required?: string[];
  items?: Node;
  $ref?: string;
  anyOf?: Node[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  $defs?: Record<string, Node>;
};

const exported = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

export function goTypes(
  pkg: string,
  schemas: Record<string, z.ZodType>,
  // A list of objects becomes a struct of this name (calls: "Call").
  itemNames: Record<string, string>,
): string {
  const out: string[] = [];
  const names = new Set<string>();
  const patterns: string[] = [];
  let jsonDef = "";

  type Field = { key: string; goName: string; type: string; node: Node };

  // The Go type of a value; pointers for every scalar, so presence can be checked.
  const typeOf = (node: Node, key: string, owner: string): string => {
    if (node.$ref !== undefined) {
      if (node.$ref !== jsonDef)
        throw new Error(`${owner}.${key}: only z.json() may be a $ref`);
      return "json.RawMessage";
    }
    switch (node.type) {
      case "string":
        return "*string";
      case "integer":
        return "*int64";
      case "number":
        return "*float64";
      case "boolean":
        return "*bool";
      case "array": {
        if (node.items === undefined)
          throw new Error(`${owner}.${key}: no items`);
        if (node.items.type === "object") {
          const name = itemNames[key];
          if (name === undefined)
            throw new Error(`${owner}.${key}: no struct name for its items`);
          struct(name, node.items);
          return `[]${name}`;
        }
        return `[]${typeOf(node.items, key, owner).replace(/^\*/, "")}`;
      }
      default:
        throw new Error(
          `${owner}.${key}: unsupported schema ${JSON.stringify(node)}`,
        );
    }
  };

  // The checks on one present field, as Go statements.
  const checks = (f: Field, owner: string): string[] => {
    const at = `${owner}.${f.key}`;
    const lines: string[] = [];
    const n = f.node;
    if (n.type === "integer" || n.type === "number") {
      if (n.minimum !== undefined)
        lines.push(
          `if *v.${f.goName} < ${String(n.minimum)} { return fmt.Errorf("${at}: below ${String(n.minimum)}") }`,
        );
      if (n.maximum !== undefined)
        lines.push(
          `if *v.${f.goName} > ${String(n.maximum)} { return fmt.Errorf("${at}: above ${String(n.maximum)}") }`,
        );
    }
    if (n.type === "string") {
      if (n.pattern !== undefined) {
        // Compiled once, at package level.
        if (!patterns.includes(n.pattern)) patterns.push(n.pattern);
        const re = `pattern${String(patterns.indexOf(n.pattern))}`;
        lines.push(
          `if !${re}.MatchString(*v.${f.goName}) { return fmt.Errorf("${at}: doesn't match its pattern") }`,
        );
      }
      if (n.maxLength !== undefined)
        lines.push(
          `if len([]rune(*v.${f.goName})) > ${String(n.maxLength)} { return fmt.Errorf("${at}: too long") }`,
        );
      if (n.minLength !== undefined)
        lines.push(
          `if len([]rune(*v.${f.goName})) < ${String(n.minLength)} { return fmt.Errorf("${at}: too short") }`,
        );
    }
    if (n.type === "array") {
      if (n.minItems !== undefined)
        lines.push(
          `if len(v.${f.goName}) < ${String(n.minItems)} { return fmt.Errorf("${at}: fewer than ${String(n.minItems)}") }`,
        );
      if (n.maxItems !== undefined)
        lines.push(
          `if len(v.${f.goName}) > ${String(n.maxItems)} { return fmt.Errorf("${at}: more than ${String(n.maxItems)}") }`,
        );
      if (n.items?.type === "object")
        lines.push(
          `for i := range v.${f.goName} { if err := v.${f.goName}[i].Validate(); err != nil { return fmt.Errorf("${at}[%d]: %w", i, err) } }`,
        );
    }
    return lines;
  };
  const present = (f: Field) =>
    f.type === "json.RawMessage"
      ? `len(v.${f.goName}) > 0`
      : `v.${f.goName} != nil`;

  const fieldsOf = (node: Node, owner: string): Field[] =>
    Object.entries(node.properties ?? {}).map(([key, child]) => ({
      key,
      goName: exported(key),
      type: typeOf(child, key, owner),
      node: child,
    }));

  const emit = (name: string, fields: Field[], validate: string[]) => {
    if (names.has(name)) throw new Error(`struct ${name} defined twice`);
    names.add(name);
    out.push(
      `type ${name} struct {\n${fields.map((f) => `\t${f.goName} ${f.type} \`json:"${f.key},omitempty"\``).join("\n")}\n}`,
      `// Validate checks ${name} against its contract.\nfunc (v ${name}) Validate() error {\n${validate.join("\n")}\nreturn nil\n}`,
    );
  };

  const struct = (name: string, node: Node) => {
    if (node.type !== "object" || node.properties === undefined)
      throw new Error(`${name}: not an object with properties`);
    const fields = fieldsOf(node, name);
    const required = new Set(node.required ?? []);
    const validate: string[] = [];
    for (const f of fields) {
      const body = checks(f, name);
      if (required.has(f.key))
        validate.push(
          `if !(${present(f)}) { return fmt.Errorf("${name}.${f.key}: missing") }`,
          ...body,
        );
      else if (body.length > 0)
        validate.push(`if ${present(f)} {`, ...body, "}");
    }
    emit(name, fields, validate);
  };

  // A union of objects: one struct holding every field, valid when exactly one variant
  // has all its fields and none of the others'.
  const union = (name: string, variants: Node[]) => {
    const byKey = new Map<string, Field>();
    for (const v of variants) {
      if (v.type !== "object")
        throw new Error(`${name}: a union of objects only`);
      for (const f of fieldsOf(v, name)) byKey.set(f.key, f);
    }
    const fields = [...byKey.values()];
    const validate: string[] = ["matched := 0"];
    variants.forEach((v) => {
      const own = new Set(Object.keys(v.properties ?? {}));
      const has = [...own].map((k) => present(byKey.get(k) as Field));
      const lacks = fields
        .filter((f) => !own.has(f.key))
        .map((f) => `!(${present(f)})`);
      validate.push(`if ${[...has, ...lacks].join(" && ")} { matched++ }`);
    });
    validate.push(
      `if matched != 1 { return fmt.Errorf("${name}: not exactly one of its forms") }`,
    );
    for (const f of fields) {
      const body = checks(f, name);
      if (body.length > 0) validate.push(`if ${present(f)} {`, ...body, "}");
    }
    emit(name, fields, validate);
  };

  for (const [name, schema] of Object.entries(schemas)) {
    const root = z.toJSONSchema(schema, { io: "input" }) as Node;
    // z.json() is the one shared definition: a JSON value of any shape.
    const defs = Object.keys(root.$defs ?? {});
    if (defs.length > 1)
      throw new Error(`${name}: more than z.json() in $defs`);
    jsonDef = defs[0] === undefined ? "" : `#/$defs/${defs[0]}`;
    if (root.anyOf !== undefined) union(name, root.anyOf);
    else struct(name, root);
    out.push(
      `// Decode${name} reads one ${name}: no unknown fields, nothing after it, every rule.\nfunc Decode${name}(data []byte) (${name}, error) {\nvar v ${name}\ndec := json.NewDecoder(bytes.NewReader(data))\ndec.DisallowUnknownFields()\nif err := dec.Decode(&v); err != nil { return v, err }\nif dec.More() { return v, fmt.Errorf("${name}: more than one value") }\nreturn v, v.Validate()\n}`,
    );
  }
  const imports = [
    "bytes",
    "encoding/json",
    "fmt",
    ...(patterns.length > 0 ? ["regexp"] : []),
  ];
  const source = [
    "// Code generated by @interval/lld (src/go.ts) from its zod contracts; DO NOT EDIT.",
    "// Regenerate with `pnpm --filter @interval/lld codegen` (ADR-0040 PROPOSED).",
    "",
    `package ${pkg}`,
    "",
    `import (\n${imports.map((i) => `\t"${i}"`).join("\n")}\n)`,
    "",
    ...patterns.map(
      (p, i) =>
        `var pattern${String(i)} = regexp.MustCompile(${JSON.stringify(p)})\n`,
    ),
    ...out.map((s) => `${s}\n`),
  ].join("\n");
  return execFileSync("gofmt", { input: source, encoding: "utf8" });
}
