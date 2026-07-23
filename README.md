# wwebjs-mcp

MCP server that exposes the [wwebjs-api](https://github.com/avoylenko/wwebjs-api)
(WhatsApp Web REST API) as **Model Context Protocol tools**. It runs as a Docker
container, is configured entirely through `.env`, and **all ~149 API endpoints
are exposed automatically** — the tools are generated at startup from the
upstream `swagger.json`, so new endpoints appear with no code changes.

## How it works

```
MCP client  ──MCP (stdio | HTTP/SSE)──▶  wwebjs-mcp  ──REST (x-api-key)──▶  wwebjs-api  ──▶  WhatsApp Web
```

- On startup the server reads `swagger.json` and turns every operation into an
  MCP tool (`session_start`, `client_sendMessage`, `message_react`,
  `groupChat_addParticipants`, …).
- Path parameters (`{sessionId}`), query params, and JSON body fields are all
  derived from the spec and validated via each tool's JSON Schema.
- The `x-api-key` header is injected on every call from `WWEBJS_API_KEY`.
- Binary responses (QR image, page screenshot) are returned as MCP image
  content.

## Prerequisites

- **Docker Engine** and **Docker Compose v2** (`docker compose version` should
  print something; if you only have the old `docker-compose` binary, upgrade
  Docker Desktop/Engine).
- Either an existing **wwebjs-api** instance you can reach (→ Scenario A), or
  none at all — this repo can run one for you too (→ Scenario B).

## Get the code

```bash
git clone https://github.com/victor-halla/wwebjs-mcp.git
cd wwebjs-mcp
```

(SSH clone: `git clone git@github.com:victor-halla/wwebjs-mcp.git`, if you
have a deploy key or your own key registered on GitHub.)

Then continue with whichever scenario matches your setup below. Both end with
the same two commands:

```bash
docker compose up --build -d      # builds the image and starts the container(s)
curl http://localhost:8080/health # -> {"status":"ok"} once it's up
```

## Scenario A — connect to an existing wwebjs-api container

Use this when you **already run wwebjs-api**, with its `API_KEY` set and a
session (a logged-in WhatsApp number) already created.

You need three things from the running instance:

1. **Base URL** — how *this* MCP container reaches the wwebjs-api container.
2. **API key** — the value of `API_KEY` on the wwebjs-api server.
3. **Session ID** — the id of the already-configured session. Confirm it with:
   ```bash
   curl -H "x-api-key: <API_KEY>" http://<host>:3000/session/getSessions
   curl -H "x-api-key: <API_KEY>" http://<host>:3000/session/status/<sessionId>
   ```
   A ready session returns a connected/authenticated state — no QR needed.

### 1. Pick the right `WWEBJS_API_URL` (container networking)

| How wwebjs-api runs | `WWEBJS_API_URL` in `.env` |
|---|---|
| Its own container on a **shared Docker network** | `http://<wwebjs-service-or-container-name>:3000` |
| A container publishing port 3000 on the **host** | `http://host.docker.internal:3000` (already wired in `docker-compose.yml`) |
| A **remote** server | `http://<remote-host-or-domain>:3000` (or `https://…`) |

To share a network with an existing container, find/create the network and
attach this service to it:

```bash
docker network ls                          # find the existing network name
docker inspect <wwebjs-container> --format '{{json .NetworkSettings.Networks}}'
```

Then in `docker-compose.yml` add (external = the network already created by your
wwebjs-api stack):

```yaml
services:
  wwebjs-mcp:
    networks: [wa-net]
networks:
  wa-net:
    external: true
    name: <existing-network-name>
```

…and set `WWEBJS_API_URL=http://<wwebjs-container-name>:3000` in `.env`.

### 2. Configure `.env` and start

```bash
cp .env.example .env
```
```dotenv
WWEBJS_API_URL=http://wwebjs-api:3000     # or host.docker.internal:3000
WWEBJS_API_KEY=<the API_KEY of your wwebjs-api>
MCP_TRANSPORT=http
MCP_HTTP_PORT=8080
MCP_AUTH_TOKEN=<optional token AI clients must present>
```
```bash
docker compose up --build -d
curl http://localhost:8080/health          # -> {"status":"ok"}
```

The MCP endpoint is now at `http://localhost:8080/mcp` (Streamable HTTP).

> The session id is **not** an env var — it is passed as the `sessionId`
> argument on each tool call by the AI client (e.g. `session_status`,
> `client_sendMessage`). Just tell your AI agent which `sessionId` to use.

## Scenario B — set up everything from scratch

Use this when you have no wwebjs-api yet. Run both containers together.

1. In `docker-compose.yml`, **uncomment the `wwebjs-api` service** at the bottom
   and set in `.env`:
   ```dotenv
   WWEBJS_API_URL=http://wwebjs-api:3000
   WWEBJS_API_KEY=<choose-a-strong-key>
   MCP_TRANSPORT=http
   ```
2. Start the stack:
   ```bash
   docker compose up --build -d
   ```
3. Create and log in a session (pick any id, e.g. `main`). Either drive it via
   your AI client's tools (`session_start` → `session_qr_image` → scan), or by
   curl directly against wwebjs-api:
   ```bash
   curl -H "x-api-key: $WWEBJS_API_KEY" http://localhost:3000/session/start/main
   # open the QR image in a browser and scan it with WhatsApp > Linked devices:
   #   http://localhost:3000/session/qr/main/image   (send x-api-key header)
   curl -H "x-api-key: $WWEBJS_API_KEY" http://localhost:3000/session/status/main
   ```
   Alternatively use phone pairing via the `session_requestPairingCode` tool.
4. Once `status` reports connected, the session persists on disk (the `sessions`
   volume) and is reused on restart. From then on it behaves like Scenario A.

## Authentication

The HTTP transport supports an optional bearer token: set `MCP_AUTH_TOKEN` in
`.env` and every client must send `Authorization: Bearer <token>` on `/mcp`,
or the server replies `401`. Generate a strong token with:

```bash
openssl rand -hex 32
```

Leave `MCP_AUTH_TOKEN` empty only for local, loopback-only testing. **Always
set it before exposing the server outside `localhost`** (e.g. via the
Cloudflare Tunnel below) — without it, anyone who can reach the URL gets full
access to every WhatsApp session.

## Connecting an AI client (OpenClaw, Claude Code, VS Code, etc.)

The container speaks **Streamable HTTP MCP** at `POST/GET /mcp`. Point any
MCP-capable client at it.

### Claude Code

Project-scoped, via `.mcp.json` in the repo root of the project you want the
tools available in:

```json
{
  "mcpServers": {
    "whatsapp": {
      "type": "http",
      "url": "http://<mcp-host>:8080/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

Or register it with the CLI instead of hand-editing JSON:

```bash
claude mcp add --transport http whatsapp http://<mcp-host>:8080/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

### VS Code

Create `.vscode/mcp.json` in the workspace (note: VS Code uses a top-level
`servers` key, not `mcpServers`):

```json
{
  "servers": {
    "whatsapp": {
      "type": "http",
      "url": "http://<mcp-host>:8080/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

Then enable it from the Command Palette (MCP: List Servers /
MCP: Add Server) if it isn't picked up automatically. Check your VS Code
version's MCP docs if the schema has moved since this was written.

### Generic / any other MCP client

Most clients follow the same shape as Claude Code above (`mcpServers` map with
`type: "http"`, `url`, optional `headers`). Point `url` at `/mcp` and, if
`MCP_AUTH_TOKEN` is set, include the `Authorization: Bearer` header.

- Omit the `headers` block if `MCP_AUTH_TOKEN` is empty.
- If the AI tool runs in its own container, use a URL it can reach the MCP
  container by (shared Docker network name, or `host.docker.internal:8080`).
- Tell the agent which **session id** to operate on; it passes `sessionId` on
  every tool call. See the `whatsapp-mcp` skill for the usage playbook.

**stdio transport** (local process instead of HTTP) — set `MCP_TRANSPORT=stdio`
and have the client launch `node dist/index.js` with the same env vars.

## Using the included Claude Code skill

This repo ships a Claude Code skill at
[`.claude/skills/whatsapp-mcp/SKILL.md`](.claude/skills/whatsapp-mcp/SKILL.md).
It's a task-oriented playbook for the *agent using the tools* (not for
building this server): connecting a session (QR/pairing code), sending
text/media/location/poll messages, resolving `chatId`/`messageId` correctly,
managing chats/groups/contacts/labels/channels, and which actions to confirm
with the user before calling (`session_terminateAll`, `chat_delete`, …).

Skills are project-scoped, and you'll normally be using the WhatsApp tools
from a *different* project than this one (this repo's job is just to run the
server). Copy the skill folder wherever you need it:

```bash
# Available only in one project:
mkdir -p /path/to/your-project/.claude/skills
cp -r .claude/skills/whatsapp-mcp /path/to/your-project/.claude/skills/

# Or available to Claude Code in every project on this machine:
mkdir -p ~/.claude/skills
cp -r .claude/skills/whatsapp-mcp ~/.claude/skills/
```

Once the skill is in place and the MCP server is connected (previous
section), Claude Code loads it automatically — no manual setup beyond
copying the folder. It triggers on its own whenever you ask for something
WhatsApp-related ("send a WhatsApp message to...", "list my WhatsApp
chats..."), or you can invoke it explicitly with `/whatsapp-mcp`.

## Exposing over HTTPS (Cloudflare Tunnel)

To reach this server from outside your network (e.g. a hosted AI client that
can't reach your LAN) without opening an inbound port, run it behind a
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

1. In the Cloudflare Zero Trust dashboard, create a tunnel and add a public
   hostname pointing at service `http://wwebjs-mcp:8080` (the Docker service
   name — `cloudflared` reaches it over the compose network, no host port
   needed).
2. Copy the tunnel token into `.env`:
   ```dotenv
   CLOUDFLARE_TUNNEL_TOKEN=<token from the dashboard>
   ```
3. **Set `MCP_AUTH_TOKEN`** (see Authentication above) — the tunnel makes
   `/mcp` reachable from the public internet.
4. Uncomment the `cloudflared` service at the bottom of `docker-compose.yml`
   and start it:
   ```bash
   docker compose up -d cloudflared
   ```
5. Point your MCP client's `url` at `https://<your-tunnel-hostname>/mcp`
   instead of the local address.

No other code changes are needed — the server already sets Express's
`trust proxy`, so it correctly reads the original client's protocol/IP from
the `X-Forwarded-*` headers Cloudflare adds. `/health` stays reachable without
the bearer token (used by the container's own Docker healthcheck); every
`/mcp` call still requires it.

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `WWEBJS_API_URL` | `http://localhost:3000` | Base URL of the wwebjs-api server |
| `WWEBJS_API_KEY` | – | Sent as `x-api-key` on every request |
| `WWEBJS_TIMEOUT_MS` | `60000` | Per-request timeout |
| `MCP_TRANSPORT` | `stdio` (image: `http`) | `http` or `stdio` |
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` | `0.0.0.0` / `8080` | HTTP bind address |
| `MCP_AUTH_TOKEN` | – | Optional bearer token for MCP clients |
| `MCP_TOOL_ALLOWLIST` | – | Only expose these tools (comma sep.) |
| `MCP_TOOL_DENYLIST` | – | Hide these tools (e.g. `session_terminateAll`) |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `CLOUDFLARE_TUNNEL_TOKEN` | – | Token for the optional `cloudflared` service (HTTPS exposure) |

## Development

```bash
npm install
npm run build
MCP_TRANSPORT=stdio WWEBJS_API_URL=http://localhost:3000 WWEBJS_API_KEY=... npm start
```

Refresh the endpoint list from upstream at any time:

```bash
npm run fetch-swagger   # re-downloads swagger.json
```

## Tool naming

Tools are named `<segments>` joined by `_`, dropping path params:

| Endpoint | Tool |
|---|---|
| `GET /session/start/{sessionId}` | `session_start` |
| `POST /client/sendMessage/{sessionId}` | `client_sendMessage` |
| `POST /message/react/{sessionId}` | `message_react` |
| `POST /groupChat/addParticipants/{sessionId}` | `groupChat_addParticipants` |

When two methods share a path (e.g. `GET`/`POST /client/getChats`), the second
is prefixed with its method (`post_client_getChats`).
