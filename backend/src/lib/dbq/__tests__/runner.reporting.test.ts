// How the DB-queue runner logs failures: one error line per failure class
// for a claim that fails every tick, the PostgREST code on the logged error,
// and a backoff so a broken dependency is not hammered (MIKE-BACKEND-P, -G).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../supabase", () => ({ createServerSupabase: vi.fn() }));
vi.mock("../../storage", () => ({ deleteFile: vi.fn() }));

import { diagnosticErrorTags } from "../../observability/diagnostics";
import { createDbJobClaimGate, processClaimedJob, runDbJobTick } from "../runner";
import { DbJobDeferredError, type DbJob } from "../types";

const MISSING_RPC = {
    code: "PGRST202",
    message:
        "Could not find the function public.claim_db_jobs(p_limit, p_stale_seconds) in the schema cache",
    details: null,
    hint: null,
};

function makeDb(rpc: () => Promise<{ data: unknown; error: unknown }>) {
    const builder: Record<string, unknown> = {};
    for (const method of ["update", "delete", "select", "eq", "neq", "lt", "limit"]) {
        builder[method] = () => builder;
    }
    builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve);
    return { from: () => builder, rpc };
}

const JOB = (over: Partial<DbJob> = {}): DbJob => ({
    id: "job-1",
    kind: "test.kind",
    payload: {},
    status: "running",
    attempts: 1,
    max_attempts: 3,
    run_at: "2026-08-21T00:00:00Z",
    claimed_at: "2026-08-21T00:00:01Z",
    finished_at: null,
    last_error: null,
    dedupe_key: null,
    result: null,
    created_at: "2026-08-21T00:00:00Z",
    ...over,
});

function claimLogs() {
    return consoleError.mock.calls.filter(
        ([label]) => label === "[dbq] claim failed",
    );
}

type ConsoleSpy = ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
let consoleError: ConsoleSpy;
let consoleWarn: ConsoleSpy;
let consoleLog: ConsoleSpy;

beforeEach(() => {
    consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {}) as unknown as ConsoleSpy;
    consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {}) as unknown as ConsoleSpy;
    consoleLog = vi
        .spyOn(console, "log")
        .mockImplementation(() => {}) as unknown as ConsoleSpy;
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("runDbJobTick claim failure logging", () => {
    it("logs the PostgREST code (PGRST202) instead of a code-less re-wrapped message", async () => {
        const db = makeDb(async () => ({ data: null, error: MISSING_RPC }));
        await runDbJobTick(db as never, {}, {}, createDbJobClaimGate());

        expect(claimLogs()).toHaveLength(1);
        const logged = claimLogs()[0]![1] as Error;
        expect(logged).toBeInstanceOf(Error);
        expect(diagnosticErrorTags(logged).failure_code).toBe("PGRST202");
        // The dependency's free text never becomes the error's own message.
        expect(logged.message).not.toContain("claim_db_jobs");
    });

    it("logs a claim that fails every tick once, then stays quiet and backs off", async () => {
        vi.useFakeTimers();
        const gate = createDbJobClaimGate();
        const db = makeDb(async () => ({ data: null, error: MISSING_RPC }));

        let ticks = 0;
        // Drive the loop the way startDbJobRunner does: an interval that
        // skips while the gate says to wait. 10 minutes at the 5 s cadence.
        for (let elapsed = 0; elapsed < 10 * 60_000; elapsed += 5_000) {
            if (gate.ready()) {
                ticks += 1;
                await runDbJobTick(db as never, {}, {}, gate);
            }
            await vi.advanceTimersByTimeAsync(5_000);
        }

        expect(claimLogs()).toHaveLength(1);
        // Backed off to the 60 s ceiling instead of 120 claims in 10 minutes.
        expect(ticks).toBeLessThan(20);
        // A compact count line, at most once a minute.
        const lines = consoleWarn.mock.calls.filter(([m]) =>
            String(m).startsWith("[dbq] claim still failing (Error:PGRST202)"),
        );
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.length).toBeLessThanOrEqual(10);
    });

    it("logs again when the failure class changes, and after a recovery", async () => {
        const gate = createDbJobClaimGate();
        let error: unknown = MISSING_RPC;
        const db = makeDb(async () => ({ data: error ? null : [], error }));

        await runDbJobTick(db as never, {}, {}, gate);
        await runDbJobTick(db as never, {}, {}, gate);
        expect(claimLogs()).toHaveLength(1);

        error = { code: "ECONNREFUSED", message: "connect ECONNREFUSED" };
        await runDbJobTick(db as never, {}, {}, gate);
        expect(claimLogs()).toHaveLength(2);

        error = null;
        await runDbJobTick(db as never, {}, {}, gate);
        expect(consoleLog).toHaveBeenCalledWith(
            expect.stringContaining("[dbq] claim recovered after 3 consecutive failure(s)"),
        );

        error = { code: "ECONNREFUSED", message: "connect ECONNREFUSED" };
        await runDbJobTick(db as never, {}, {}, gate);
        expect(claimLogs()).toHaveLength(3);
    });
});

describe("processClaimedJob console lines", () => {
    it("logs a failed job with the Error object (MIKE-BACKEND-G)", async () => {
        const db = makeDb(async () => ({ data: [], error: null }));
        await processClaimedJob(db as never, {
            "test.kind": async () => {
                throw new Error("Memory curator scope failed");
            },
        }, JOB());

        const logged = consoleError.mock.calls.find(
            ([label]) => label === "[dbq] job failed; will retry",
        );
        expect(logged).toBeDefined();
        expect((logged![1] as { error: unknown }).error).toBeInstanceOf(Error);
    });

    it("gives a job rejected with a PostgREST object a code-carrying Error", async () => {
        const db = makeDb(async () => ({ data: [], error: null }));
        await processClaimedJob(db as never, {
            "test.kind": async () => {
                throw { code: "42P01", message: 'relation "x" does not exist' };
            },
        }, JOB());

        const logged = consoleError.mock.calls.find(
            ([label]) => label === "[dbq] job failed; will retry",
        );
        expect(logged).toBeDefined();
        const error = (logged![1] as { error: Error }).error;
        expect(error).toBeInstanceOf(Error);
        expect(diagnosticErrorTags(error).failure_code).toBe("42P01");
    });

    it("logs an unknown kind with an Error", async () => {
        const db = makeDb(async () => ({ data: [], error: null }));
        await processClaimedJob(db as never, {}, JOB({ kind: "nope.kind" }));

        const logged = consoleError.mock.calls.find(
            ([label]) => label === "[dbq] unknown job kind",
        );
        expect(logged).toBeDefined();
        expect((logged![1] as { error: unknown }).error).toBeInstanceOf(Error);
    });

    it("never logs a deferral at error level", async () => {
        const db = makeDb(async () => ({ data: [], error: null }));
        await processClaimedJob(db as never, {
            "test.kind": async () => {
                throw new DbJobDeferredError(
                    new Date(Date.now() + 60_000).toISOString(),
                    "memory_quiet_period",
                );
            },
        }, JOB());

        expect(consoleError).not.toHaveBeenCalled();
        expect(consoleLog).toHaveBeenCalledWith(
            "[dbq] job deferred",
            expect.objectContaining({ id: "job-1" }),
        );
    });
});
