# AGENT.md — orientation for AI agents working on this repo

This file explains **what this project is, how it was built, and how to change
it**, so another AI agent (or human) can be productive without re-reading every
file. Read this first.

---

## 1. What this is

`wwebjs-mcp` is a **Model Context Protocol (MCP) server** that exposes the
[wwebjs-api](https://github.com/avoylenko/wwebjs-api) — a REST wrapper around
`whatsapp-web.js` — as MCP tools. It lets an AI client (OpenClaw, Hermes,
Claude Code, …) drive WhatsApp: manage sessions, send messages, handle chats,
groups, contacts, labels, channels, and messages.

- It is a **thin proxy**: it does not talk to WhatsApp directly. It forwards
  MCP tool calls to a *separately running* wwebjs-api instance over HTTP,
  injecting the `x-api-key` header.
- Deployment target: a **Docker container** configured entirely via `.env`.
- Transports: **Streamable HTTP** (default in container, `/mcp`) and **stdio**.

```
AI client ──MCP (HTTP/SSE | stdio)──▶ wwebjs-mcp ──REST (x-api-key)──▶ wwebjs-api ──▶ WhatsApp Web
```

The session id is **not** configuration — it is a per-call tool argument
(`sessionId`). One MCP server can drive many WhatsApp sessions.

---

## 2. The key design decision (read this before changing tools)

**Tools are generated dynamically at runtime from the OpenAPI/Swagger spec**
(`swagger.json`), not hand-written. On startup the server:

1. reads `swagger.json` (bundled in the image, refreshable from upstream),
2. iterates every path + method (149 operations at time of writing),
3. builds one MCP tool per operation, deriving the JSON Schema input from the
   operation's path params, query params, and JSON request-body properties,
4. registers a single generic handler that routes each call's arguments to the
   correct place (path / query / body) and performs the HTTP request.

**Consequence:** to support new WhatsApp API endpoints you normally change
**nothing** — just refresh `swagger.json` (`npm run fetch-swagger`) and restart.
Do **not** add per-endpoint code unless an endpoint needs special handling.

Tool naming: path segments minus `{params}`, joined by `_`
(`POST /client/sendMessage/{sessionId}` → `client_sendMessage`). When two
methods share a path, the second gets a method prefix (`post_client_getChats`).
This is guaranteed collision-free for the current spec (validated: 149 unique
names).

---

## 3. File map

| File | Role |
|---|---|
| `src/index.ts` | Entrypoint. Chooses transport (`MCP_TRANSPORT`). stdio → one server; http → Express app at `/mcp` with per-session `StreamableHTTPServerTransport`, optional bearer auth, `/health`. |
| `src/config.ts` | Loads **all** config from env vars into a typed `Config`. Any new setting goes here. |
| `src/swagger.ts` | The generator. `generateTools(config)` → `GeneratedTool[]`. Contains tool-naming, JSON-Schema building, allow/deny filtering. **Most tool-behavior changes happen here.** |
| `src/apiClient.ts` | `callEndpoint(config, tool, args)` — builds the URL/query/body from a tool's `location` map, adds `x-api-key`, calls the API via `undici`, returns `CallResult` (JSON or binary/base64 for images). |
| `src/server.ts` | Builds the MCP `Server`, wires `ListTools`/`CallTool` handlers, converts `CallResult` into MCP content (text or image). |
| `src/log.ts` | Logger. **Writes only to stderr** (stdout is reserved for stdio JSON-RPC). Always use `log.*`, never `console.log`. |
| `swagger.json` | Bundled OpenAPI 3.0 spec. Source of truth for the tool set. |
| `scripts/fetch-swagger.mjs` | Re-downloads `swagger.json` from upstream. |
| `Dockerfile` | Multi-stage (build → runtime), defaults to HTTP transport, healthcheck on `/health`. |
| `docker-compose.yml` | Runs the MCP only; commented block optionally runs wwebjs-api too. |
| `.env.example` | Documented template for `.env`. |
| `README.md` | Human setup: connect to existing wwebjs-api (Scenario A) or from scratch (Scenario B); client config. |
| `SETUP-OPENCLAW.md` | Runbook an OpenClaw/Hermes agent executes to self-configure the connection. |
| `.claude/skills/whatsapp-mcp/SKILL.md` | Task-oriented usage guide for the WhatsApp tools (for the client agent, not for building). |

---

## 4. How it was built (history & context)

- Language/SDK chosen: **TypeScript + `@modelcontextprotocol/sdk`** (matches the
  Node stack of wwebjs-api; mature SDK).
- Deployment shape chosen: **container that connects to an already-running
  wwebjs-api** (not bundling it), with HTTP + stdio transports.
- The low-level `Server` class is used (not the high-level `McpServer` with Zod
  shapes) **on purpose**: it accepts raw JSON Schema for `inputSchema`, which is
  what the swagger generator produces. Don't refactor to Zod-per-tool — it would
  fight the dynamic-generation design.
- The upstream spec is OpenAPI 3.0.0, `apiKeyAuth` via header `x-api-key`, and
  request bodies are `application/json` with per-property schemas + examples.
  Bodies with a non-object schema fall back to a single free-form `body` arg.

---

## 5. How to make common changes

### Add support for new WhatsApp API endpoints
1. `npm run fetch-swagger` (or replace `swagger.json`).
2. Rebuild/restart. New tools appear automatically. Nothing else to do.

### Add a new configuration option
1. Add the field + env parsing in `src/config.ts` (follow existing `bool`/`list`
   helpers).
2. Use it where needed. Document it in `.env.example` **and** the README config
   table.

### Change tool naming, descriptions, or input schemas
Edit `src/swagger.ts` (`toolNameFor`, `buildInput`, or the description assembly
in `generateTools`). If you change naming, re-check uniqueness across the whole
spec and update any names referenced in `SKILL.md` / `README.md`.

### Change how requests are sent (retries, headers, proxy)
Edit `src/apiClient.ts`. Keep the `x-api-key` injection and the binary/image
detection.

### Change how responses are returned to the client
Edit `src/server.ts` (`CallTool` handler). Images/screenshots/QR come back as
`{ type: "image", data, mimeType }`; everything else as pretty-printed text.

### Add/adjust a transport
Edit `src/index.ts`. HTTP uses per-session transports keyed by the
`mcp-session-id` header; a fresh `Server` is built per session via
`buildServer(config)`.

---

## 6. Build, run, verify

No Node/npm/Docker is assumed on the authoring machine — the build runs inside
Docker. Locally (if Node ≥20 present):

```bash
npm install
npm run build          # tsc -> dist/
MCP_TRANSPORT=stdio WWEBJS_API_URL=http://localhost:3000 WWEBJS_API_KEY=... npm start
```

Container:

```bash
cp .env.example .env   # set WWEBJS_API_URL, WWEBJS_API_KEY
docker compose up --build -d
curl http://localhost:8080/health           # {"status":"ok"}
```

Quick sanity check of generated tool names (Python, no Node needed):
```bash
python - <<'PY'
import json,re
s=json.load(open("swagger.json",encoding="utf-8"))
def base(p): return "_".join(re.sub(r'[^a-zA-Z0-9]','',x) for x in p.split('/') if x and not x.startswith('{'))[:64]
seen={}; names=[]
for p in s["paths"]:
    for m in s["paths"][p]:
        if m not in ("get","post","put","delete","patch"): continue
        b=base(p); c=seen.get(b,0); seen[b]=c+1
        names.append(b if c==0 else f"{m}_{b}"[:64])
print(len(names),"tools,",len(set(names)),"unique")
PY
```

---

## 7. Invariants — don't break these

- **Never write to stdout except JSON-RPC** (breaks stdio transport). Use
  `log.*` → stderr.
- **`x-api-key` must be sent on every API call** from `WWEBJS_API_KEY`.
- **Tool names must stay `^[a-zA-Z0-9_-]{1,64}$` and unique.**
- **Keep the dynamic-generation model.** Prefer fixing the generator over
  hand-coding tools.
- Destructive endpoints exist (`session_terminateAll`, `chat_delete`, …); they
  can be hidden via `MCP_TOOL_DENYLIST` — don't remove that mechanism.
- Bump `SERVER_VERSION` in `src/server.ts` and `version` in `package.json`
  together on releases.

---

## 8. Known limitations / TODO ideas

- No automated tests yet (a smoke test hitting `/health` + a mocked API would be
  a good add).
- `swagger.json` is pinned to the bundled copy; there is no runtime auto-refresh
  from upstream (intentional — deterministic tool set).
- No request retry/backoff in `apiClient.ts`.
- OpenClaw CLI command names in `SETUP-OPENCLAW.md` are sourced from third-party
  docs (official docs were network-blocked when authored) — verify against the
  running OpenClaw version.
