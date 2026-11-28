import { GOOGLE_DRIVE_TOOL_PREFIX } from "../../../../lib/integrations/googleDrive";
import { isGoogleWorkspaceTool } from "../../../../lib/integrations/googleWorkspace";
import { toolName } from "./toolSchemas";

/**
 * What a tool of the assistant does, declared once per tool.
 *
 * A turn that a connected application starts (the built-in MCP server) is
 * given only the capabilities its connection was granted (`allowedCapabilities`
 * on `runLLMStream`): "read" always, "run" with litt.run, "write" with
 * litt.write, and never "connector" or "person". A turn started in the web app or the Word
 * add-in passes nothing and keeps every tool.
 *
 * The decision is default-deny: a tool that is not declared here, or that
 * needs a capability the turn does not hold, is neither offered to the model
 * nor dispatched if the model names it anyway. A tool added later therefore
 * stays out of connected-app turns until it is declared on purpose
 * (toolCapabilities.test.ts fails for a tool that is advertised without one).
 */
export type ToolCapability = "read" | "run" | "write" | "connector" | "person";

/**
 * Every capability a tool needs; it is allowed only when the turn holds all of them.
 * "person" means the person is present in LiTT to answer a question.
 */
export const TOOL_CAPABILITIES: Readonly<Record<string, readonly ToolCapability[]>> = {
  // A question to the person pauses the turn until they answer it in LiTT.
  ask_inputs: ["read", "person"],
  // Reads: documents, workflows, tables, the web.
  create_text_card: ["read"],
  read_document: ["read"],
  find_documents: ["read"],
  find_in_document: ["read"],
  list_documents: ["read"],
  fetch_documents: ["read"],
  list_workflows: ["read"],
  read_workflow: ["read"],
  list_playbooks: ["read"],
  read_table_cells: ["read"],
  list_firm_criteria: ["read"],
  compute_methodology: ["read"],
  web_search: ["read"],
  read_webpage: ["read"],
  // Subagents run under the same capabilities as the turn that spawned them.
  delegate: ["read"],
  ask_parent: ["read"],
  read_active_document: ["read"],
  // Writes: they create documents or rewrite a document's versions.
  edit_document: ["write"],
  replicate_document: ["write"],
  generate_docx: ["write"],
  generate_excel: ["write"],
  generate_ppt: ["write"],
  apply_word_edits: ["write"],
  // A playbook review spends the review engine and saves its suggestions.
  run_playbook: ["run", "write"],
};

const isConnectorToolName = (name: string): boolean =>
  name.startsWith("mcp_") ||
  name.startsWith(GOOGLE_DRIVE_TOOL_PREFIX) ||
  isGoogleWorkspaceTool(name);

/** What a tool needs; null when nobody declared it (and it is no connector tool). */
export function requiredCapabilities(
  name: string | null | undefined,
): readonly ToolCapability[] | null {
  if (!name) return null;
  if (Object.hasOwn(TOOL_CAPABILITIES, name)) return TOOL_CAPABILITIES[name];
  return isConnectorToolName(name) ? ["connector"] : null;
}

/** `allowed` undefined means the turn is not narrowed. */
export function holdsCapability(
  allowed: readonly ToolCapability[] | undefined,
  capability: ToolCapability,
): boolean {
  return !allowed || allowed.includes(capability);
}

export function isToolAllowed(
  name: string | null | undefined,
  allowed: readonly ToolCapability[] | undefined,
): boolean {
  if (!allowed) return true;
  const needed = requiredCapabilities(name);
  return !!needed && needed.every((capability) => allowed.includes(capability));
}

/** The tool list a narrowed turn may be shown; the list itself when not narrowed. */
export function withAllowedTools<T>(
  tools: T[],
  allowed: readonly ToolCapability[] | undefined,
): T[] {
  return allowed ? tools.filter((tool) => isToolAllowed(toolName(tool), allowed)) : tools;
}

/**
 * Was this turn started by a connected application? Such a turn carries the
 * capabilities its connection was granted; a turn started in the web app or
 * the Word add-in carries none. Text a connected application wrote never
 * becomes the person's or the matter's lasting memory, so the three turns
 * schedule no consolidation for it.
 */
export function startedByConnectedApp(
  allowed: readonly ToolCapability[] | undefined,
): boolean {
  return allowed !== undefined;
}
