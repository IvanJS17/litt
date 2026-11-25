import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

// Stack-level test for public.reserve_donna_run: the count and the insert of a
// place happen under one lock per firm, which only a real database can show. Gated
// like dbJobs.supabase.test.ts: run a local stack, then export
//   SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY, SUPABASE_TEST_ANON_KEY
// Places are insert-only, so a test cannot delete its rows: each test uses a firm
// and people of its own (random ids), which nothing else reads.
const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const maybeDescribe = url && serviceKey ? describe : describe.skip;

const HOUR = 3_600_000;
const window = () => {
    const now = Date.now();
    return {
        p_month_start: new Date(now - 24 * HOUR).toISOString(),
        p_month_end: new Date(now + 24 * HOUR).toISOString(),
        p_day_start: new Date(now - HOUR).toISOString(),
        p_day_end: new Date(now + HOUR).toISOString(),
    };
};

maybeDescribe("reserve_donna_run", () => {
    let db: SupabaseClient;

    const reserve = async (org: string, user: string, caps: { month: number; day: number }, extra: Record<string, unknown> = {}) => {
        const { data, error } = await db.rpc("reserve_donna_run", {
            p_org_id: org,
            p_user_id: user,
            p_request_id: randomUUID(),
            ...window(),
            p_month_cap: caps.month,
            p_day_cap: caps.day,
            ...extra,
        });
        if (error) throw new Error(error.message);
        return data as string;
    };
    const rowsOf = async (org: string) => {
        const { data, error } = await db.from("matter_request_triage_reservations").select("id, user_id").eq("org_id", org);
        if (error) throw new Error(error.message);
        return data ?? [];
    };

    beforeAll(() => {
        db = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    });

    it("leaves exactly the cap in rows when many calls run at once near the cap", async () => {
        const org = randomUUID();
        const answers = await Promise.all(Array.from({ length: 25 }, () => reserve(org, randomUUID(), { month: 7, day: 100 })));
        expect(answers.filter((answer) => answer === "ok")).toHaveLength(7);
        expect(answers.filter((answer) => answer === "monthly_cap")).toHaveLength(18);
        expect(await rowsOf(org)).toHaveLength(7);
    });

    it("holds a person's daily cap under concurrency, and another person of the firm still gets a place", async () => {
        const org = randomUUID();
        const person = randomUUID();
        const answers = await Promise.all(Array.from({ length: 12 }, () => reserve(org, person, { month: 1000, day: 5 })));
        expect(answers.filter((answer) => answer === "ok")).toHaveLength(5);
        expect(answers.filter((answer) => answer === "daily_cap")).toHaveLength(7);
        expect(await reserve(org, randomUUID(), { month: 1000, day: 5 })).toBe("ok");
        expect(await rowsOf(org)).toHaveLength(6);
    });

    it("counts only the places inside the windows it is given, and only the firm's own", async () => {
        const org = randomUUID();
        const person = randomUUID();
        expect(await reserve(org, person, { month: 1, day: 1 })).toBe("ok");
        expect(await reserve(org, person, { month: 1, day: 1 })).toBe("monthly_cap");
        // A window that does not hold the place counts none.
        const past = new Date(Date.now() - 48 * HOUR).toISOString();
        const pastEnd = new Date(Date.now() - 36 * HOUR).toISOString();
        expect(await reserve(org, person, { month: 1, day: 1 }, { p_month_start: past, p_month_end: pastEnd, p_day_start: past, p_day_end: pastEnd })).toBe("ok");
        // Another firm is unaffected.
        expect(await reserve(randomUUID(), person, { month: 1, day: 1 })).toBe("ok");
    });

    it("refuses to update or delete a place, and is closed to the anon role", async () => {
        const org = randomUUID();
        expect(await reserve(org, randomUUID(), { month: 10, day: 10 })).toBe("ok");
        const [row] = await rowsOf(org);
        const update = await db.from("matter_request_triage_reservations").update({ user_id: randomUUID() }).eq("id", row.id);
        expect(update.error).not.toBeNull();
        const del = await db.from("matter_request_triage_reservations").delete().eq("id", row.id);
        expect(del.error).not.toBeNull();
        expect(await rowsOf(org)).toHaveLength(1);
        if (anonKey) {
            const anon = createClient(url!, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
            const call = await anon.rpc("reserve_donna_run", { p_org_id: org, p_user_id: randomUUID(), p_request_id: randomUUID(), ...window(), p_month_cap: 10, p_day_cap: 10 });
            expect(call.error).not.toBeNull();
            const read = await anon.from("matter_request_triage_reservations").select("id").eq("org_id", org);
            expect(read.error !== null || (read.data ?? []).length === 0).toBe(true);
        }
    });
});
