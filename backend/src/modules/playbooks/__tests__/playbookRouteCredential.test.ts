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
import { pinChatRoute } from "../../user/user.chatRoute";
import { resolveUserChatSelection } from "../../user/user.chatSelection";
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
        in: () => builder,
        limit: () => builder,
        update: () => builder,
        single: async () => ({ data: rows()[0] ?? null, error: null }),
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

describe("playbook work refuses what chat refuses, including ids the catalog does not recognise", () => {
  async function routerWorld(): Promise<Db> {
    return fakeDb({
      org_members: [{ org_id: "o1", user_id: "u1" }],
      organizations: [{ id: "o1", allow_personal_ai_keys: true }],
      org_api_keys: [await keyRow({ kind: "org", id: "o1" }, "openrouter", "sk-or-firm")],
      user_api_keys: [
        await keyRow({ kind: "user", id: "u1" }, "claude", "sk-own"),
        await keyRow({ kind: "user", id: "u1" }, "openrouter", "sk-or-own"),
        await keyRow({ kind: "user", id: "u1" }, "vercel", "sk-vc-own"),
      ],
      org_router_models: [
        { org_id: "o1", router: "openrouter", model_id: "anthropic/claude-sonnet-4" },
      ],
      user_router_models: [
        { user_id: "u1", router: "openrouter", model_id: "meta/llama-4" },
        { user_id: "u1", router: "vercel", model_id: "vendor/model-1" },
        { user_id: "u1", router: "opencode-go", model_id: "model-1" },
      ],
      user_profiles: [],
    });
  }
  const FIRM = "org:o1:openrouter:v1";
  const OWN = "user:u1:openrouter:v1";

  it.each([
    ["firm key + openrouter/auto", "openrouter/auto", "o1", FIRM],
    ["firm key + an unknown single-segment id", "openrouter/gpt-5-pro", "o1", FIRM],
    ["own key, no ref + openrouter/auto", "openrouter/auto", null, undefined],
  ])("%s: 400 model_unavailable", async (_name, model, org, ref) => {
    const error = await refusal(pinPlaybookRoute(await routerWorld(), "u1", model, org, ref));
    expect(error.status).toBe(400);
    expect(error.code).toBe("model_unavailable");
    expect(error.message).toBe(`Model "${model}" is not available. Select another model.`);
  });

  // Parity with chat: every row runs through chat's own resolution and pin
  // and through the playbook pin; the verdict AND the error code must agree.
  const ROUTER_FAMILIES = [
    "openrouter", "vercel", "opencode-go", "bedrock", "azure",
    "azure-foundry", "vertex", "xai", "custom",
  ];
  const TABLE: Array<[string, string, string | null, string | undefined]> = [
    ["A firm key + unapproved", "openrouter/openai/gpt-5-pro", "o1", FIRM],
    ["B firm key + approved", "openrouter/anthropic/claude-sonnet-4", "o1", FIRM],
    ["C own router key + outside own list", "openrouter/openai/gpt-5-pro", null, OWN],
    ["C0 same, no ref", "openrouter/openai/gpt-5-pro", null, undefined],
    ["D own router key + inside own list", "openrouter/meta/llama-4", null, OWN],
    ["O firm key + id only in the person's own list", "openrouter/meta/llama-4", "o1", FIRM],
    ["P own key in a firm that holds the router key", "openrouter/meta/llama-4", "o1", OWN],
    ["firm key + openrouter/auto", "openrouter/auto", "o1", FIRM],
    ["own key, no ref + openrouter/auto", "openrouter/auto", null, undefined],
    ["firm key + approved, trailing space", "openrouter/anthropic/claude-sonnet-4 ", "o1", FIRM],
    ["firm key + approved, leading space", " openrouter/anthropic/claude-sonnet-4", "o1", FIRM],
    ["firm key + approved, other case", "OpenRouter/Anthropic/Claude-Sonnet-4", "o1", FIRM],
    ["empty model", "", null, undefined],
    ["blank model", "   ", null, undefined],
    ["built-in on a direct key", "claude-sonnet-5-5", null, "user:u1:claude:v1"],
    ["built-in, no ref", "claude-sonnet-5-5", null, undefined],
    ["built-in, other case", "Claude-Sonnet-5-5", null, undefined],
    ["built-in, trailing space", "claude-sonnet-5-5 ", null, undefined],
    ["built-in without a key", "gemini-3.5-flash-lite", null, undefined],
    ["legacy id", "claude-opus-4-7", null, undefined],
    ["unknown id", "no-such-model", null, undefined],
    ["unknown id with a router-like prefix", "openrouter", null, undefined],
    ["local Ollama", "ollama/llama3", null, undefined],
    ["deployment-configured local", "acme-local", null, undefined],
    ["deployment-configured, other case", "ACME-LOCAL", null, undefined],
    ...ROUTER_FAMILIES.flatMap((family): typeof TABLE => [
      [`${family}: vendor/model id`, `${family}/vendor/model-1`, null, undefined],
      [`${family}: single segment id`, `${family}/model-1`, null, undefined],
      [`${family}: vendor/model id in a firm`, `${family}/vendor/model-1`, "o1", undefined],
      [`${family}: unsafe id`, `${family}/ven dor/../model`, null, undefined],
      [`${family}: no model part`, `${family}/`, null, undefined],
    ]),
  ];

  beforeEach(() => {
    process.env.MIKE_MODEL_CONFIG_JSON = JSON.stringify({
      models: [
        { id: "acme-local", provider: "openai-compatible", location: "local", baseUrl: "http://localhost:8000/v1" },
      ],
    });
    resetModelRegistryCache();
  });
  afterEach(() => {
    delete process.env.MIKE_MODEL_CONFIG_JSON;
    resetModelRegistryCache();
  });

  it.each(TABLE)("%s: same verdict and code as chat", async (_name, model, org, ref) => {
    const chat = await (async () => {
      const db = await routerWorld();
      const selected = await resolveUserChatSelection(db, {
        userId: "u1", requestedModel: model, orgId: org,
      });
      if (!selected.ok) return { ok: false, code: selected.code };
      const pinned = await pinChatRoute(db, {
        userId: "u1", orgId: org, model: selected.selectedModel,
        requestedCredentialRef: ref ?? null,
      });
      return pinned.ok ? { ok: true, code: null } : { ok: false, code: pinned.code };
    })();
    const playbook = await pinPlaybookRoute(await routerWorld(), "u1", model, org, ref).then(
      () => ({ ok: true, code: null as string | null }),
      (error: PlaybookRequestError) => ({ ok: false, code: error.code ?? null }),
    );
    expect(playbook).toEqual(chat);
  });
});
