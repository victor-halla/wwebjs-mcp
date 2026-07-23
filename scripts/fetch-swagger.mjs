#!/usr/bin/env node
/**
 * Refreshes the bundled swagger.json from upstream. Run `npm run fetch-swagger`
 * whenever the wwebjs-api adds new endpoints — the MCP tools regenerate
 * automatically on next start.
 */
import { writeFileSync } from "node:fs";

const URL =
  process.env.SWAGGER_URL ||
  "https://raw.githubusercontent.com/avoylenko/wwebjs-api/main/swagger.json";

const res = await fetch(URL);
if (!res.ok) {
  console.error(`Failed to fetch swagger: HTTP ${res.status}`);
  process.exit(1);
}
const text = await res.text();
JSON.parse(text); // validate
writeFileSync(new URL("../swagger.json", import.meta.url), text);
console.error(`Wrote swagger.json (${text.length} bytes) from ${URL}`);
