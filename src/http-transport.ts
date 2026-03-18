// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";

import { logger } from "./logger.js";

export interface HttpServerOptions {
  port: number;
  host: string;
  allowedOrigins: string[];
  serverFactory: () => McpServer;
}

export async function startHttpServer(options: HttpServerOptions): Promise<void> {
  const { port, host, allowedOrigins, serverFactory } = options;

  const app = createMcpExpressApp({ host });

  if (allowedOrigins.length > 0) {
    app.use(
      cors({
        origin: allowedOrigins,
        methods: ["GET", "POST", "DELETE"],
        allowedHeaders: ["Content-Type", "mcp-session-id"],
        exposedHeaders: ["mcp-session-id"],
      })
    );
  }

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.all("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
      } else if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            logger.info(`HTTP session initialized: ${newSessionId}`);
            transports.set(newSessionId, transport);
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports.has(sid)) {
            logger.info(`HTTP session closed: ${sid}`);
            transports.delete(sid);
          }
        };

        const server = serverFactory();
        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error("Error handling MCP HTTP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  const server = app.listen(port, host, () => {
    logger.info("Azure DevOps MCP HTTP server started", {
      host,
      port,
      endpoint: `http://${host}:${port}/mcp`,
      allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : "none (cross-origin requests blocked)",
    });
  });

  const shutdown = async () => {
    logger.info("Shutting down HTTP server...");
    for (const [sessionId, transport] of transports) {
      logger.info(`Closing session: ${sessionId}`);
      await transport.close();
    }
    transports.clear();
    server.close();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
