import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Stack-level test for the DB queue's claim SQL. These are properties of the
// Postgres functions themselves — FOR UPDATE SKIP LOCKED partitioning, stale
// reclaim, and the attempt budget applying to a job that crashed its worker —
// so a mock proves nothing. Gated exactly like stack.supabase.test.ts: run a
// local stack, then export
//   SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY, SUPABASE_TEST_ANON_KEY
const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const maybeDescribe = url && serviceKey ? describe : describe.skip;

/** Stale threshold used by the calls below (seconds). */
const STALE = 600;
const STALE_AGO = new Date(Date.now() - (STALE + 60) * 1000).toISOString();

maybeDescribe("db_jobs claim SQL", () => {
    let db: SupabaseClient;
    const created: string[] = [];

    const insertJob = async (row: Record<string, unknown>) => {
        const { data, error } = await db
            .from("db_jobs")
            .insert({ kind: "stack.test", payload: {}, ...row })
            .select("*")
            .single();
        if (error) throw new Error(error.message);
        created.push(data.id as string);
        return data as Record<string, unknown>;
    };

    const claimBatch = async (limit = 10) => {
        const { data, error } = await db.rpc("claim_db_jobs", {
            p_limit: limit,
            p_stale_seconds: STALE,
        });
        if (error) throw new Error(error.message);
        return (data ?? []) as Record<string, unknown>[];
    };

    const reload = async (id: string) => {
        const { data, error } = await db
            .from("db_jobs")
            .select("*")
            .eq("id", id)
            .single();
        if (error) throw new Error(error.message);
        return data as Record<string, unknown>;
    };

    beforeAll(() => {
        db = createClient(url!, serviceKey!, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
    });

    afterAll(async () => {
        if (created.length)
            await db.from("db_jobs").delete().in("id", created);
    });

    it("claims a due pending job, incrementing attempts and stamping claimed_at", async () => {
        const job = await insertJob({ dedupe_key: `claim-${Date.now()}` });
        const claimed = await claimBatch();
        const mine = claimed.find((j) => j.id === job.id);
        expect(mine).toBeTruthy();
        expect(mine!.status).toBe("running");
        expect(mine!.attempts).toBe(1);
        expect(mine!.claimed_at).not.toBeNull();
        // A second claim does not double-claim it: it is running and fresh.
        const again = await claimBatch();
        expect(again.some((j) => j.id === job.id)).toBe(false);
    });

    it("claims parser-bound jobs fairly per owner and only for free parser slots", async () => {
        const tag = `fair-${Date.now()}`;
        const parserKind = "document.extract_text";
        const hourAgo = (s: number) => new Date(Date.now() - 3_600_000 + s * 1000).toISOString();
        await insertJob({ kind: parserKind, owner_key: `${tag}-a`, status: "running", claimed_at: new Date().toISOString(), run_at: hourAgo(0) });
        for (let i = 1; i <= 8; i++) await insertJob({ kind: parserKind, owner_key: `${tag}-a`, run_at: hourAgo(i) });
        const other = await insertJob({ kind: parserKind, owner_key: `${tag}-b`, run_at: new Date().toISOString() });
        const plain = await insertJob({ kind: "export.build", run_at: new Date().toISOString() });
        const none = await db.rpc("claim_db_jobs", { p_limit: 5, p_stale_seconds: STALE, p_kind: parserKind, p_parser_limit: 0 });
        expect((none.data as { kind: string }[]).some((j) => j.kind === parserKind)).toBe(false);
        const claimed = await claimBatch(20);
        const ids = claimed.map((j) => j.id);
        expect(ids).toContain(other.id);
        expect(ids).toContain(plain.id);
        expect(claimed.filter((j) => j.owner_key === `${tag}-a`)).toHaveLength(0);
    });

    it("reclaims a stale running job while attempts remain", async () => {
        const job = await insertJob({
            status: "running",
            claimed_at: STALE_AGO,
            attempts: 1,
            max_attempts: 3,
        });
        const claimed = await claimBatch();
        const mine = claimed.find((j) => j.id === job.id);
        expect(mine).toBeTruthy();
        expect(mine!.attempts).toBe(2);
    });

    // The crash-loop the guard exists to stop: a job that kills its worker
    // never reaches the runner's retry state machine, so before the guard it
    // was reclaimed every stale window forever, taking a worker each time.
    it("does NOT reclaim a stale running job whose attempts are spent", async () => {
        const job = await insertJob({
            status: "running",
            claimed_at: STALE_AGO,
            attempts: 3,
            max_attempts: 3,
        });
        const claimed = await claimBatch();
        expect(claimed.some((j) => j.id === job.id)).toBe(false);
    });

    it("terminally fails an over-budget stale running job", async () => {
        const job = await insertJob({
            status: "running",
            claimed_at: STALE_AGO,
            attempts: 5,
            max_attempts: 5,
        });
        await claimBatch();
        const after = await reload(job.id as string);
        expect(after.status).toBe("failed");
        expect(after.finished_at).not.toBeNull();
        expect(String(after.last_error)).toMatch(/abandoned/);
    });

    it("claim_db_job (single id) applies the same attempt budget", async () => {
        const spent = await insertJob({
            status: "running",
            claimed_at: STALE_AGO,
            attempts: 2,
            max_attempts: 2,
        });
        const live = await insertJob({
            status: "running",
            claimed_at: STALE_AGO,
            attempts: 1,
            max_attempts: 2,
        });

        const spentClaim = await db.rpc("claim_db_job", {
            p_id: spent.id,
            p_stale_seconds: STALE,
        });
        expect(spentClaim.error).toBeNull();
        expect((spentClaim.data ?? []).length).toBe(0);

        const liveClaim = await db.rpc("claim_db_job", {
            p_id: live.id,
            p_stale_seconds: STALE,
        });
        expect(liveClaim.error).toBeNull();
        expect((liveClaim.data ?? []).length).toBe(1);
    });

    // The fencing token the runner writes with. A reclaim moves both values,
    // so the zombie predecessor's terminal write matches nothing.
    it("a reclaim moves the fencing token, so the old claim matches no rows", async () => {
        const job = await insertJob({
            status: "running",
            claimed_at: STALE_AGO,
            attempts: 1,
            max_attempts: 3,
        });
        const [reclaimed] = (await claimBatch()).filter(
            (j) => j.id === job.id,
        );
        expect(reclaimed).toBeTruthy();

        // The zombie finalizes using the token it was handed at ITS claim.
        const zombie = await db
            .from("db_jobs")
            .update({ status: "done", finished_at: new Date().toISOString() })
            .eq("id", job.id)
            .eq("status", "running")
            .eq("attempts", job.attempts)
            .eq("claimed_at", job.claimed_at)
            .select("id");
        expect(zombie.error).toBeNull();
        expect(zombie.data ?? []).toHaveLength(0);

        // The current claimant's write, with the current token, does land.
        const winner = await db
            .from("db_jobs")
            .update({ status: "done", finished_at: new Date().toISOString() })
            .eq("id", job.id)
            .eq("status", "running")
            .eq("attempts", reclaimed.attempts)
            .eq("claimed_at", reclaimed.claimed_at)
            .select("id");
        expect(winner.data ?? []).toHaveLength(1);
    });
});
