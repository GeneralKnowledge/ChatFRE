type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

const SECRET_KEYS = /key|token|secret|password|authorization/i;

function redact(fields?: LogFields): LogFields | undefined {
  if (!fields) return fields;
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SECRET_KEYS.test(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "string" && v.length > 500) {
      out[k] = `${v.slice(0, 200)}…[truncated ${v.length} chars]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function createLogger(scope: string) {
  const write = (level: LogLevel, message: string, fields?: LogFields) => {
    const entry = {
      level,
      scope,
      message,
      time: new Date().toISOString(),
      ...redact(fields),
    };
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };

  return {
    debug: (message: string, fields?: LogFields) =>
      write("debug", message, fields),
    info: (message: string, fields?: LogFields) =>
      write("info", message, fields),
    warn: (message: string, fields?: LogFields) =>
      write("warn", message, fields),
    error: (message: string, fields?: LogFields) =>
      write("error", message, fields),
  };
}
