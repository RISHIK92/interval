import { z } from "zod";
import { parseType } from "./types";

// P5-W29-S01 (LLDQ-1, Q-P5-06): a problem's fixed interface (§6.5: "fixed interfaces, so
// hidden tests run against any submission"). One class, its constructor and methods,
// typed in the grammar of types.ts. Names must work unchanged in all five languages,
// so they are never a keyword or a name the harness uses itself.
const RESERVED = new Set(
  [
    // Python
    "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case type self",
    // JavaScript and TypeScript
    "case catch const debugger default delete do enum export extends false function instanceof let new null static super switch this throw true typeof var void arguments eval implements interface package private protected public any boolean number string symbol declare namespace module readonly abstract get set of constructor prototype",
    // Java
    "byte char double final float goto int long native short strictfp synchronized throws transient volatile record sealed permits",
    // C++
    "alignas alignof asm auto bitand bitor bool compl concept consteval constexpr constinit decltype explicit extern friend inline mutable noexcept nullptr operator register requires signed sizeof struct template typedef typeid typename union unsigned using virtual xor std",
    // Java's Object methods (final, or fixed in their return type)
    "wait notify notifyAll getClass toString hashCode clone finalize equals valueOf",
    // Go
    "chan defer fallthrough func go map range select error len cap make append copy panic recover print println nil iota",
    // The generated harnesses' own names
    "main harness dispatch call calls args input output out result results instance scenario json sys os fmt",
  ]
    .join(" ")
    .split(" "),
);

// Class names a language already gives a meaning: Python's constants and typing names,
// C++ macros, java.lang (a same-file class would shadow it), and JS globals the harness
// uses.
const RESERVED_CLASSES = new Set(
  [
    "None True False Optional List Dict Any",
    "NULL EOF",
    "Main Harness Object String Integer Long Double Boolean Character Math System Exception Class Void Map Set",
    "JSON Array Number Error Promise Symbol",
    // Names the generated harnesses use themselves (Java's single-file Main, C++'s namespace).
    "IntervalJson Reader From Function ArrayList LinkedHashMap StringBuilder Throwable PrintStream FileDescriptor FileOutputStream StandardCharsets IOException StackOverflowError OutOfMemoryError ArithmeticException IllegalArgumentException UnsupportedOperationException RangeError TypeError",
  ]
    .join(" ")
    .split(" "),
);

const Name = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]{0,30}$/, "lower camel case, up to 31 characters")
  .refine(
    (n) => !RESERVED.has(n),
    "a keyword or a harness name in some language",
  );

const ClassName = z
  .string()
  .regex(/^[A-Z][a-zA-Z0-9]{0,30}$/, "upper camel case, up to 31 characters")
  .refine(
    (n) => !RESERVED_CLASSES.has(n),
    "a keyword, a standard name or a name the harness uses",
  );

const parses = (t: string) => {
  try {
    parseType(t);
    return true;
  } catch {
    return false;
  }
};
const Type = z.string().refine(parses, "not a type in the grammar");

const Param = z.strictObject({ name: Name, type: Type });
const Params = z
  .array(Param)
  .max(8)
  .refine(
    (ps) => new Set(ps.map((p) => p.name)).size === ps.length,
    "parameter names repeat",
  );

const Method = z.strictObject({
  name: Name,
  params: Params,
  returns: z.union([z.literal("void"), Type]),
});

// The generated JSON Schema carries the structure only: the naming, uniqueness and
// grammar rules are refinements, which live here.
export const Interface = z
  .strictObject({
    class: ClassName,
    constructor: z.strictObject({ params: Params }),
    methods: z
      .array(Method)
      .min(1)
      .max(20)
      .refine(
        (ms) => new Set(ms.map((m) => m.name)).size === ms.length,
        "method names repeat",
      ),
  })
  .meta({
    description:
      "A problem's interface (LLDQ-1). Structure only: the naming, uniqueness and type-grammar rules are zod refinements in packages/lld/src/interface.ts (ADR-0040).",
  });
export type Interface = z.infer<typeof Interface>;
