import type { Interface } from "../interface";
import type { TypeAst } from "../types";
import { type Generated, methodsOf } from "./common";

// int is long (64-bit, W29-S01); inside generics and as an optional, the boxed type.
const jt = (t: TypeAst, boxed = false): string => {
  switch (t.kind) {
    case "int":
      return boxed ? "Long" : "long";
    case "float":
      return boxed ? "Double" : "double";
    case "bool":
      return boxed ? "Boolean" : "boolean";
    case "string":
      return "String";
    case "list":
      return `List<${jt(t.of, true)}>`;
    case "map":
      return `Map<String, ${jt(t.of, true)}>`;
    case "optional":
      return jt(t.of, true);
  }
};

// A JSON value (the harness's own reader) to the declared type, as a Java expression.
const conv = (t: TypeAst, expr: string, depth = 0): string => {
  const x = `x${String(depth)}`;
  switch (t.kind) {
    case "int":
      return `asLong(${expr})`;
    case "float":
      return `asDouble(${expr})`;
    case "bool":
      return `asBool(${expr})`;
    case "string":
      return `asString(${expr})`;
    case "list":
      return `asList(${expr}, ${x} -> ${conv(t.of, x, depth + 1)})`;
    case "map":
      return `asMap(${expr}, ${x} -> ${conv(t.of, x, depth + 1)})`;
    case "optional":
      return `asOptional(${expr}, ${x} -> ${conv(t.of, x, depth + 1)})`;
  }
};

const RUNTIME = String.raw`
  // A small JSON reader and writer: Java has none in its standard library.
  static final class IntervalJson {
    final String s;
    int i;

    IntervalJson(String s) {
      this.s = s;
    }

    void ws() {
      while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
    }

    Object value() {
      ws();
      char c = s.charAt(i);
      if (c == '{') {
        Map<String, Object> m = new LinkedHashMap<>();
        i++;
        ws();
        if (s.charAt(i) == '}') { i++; return m; }
        while (true) {
          ws();
          String k = string();
          ws();
          i++; // :
          m.put(k, value());
          ws();
          if (s.charAt(i++) == '}') return m;
        }
      }
      if (c == '[') {
        List<Object> l = new ArrayList<>();
        i++;
        ws();
        if (s.charAt(i) == ']') { i++; return l; }
        while (true) {
          l.add(value());
          ws();
          if (s.charAt(i++) == ']') return l;
        }
      }
      if (c == '"') return string();
      if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
      if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
      if (s.startsWith("null", i)) { i += 4; return null; }
      int start = i;
      while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
      String n = s.substring(start, i);
      if (n.contains(".") || n.contains("e") || n.contains("E")) return Double.parseDouble(n);
      return Long.parseLong(n);
    }

    String string() {
      StringBuilder b = new StringBuilder();
      i++; // "
      while (true) {
        char c = s.charAt(i++);
        if (c == '"') return b.toString();
        if (c != '\\') { b.append(c); continue; }
        char e = s.charAt(i++);
        switch (e) {
          case 'n' -> b.append('\n');
          case 't' -> b.append('\t');
          case 'r' -> b.append('\r');
          case 'b' -> b.append('\b');
          case 'f' -> b.append('\f');
          case 'u' -> { b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; }
          default -> b.append(e);
        }
      }
    }
  }

  static void write(StringBuilder b, Object v) {
    if (v == null) b.append("null");
    else if (v instanceof Boolean || v instanceof Long || v instanceof Integer) b.append(v);
    else if (v instanceof Double d) {
      if (!Double.isFinite(d)) throw new ArithmeticException("not a finite number");
      b.append(d);
    } else if (v instanceof String str) {
      b.append('"');
      for (char c : str.toCharArray()) {
        if (c == '"' || c == '\\') b.append('\\').append(c);
        else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
        else b.append(c);
      }
      b.append('"');
    } else if (v instanceof List<?> l) {
      b.append('[');
      for (int k = 0; k < l.size(); k++) { if (k > 0) b.append(','); write(b, l.get(k)); }
      b.append(']');
    } else if (v instanceof Map<?, ?> m) {
      b.append('{');
      boolean first = true;
      for (Map.Entry<?, ?> e : m.entrySet()) {
        if (!first) b.append(',');
        first = false;
        write(b, String.valueOf(e.getKey()));
        b.append(':');
        write(b, e.getValue());
      }
      b.append('}');
    } else throw new IllegalArgumentException("can't write a " + v.getClass().getSimpleName());
  }

  static long asLong(Object v) { return (Long) v; }

  static double asDouble(Object v) { return ((Number) v).doubleValue(); }

  static boolean asBool(Object v) { return (Boolean) v; }

  static String asString(Object v) { return (String) v; }

  static <T> List<T> asList(Object v, Function<Object, T> f) {
    List<T> out = new ArrayList<>();
    for (Object x : (List<?>) v) out.add(f.apply(x));
    return out;
  }

  static <T> Map<String, T> asMap(Object v, Function<Object, T> f) {
    Map<String, T> out = new LinkedHashMap<>();
    for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) out.put((String) e.getKey(), f.apply(e.getValue()));
    return out;
  }

  static <T> T asOptional(Object v, Function<Object, T> f) { return v == null ? null : f.apply(v); }

  static String clean(Throwable t) {
    String s;
    try {
      s = t.getClass().getSimpleName() + ": " + t.getMessage();
    } catch (Throwable inner) {
      s = t.getClass().getSimpleName();
    }
    StringBuilder b = new StringBuilder();
    for (char c : s.toCharArray()) b.append(c >= ' ' && c <= '~' ? c : '?');
    return b.length() > 200 ? b.substring(0, 200) : b.toString();
  }
`;

export function java(iface: Interface): Generated {
  const { ctor, methods } = methodsOf(iface);
  const sig = (ps: typeof ctor) =>
    ps.map((p) => `${jt(p.type)} ${p.name}`).join(", ");
  const starter = [
    "import java.util.*;",
    "",
    `public class ${iface.class} {`,
    `  public ${iface.class}(${sig(ctor)}) {}`,
    ...methods.flatMap((m) => [
      "",
      `  public ${m.returns === "void" ? "void" : jt(m.returns)} ${m.name}(${sig(m.params)}) {`,
      '    throw new UnsupportedOperationException("not implemented");',
      "  }",
    ]),
    "}",
    "",
  ].join("\n");
  const args = (ps: typeof ctor) =>
    ps.map((p, i) => conv(p.type, `a.get(${String(i)})`)).join(", ");
  // One dispatch, for the main calls and the threads alike (P5-W30-S02b).
  const arms = [
    ...methods.map((x) =>
      x.returns === "void"
        ? `      case "${x.name}" -> {\n        obj.${x.name}(${args(x.params)});\n        return null;\n      }`
        : `      case "${x.name}" -> { return obj.${x.name}(${args(x.params)}); }`,
    ),
    '      default -> throw new IllegalArgumentException("unknown method " + m);',
  ];
  const harness = [
    "// Generated by @interval/lld (P5-W29-S02, S02b); do not edit.",
    "import java.io.*;",
    "import java.nio.charset.StandardCharsets;",
    "import java.util.*;",
    "import java.util.concurrent.CyclicBarrier;",
    "import java.util.concurrent.atomic.AtomicReference;",
    "import java.util.function.Function;",
    "",
    "public class Main {",
    RUNTIME,
    '  @SuppressWarnings("unchecked")',
    `  static Object call(${iface.class} obj, String m, List<Object> a) {`,
    "    switch (m) {",
    ...arms,
    "    }",
    "  }",
    "",
    "  // Started together behind a barrier, so they really collide; a thread's own results",
    "  // and errors aren't reported, but running out of memory still ends the run.",
    '  @SuppressWarnings("unchecked")',
    `  static void threads(${iface.class} obj, List<Object> ts) throws InterruptedException {`,
    "    CyclicBarrier gate = new CyclicBarrier(ts.size());",
    "    AtomicReference<OutOfMemoryError> fatal = new AtomicReference<>();",
    "    List<Thread> workers = new ArrayList<>();",
    "    for (Object t : ts) {",
    "      Thread w = new Thread(() -> {",
    "        try {",
    "          gate.await();",
    "        } catch (Exception e) {",
    "          return;",
    "        }",
    "        for (Object x : (List<Object>) t) {",
    "          Map<String, Object> c = (Map<String, Object>) x;",
    "          try {",
    '            call(obj, (String) c.get("method"), (List<Object>) c.get("args"));',
    "          } catch (OutOfMemoryError e) {",
    "            fatal.set(e);",
    "            return;",
    "          } catch (Throwable e) {",
    "            // Swallowed: what's judged is the state the later calls see.",
    "          }",
    "        }",
    "      });",
    "      try {",
    "        w.start();",
    "      } catch (RuntimeException | Error e) {",
    "        // The started threads would wait at the barrier forever: release them, then",
    "        // end the run as a crash, never a timeout.",
    "        gate.reset();",
    "        throw e;",
    "      }",
    "      workers.add(w);",
    "    }",
    "    for (Thread w : workers) w.join();",
    "    if (fatal.get() != null) throw fatal.get();",
    "  }",
    "",
    '  @SuppressWarnings("unchecked")',
    "  public static void main(String[] argv) throws IOException, InterruptedException {",
    "    PrintStream real = new PrintStream(new FileOutputStream(FileDescriptor.out), false, StandardCharsets.UTF_8);",
    "    // The submission's own prints go to stderr, never into the results.",
    "    System.setOut(System.err);",
    "    String input = new String(System.in.readAllBytes(), StandardCharsets.UTF_8);",
    "    Map<String, Object> scenario = (Map<String, Object>) new IntervalJson(input).value();",
    '    List<Object> calls = (List<Object>) scenario.get("calls");',
    '    Map<String, Object> concurrent = (Map<String, Object>) scenario.get("concurrent");',
    '    long after = concurrent == null ? -1 : (Long) concurrent.get("after");',
    "    StringBuilder out = new StringBuilder();",
    `    ${iface.class} obj = null;`,
    "    for (int i = 0; i < calls.size(); i++) {",
    '      if (i == after) threads(obj, (List<Object>) concurrent.get("threads"));',
    "      Map<String, Object> c = (Map<String, Object>) calls.get(i);",
    '      String m = (String) c.get("method");',
    '      List<Object> a = (List<Object>) c.get("args");',
    "      StringBuilder line = new StringBuilder();",
    "      try {",
    "        Object v = null;",
    `        if (m.equals("new")) obj = new ${iface.class}(${args(ctor)});`,
    "        else v = call(obj, m, a);",
    '        line.append("{\\"call\\":").append(i).append(",\\"value\\":");',
    "        write(line, v);",
    "        line.append('}');",
    "      } catch (OutOfMemoryError e) {",
    "        // The engine scores it as a memory limit (its message on stderr).",
    "        throw e;",
    "      } catch (Throwable e) {",
    "        line.setLength(0);",
    '        line.append("{\\"call\\":").append(i).append(",\\"error\\":");',
    "        write(line, clean(e));",
    "        line.append('}');",
    "      }",
    "      out.append(line).append('\\n');",
    "    }",
    "    real.print(out);",
    "    real.flush();",
    "    // A submission's leftover threads must not keep the run alive past its results.",
    "    Runtime.getRuntime().halt(0);",
    "  }",
    "}",
    "",
  ].join("\n");
  return {
    solutionFile: `${iface.class}.java`,
    starter,
    harnessFile: "Main.java",
    harness,
  };
}
