import { beforeEach, describe, expect, it, vi } from "vitest";

type Options = { includeWorkflowAssets?: boolean; reportMissing?: boolean };
const finder = vi.hoisted(() => ({
    calls: [] as { ids: string[]; org: string | null | undefined; options: unknown }[],
    outside: (_ids: string[], _org: string | null | undefined): string[] => [],
}));
vi.mock("../../../lib/documentWorkspace", () => ({
    findDocumentsOutsideWorkspace: vi.fn(async (_db: unknown, ids: string[], org: string | null | undefined, options: Options) => {
        finder.calls.push({ ids, org, options });
        return finder.outside(ids, org);
    }),
}));

import { documentsOutsideGrant } from "../mcp.toolkit";
import type { McpCall } from "../mcp.tools";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const callOf = (workspaces: string[]) => ({ db: {}, principal: { workspaces: workspaces.map((id) => ({ id })) } }) as unknown as McpCall;

beforeEach(() => {
    finder.calls = [];
    finder.outside = () => [];
});

describe("documentsOutsideGrant", () => {
    it("asks about a long list in batches of fifty at most, and answers it whole", async () => {
        const ids = Array.from({ length: 230 }, (_, i) => uuid(i + 1));
        finder.outside = (batch) => batch.filter((id) => id.endsWith("7"));
        const outside = await documentsOutsideGrant(callOf(["org-a"]), ids);
        expect(outside).toEqual(new Set(ids.filter((id) => id.endsWith("7"))));
        expect(finder.calls).toHaveLength(5);
        expect(Math.max(...finder.calls.map((call) => call.ids.length))).toBeLessThanOrEqual(50);
    });

    it("asks for the workflow's files and for a document that cannot be found to be reported, so it never counts as inside", async () => {
        await documentsOutsideGrant(callOf(["org-a"]), [uuid(1)]);
        expect(finder.calls[0].options).toEqual({ includeWorkflowAssets: true, reportMissing: true });
    });

    it("counts a document that is inside any covered workspace as inside, and honors a single named workspace", async () => {
        const [a, b] = [uuid(1), uuid(2)];
        finder.outside = (batch, org) => batch.filter((id) => (org === "org-a" ? id === b : id === a));
        expect((await documentsOutsideGrant(callOf(["org-a", "org-b"]), [a, b])).size).toBe(0);
        expect(await documentsOutsideGrant(callOf(["org-a", "org-b"]), [a, b], "org-a")).toEqual(new Set([b]));
    });

    it("counts everything as outside when no workspace is covered or the named one is not", async () => {
        const [a, b] = [uuid(1), uuid(2)];
        expect(await documentsOutsideGrant(callOf([]), [a, b])).toEqual(new Set([a, b]));
        expect(await documentsOutsideGrant(callOf(["org-a"]), [a, b], "org-z")).toEqual(new Set([a, b]));
    });

    it("treats the personal workspace as no organization", async () => {
        await documentsOutsideGrant(callOf(["personal"]), [uuid(1)]);
        expect(finder.calls[0].org).toBeNull();
    });

    it("asks nothing for an empty list", async () => {
        expect((await documentsOutsideGrant(callOf(["org-a"]), [])).size).toBe(0);
        expect(finder.calls).toHaveLength(0);
    });
});
