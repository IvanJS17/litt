import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Db } from "../../lib/supabase";
import { setOperation, withDiagnosticScope } from "../../lib/observability/report";
import { resetSchemaOutOfDateReportsForTests } from "../../lib/schemaOutOfDate";

const sweeps = vi.hoisted(() => ({
    text: vi.fn(), documents: vi.fn(), cells: vi.fn(), organizations: vi.fn(), subagents: vi.fn(),
    captureCleanup: vi.fn(), completeCleanup: vi.fn(),
}));
vi.mock("../../modules/documents/documents.service", () => ({
    backfillDocumentText: sweeps.text,
    sweepStaleProcessingDocuments: sweeps.documents,
    captureInlineDocumentCleanup: sweeps.captureCleanup,
    completeInlineDocumentCleanup: sweeps.completeCleanup,
}));
vi.mock("../../modules/tabular/tabular.service", () => ({ sweepStaleGeneratingCells: sweeps.cells }));
vi.mock("../../modules/chat/chat.service", () => ({ purgeExpiredSubagentRuns: sweeps.subagents }));
vi.mock("../../modules/orgs/orgs.service", async () => ({
    // Exercise the real archive service through the timer's reporting boundary.
    expireDepartureArchives: (await vi.importActual<typeof import("../../modules/orgs/orgs.retention")>("../../modules/orgs/orgs.retention")).expireDepartureArchives,
    purgeExpiredOrganizations: sweeps.organizations,
}));
import { runStaleWorkSweep } from "../maintenance";

const PRIVATE = "SYNTHETIC_CLIENT_Jane_Doe_NDA.pdf jane@example.test";
function database(failureAt?: "load" | "expire") {
    const cause = { code: "42501", message: PRIVATE, details: PRIVATE, hint: PRIVATE };
    const query: Record<string, unknown> = {};
    for (const method of ["select", "lte", "order", "limit"]) query[method] = () => query;
    query.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: failureAt === "load" ? cause : null }).then(resolve);
    return {
        from: vi.fn(() => query),
        rpc: vi.fn(async () => ({ data: 1, error: failureAt === "expire" ? cause : null })),
    };
}

let warnings: unknown[][];
beforeEach(() => {
    vi.resetAllMocks();
    resetSchemaOutOfDateReportsForTests();
    warnings = [];
    vi.spyOn(console, "warn").mockImplementation((...args) => { warnings.push(args); });
    sweeps.captureCleanup.mockResolvedValue([]);
});
afterEach(() => {
    vi.restoreAllMocks();
});

/** The sanitized report lines written by reportError. */
function reports(spy: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
    return spy.mock.calls
        .filter(call => call[0] === "[report]")
        .map(call => JSON.parse(String(call[1])) as Record<string, unknown>);
}

it.each(["load", "expire"] as const)("reports all sweeps once and preserves archive %s diagnostics without private data", async failureAt => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = { code: "ECONNRESET", message: PRIVATE };
    for (const sweep of [sweeps.text, sweeps.cells, sweeps.organizations, sweeps.subagents]) sweep.mockRejectedValue(cause);
    sweeps.documents.mockRejectedValue(cause);
    const db = database(failureAt);
    await withDiagnosticScope(async () => {
        setOperation("outside.sweep");
        await expect(runStaleWorkSweep(db as unknown as Db)).resolves.toEqual({ documents: 0, cells: 0 });
    });

    const events = reports(errors);
    expect(events.map(event => event.operation)).toEqual([
        "maintenance.document_text", "maintenance.documents", "maintenance.cells",
        "maintenance.organization_archives", "maintenance.organizations", "maintenance.subagent_runs",
    ]);
    for (const event of events) {
        expect(event.component).toBe("stale-sweep");
        const archive = event.operation === "maintenance.organization_archives";
        expect(event.error_kind).toBe(archive ? "db.query_failed" : "maintenance.sweep_failed");
        expect(event.failure_code).toBe(archive ? "42501" : "ECONNRESET");
    }
    expect(JSON.stringify(errors.mock.calls)).not.toContain(PRIVATE);
    expect(JSON.stringify(warnings)).not.toContain(PRIVATE);
    expect(sweeps.completeCleanup).not.toHaveBeenCalled();
    if (failureAt === "load") expect(db.rpc).not.toHaveBeenCalled();
    else expect(db.rpc).toHaveBeenCalledWith("expire_org_departure_archives", { p_limit: 100 });
});

it("preserves successful sweep counts and completes archive cleanup", async () => {
    sweeps.documents.mockResolvedValue(7);
    sweeps.cells.mockResolvedValue(9);
    const db = database();
    await expect(runStaleWorkSweep(db as unknown as Db)).resolves.toEqual({ documents: 7, cells: 9 });
    expect(sweeps.completeCleanup).toHaveBeenCalledWith(db, []);
    expect(sweeps.subagents).toHaveBeenCalledWith(db);
    expect(warnings).toEqual([]);
});

// Upstream MIK-94: an install whose database lacks a bundled migration failed
// the same sweep on every run and reported an error each time.
it("reports a missing database object once per operation, at error, under schema_out_of_date, and keeps sweeping", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    sweeps.text.mockRejectedValue({ code: "PGRST202", message: PRIVATE });
    sweeps.documents.mockResolvedValue(3);
    const db = database();

    await runStaleWorkSweep(db as unknown as Db);
    await expect(runStaleWorkSweep(db as unknown as Db)).resolves.toEqual({ documents: 3, cells: 0 });

    expect(sweeps.text).toHaveBeenCalledTimes(2);
    expect(sweeps.subagents).toHaveBeenCalledTimes(2);
    const events = reports(errors);
    expect(events).toHaveLength(1);
    // Error, not warning: this is the only report the process writes for it.
    expect(events[0]).toMatchObject({
        level: "error",
        operation: "maintenance.document_text",
        component: "stale-sweep",
        error_kind: "schema_out_of_date",
        failure_code: "PGRST202",
    });
    expect(JSON.stringify(errors.mock.calls)).not.toContain(PRIVATE);
    expect(JSON.stringify(warnings)).not.toContain(PRIVATE);
});

it("keeps reminding in the log, at most once an hour, while the database stays behind", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
        vi.setSystemTime(new Date("2026-11-05T09:00:00Z"));
        sweeps.text.mockRejectedValue({ code: "PGRST202", message: PRIVATE });
        const db = database();
        const reminders = () =>
            warnings.filter(([line]) => String(line).startsWith("[schema-out-of-date] maintenance.document_text: still failing"));

        await runStaleWorkSweep(db as unknown as Db); // first failure: report + log line
        vi.setSystemTime(new Date("2026-11-05T09:30:00Z"));
        await runStaleWorkSweep(db as unknown as Db); // inside the hour: silent
        expect(reminders()).toHaveLength(0);

        vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
        await runStaleWorkSweep(db as unknown as Db); // an hour on: one reminder
        vi.setSystemTime(new Date("2026-11-05T10:10:00Z"));
        await runStaleWorkSweep(db as unknown as Db); // silent again

        expect(reminders()).toHaveLength(1);
        expect(String(reminders()[0]![0])).toContain("2 more failure(s)");
        expect(String(reminders()[0]![0])).toContain("migrate.sh status");
        expect(reports(errors)).toHaveLength(1);
        expect(JSON.stringify(warnings)).not.toContain(PRIVATE);
    } finally {
        vi.useRealTimers();
    }
});

it("still reports any other sweep failure at error level on every run", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    sweeps.text.mockRejectedValue({ code: "57014", message: PRIVATE });
    const db = database();

    await runStaleWorkSweep(db as unknown as Db);
    await runStaleWorkSweep(db as unknown as Db);

    const events = reports(errors).filter(event => event.operation === "maintenance.document_text");
    expect(events).toHaveLength(2);
    for (const event of events) {
        expect(event).toMatchObject({
            level: "error",
            error_kind: "maintenance.sweep_failed",
            failure_code: "57014",
        });
    }
});
