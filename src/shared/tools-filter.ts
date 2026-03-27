// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Parses the --tools CLI option into a Set of allowed tool names, or null when all tools are allowed.
 *
 * @param toolsInput - Either "all", a single tool name, or an array of tool names.
 * @returns A Set of allowed tool names, or null when all tools should be registered.
 */
export function parseAllowedTools(toolsInput: string | string[] | undefined): Set<string> | null {
  if (!toolsInput) return null;
  const inputs = Array.isArray(toolsInput) ? toolsInput : [toolsInput];
  if (inputs.length === 0 || inputs.includes("all")) return null;
  return new Set(inputs.map((t) => t.trim()));
}

/**
 * Parses the --deny-tools CLI option into a Set of denied tool names, or null when nothing is denied.
 *
 * @param denyInput - A single tool name or an array of tool names to deny.
 * @returns A Set of denied tool names, or null when no tools are denied.
 */
export function parseDeniedTools(denyInput: string | string[] | undefined): Set<string> | null {
  if (!denyInput) return null;
  const inputs = Array.isArray(denyInput) ? denyInput : [denyInput];
  if (inputs.length === 0) return null;
  return new Set(inputs.map((t) => t.trim()).filter(Boolean));
}
