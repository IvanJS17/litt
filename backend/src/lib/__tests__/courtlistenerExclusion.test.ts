import { afterEach, describe, expect, it, vi } from "vitest";
import { runToolCalls } from "../../modules/chat/engine/tools/toolDispatcher";
import { buildMessages } from "../../modules/chat/engine/contextBuilders";
import { buildSystemPrompt } from "../../modules/chat/engine/prompts";
import {
  PLAYBOOK_TOOLS,
  TOOLS,
  WORKFLOW_TOOLS,
} from "../../modules/chat/engine/tools/toolSchemas";

// CourtListener (US case law) is not a Mexican authority and was removed from
// LiTT. The names are kept here on purpose: naming a retired tool must stay
// inert instead of reviving a fetch, a stream event or a citation.
const REMOVED_TOOLS = [
  ["courtlistener_search_case_law", { query: "contract" }],
  ["courtlistener_get_cases", { cluster_ids: [123] }],
  ["courtlistener_find_in_case", { cluster_id: 123, query: "contract" }],
  ["courtlistener_read_case", { cluster_id: 123 }],
  ["courtlistener_verify_citations", { citations: ["410 U.S. 113"] }],
] as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("CourtListener exclusion", () => {
  it.each(REMOVED_TOOLS)(
    "%s neither fetches nor produces research output",
    async (name, args) => {
      vi.stubEnv("COURTLISTENER_API_TOKEN", "exclusion-test-token");
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new Error("Network is forbidden in the exclusion test"));
      vi.stubGlobal("fetch", fetchMock);
      const write = vi.fn();

      const result = await runToolCalls(
        [
          {
            id: "removed-tool",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
        new Map(),
        "user-1",
        {} as never,
        write,
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(result.toolResults).toEqual([]);
      expect(result).not.toHaveProperty("courtlistenerEvents");
      expect(result).not.toHaveProperty("caseCitationEvents");
    },
  );

  it("advertises no case-law tool to the model", () => {
    const names = [...TOOLS, ...WORKFLOW_TOOLS, ...PLAYBOOK_TOOLS]
      .map((tool) => ("function" in tool ? tool.function.name : ""))
      .filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name.toLowerCase()).not.toContain("courtlistener");
    }
    for (const [removed] of REMOVED_TOOLS) {
      expect(names).not.toContain(removed);
    }
  });

  it("carries no case-law instructions in the system prompt", () => {
    const prompt = buildSystemPrompt();
    expect(prompt.toLowerCase()).not.toContain("courtlistener");
    expect(prompt).not.toContain("US CASE LAW RESEARCH");
  });

  it("still spotlights filenames with the document-only prompt extra", () => {
    const messages = buildMessages(
      [],
      [{ doc_id: "doc-0", filename: "synthetic.docx" }],
      undefined,
      undefined,
      "exclusion-nonce",
    );
    expect(JSON.stringify(messages)).toContain("exclusion-nonce");
  });
});
