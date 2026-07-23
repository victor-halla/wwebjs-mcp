import { readFileSync } from "node:fs";
import type { Config } from "./config.js";
import { log } from "./log.js";

/** A JSON Schema object as used by MCP tool inputSchema. */
export type JsonSchema = Record<string, any>;

/** Describes where each input argument must go when building the HTTP call. */
export interface ParamLocation {
  path: string[]; // arg names that are path parameters
  query: string[]; // arg names that are query parameters
  body: string[]; // arg names that belong in the JSON body
}

export interface GeneratedTool {
  name: string;
  description: string;
  method: string; // GET, POST, DELETE ...
  pathTemplate: string; // e.g. /client/sendMessage/{sessionId}
  inputSchema: JsonSchema;
  location: ParamLocation;
}

interface OpenApiParam {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
  example?: unknown;
}

/**
 * Turn "/client/sendMessage/{sessionId}" + "post" into a stable, unique,
 * MCP-safe tool name like "client_sendMessage".
 */
function toolNameFor(method: string, path: string): string {
  const segments = path
    .split("/")
    .filter((s) => s && !s.startsWith("{"))
    .map((s) => s.replace(/[^a-zA-Z0-9]/g, ""));
  let name = segments.join("_");
  // A handful of paths only differ by having a trailing sub-resource
  // (e.g. /session/qr/{id} vs /session/qr/{id}/image). Keep the last static
  // segment already captured above; disambiguate GET vs POST on same path.
  if (!name) name = method.toLowerCase();
  // Prefix with method only when needed to stay unique (handled by caller).
  return name.slice(0, 64);
}

function normalizeExample(schema: JsonSchema | undefined, example: unknown) {
  if (example === undefined || schema === undefined) return schema;
  return { ...schema, examples: [example] };
}

/**
 * Build the MCP inputSchema (JSON Schema) and the arg->location map for one
 * OpenAPI operation.
 */
function buildInput(operation: any): {
  schema: JsonSchema;
  location: ParamLocation;
} {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const location: ParamLocation = { path: [], query: [], body: [] };

  const params: OpenApiParam[] = operation.parameters || [];
  for (const p of params) {
    if (p.in !== "path" && p.in !== "query") continue; // headers handled globally
    let sub: JsonSchema = { ...(p.schema || { type: "string" }) };
    if (p.description) sub.description = p.description;
    sub = normalizeExample(sub, p.example) as JsonSchema;
    properties[p.name] = sub;
    if (p.in === "path") {
      location.path.push(p.name);
      required.push(p.name); // path params are always required
    } else {
      location.query.push(p.name);
      if (p.required) required.push(p.name);
    }
  }

  const rb = operation.requestBody;
  if (rb) {
    const json =
      rb.content?.["application/json"] ||
      rb.content?.[Object.keys(rb.content || {})[0]];
    const bodySchema: JsonSchema | undefined = json?.schema;
    if (bodySchema?.type === "object" && bodySchema.properties) {
      for (const [key, valRaw] of Object.entries<JsonSchema>(
        bodySchema.properties
      )) {
        const val: JsonSchema = { ...valRaw };
        if (val.example !== undefined && val.examples === undefined) {
          val.examples = [val.example];
          delete val.example;
        }
        properties[key] = val;
        location.body.push(key);
      }
      if (Array.isArray(bodySchema.required)) {
        for (const r of bodySchema.required) {
          if (!required.includes(r)) required.push(r);
        }
      } else if (rb.required) {
        // Body is required but per-field requiredness unspecified: don't force
        // fields, but note it in the description-less object. Leave as optional
        // to keep the tool forgiving.
      }
    } else if (bodySchema) {
      // Non-object body (rare): expose a single free-form "body" arg.
      properties["body"] = {
        ...bodySchema,
        description: "Raw request body.",
      };
      location.body.push("body");
      if (rb.required) required.push("body");
    }
  }

  const schema: JsonSchema = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length) schema.required = Array.from(new Set(required));
  return { schema, location };
}

/**
 * Load the swagger.json and generate one GeneratedTool per operation,
 * applying the allow/deny lists from config.
 */
export function generateTools(config: Config): GeneratedTool[] {
  const raw = readFileSync(config.swaggerPath, "utf-8");
  const spec = JSON.parse(raw);
  const paths: Record<string, any> = spec.paths || {};

  const seen = new Map<string, number>();
  const tools: GeneratedTool[] = [];

  for (const [pathTemplate, methods] of Object.entries(paths)) {
    for (const [method, opRaw] of Object.entries<any>(methods)) {
      if (!["get", "post", "put", "delete", "patch"].includes(method))
        continue;
      const op = opRaw;

      let base = toolNameFor(method, pathTemplate);
      // Ensure uniqueness (e.g. GET and POST /client/getChats).
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      let name = base;
      if (count > 0) {
        name = `${method}_${base}`.slice(0, 64);
        // still guard against a second collision
        let n = 1;
        while (tools.some((t) => t.name === name)) {
          name = `${method}_${base}_${n++}`.slice(0, 64);
        }
      }

      const { schema, location } = buildInput(op);

      const summary = op.summary || name;
      const desc = op.description ? `${summary}. ${op.description}` : summary;
      const tag = (op.tags && op.tags[0]) || "";
      const description = `[${tag}] ${desc}`.trim();

      tools.push({
        name,
        description,
        method: method.toUpperCase(),
        pathTemplate,
        inputSchema: schema,
        location,
      });
    }
  }

  // Apply allow/deny lists.
  let filtered = tools;
  if (config.toolAllowlist) {
    const allow = new Set(config.toolAllowlist);
    filtered = filtered.filter((t) => allow.has(t.name));
  }
  if (config.toolDenylist.length) {
    const deny = new Set(config.toolDenylist);
    filtered = filtered.filter((t) => !deny.has(t.name));
  }

  log.info(
    `Generated ${filtered.length} tools from swagger (of ${tools.length} operations).`
  );
  return filtered;
}
