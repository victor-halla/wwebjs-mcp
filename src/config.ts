/**
 * Runtime configuration, read entirely from environment variables so the
 * whole server can be customized via the container's .env file.
 */

export type TransportKind = "stdio" | "http";

export interface Config {
  /** Base URL of the running wwebjs-api instance, e.g. http://wwebjs-api:3000 */
  apiBaseUrl: string;
  /** Value sent in the x-api-key header on every request. */
  apiKey: string | undefined;
  /** Which MCP transport to expose. */
  transport: TransportKind;
  /** Port for the HTTP/SSE transport (ignored for stdio). */
  httpPort: number;
  /** Host to bind the HTTP transport to. */
  httpHost: string;
  /** Optional bearer token required from MCP clients on the HTTP transport. */
  mcpAuthToken: string | undefined;
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs: number;
  /**
   * Optional allow-list of tool names (comma separated). When set, only these
   * tools are exposed. Useful to restrict a deployment to e.g. messaging only.
   */
  toolAllowlist: string[] | null;
  /**
   * Optional deny-list of tool names (comma separated). Applied after the
   * allow-list. Handy to hide destructive endpoints like terminateAll.
   */
  toolDenylist: string[];
  /** Absolute path to the bundled swagger.json used to generate tools. */
  swaggerPath: string;
  /** Log verbosity. */
  logLevel: "debug" | "info" | "warn" | "error";
}

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

function list(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(): Config {
  const transport = (process.env.MCP_TRANSPORT || "stdio").toLowerCase();
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(
      `Invalid MCP_TRANSPORT "${transport}". Use "stdio" or "http".`
    );
  }

  const apiBaseUrl = (
    process.env.WWEBJS_API_URL || "http://localhost:3000"
  ).replace(/\/+$/, "");

  const allow = list(process.env.MCP_TOOL_ALLOWLIST);

  return {
    apiBaseUrl,
    apiKey: process.env.WWEBJS_API_KEY || undefined,
    transport: transport as TransportKind,
    httpPort: Number(process.env.MCP_HTTP_PORT || 8080),
    httpHost: process.env.MCP_HTTP_HOST || "0.0.0.0",
    mcpAuthToken: process.env.MCP_AUTH_TOKEN || undefined,
    requestTimeoutMs: Number(process.env.WWEBJS_TIMEOUT_MS || 60000),
    toolAllowlist: allow.length ? allow : null,
    toolDenylist: list(process.env.MCP_TOOL_DENYLIST),
    swaggerPath:
      process.env.WWEBJS_SWAGGER_PATH ||
      new URL("../swagger.json", import.meta.url).pathname,
    logLevel: (process.env.LOG_LEVEL as Config["logLevel"]) || "info",
  };
}
