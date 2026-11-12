// P5-W29-S01 (LLDQ-1, Q-P5-06): the type grammar a problem's interface is written in,
// small enough for every launch language to hold the same values: int, float, bool,
// string, list<T>, map<string,T> and optional<T>, at most four levels including the
// scalar. Map keys are strings only (JSON's objects); an optional is never directly
// optional. int is 64-bit everywhere (Python int, JS number within ±2^53, Java long,
// C++ int64_t, Go int64), and its values stay within ±2^53 so every language and JSON
// hold them exactly.
export type TypeAst =
  | { kind: "int" | "float" | "bool" | "string" }
  | { kind: "list" | "map" | "optional"; of: TypeAst };

const MAX_DEPTH = 4;
const SCALARS = new Set(["int", "float", "bool", "string"]);

export function parseType(source: string): TypeAst {
  let at = 0;
  const fail: (why: string) => never = (why) => {
    throw new Error(`type "${source}": ${why}`);
  };
  // Whitespace may sit between tokens, never inside a name.
  const skip = () => {
    while (/\s/.test(source.charAt(at))) at++;
  };
  const word = (): string => {
    skip();
    const match = /^[a-z]+/.exec(source.slice(at));
    if (match === null) return fail(`a type name expected at ${String(at)}`);
    at += match[0].length;
    return match[0];
  };
  const expect = (char: string) => {
    skip();
    if (source.charAt(at) !== char) fail(`"${char}" expected at ${String(at)}`);
    at++;
  };
  const one = (depth: number): TypeAst => {
    if (depth > MAX_DEPTH) fail(`nested more than ${String(MAX_DEPTH)} deep`);
    const name = word();
    if (SCALARS.has(name)) return { kind: name as "int" };
    if (name !== "list" && name !== "map" && name !== "optional")
      return fail(`unknown type "${name}"`);
    expect("<");
    if (name === "map") {
      if (word() !== "string") fail("map keys are strings only");
      expect(",");
    }
    const of = one(depth + 1);
    if (name === "optional" && of.kind === "optional")
      fail("an optional can't be optional");
    expect(">");
    return { kind: name, of };
  };
  const ast = one(1);
  skip();
  if (at !== source.length) fail(`unexpected "${source.slice(at)}"`);
  return ast;
}

export function formatType(t: TypeAst): string {
  switch (t.kind) {
    case "list":
    case "optional":
      return `${t.kind}<${formatType(t.of)}>`;
    case "map":
      return `map<string,${formatType(t.of)}>`;
    default:
      return t.kind;
  }
}

// Does a JSON value hold this type? Integers stay within what every language's integer
// and JSON's numbers agree on.
export function fits(t: TypeAst, value: unknown): boolean {
  switch (t.kind) {
    case "int":
      return Number.isSafeInteger(value);
    case "float":
      return typeof value === "number" && Number.isFinite(value);
    case "bool":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "list":
      return Array.isArray(value) && value.every((v) => fits(t.of, v));
    case "map":
      return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        Object.values(value).every((v) => fits(t.of, v))
      );
    case "optional":
      return value === null || fits(t.of, value);
  }
}
