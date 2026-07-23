import { request } from "undici";
import type { Config } from "./config.js";
import type { GeneratedTool } from "./swagger.js";
import { log } from "./log.js";

export interface CallResult {
  ok: boolean;
  status: number;
  /** Parsed JSON when possible, otherwise raw text. */
  data: unknown;
  /** Present when the response was binary (e.g. QR image, screenshot). */
  binary?: { mimeType: string; base64: string };
}

/**
 * Executes the HTTP call for a generated tool, routing arguments to path /
 * query / body according to the tool's location map.
 */
export async function callEndpoint(
  config: Config,
  tool: GeneratedTool,
  args: Record<string, unknown>
): Promise<CallResult> {
  // 1. Build the path, substituting {param} placeholders.
  let path = tool.pathTemplate;
  for (const name of tool.location.path) {
    const val = args[name];
    if (val === undefined || val === null || val === "") {
      throw new Error(`Missing required path parameter "${name}".`);
    }
    path = path.replace(
      `{${name}}`,
      encodeURIComponent(String(val))
    );
  }

  // 2. Query string.
  const url = new URL(config.apiBaseUrl + path);
  for (const name of tool.location.query) {
    const val = args[name];
    if (val !== undefined && val !== null) {
      url.searchParams.set(name, String(val));
    }
  }

  // 3. JSON body.
  let body: string | undefined;
  const headers: Record<string, string> = { accept: "application/json" };
  if (config.apiKey) headers["x-api-key"] = config.apiKey;

  if (tool.location.body.length && tool.method !== "GET") {
    const payload: Record<string, unknown> = {};
    for (const name of tool.location.body) {
      if (name === "body") {
        // free-form body passthrough
        headers["content-type"] = "application/json";
        body = JSON.stringify(args["body"]);
      } else if (args[name] !== undefined) {
        payload[name] = args[name];
      }
    }
    if (body === undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(payload);
    }
  }

  log.debug(`${tool.method} ${url.toString()}`, body ? `body=${body}` : "");

  const res = await request(url, {
    method: tool.method as any,
    headers,
    body,
    headersTimeout: config.requestTimeoutMs,
    bodyTimeout: config.requestTimeoutMs,
  });

  const status = res.statusCode;
  const contentType = String(res.headers["content-type"] || "");

  if (contentType.startsWith("image/") || contentType.startsWith("application/octet-stream")) {
    const buf = Buffer.from(await res.body.arrayBuffer());
    return {
      ok: status >= 200 && status < 300,
      status,
      data: null,
      binary: { mimeType: contentType.split(";")[0], base64: buf.toString("base64") },
    };
  }

  const text = await res.body.text();
  let data: unknown = text;
  if (contentType.includes("application/json") || (text && (text[0] === "{" || text[0] === "["))) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return { ok: status >= 200 && status < 300, status, data };
}
