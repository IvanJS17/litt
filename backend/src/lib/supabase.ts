import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The server-side database handle every service function takes as its first
 * argument. One name for the whole backend: services and job handlers accept
 * a `Db`, route handlers obtain one from `createServerSupabase()` and pass it
 * down. Declaring the alias here (instead of a private
 * `type Db = ReturnType<typeof createServerSupabase>` in every file) keeps
 * the seam explicit and lets tests substitute a fake with a single cast.
 */
export type Db = SupabaseClient<any, "public", any>;

let cachedAdminClient:
  | {
      url: string;
      key: string;
      client: SupabaseClient<any, "public", any>;
    }
  | undefined;

function isEmptyArray(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    return Array.isArray(parsed) && parsed.length === 0;
  } catch {
    return false;
  }
}

/**
 * The database gateway answers every error as JSON. The client reads an
 * error reply with status 404 and no body, or with status 404 and an empty
 * JSON array, as "no error, no rows", and an access check reads "no rows" as
 * "nothing denies this". A reply from the database gateway that is not a
 * success and has an empty body or an empty array is therefore given an
 * error body here, so callers see an error. Only requests to the gateway
 * (the path the client builds for it) are looked at: a reply from the
 * identity service or anything else, a successful reply, and a reply with any
 * other body are handed on as they came, and a successful reply is not read.
 */
export function failEmptyErrorReplies(baseUrl: string) {
  // The same address the client builds: the base with a trailing slash, then the path.
  const gateway = new URL("rest/v1", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).href;
  return async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const response = await fetch(input, init);
    if (response.ok) return response;
    const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const isGateway =
      target.startsWith(gateway) &&
      (target.length === gateway.length || /^[/?#]/.test(target.charAt(gateway.length)));
    if (!isGateway) return response;
    const body = await response.clone().text();
    if (body !== "" && !isEmptyArray(body)) return response;
    return new Response(
      JSON.stringify({ message: "The database gateway answered with an error and no body" }),
      {
        status: response.status,
        statusText: response.statusText,
        headers: { "content-type": "application/json" },
      },
    );
  };
}

/**
 * Server-side Supabase client using the service role key.
 * Bypasses RLS — only use in API routes after verifying the user.
 */
export function createServerSupabase(): Db {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
  }

  if (cachedAdminClient?.url === url && cachedAdminClient.key === key) {
    return cachedAdminClient.client;
  }

  const client = createClient(url, key, {
    global: { fetch: failEmptyErrorReplies(url) },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  cachedAdminClient = { url, key, client };
  return client;
}
