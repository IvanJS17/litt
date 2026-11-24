// Governed BYOK for playbook work: the model a playbook import, review or
// draft runs on is offered from the account's effective keys, an
// organization's included, but pinChatRoute never takes an organization's key
// implicitly. The key must therefore be chosen (as the chat's key selector
// does) and passed through, or every model whose only key is the firm's is
// offered and then refused with chat_route_credential_required.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";
import { saveApiKeyFor } from "../../../lib/providerCredentials/store";
import { PlaybookRequestError, pinPlaybookRoute } from "../playbooks.operations";

type Row = Record<string, unknown>;

/** Tables as arrays; `.eq` filters, `.maybeSingle` returns the first match. */
function fakeDb(tables: Record<string, Row[]>) {
  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const rows = () =>
        (tables[table] ?? []).filter((row) =>
          Object.entries(filters).every(([column, value]) =>
            column.includes(".") ? true : row[column] === value,
          ),
        );
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        is: () => builder,
        insert: async (payload: Row) => {
          (tables[table] ??= []).push({ ...payload });
          return { error: null };
        },
        upsert: (payload: Row) => {
          (tables[table] ??= []).push({ ...payload });
          return builder;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve),
      };
      return builder;
    },
  };
  return db as unknown as Db;
}

/** A saved key row as the database stores it (version from the trigger). */
async function keyRow(
  owner: { kind: "user" | "org"; id: string },
  provider: string,
  secret: string,
  version = 1,
): Promise<Row> {
  const tables: Record<string, Row[]> = {};
  await saveApiKeyFor(owner, provider as never, secret, fakeDb(tables));
  const table = owner.kind === "user" ? "user_api_keys" : "org_api_keys";
  return {
    ...tables[table]![0]!,
    version,
    credential_ref: `${provider}:v${version}`,
  };
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(PlaybookRequestError);
  return error as PlaybookRequestError;
}

beforeEach(() => {
  vi.stubEnv("USER_API_KEYS_ENCRYPTION_SECRET", "synthetic-secret");
  for (const name of [
    "ANTHROPIC_API_KEY",
    "CLAUDE_API_KEY",
    "OPENROUTER_API_KEY",
    "GEMINI_API_KEY",
    "OPENAI_API_KEY",
  ]) {
    vi.stubEnv(name, "");
  }
});
afterEach(() => vi.unstubAllEnvs());

/** A firm whose Anthropic key is its own; its members' keys are off. */
async function firmWithItsOwnAnthropicKey(): Promise<Db> {
  return fakeDb({
    org_members: [{ org_id: "o1", user_id: "u1" }],
    organizations: [{ id: "o1", allow_personal_ai_keys: false }],
    org_api_keys: [await keyRow({ kind: "org", id: "o1" }, "claude", "sk-firm", 2)],
    user_api_keys: [
      await keyRow({ kind: "user", id: "u1" }, "claude", "sk-own"),
      await keyRow({ kind: "user", id: "u1" }, "openrouter", "sk-or-own"),
    ],
  });
}

describe("pinPlaybookRoute and the key a playbook runs on", () => {
  it("runs on the person's own key when they hold Anthropic and OpenRouter keys", async () => {
    const db = fakeDb({
      user_api_keys: [
        await keyRow({ kind: "user", id: "u1" }, "claude", "sk-own"),
        await keyRow({ kind: "user", id: "u1" }, "openrouter", "sk-or-own"),
      ],
    });
    const pinned = await pinPlaybookRoute(db, "u1", "claude-sonnet-5-5", null);
    expect(pinned.route).toEqual({
      provider: "claude",
      model: "claude-sonnet-5-5",
      credentialRef: "user:u1:claude:v1",
    });
  });

  it("does not pick the organization's key on its own", async () => {
    const db = await firmWithItsOwnAnthropicKey();
    const error = await refusal(
      pinPlaybookRoute(db, "u1", "claude-sonnet-5-5", "o1"),
    );
    // Available (not missing_api_key): the key exists, it was just not chosen.
    expect(error.code).toBe("chat_route_credential_required");
  });

  it("runs on the organization's key when the person chose it", async () => {
    const db = await firmWithItsOwnAnthropicKey();
    const pinned = await pinPlaybookRoute(
      db,
      "u1",
      "claude-sonnet-5-5",
      "o1",
      "org:o1:claude:v2",
    );
    expect(pinned.route.credentialRef).toBe("org:o1:claude:v2");
    expect(pinned.apiKeys.claude).toBe("sk-firm");
    expect(pinned.apiKeys.keySources).toEqual({ claude: "org" });
  });

  it("refuses a malformed key reference as a bad request", async () => {
    const db = await firmWithItsOwnAnthropicKey();
    const error = await refusal(
      pinPlaybookRoute(db, "u1", "claude-sonnet-5-5", "o1", "not a ref"),
    );
    expect(error.status).toBe(400);
    expect(error.message).toBe("credential_ref is invalid");
  });

  it("refuses a chosen key the person may not use, without trying another", async () => {
    const db = await firmWithItsOwnAnthropicKey();
    // The firm switched personal keys off, so the person's own is not usable here.
    const error = await refusal(
      pinPlaybookRoute(db, "u1", "claude-sonnet-5-5", "o1", "user:u1:claude:v1"),
    );
    expect(error.code).toBe("chat_route_credential_unavailable");
  });
});
