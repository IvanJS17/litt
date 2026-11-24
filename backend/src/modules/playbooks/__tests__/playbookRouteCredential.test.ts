// Governed BYOK for playbook work: the model a playbook import, review or
// draft runs on is offered from the account's effective keys, an
// organization's included, but pinChatRoute never takes an organization's key
// implicitly. The key must therefore be chosen (as the chat's key selector
// does) and passed through, or every model whose only key is the firm's is
// offered and then refused with chat_route_credential_required.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";
import { saveApiKeyFor } from "../../../lib/providerCredentials/store";
import { resetModelRegistryCache } from "../../../lib/llm/registry";
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
        order: () => builder,
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

/** A member of two firms, each with its own Anthropic key; personal keys on. */
async function memberOfTwoFirms(): Promise<Db> {
  return fakeDb({
    org_members: [
      { org_id: "o1", user_id: "u1" },
      { org_id: "o2", user_id: "u1" },
    ],
    organizations: [
      { id: "o1", allow_personal_ai_keys: true },
      { id: "o2", allow_personal_ai_keys: true },
    ],
    org_api_keys: [
      await keyRow({ kind: "org", id: "o1" }, "claude", "sk-firm-1"),
      await keyRow({ kind: "org", id: "o2" }, "claude", "sk-firm-2"),
    ],
    user_api_keys: [await keyRow({ kind: "user", id: "u1" }, "claude", "sk-own")],
  });
}

describe("a chosen key is never replaced by another one", () => {
  it("refuses a rotated firm key although the person's own key would work", async () => {
    const db = await memberOfTwoFirms();
    const error = await refusal(
      pinPlaybookRoute(db, "u1", "claude-sonnet-5-5", "o1", "org:o1:claude:v9"),
    );
    expect(error.code).toBe("chat_route_credential_unavailable");
  });

  it("refuses a missing own key although the deployment's key is set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-deployment");
    const db = await memberOfTwoFirms();
    const error = await refusal(
      pinPlaybookRoute(db, "u1", "claude-sonnet-5-5", "o1", "user:u1:claude:v7"),
    );
    expect(error.code).toBe("chat_route_credential_unavailable");
  });
});

describe("a chosen key is judged against the playbook's organization", () => {
  it.each([
    ["a firm key of another firm the person also belongs to", "o2", "org:o1:claude:v1"],
    ["a firm key in the personal workspace", null, "org:o1:claude:v1"],
  ])("refuses %s", async (_name, playbookOrg, ref) => {
    const db = await memberOfTwoFirms();
    const error = await refusal(
      pinPlaybookRoute(db, "u1", "claude-sonnet-5-5", playbookOrg, ref),
    );
    expect(error.code).toBe("chat_route_credential_unavailable");
  });

  it("accepts the key of the playbook's own organization", async () => {
    const db = await memberOfTwoFirms();
    const pinned = await pinPlaybookRoute(
      db, "u1", "claude-sonnet-5-5", "o2", "org:o2:claude:v1",
    );
    expect(pinned.route.credentialRef).toBe("org:o2:claude:v1");
  });
});

/**
 * The model rule of chat: a router model runs only if it is in the list that
 * governs the key it would run on: the firm's saved list where the firm holds
 * that router's key, the person's own list otherwise.
 */
async function firmWithRouterList(approved: string[]): Promise<Db> {
  return fakeDb({
    org_members: [{ org_id: "o1", user_id: "u1" }],
    organizations: [{ id: "o1", allow_personal_ai_keys: true }],
    org_api_keys: [
      await keyRow({ kind: "org", id: "o1" }, "openrouter", "sk-or-firm"),
      await keyRow({ kind: "org", id: "o1" }, "claude", "sk-firm"),
    ],
    org_router_models: approved.map((model_id) => ({
      org_id: "o1", router: "openrouter", model_id,
    })),
    // The person's own list names the unapproved model: it must not govern.
    user_router_models: [
      { user_id: "u1", router: "openrouter", model_id: "openai/gpt-5-pro" },
    ],
    user_api_keys: [],
  });
}

describe("the model rule of chat applies to playbook work", () => {
  const APPROVED = "openrouter/openai/gpt-4.1";
  const UNAPPROVED = "openrouter/openai/gpt-5-pro";

  it.each([
    "import", "review", "draft", "proposals", "corrections",
  ])("%s: refuses a router model the firm did not approve, pinning nothing", async (_flow) => {
    const db = await firmWithRouterList(["openai/gpt-4.1"]);
    const error = await refusal(
      pinPlaybookRoute(db, "u1", UNAPPROVED, "o1", "org:o1:openrouter:v1"),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe("model_unavailable");
    expect(error.message).toMatch(/organization's saved OpenRouter models/);
  });

  it("refuses it without a chosen key too: the firm's list governs the work", async () => {
    const db = await firmWithRouterList(["openai/gpt-4.1"]);
    const error = await refusal(pinPlaybookRoute(db, "u1", UNAPPROVED, "o1"));
    expect(error.code).toBe("model_unavailable");
  });

  it("accepts a router model the firm approved, on the firm's key", async () => {
    const db = await firmWithRouterList(["openai/gpt-4.1"]);
    const pinned = await pinPlaybookRoute(
      db, "u1", APPROVED, "o1", "org:o1:openrouter:v1",
    );
    expect(pinned.route).toEqual({
      provider: "openrouter",
      model: APPROVED,
      credentialRef: "org:o1:openrouter:v1",
    });
  });

  it("leaves a built-in model on the firm's direct key as before", async () => {
    const db = await firmWithRouterList([]);
    const pinned = await pinPlaybookRoute(
      db, "u1", "claude-sonnet-5-5", "o1", "org:o1:claude:v1",
    );
    expect(pinned.route.credentialRef).toBe("org:o1:claude:v1");
  });

  it("with no key sent, judges a router model against the person's own saved selections", async () => {
    const withKey = async (list: string[]) => {
      return fakeDb({
        user_api_keys: [await keyRow({ kind: "user", id: "u1" }, "openrouter", "sk-or-own")],
        user_router_models: list.map((model_id) => ({
          user_id: "u1", router: "openrouter", model_id,
        })),
      });
    };
    const outside = await refusal(
      pinPlaybookRoute(await withKey(["openai/gpt-4.1"]), "u1", UNAPPROVED, null),
    );
    expect(outside.status).toBe(400);
    expect(outside.code).toBe("model_unavailable");
    expect(outside.message).toMatch(/not in your saved OpenRouter models/);
    const inside = await pinPlaybookRoute(
      await withKey(["openai/gpt-5-pro"]), "u1", UNAPPROVED, null,
    );
    expect(inside.route.credentialRef).toBe("user:u1:openrouter:v1");
  });
});

describe("local and deployment-configured models are not router models", () => {
  const original = process.env.MIKE_MODEL_CONFIG_JSON;
  beforeEach(() => {
    process.env.MIKE_MODEL_CONFIG_JSON = JSON.stringify({
      models: [
        {
          id: "keyless-local",
          provider: "openai-compatible",
          location: "local",
          baseUrl: "http://localhost:8000/v1",
        },
      ],
    });
    resetModelRegistryCache();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.MIKE_MODEL_CONFIG_JSON;
    else process.env.MIKE_MODEL_CONFIG_JSON = original;
    resetModelRegistryCache();
  });

  it.each(["ollama/llama3.2", "keyless-local"])(
    "pins %s without any saved router list, as chat does",
    async (model) => {
      const db = fakeDb({});
      const pinned = await pinPlaybookRoute(db, "u1", model, null);
      expect(pinned.route.model).toBe(model);
    },
  );
});
