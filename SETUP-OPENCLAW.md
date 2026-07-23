# Agent runbook — connect OpenClaw / Hermes to `wwebjs-mcp`

> This file is written **for an AI agent (OpenClaw or Hermes) to execute**.
> Follow the steps top to bottom. Stop and report if any verification fails.
> Commands assume a Unix-like shell; adapt paths for your OS.

## 0. Facts you need before starting

Ask the operator for these if not already known:

| Value | Meaning | Example |
|---|---|---|
| `MCP_URL` | Streamable HTTP endpoint of the wwebjs-mcp container | `http://localhost:8080/mcp` |
| `MCP_AUTH_TOKEN` | Bearer token, **only if** the server sets one (else empty) | `s3cr3t` |
| `SESSION_ID` | The wwebjs-api session (logged-in WhatsApp number) to operate on | `main` |

`wwebjs-mcp` exposes **Streamable HTTP** MCP. Both OpenClaw (native remote MCP
since **v2026.3.13**) and Hermes Agent (native MCP since **v0.7**) support this
transport with **no plugins required**.

## 1. Verify the MCP server is reachable

```bash
curl -fsS "${MCP_URL%/mcp}/health"        # expect: {"status":"ok"}
```

If this fails, the container isn't up or the URL is wrong — do not continue.
Start it first: in the wwebjs-mcp project run `docker compose up -d` and re-check.

---

## 2A. If you are **OpenClaw**

OpenClaw reads MCP servers from `~/.openclaw/openclaw.json` under `mcp.servers`.

1. **Add the server** (create the file/keys if absent). Merge this into the
   existing JSON — do not overwrite unrelated keys:

   ```json
   {
     "mcp": {
       "servers": {
         "whatsapp": {
           "url": "REPLACE_WITH_MCP_URL",
           "headers": {
             "Authorization": "Bearer REPLACE_WITH_MCP_AUTH_TOKEN"
           }
         }
       }
     }
   }
   ```

   - If `MCP_AUTH_TOKEN` is empty, **omit the entire `headers` block**.
   - The transport (Streamable HTTP) is inferred from the `url`.

2. **Reload the gateway** so it picks up the new server:

   ```bash
   openclaw gateway restart
   ```

3. **Verify the tools loaded:**

   ```bash
   openclaw mcp list
   ```

   Confirm a `whatsapp` server appears with ~149 tools (names like
   `session_status`, `client_sendMessage`, `message_react`).

---

## 2B. If you are **Hermes Agent**

Hermes connects MCP servers through its tool system (native since v0.7; OAuth
2.1 supported from v0.8.0 — not needed here, we use a static bearer token).

1. Add the server to your Hermes MCP configuration (the servers block your
   Hermes version uses; typically a `mcpServers` map in the agent config):

   ```json
   {
     "mcpServers": {
       "whatsapp": {
         "type": "http",
         "url": "REPLACE_WITH_MCP_URL",
         "headers": { "Authorization": "Bearer REPLACE_WITH_MCP_AUTH_TOKEN" }
       }
     }
   }
   ```

   - `type: "http"` = Streamable HTTP. Omit `headers` if no token.

2. Restart / reload the Hermes agent so it connects to the server.

3. Confirm the `whatsapp` tools are exposed to the model (list tools in the
   Hermes UI/CLI). You should see the wwebjs tool set.

---

## 3. Smoke test the connection (either agent)

Call one **read-only** tool through your MCP tool interface:

- Tool: `session_status`
- Arguments: `{ "sessionId": "REPLACE_WITH_SESSION_ID" }`

Expected: a JSON status showing the session is connected/ready. If you get
HTTP 404, the session id is wrong — run `session_getSessions` (no args) to list
valid ids. If you get HTTP 403, the `WWEBJS_API_KEY` on the server is wrong
(that is fixed on the wwebjs-mcp container, not here).

## 4. First real action (only after operator confirms)

To send a test message, resolve the number then send:

1. `client_getNumberId` → `{ "sessionId": "<id>", "number": "5511999998888" }`
   → returns the serialized `chatId`.
2. `client_sendMessage` → `{ "sessionId": "<id>", "chatId": "<from step 1>",
   "contentType": "string", "content": "Test from OpenClaw ✅" }`

Do **not** send messages, join/leave groups, block contacts, or terminate
sessions without explicit operator approval.

---

## Notes / caveats

- Exact OpenClaw CLI command names (`openclaw gateway restart`, `openclaw mcp
  list`) are documented by the OpenClaw project; if a command is not found on
  this version, run `openclaw --help` and `openclaw mcp --help` to find the
  equivalent, then reload config and list servers.
- If your agent runs in its own container, `MCP_URL` must be reachable from
  *that* container — use the shared Docker network service name or
  `http://host.docker.internal:8080/mcp`, not `localhost`.
- The full usage guide for the WhatsApp tools lives in
  `.claude/skills/whatsapp-mcp/SKILL.md` in this repo.
