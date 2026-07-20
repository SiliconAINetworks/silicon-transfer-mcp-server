#!/usr/bin/env node
/**
 * Silicon Transfer MCP Server
 * FTP/SFTP/FTPS fuer Claude - mit eingebauten Transfer-Beweisen.
 * Grundsatz: erst beweisen, dann behaupten. Jeder Upload liefert seinen Hash-Beweis mit.
 *
 * Built from scratch by Silicon Networks (aegis888.com), 2026.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConnectionManager } from "./services/connection.js";
import { registerAll } from "./tools/register.js";

const SERVER_NAME = "silicon-transfer-mcp-server";
const SERVER_VERSION = "0.1.0";

const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
const connections = new ConnectionManager();

server.registerTool(
  "silicon_server_info",
  {
    title: "Server Info",
    description: "Name, Version und Philosophie dieses MCP-Servers. Lebenszeichen-Check.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async () => {
    const output = {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      philosophy: "erst beweisen, dann behaupten - every transfer returns its checksum proof",
      protocols: ["ftp", "ftps", "sftp"],
    };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  }
);

registerAll(server, connections);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} ${SERVER_VERSION} bereit (stdio)`);
}

main().catch((err) => {
  console.error("Serverstart fehlgeschlagen:", err);
  process.exit(1);
});
