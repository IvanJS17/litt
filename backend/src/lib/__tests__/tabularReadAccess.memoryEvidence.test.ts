import { describe, expect, it } from "vitest";
import { filterMemoryEvidenceMessages } from "../tabularReadAccess";

describe("filterMemoryEvidenceMessages", () => {
    it("reads the provenance of a long transcript in batches of at most 50 ids", async () => {
        const batches: number[] = [];
        const db = {
            from: () => {
                let rows: Record<string, unknown>[] = [];
                const builder: any = {
                    select: () => builder,
                    in: (_column: string, ids: string[]) => {
                        batches.push(ids.length);
                        rows = ids.map((id) => ({ id, source_document_ids: [] }));
                        return builder;
                    },
                    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
                };
                return builder;
            },
        } as any;
        const messages = Array.from({ length: 130 }, (_, index) => ({ id: `m-${index}` }));
        const kept = await filterMemoryEvidenceMessages(db, messages, "actor", "actor@example.test", null);
        expect(kept).toHaveLength(130);
        expect(batches).toEqual([50, 50, 30]);
    });
});
