// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseAllowedTools, parseDeniedTools } from "../../src/shared/tools-filter";
import { configureCoreTools } from "../../src/tools/core";
import { WebApi } from "azure-devops-node-api";

// ---------------------------------------------------------------------------
// parseAllowedTools
// ---------------------------------------------------------------------------

describe("parseAllowedTools", () => {
  it("returns null when input is undefined", () => {
    expect(parseAllowedTools(undefined)).toBeNull();
  });

  it("returns null for the string 'all'", () => {
    expect(parseAllowedTools("all")).toBeNull();
  });

  it("returns null when the array contains 'all'", () => {
    expect(parseAllowedTools(["all"])).toBeNull();
    expect(parseAllowedTools(["core_list_projects", "all"])).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(parseAllowedTools([])).toBeNull();
  });

  it("returns a Set for a single tool name string", () => {
    const result = parseAllowedTools("core_list_projects");
    expect(result).toBeInstanceOf(Set);
    expect(result?.has("core_list_projects")).toBe(true);
    expect(result?.size).toBe(1);
  });

  it("returns a Set for an array of tool names", () => {
    const result = parseAllowedTools(["core_list_projects", "repo_list_repos_by_project"]);
    expect(result).toBeInstanceOf(Set);
    expect(result?.has("core_list_projects")).toBe(true);
    expect(result?.has("repo_list_repos_by_project")).toBe(true);
    expect(result?.size).toBe(2);
  });

  it("trims whitespace from tool names", () => {
    const result = parseAllowedTools(["  core_list_projects  ", "repo_list_repos_by_project "]);
    expect(result?.has("core_list_projects")).toBe(true);
    expect(result?.has("repo_list_repos_by_project")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseDeniedTools
// ---------------------------------------------------------------------------

describe("parseDeniedTools", () => {
  it("returns null when input is undefined", () => {
    expect(parseDeniedTools(undefined)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(parseDeniedTools([])).toBeNull();
  });

  it("returns a Set for a single tool name string", () => {
    const result = parseDeniedTools("core_list_projects");
    expect(result).toBeInstanceOf(Set);
    expect(result?.has("core_list_projects")).toBe(true);
    expect(result?.size).toBe(1);
  });

  it("returns a Set for an array of tool names", () => {
    const result = parseDeniedTools(["core_list_projects", "repo_list_repos_by_project"]);
    expect(result).toBeInstanceOf(Set);
    expect(result?.has("core_list_projects")).toBe(true);
    expect(result?.has("repo_list_repos_by_project")).toBe(true);
    expect(result?.size).toBe(2);
  });

  it("trims whitespace from tool names", () => {
    const result = parseDeniedTools(["  core_list_projects  ", "repo_list_repos_by_project "]);
    expect(result?.has("core_list_projects")).toBe(true);
    expect(result?.has("repo_list_repos_by_project")).toBe(true);
  });

  it("filters out empty strings after trimming", () => {
    const result = parseDeniedTools(["core_list_projects", "   "]);
    expect(result?.has("core_list_projects")).toBe(true);
    expect(result?.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tool filter wrapping — mirrors the createMcpServer wrapping in index.ts
// ---------------------------------------------------------------------------

function applyFilters(server: McpServer, filter: Set<string> | null, denyList: Set<string> | null): void {
  if (filter === null && denyList === null) return;
  const _original = server.tool.bind(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool = (name: string, ...rest: unknown[]) => {
    if (filter !== null && !filter.has(name)) return undefined;
    if (denyList !== null && denyList.has(name)) return undefined;
    return (_original as (name: string, ...args: unknown[]) => unknown)(name, ...rest);
  };
}

describe("tool filter wrapping", () => {
  let originalToolFn: jest.Mock;
  let server: McpServer;
  let connectionProvider: () => Promise<WebApi>;

  beforeEach(() => {
    originalToolFn = jest.fn().mockReturnValue({});
    server = {
      tool: originalToolFn,
      server: { elicitInput: jest.fn() },
    } as unknown as McpServer;
    connectionProvider = jest.fn();
  });

  it("registers all core tools when no filter is applied (null)", () => {
    applyFilters(server, null, null);
    configureCoreTools(server, jest.fn(), connectionProvider, () => "test");

    const registeredNames = originalToolFn.mock.calls.map(([name]: [string]) => name);
    expect(registeredNames).toContain("core_list_projects");
    expect(registeredNames).toContain("core_list_project_teams");
    expect(registeredNames).toContain("core_get_identity_ids");
  });

  it("registers only the allowed tool when a single-tool filter is applied", () => {
    applyFilters(server, new Set(["core_list_projects"]), null);
    configureCoreTools(server, jest.fn(), connectionProvider, () => "test");

    const registeredNames = originalToolFn.mock.calls.map(([name]: [string]) => name);
    expect(registeredNames).toEqual(["core_list_projects"]);
  });

  it("registers multiple allowed tools when a multi-tool filter is applied", () => {
    applyFilters(server, new Set(["core_list_projects", "core_get_identity_ids"]), null);
    configureCoreTools(server, jest.fn(), connectionProvider, () => "test");

    const registeredNames = originalToolFn.mock.calls.map(([name]: [string]) => name);
    expect(registeredNames).toContain("core_list_projects");
    expect(registeredNames).toContain("core_get_identity_ids");
    expect(registeredNames).not.toContain("core_list_project_teams");
  });

  it("registers no tools when the filter contains no matching tool names", () => {
    applyFilters(server, new Set(["nonexistent_tool"]), null);
    configureCoreTools(server, jest.fn(), connectionProvider, () => "test");

    expect(originalToolFn).not.toHaveBeenCalled();
  });

  // deny-list tests

  it("denies specific tools when a deny list is applied", () => {
    applyFilters(server, null, new Set(["core_list_project_teams"]));
    configureCoreTools(server, jest.fn(), connectionProvider, () => "test");

    const registeredNames = originalToolFn.mock.calls.map(([name]: [string]) => name);
    expect(registeredNames).toContain("core_list_projects");
    expect(registeredNames).toContain("core_get_identity_ids");
    expect(registeredNames).not.toContain("core_list_project_teams");
  });

  it("denies multiple tools when a multi-entry deny list is applied", () => {
    applyFilters(server, null, new Set(["core_list_projects", "core_list_project_teams"]));
    configureCoreTools(server, jest.fn(), connectionProvider, () => "test");

    const registeredNames = originalToolFn.mock.calls.map(([name]: [string]) => name);
    expect(registeredNames).toEqual(["core_get_identity_ids"]);
  });

  it("deny list takes precedence over allow list when both are specified", () => {
    // Allow core_list_projects and core_get_identity_ids, but deny core_list_projects.
    applyFilters(server, new Set(["core_list_projects", "core_get_identity_ids"]), new Set(["core_list_projects"]));
    configureCoreTools(server, jest.fn(), connectionProvider, () => "test");

    const registeredNames = originalToolFn.mock.calls.map(([name]: [string]) => name);
    expect(registeredNames).toEqual(["core_get_identity_ids"]);
  });

  it("registers no tools when the deny list blocks all allowed tools", () => {
    applyFilters(server, new Set(["core_list_projects"]), new Set(["core_list_projects"]));
    configureCoreTools(server, jest.fn(), connectionProvider, () => "test");

    expect(originalToolFn).not.toHaveBeenCalled();
  });
});
