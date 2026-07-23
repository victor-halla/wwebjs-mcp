import type { Config } from "./config.js";

const order = { debug: 10, info: 20, warn: 30, error: 40 };

let current: Config["logLevel"] = "info";

export function setLogLevel(level: Config["logLevel"]) {
  current = level;
}

function emit(level: Config["logLevel"], args: unknown[]) {
  if (order[level] < order[current]) return;
  // IMPORTANT: never write logs to stdout — on the stdio transport stdout
  // carries JSON-RPC frames. Everything goes to stderr.
  const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
  console.error(prefix, ...args);
}

export const log = {
  debug: (...a: unknown[]) => emit("debug", a),
  info: (...a: unknown[]) => emit("info", a),
  warn: (...a: unknown[]) => emit("warn", a),
  error: (...a: unknown[]) => emit("error", a),
};
