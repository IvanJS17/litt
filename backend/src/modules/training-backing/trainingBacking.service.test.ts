import { describe, expect, it } from "vitest";
import { memoryDb } from "../../__tests__/helpers/memoryDb";
import type { Db } from "../../lib/supabase";
import { getMyChatBacking, getPupilBacking, markMyConclusion } from "./trainingBacking.service";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = id(10);
const PUPIL = id(1);
const CHAT = id(20);
const MESSAGE = id(40);
const CHECK = id(50);

function world() {
    const made = memoryDb(
        {
            chats: [{ id: CHAT, project_id: null, title: null }],
            chat_messages: [{ id: MESSAGE, chat_id: CHAT, citations: [] }],
            training_backing_checks: [
                {
                    id: CHECK, org_id: ORG, trainee_user_id: PUPIL, chat_id: CHAT, word_chat_id: null, tabular_chat_id: null,
                    message_id: MESSAGE, status: "ready", created_at: "2026-11-08T10:00:00Z", updated_at: "2026-11-08T10:00:00Z",
                    conclusions: [{ id: "c1", text: "t", citation_ref: null, status: "unbacked", unverified_references: [], person_verified: false, person_note: null }],
                },
            ],
        },
        { training_can_read_learning: () => true },
    );
    return made;
}

describe("a database failure is an internal error, never a detail", () => {
    it.each([
        ["reading the checks", "training_backing_checks", "select"],
        ["reading the messages", "chat_messages", "select"],
    ])("when %s fails (person)", async (_label, table, op) => {
        const { db, failNext } = world();
        failNext(table, op, { message: "secret detail" });
        const result = await getMyChatBacking(db, { userId: PUPIL, chatId: CHAT });
        expect(result).toMatchObject({ ok: false, kind: "error" });
    });

    it("when the learning rule cannot be asked", async () => {
        const { db, failNext } = world();
        failNext("training_can_read_learning", "rpc", { message: "down" });
        expect(await getMyChatBacking(db, { userId: PUPIL, chatId: CHAT })).toMatchObject({ ok: false, kind: "error" });
    });

    it("when saving a mark fails", async () => {
        const { db, failNext } = world();
        failNext("training_backing_checks", "update", { message: "down" });
        const result = await markMyConclusion(db, {
            userId: PUPIL, chatId: CHAT, checkId: CHECK, conclusionId: "c1", body: { person_verified: true },
        });
        expect(result).toMatchObject({ ok: false, kind: "error" });
    });

    it("when the pupil's checks cannot be read (mentor)", async () => {
        const { db, failNext } = world();
        failNext("training_backing_checks", "select", { message: "down" });
        const result = await getPupilBacking(db as Db, { actorId: id(2), actorEmail: null, orgId: ORG, traineeId: PUPIL });
        expect(result).toMatchObject({ ok: false, kind: "error" });
    });

    it("the mentor route refuses the pupil themself", async () => {
        const { db } = world();
        const result = await getPupilBacking(db, { actorId: PUPIL, actorEmail: null, orgId: ORG, traineeId: PUPIL });
        expect(result).toMatchObject({ ok: false, kind: "not_found" });
    });

    it("keeps a mark made in another tab instead of overwriting it (409)", async () => {
        const { db, tables } = world();
        // The other tab saves between this request's read and its write.
        const racing = {
            ...db,
            from: (table: string) => {
                const builder = db.from(table) as unknown as { update: (value: unknown) => unknown };
                if (table !== "training_backing_checks") return builder;
                const update = builder.update.bind(builder);
                builder.update = (value: unknown) => {
                    tables.training_backing_checks[0].updated_at = "2026-11-08T12:00:00Z";
                    return update(value);
                };
                return builder;
            },
        } as unknown as Db;
        const result = await markMyConclusion(racing, {
            userId: PUPIL, chatId: CHAT, checkId: CHECK, conclusionId: "c1", body: { person_verified: true },
        });
        expect(result).toMatchObject({ ok: false, kind: "conflict" });
        expect((tables.training_backing_checks[0].conclusions as { person_verified: boolean }[])[0].person_verified).toBe(false);
    });
});

describe("a stored «backed» conclusion is read again with its passage (B1)", () => {
    const citation = (title: string) => ({
        ref: 1, filename: title, page: 1, verified: true,
        quotes: [{ page: 1, quote: "x", verification: { verified: true, source_excerpt: "Artículo 5. Texto." } }],
    });
    const present = async (text: string, title: string) => {
        const { db, tables } = world();
        tables.chat_messages[0].citations = [citation(title)];
        tables.training_backing_checks[0].conclusions = [
            { id: "c1", text, citation_ref: 1, status: "backed", unverified_references: [], person_verified: false, person_note: null },
        ];
        const result = await getMyChatBacking(db, { userId: PUPIL, chatId: CHAT });
        if (!result.ok) throw new Error("expected ok");
        return result.data.checks[0].conclusions![0];
    };

    it("keeps it backed when the passage shows the same article of the same law", async () => {
        expect(await present("Aplica el artículo 5 de la Ley B", "Ley B.pdf")).toMatchObject({
            status: "backed", citation_ref: 1, unverified_references: [], passage: { excerpt: "Artículo 5. Texto." },
        });
    });

    it("keeps it backed when the stored text goes on after the law's name", async () => {
        for (const text of ["El artículo 5 de la LFT exige una jornada máxima", "Aplica el artículo 5 de la Ley B establece que sí"])
            expect(await present(text, text.includes("LFT") ? "Ley Federal del Trabajo.pdf" : "Ley B.pdf")).toMatchObject({
                status: "backed", citation_ref: 1, unverified_references: [], passage: { excerpt: "Artículo 5. Texto." },
            });
    });

    it("shows it unbacked, with the reference unverified and no passage, when the passage does not show the article", async () => {
        expect(await present("Aplica el artículo 6 de la Ley A", "Ley B.pdf")).toMatchObject({
            status: "unbacked", citation_ref: null, passage: null, unverified_references: ["art. 6"],
        });
    });
});
