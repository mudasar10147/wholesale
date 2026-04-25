type LogMeta = Record<string, unknown> | undefined;

function write(level: "debug" | "info" | "warn" | "error", message: string, meta?: LogMeta) {
  if (meta && Object.keys(meta).length > 0) {
    console[level](message, meta);
    return;
  }
  console[level](message);
}

export const logger = {
  debug(message: string, meta?: LogMeta) {
    write("debug", message, meta);
  },
  info(message: string, meta?: LogMeta) {
    write("info", message, meta);
  },
  warn(message: string, meta?: LogMeta) {
    write("warn", message, meta);
  },
  error(message: string, meta?: LogMeta) {
    write("error", message, meta);
  },
};
