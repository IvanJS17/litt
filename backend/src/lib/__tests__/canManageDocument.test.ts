import { describe, expect, it } from "vitest";
import { canManageDocument } from "../access";

// Destructive document operations (delete a document, delete one of its
// versions, replace a version) are TWO conditions: authorship scope AND a
// current content.edit verdict where the document lives. Authorship alone is
// provenance — it must not survive a downgrade to Viewer or a revoked grant.

describe("canManageDocument", () => {
  it.each([
    // role, isCreator, doc creator, workflow, expected
    ["owner", true, "me", null, true],
    ["owner", false, null, null, true],
    ["editor", true, "me", null, true],
    ["editor", false, null, "workflow-1", true],
    // A creator downgraded to Viewer keeps provenance, not the right to
    // destroy content in that project.
    ["viewer", true, "me", null, false],
    ["viewer", false, "me", null, false],
    // A live colleague's document is not an Editor's to delete.
    ["editor", false, "colleague", null, false],
    // Workflow assets are managed at the workflow share's edit tier.
    ["editor", false, "colleague", "workflow-1", true],
    // Fail closed on a missing role.
    [null, true, "me", null, false],
  ] as const)(
    "role=%s creator=%s doc.user_id=%s workflow=%s → %s",
    (projectRole, isCreator, creatorId, workflowId, expected) => {
      expect(
        canManageDocument(
          {
            isCreator,
            projectRole: projectRole as
              | "owner"
              | "editor"
              | "viewer"
              | null as never,
          },
          {
            user_id: creatorId as string | null,
            workflow_id: workflowId as string | null,
          },
        ),
      ).toBe(expected);
    },
  );
});
