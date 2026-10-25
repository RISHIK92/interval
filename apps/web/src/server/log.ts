type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function serialiseError(error: Error): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  const extra = error as Error & { code?: unknown; errors?: unknown };
  if (extra.code !== undefined) out["code"] = extra.code;
  if (error.cause !== undefined) out["cause"] = error.cause;
  if (Array.isArray(extra.errors)) out["errors"] = extra.errors;
  return out;
}

// Errors at any depth keep name, message, stack, code, cause and errors; BigInt becomes a
// string; a repeated object becomes "[Circular]".
function replacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Error) value = serialiseError(value);
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  };
}

function write(level: Level, msg: string, fields: Fields): void {
  const time = new Date().toISOString();
  let line: string;
  try {
    // Reserved keys last, so a field cannot overwrite them.
    line = JSON.stringify({ ...fields, time, level, msg }, replacer());
  } catch (error) {
    // A logger must never throw: fall back to a line without the fields.
    line = JSON.stringify({
      time,
      level,
      msg,
      logError:
        error instanceof Error ? error.message : "unserialisable fields",
    });
  }
  process.stdout.write(`${line}\n`);
}

// One JSON object per line on stdout; the container log driver ships it (OPS-2).
export const log = {
  info: (msg: string, fields: Fields = {}) => {
    write("info", msg, fields);
  },
  warn: (msg: string, fields: Fields = {}) => {
    write("warn", msg, fields);
  },
  error: (msg: string, fields: Fields = {}) => {
    write("error", msg, fields);
  },
};
