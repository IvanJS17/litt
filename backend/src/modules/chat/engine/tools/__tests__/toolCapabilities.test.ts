import { describe, expect, it } from "vitest";
import { ASK_PARENT_TOOL, delegateTool } from "../delegateTools";
import { FIRM_CRITERIA_TOOL } from "../firmCriteriaTool";
import { METHODOLOGY_TOOL } from "../methodologyTool";
import {
  isToolAllowed,
  requiredCapabilities,
  TOOL_CAPABILITIES,
  withAllowedTools,
  type ToolCapability,
} from "../toolCapabilities";
import {
  DOCUMENT_MUTATING_TOOL_NAMES,
  PLAYBOOK_TOOLS,
  PROJECT_EXTRA_TOOLS,
  TABULAR_TOOLS,
  toolName,
  TOOLS,
  WORKFLOW_TOOLS,
} from "../toolSchemas";
import { webToolsFor } from "../webSearchTools";
import { WORD_CLIENT_TOOLS } from "../wordClientTools";

// Every tool the engine can put in front of the model on its own (connector
// tools are named by the person's connections and are classified by prefix).
const OWN_TOOLS = [
  ...TOOLS,
  ...PROJECT_EXTRA_TOOLS,
  ...TABULAR_TOOLS,
  ...WORKFLOW_TOOLS,
  ...PLAYBOOK_TOOLS,
  ...webToolsFor("tavily"),
  ...webToolsFor("provider"),
  METHODOLOGY_TOOL,
  FIRM_CRITERIA_TOOL,
  delegateTool(null),
  ASK_PARENT_TOOL,
  ...WORD_CLIENT_TOOLS,
];

const READ: ToolCapability[] = ["read"];

describe("tool capabilities", () => {
  it("declares what every tool of the engine does, so a new tool cannot slip into a connected app's turn", () => {
    for (const tool of OWN_TOOLS) {
      const name = toolName(tool);
      expect(requiredCapabilities(name), String(name)).not.toBeNull();
    }
    // And nothing is declared for a tool that no longer exists.
    const known = new Set(OWN_TOOLS.map(toolName));
    for (const name of Object.keys(TOOL_CAPABILITIES)) expect(known.has(name), name).toBe(true);
  });

  it("needs write for every tool that writes documents, and run as well for a review", () => {
    for (const name of DOCUMENT_MUTATING_TOOL_NAMES) expect(requiredCapabilities(name), name).toContain("write");
    expect(requiredCapabilities("run_playbook")).toEqual(["run", "write"]);
  });

  it("treats the person's connectors as their own capability, never granted by the other three", () => {
    for (const name of ["mcp_dummymail_send_message", "google_drive_create_folder", "gmail_send"])
      expect(requiredCapabilities(name), name).toEqual(["connector"]);
    expect(isToolAllowed("mcp_dummymail_send_message", ["read", "run", "write"])).toBe(false);
  });

  it("refuses by default: an undeclared tool, a missing or inherited name", () => {
    for (const name of ["brand_new_tool", "constructor", "toString", "", null, undefined])
      expect(isToolAllowed(name, READ), String(name)).toBe(false);
  });

  it("does not narrow a turn that passes no capabilities", () => {
    expect(isToolAllowed("brand_new_tool", undefined)).toBe(true);
    const tools = [...OWN_TOOLS];
    expect(withAllowedTools(tools, undefined)).toBe(tools);
  });

  it("keeps the whole reading surface for a read-only turn", () => {
    const names = withAllowedTools([...OWN_TOOLS], READ).map(toolName);
    expect(names).toEqual(
      expect.arrayContaining(["read_document", "find_in_document", "list_documents", "fetch_documents", "list_workflows", "list_playbooks", "read_table_cells", "delegate"]),
    );
    for (const name of [...DOCUMENT_MUTATING_TOOL_NAMES]) expect(names).not.toContain(name);
  });

  it("keeps the question to the person for the person's own turn only", () => {
    expect(isToolAllowed("ask_inputs", undefined)).toBe(true);
    expect(isToolAllowed("ask_inputs", ["read", "run", "write"])).toBe(false);
    expect(isToolAllowed("ask_inputs", ["read", "person"])).toBe(true);
    expect(withAllowedTools([...OWN_TOOLS], READ).map(toolName)).not.toContain("ask_inputs");
  });
});
