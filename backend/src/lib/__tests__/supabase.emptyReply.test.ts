import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountErasureRequested } from "../access";
import { createServerSupabase } from "../supabase";

// The database gateway answers errors as JSON. A reply that is not a success
// and has no body (a broken intermediary) must reach the callers as an error,
// not as "no rows". Real client from createServerSupabase over a stub fetch.
let counter = 0;
const gateway = vi.fn<(input: unknown) => Promise<Response>>();

beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", `http://gateway-${++counter}.test`);
    vi.stubEnv("SUPABASE_SECRET_KEY", "service-key");
    vi.stubGlobal("fetch", gateway);
    gateway.mockReset();
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

const read = () => createServerSupabase().from("user_profiles").select("user_id").eq("user_id", "u1").maybeSingle();
const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("a reply from the database gateway", () => {
    it.each([404, 500, 502])("with status %s and no body is an error", async (status) => {
        gateway.mockResolvedValue(new Response(null, { status }));
        const { data, error } = await read();
        expect(error).not.toBeNull();
        expect(data).toBeNull();
    });

    it("with status 404 and an empty text body is an error", async () => {
        gateway.mockResolvedValue(new Response("", { status: 404 }));
        expect((await read()).error).not.toBeNull();
    });

    it("with status 404 and the gateway's own error body is left as it is", async () => {
        gateway.mockResolvedValue(json(404, { code: "PGRST205", message: "Could not find the table", details: null, hint: null }));
        const { error } = await read();
        expect(error).toMatchObject({ code: "PGRST205", message: "Could not find the table" });
    });

    it("with status 200 is left as it is", async () => {
        gateway.mockResolvedValue(json(200, [{ user_id: "u1" }]));
        const { data, error } = await read();
        expect(error).toBeNull();
        expect(data).toEqual({ user_id: "u1" });
    });

    it("with status 204 and no body is not an error", async () => {
        gateway.mockResolvedValue(new Response(null, { status: 204 }));
        const { error } = await createServerSupabase().from("user_profiles").update({ user_id: "u1" }).eq("user_id", "u1");
        expect(error).toBeNull();
    });

    it("that succeeded is not read before it is handed on", async () => {
        const reply = json(200, []);
        const text = vi.spyOn(reply, "text");
        const clone = vi.spyOn(reply, "clone");
        gateway.mockResolvedValue(reply);
        await createServerSupabase().from("user_profiles").select("user_id");
        expect(text).toHaveBeenCalledTimes(1); // by the client itself, once
        expect(clone).not.toHaveBeenCalled();
    });
});

describe("a reply from the database gateway that is an error with an empty array", () => {
    it.each([404, 400, 502])("with status %s is an error", async (status) => {
        gateway.mockResolvedValue(json(status, []));
        const { error } = await read();
        expect(error).not.toBeNull();
    });
});

describe("a reply from the database gateway that is not a success and whose body is not a JSON object", () => {
    it.each([
        ["null", 400, () => json(400, null)],
        ["0", 400, () => json(400, 0)],
        ["false", 400, () => json(400, false)],
        ["an empty JSON string", 400, () => json(400, "")],
        ["a non-empty array", 404, () => json(404, [{ user_id: "u1" }])],
        ["plain text", 500, () => new Response("upstream exploded", { status: 500 })],
    ])("%s is an error", async (_name, status, make) => {
        gateway.mockResolvedValue(make());
        const result = await read();
        expect(result.error).not.toBeNull();
        expect(result.data).toBeNull();
        expect(result.error?.message).toBeTruthy();
        // The reply's own status is kept with the error.
        expect(result.status).toBe(status);
    });

    it.each([404, 400])("with status %s and the gateway's JSON object is left as it is", async (status) => {
        gateway.mockResolvedValue(json(status, { code: "PGRST116", message: "The gateway's own message", details: "d", hint: null }));
        const { error } = await read();
        expect(error).toMatchObject({ code: "PGRST116", message: "The gateway's own message", details: "d" });
    });

    it("with status 200 and an empty array is not read and not an error", async () => {
        const reply = json(200, []);
        const clone = vi.spyOn(reply, "clone");
        gateway.mockResolvedValue(reply);
        const { data, error } = await createServerSupabase().from("user_profiles").select("user_id");
        expect(error).toBeNull();
        expect(data).toEqual([]);
        expect(clone).not.toHaveBeenCalled();
    });

    it("to a HEAD request that succeeded is not read", async () => {
        const reply = new Response(null, { status: 200, headers: { "content-range": "0-0/3" } });
        const clone = vi.spyOn(reply, "clone");
        gateway.mockResolvedValue(reply);
        const { error, count } = await createServerSupabase().from("user_profiles").select("user_id", { count: "exact", head: true });
        expect(error).toBeNull();
        expect(count).toBe(3);
        expect(clone).not.toHaveBeenCalled();
    });
});

const userId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("a reply from the identity service", () => {
    it("with status 404 and no body comes back as it came, unread", async () => {
        const reply = new Response(null, { status: 404 });
        const clone = vi.spyOn(reply, "clone");
        gateway.mockResolvedValue(reply);
        const { error } = await createServerSupabase().auth.admin.getUserById(userId);
        expect(gateway.mock.calls[0]![0]).toContain("/auth/v1/admin/users/");
        expect(clone).not.toHaveBeenCalled();
        expect(error?.name).toBe("AuthUnknownError");
    });
});

describe("an access read when the gateway answers with an empty 404", () => {
    it("refuses instead of reading no rows", async () => {
        gateway.mockResolvedValue(new Response(null, { status: 404 }));
        await expect(accountErasureRequested(createServerSupabase(), "u1")).rejects.toThrow();
    });
});
