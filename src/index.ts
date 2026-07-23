#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import express from "express";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { log, setLogLevel } from "./log.js";

async function runStdio() {
  const config = loadConfig();
  const server = buildServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info(
    `wwebjs-mcp started on stdio -> API ${config.apiBaseUrl}`
  );
}

async function runHttp() {
  const config = loadConfig();
  const app = express();
  // Behind a reverse proxy / tunnel (e.g. Cloudflare Tunnel) so req.ip and
  // req.protocol reflect the original client via X-Forwarded-* headers.
  app.set("trust proxy", true);
  app.use(express.json({ limit: "50mb" }));

  // Optional bearer-token gate for MCP clients.
  const requireAuth: express.RequestHandler = (req, res, next) => {
    if (!config.mcpAuthToken) return next();
    const header = req.headers["authorization"] || "";
    const token = header.toString().replace(/^Bearer\s+/i, "");
    if (token !== config.mcpAuthToken) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }
    next();
  };

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Session-aware Streamable HTTP transports.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", requireAuth, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport!);
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      const server = buildServer(config);
      await server.connect(transport);
    }

    if (!transport) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "No valid session; send initialize first." },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  // GET/DELETE for SSE stream + session teardown.
  const sessionRoute: express.RequestHandler = async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing session id");
      return;
    }
    await transport.handleRequest(req, res);
  };
  app.get("/mcp", requireAuth, sessionRoute);
  app.delete("/mcp", requireAuth, sessionRoute);

  app.listen(config.httpPort, config.httpHost, () => {
    log.info(
      `wwebjs-mcp (Streamable HTTP) listening on http://${config.httpHost}:${config.httpPort}/mcp -> API ${config.apiBaseUrl}`
    );
  });
}

async function main() {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  if (config.transport === "http") {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  log.error("Fatal:", err);
  process.exit(1);
});
