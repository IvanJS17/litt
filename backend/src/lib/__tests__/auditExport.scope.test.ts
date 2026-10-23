import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// #463 (iii) — the audit trail is scoped by the access verdict, not by "did
// this user create the project?".
//
// accessibleProjectIds used to union projects.user_id with
// project_access_grants and stop there: an organization editor or admin got
// no audit rows for a colleague's matter, and a grant that had since been
// overridden with `deny` still counted. listAccessibleProjectIds already
// answers "which projects may this caller see" (creator + direct grant + org
// access, minus deny overrides, minus private matters without membership),
// so the audit scope must ask it rather than keep a second, older definition.
// ---------------------------------------------------------------------------

const { listAccessibleProjectIds } = vi.hoisted(() => ({
    listAccessibleProjectIds: vi.fn(),
}));

vi.mock("../access", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../access")>();
    return {
        ...actual,
        listAccessibleProjectIds: (...args: unknown[]) =>
            listAccessibleProjectIds(...args),
    };
});

type Row = Record<string, unknown>;

let calls: { or?: string; eq: [string, unknown][]; tables: string[] };

function makeDb(options: {
    forbidOwnScope?: boolean;
    ownProjects?: Row[];
    grants?: Row[];
}) {
    function projectsBuilder() {
        const b: any = {
            select: () => b,
            eq: () => b,
            then: (resolve: (value: unknown) => unknown) =>
                Promise.resolve({
                    data: options.ownProjects ?? [],
                    error: null,
                }).then(resolve),
        };
        return b;
    }
    function grantsBuilder() {
        const b: any = {
            select: () => b,
            eq: () => b,
            then: (resolve: (value: unknown) => unknown) =>
                Promise.resolve({ data: options.grants ?? [], error: null }).then(
                    resolve,
                ),
        };
        return b;
    }
    function eventsBuilder() {
        const b: any = {
            select: () => b,
            eq: (column: string, value: unknown) => {
                calls.eq.push([column, value]);
                return b;
            },
            or: (expression: string) => {
                calls.or = expression;
                return b;
            },
            ilike: () => b,
            gte: () => b,
            lte: () => b,
            order: () => b,
            range: () => Promise.resolve({ data: [], error: null, count: 0 }),
        };
        return b;
    }
    return {
        from: (table: string) => {
            calls.tables.push(table);
            if (table === "projects") {
                if (options.forbidOwnScope) {
                    throw new Error(
                        "auditExport must not resolve its own project scope",
                    );
                }
                return projectsBuilder();
            }
            if (table === "project_access_grants") return grantsBuilder();
            if (table === "audit_events") return eventsBuilder();
            throw new Error(`unexpected table in audit scope test: ${table}`);
        },
    };
}

import { accessibleProjectIds, parseQuery, queryEvents } from "../auditExport";

const PAGED = parseQuery({}, 50);
const QUERY = PAGED.ok ? PAGED.query : (undefined as never);

beforeEach(() => {
    calls = { eq: [], tables: [] };
    listAccessibleProjectIds.mockReset();
});

describe("audit scope", () => {
    it("scopes the trail to every project the verdict admits, not just my own", async () => {
        listAccessibleProjectIds.mockResolvedValue([
            "p-own",
            "p-org-shared",
        ]);
        const db = makeDb({ ownProjects: [{ id: "p-own" }] }) as never;

        await queryEvents(db, "u1", "u1@firm.example", QUERY);

        expect(calls.or).toBe(
            "user_id.eq.u1,project_id.in.(p-own,p-org-shared)",
        );
    });

    it("does not keep a second definition of the project scope", async () => {
        // The old implementation read projects.user_id and
        // project_access_grants itself. This database refuses that read, so
        // the helper can only answer through listAccessibleProjectIds.
        listAccessibleProjectIds.mockResolvedValue(["p-org-shared"]);
        const db = makeDb({ forbidOwnScope: true }) as never;

        await expect(
            accessibleProjectIds(db, "u1", "u1@firm.example"),
        ).resolves.toEqual(["p-org-shared"]);
        expect(calls.tables).not.toContain("projects");
    });

    it("falls back to the caller's own events when the verdict set is empty", async () => {
        // listAccessibleProjectIds answers [] when one of its access reads
        // fails (fail-closed). An unreadable scope must never widen the page.
        listAccessibleProjectIds.mockResolvedValue([]);
        const db = makeDb({ ownProjects: [{ id: "p-own" }] }) as never;

        await queryEvents(db, "u1", "u1@firm.example", QUERY);

        expect(calls.or).toBeUndefined();
        expect(calls.eq).toContainEqual(["user_id", "u1"]);
    });
});
