#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getBearerHandler, WebApi } from "azure-devops-node-api";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { createAuthenticator } from "./auth.js";
import { startHttpServer } from "./http-transport.js";
import { logger } from "./logger.js";
import { getOrgTenant } from "./org-tenants.js";
//import { configurePrompts } from "./prompts.js";
import { configureAllTools } from "./tools.js";
import { UserAgentComposer } from "./useragent.js";
import { packageVersion } from "./version.js";
import { DomainsManager } from "./shared/domains.js";
import { parseAllowedTools, parseDeniedTools } from "./shared/tools-filter.js";

function isGitHubCodespaceEnv(): boolean {
  return process.env.CODESPACES === "true" && !!process.env.CODESPACE_NAME;
}

const defaultAuthenticationType = isGitHubCodespaceEnv() ? "azcli" : "interactive";

// Parse command line arguments using yargs
const argv = yargs(hideBin(process.argv))
  .scriptName("mcp-server-azuredevops")
  .usage("Usage: $0 <organization> [options]")
  .version(packageVersion)
  .command("$0 <organization> [options]", "Azure DevOps MCP Server", (yargs) => {
    yargs.positional("organization", {
      describe: "Azure DevOps organization name",
      type: "string",
      demandOption: true,
    });
  })
  .option("domains", {
    alias: "d",
    describe: "Domain(s) to enable: 'all' for everything, or specific domains like 'repositories builds work'. Defaults to 'all'.",
    type: "string",
    array: true,
    default: "all",
  })
  .option("authentication", {
    alias: "a",
    describe: "Type of authentication to use",
    type: "string",
    choices: ["interactive", "azcli", "env", "envvar"],
    default: defaultAuthenticationType,
  })
  .option("tenant", {
    alias: "t",
    describe: "Azure tenant ID (optional, applied when using 'interactive' and 'azcli' type of authentication)",
    type: "string",
  })
  .option("transport", {
    alias: "T",
    describe: "Transport type: 'stdio' for standard I/O, 'http' for HTTP server",
    type: "string",
    choices: ["stdio", "http"],
    default: "stdio",
  })
  .option("port", {
    alias: "p",
    describe: "HTTP server port (only used with --transport http)",
    type: "number",
    default: 3000,
  })
  .option("host", {
    alias: "H",
    describe: "HTTP server bind address (only used with --transport http)",
    type: "string",
    default: "127.0.0.1",
  })
  .option("allowed-origins", {
    describe: "Allowed CORS origins for HTTP transport (e.g. 'http://host-a.corp' 'http://host-b.corp'). If omitted, cross-origin requests are blocked.",
    type: "string",
    array: true,
  })
  .option("tools", {
    describe: "Tool(s) to enable: 'all' for everything, or specific tool names like 'core_list_projects repo_list_repos_by_project'. Defaults to 'all'.",
    type: "string",
    array: true,
    default: "all",
  })
  .option("deny-tools", {
    describe: "Tool(s) to deny regardless of --tools. Useful for disabling specific tools when --tools is set to 'all'.",
    type: "string",
    array: true,
  })
  .check((argv) => {
    if (argv.transport === "stdio") {
      if (argv.port !== 3000) {
        logger.warn("--port is ignored when using stdio transport");
      }
      if (argv.host !== "127.0.0.1") {
        logger.warn("--host is ignored when using stdio transport");
      }
      if (argv["allowed-origins"] && argv["allowed-origins"].length > 0) {
        logger.warn("--allowed-origins is ignored when using stdio transport");
      }
    }
    return true;
  })
  .help()
  .parseSync();

export const orgName = argv.organization as string;
const orgUrl = "https://dev.azure.com/" + orgName;

const domainsManager = new DomainsManager(argv.domains);
export const enabledDomains = domainsManager.getEnabledDomains();

export const allowedTools = parseAllowedTools(argv.tools);
export const deniedTools = parseDeniedTools(argv["deny-tools"]);

function getAzureDevOpsClient(getAzureDevOpsToken: () => Promise<string>, userAgentComposer: UserAgentComposer): () => Promise<WebApi> {
  return async () => {
    const accessToken = await getAzureDevOpsToken();
    const authHandler = getBearerHandler(accessToken);
    const connection = new WebApi(orgUrl, authHandler, undefined, {
      productName: "AzureDevOps.MCP",
      productVersion: packageVersion,
      userAgent: userAgentComposer.userAgent,
    });
    return connection;
  };
}

async function resolveAuthenticator(): Promise<() => Promise<string>> {
  const tenantId = (await getOrgTenant(orgName)) ?? argv.tenant;
  return createAuthenticator(argv.authentication, tenantId);
}

function createMcpServer(authenticator: () => Promise<string>, toolFilter: Set<string> | null = null, toolDenyList: Set<string> | null = null): McpServer {
  const server = new McpServer({
    name: "Azure DevOps MCP Server",
    version: packageVersion,
    icons: [
      {
        src: "https://cdn.vsassets.io/content/icons/favicon.ico",
      },
    ],
  });

  const userAgentComposer = new UserAgentComposer(packageVersion);
  server.server.oninitialized = () => {
    userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
  };

  if (toolFilter !== null || toolDenyList !== null) {
    const _originalTool = server.tool.bind(server);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).tool = (name: string, ...rest: unknown[]) => {
      if (toolFilter !== null && !toolFilter.has(name)) {
        logger.debug(`Skipping tool registration: ${name} (not in allowed tools list)`);
        return undefined;
      }
      if (toolDenyList !== null && toolDenyList.has(name)) {
        logger.debug(`Skipping tool registration: ${name} (in denied tools list)`);
        return undefined;
      }
      return (_originalTool as (name: string, ...args: unknown[]) => unknown)(name, ...rest);
    };
  }

  // removing prompts until further notice
  // configurePrompts(server);

  configureAllTools(server, authenticator, getAzureDevOpsClient(authenticator, userAgentComposer), () => userAgentComposer.userAgent, enabledDomains);

  return server;
}

async function main() {
  logger.info("Starting Azure DevOps MCP Server", {
    organization: orgName,
    organizationUrl: orgUrl,
    authentication: argv.authentication,
    tenant: argv.tenant,
    transport: argv.transport,
    domains: argv.domains,
    enabledDomains: Array.from(enabledDomains),
    tools: allowedTools !== null ? Array.from(allowedTools) : "all",
    deniedTools: deniedTools !== null ? Array.from(deniedTools) : "none",
    version: packageVersion,
    isCodespace: isGitHubCodespaceEnv(),
  });

  const authenticator = await resolveAuthenticator();

  if (argv.transport === "http") {
    await startHttpServer({
      port: argv.port as number,
      host: argv.host as string,
      allowedOrigins: (argv["allowed-origins"] as string[] | undefined) ?? [],
      serverFactory: () => createMcpServer(authenticator, allowedTools, deniedTools),
    });
  } else {
    const server = createMcpServer(authenticator, allowedTools, deniedTools);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((error) => {
  logger.error("Fatal error in main():", error);
  process.exit(1);
});
