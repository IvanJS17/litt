import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ reported: [] as unknown[][], fetched: 0 }));
vi.mock("../../observability/report", () => ({
    reportError: (...args: unknown[]) => {
        state.reported.push(args);
    },
}));
vi.mock("../dailyNumber", () => ({
    takeCitationChecks: () => {
        throw new Error("daily number unavailable");
    },
}));
vi.mock("../preference", () => ({ citationCheckPermitted: async () => true }));

import { createCitationSupportRunner } from "../check";

beforeEach(() => {
    process.env.LITT_CITATION_CHECK = "enabled";
    process.env.TYPESAFE_API_KEY = "synthetic-typesafe-key-0003";
});
afterEach(() => {
    delete process.env.LITT_CITATION_CHECK;
    delete process.env.TYPESAFE_API_KEY;
    state.reported.length = 0;
    state.fetched = 0;
});

describe("the background citation check runner", () => {
    it("resolves with null, sends nothing and writes nothing when the daily number cannot be taken", async () => {
        const writes: string[] = [];
        const db = { from: (table: string) => { writes.push(table); throw new Error("no write expected"); } } as never;
        const fetchImpl = vi.fn(async () => { state.fetched += 1; return new Response("{}"); });
        const runner = await createCitationSupportRunner({
            db,
            userId: "u",
            orgId: "org-1",
            legalVersion: "2026-11-15",
            deps: { fetch: fetchImpl as unknown as typeof fetch, sleep: async () => undefined },
        });
        expect(runner).not.toBeNull();
        const input = { ref: 1, documentId: "d", versionId: "v", startChar: 0, endChar: 5, state: { afirmacion: "a", cita: "b", contexto: "c" } };
        await expect(runner!.run({ surface: "chat", ownerId: "m-1" }, [input as never])).resolves.toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(writes).toEqual([]);
        expect(state.reported).toHaveLength(1);
    });
});
