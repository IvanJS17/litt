// Saved provider keys as the database stores them, for the playbook suites
// that run the real key rules (pinChatRoute) over the in-memory database.
import type { Db } from "../../../lib/supabase";
import { saveApiKeyFor } from "../../../lib/providerCredentials/store";
import type { Row } from "./playbookTestDb";

/** An encrypted key row of a person or an organization (version 1). */
export async function keyRow(
  owner: { kind: "user" | "org"; id: string },
  secret: string,
  provider = "claude",
): Promise<Row> {
  const saved: Row[] = [];
  const recorder = {
    from: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        insert: async (payload: Row) => (saved.push(payload), { error: null }),
        upsert: (payload: Row) => (saved.push(payload), builder),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return builder;
    },
  } as unknown as Db;
  await saveApiKeyFor(owner, provider as never, secret, recorder);
  return {
    ...saved[0]!,
    ...(owner.kind === "org" ? { org_id: owner.id } : { user_id: owner.id }),
    version: 1,
    credential_ref: `${provider}:v1`,
  };
}
