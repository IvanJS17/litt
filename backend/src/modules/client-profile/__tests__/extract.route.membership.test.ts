// The route of deferred document analysis is asked for when the work runs:
// someone who is no longer a member of the firm gets no route, never their
// own key.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";
import { resolveExtractionRoute } from "../client-profile.extract";
import { keyRow } from "../../playbooks/__tests__/playbookTestKeys";
import { database, ORG as FIRM } from "../../playbooks/__tests__/playbookTestDb";

async function world(member: boolean) {
  const { db, tables } = database([], member ? [{ user_id: "u1", org_id: FIRM, role: "member" }] : []);
  tables.organizations!.forEach((row) => {
    row.allow_personal_ai_keys = true;
  });
  tables.org_api_keys = [await keyRow({ kind: "org", id: FIRM }, "sk-firm")];
  tables.user_api_keys = [await keyRow({ kind: "user", id: "u1" }, "sk-own")];
  tables.user_profiles = [{ user_id: "u1", last_selected_chat_model: "claude-opus-5" }];
  return db as Db;
}

beforeEach(() => {
  vi.stubEnv("USER_API_KEYS_ENCRYPTION_SECRET", "synthetic-secret");
  for (const name of ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]) vi.stubEnv(name, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("the route for analysing a client document", () => {
  it("gives a member the route chat would take", async () => {
    const routed = await resolveExtractionRoute(await world(true), { userId: "u1", orgId: FIRM });
    expect(routed.ok).toBe(true);
  });

  it("gives a person who left the firm no route", async () => {
    const routed = await resolveExtractionRoute(await world(false), { userId: "u1", orgId: FIRM });
    expect(routed.ok).toBe(false);
  });
});
