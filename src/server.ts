import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "./config.js";
import { callEndpoint } from "./apiClient.js";
import { generateTools, type GeneratedTool } from "./swagger.js";
import { log } from "./log.js";

const SERVER_NAME = "wwebjs-mcp";
const SERVER_VERSION = "1.0.0";

/**
 * Builds a fully configured MCP Server whose tools are generated from the
 * wwebjs-api swagger. A fresh Server is returned per call so the HTTP
 * transport can create one instance per session.
 */
export function buildServer(config: Config): Server {
  const tools: GeneratedTool[] = generateTools(config);
  const byName = new Map(tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = byName.get(req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      };
    }

    const args = (req.params.arguments || {}) as Record<string, unknown>;

    try {
      const result = await callEndpoint(config, tool, args);

      if (result.binary) {
        // Return images (QR codes, screenshots) as image content parts.
        const isImage = result.binary.mimeType.startsWith("image/");
        return {
          isError: !result.ok,
          content: [
            {
              type: isImage ? "image" : "resource",
              ...(isImage
                ? { data: result.binary.base64, mimeType: result.binary.mimeType }
                : {
                    resource: {
                      blob: result.binary.base64,
                      mimeType: result.binary.mimeType,
                      uri: `wwebjs://${tool.name}`,
                    },
                  }),
            } as any,
          ],
        };
      }

      const pretty =
        typeof result.data === "string"
          ? result.data
          : JSON.stringify(result.data, null, 2);

      return {
        isError: !result.ok,
        content: [
          {
            type: "text",
            text: result.ok
              ? pretty
              : `HTTP ${result.status} from wwebjs-api:\n${pretty}`,
          },
        ],
      };
    } catch (err) {
      log.error(`Tool ${tool.name} failed:`, err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Request failed: ${(err as Error).message}`,
          },
        ],
      };
    }
  });

  return server;
}
