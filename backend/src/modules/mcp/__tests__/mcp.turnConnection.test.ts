import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb, type Row } from "../../../__tests__/helpers/memoryDb";
import type { Db } from "../../../lib/supabase";
import * as chatTools from "../mcp.tools.chat";

// What a connected application's turn asks before each tool call: the same
// verdict the endpoint reaches for a request, for the connection that started
// the turn.
const MADE = "2026-11-21T10:00:00.123Z";

let tables: Record<string, Row[]>;
let db: Db;
const check = (): Promise<boolean> => {
  const make = (chatTools as Record<string, unknown>).turnConnectionCheck as
    | ((call: { db: Db; principal: { grantId: string } }) => () => Promise<boolean>)
    | undefined;
  expect(typeof make).toBe("function");
  return make!({ db, principal: { grantId: "grant-1" } })();
};

beforeEach(() => {
  tables = {
    mcp_grants: [{
      id: "grant-1", user_id: "user-1", client_id: "client-1", resource: "https://mcp.test.example/mcp",
      scopes: ["litt.read"], workspaces: ["personal"], default_workspace: "personal", mfa_verified_at: null,
      created_at: MADE, last_used_at: null, expires_at: "2999-01-01T00:00:00.000Z", revoked_at: null,
    }],
    user_profiles: [{ user_id: "user-1", account_deletion_requested_at: null, sessions_ended_at: null }],
    org_members: [], organizations: [], training_stages: [],
  };
  db = memoryDb(tables).db;
});

describe("the connection check of a connected application's turn", () => {
  it("is good while the connection is live", async () => {
    expect(await check()).toBe(true);
  });

  it("is no longer good once the connection is revoked", async () => {
    expect(await check()).toBe(true);
    tables.mcp_grants[0].revoked_at = "2026-11-21T11:00:00.000Z";
    expect(await check()).toBe(false);
  });

  it("is no longer good once the person has signed out everywhere", async () => {
    expect(await check()).toBe(true);
    tables.user_profiles[0].sessions_ended_at = "2026-11-21T11:00:00.000Z";
    expect(await check()).toBe(false);
  });

  it("cannot be answered when the database fails, and says so rather than answering yes", async () => {
    db = { from: () => { throw new Error("database down"); } } as unknown as Db;
    await expect(check()).rejects.toThrow();
  });
});
