// The project gate the AI record readers share, with the real
// checkProjectAccess on the repository's table double: a firm member who
// cannot open a private project is refused on a public matter; a member the
// project admits is served.
import { describe, expect, it } from "vitest";
import { memoryDb } from "../../../__tests__/helpers/memoryDb";
import { projectReadable } from "../ai-recovery.executions";

const identity = (user_id: string) => ({
  user_id,
  transport: { kind: "web_session" as const },
  mfa_satisfied: false,
});

describe("projectReadable (real project check)", () => {
  const { db } = memoryDb(
    {
      projects: [
        { id: "p1", user_id: "creator", org_id: "org-1", visibility: "private", archived_at: null },
      ],
      org_members: [
        { org_id: "org-1", user_id: "creator", role: "owner" },
        { org_id: "org-1", user_id: "team", role: "member" },
        { org_id: "org-1", user_id: "firm-only", role: "member" },
      ],
      organizations: [{ id: "org-1", deleted_at: null }],
      project_org_access_overrides: [
        { project_id: "p1", org_id: "org-1", user_id: "team", role: "editor" },
      ],
    } as never,
    { private_matter_denied_project_ids: () => [] },
  );

  it("refuses a firm member the project does not admit", async () => {
    expect(
      await projectReadable(db as never, { project_id: "p1", identity: identity("firm-only") }),
    ).toBe(false);
  });

  it("serves a member the project admits", async () => {
    expect(
      await projectReadable(db as never, { project_id: "p1", identity: identity("team") }),
    ).toBe(true);
  });
});
