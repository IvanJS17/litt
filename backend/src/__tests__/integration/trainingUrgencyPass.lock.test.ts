// LiTT training layer 2 (docs/training.md, D4): an urgency pass lifts «Tu
// turno primero» and nothing else. One pupil, one matter, one in-memory
// database: the real turn rule, the real seal of a new version and the real
// release rule.
//
// Negative control: the same pupil, the same matter and the same document
// answer differently ONLY in what the turn requires. Were the pass folded
// into resolveTrainingStage (the "simplification" D4 forbids), the version
// written during the pass would come out unsealed and the last assertion of
// the pass phase would fail.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkTrainingTurn } from "../../lib/training";
import { resolveTurnTraining, turnStage } from "../../lib/trainingPass";
import { assertReleasable } from "../../lib/trainingRelease";
import { beginTrainingTurn } from "../../lib/trainingTurn";
import { createDocumentVersion } from "../../modules/documents/documents.service";
import type { Db } from "../../lib/supabase";
import { memoryDb, type Row } from "../helpers/memoryDb";

const ORG = "00000000-0000-4000-8000-000000000010";
const PROJECT = "00000000-0000-4000-8000-000000000020";
const PUPIL = "00000000-0000-4000-8000-000000000001";
const MENTOR = "00000000-0000-4000-8000-000000000002";
const DOC = "00000000-0000-4000-8000-000000000030";
const HASH = "a".repeat(64);
const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

function setup() {
    const memory = memoryDb({
        training_stages: [{ org_id: ORG, trainee_user_id: PUPIL, practice: null, stage: "pasante" }],
        projects: [{ id: PROJECT, practice: null }],
        matters: [],
        documents: [{ id: DOC, org_id: ORG, project_id: PROJECT }],
        document_versions: [],
        training_version_approvals: [],
        training_urgency_passes: [],
    });
    // create_document_version stores the row it is given, seal included.
    const rpc = async (name: string, args: { p_document_id: string; p_version: Row }) => {
        if (name !== "create_document_version") throw new Error(`unexpected rpc ${name}`);
        memory.tables.document_versions.push({
            id: `ver-${memory.tables.document_versions.length + 1}`,
            document_id: args.p_document_id,
            deleted_at: null,
            ...args.p_version,
        });
        return { data: null, error: null };
    };
    const db = { from: memory.db.from, rpc } as unknown as Db;
    return { db, tables: memory.tables };
}

async function turnWithoutAttempt(db: Db) {
    const turn = await resolveTurnTraining(db, PUPIL, { orgId: ORG, projectId: PROJECT });
    return checkTrainingTurn(turnStage(turn), undefined);
}

async function writeVersion(db: Db, tables: Record<string, Row[]>) {
    await createDocumentVersion(db, {
        authorship: { kind: "author", userId: PUPIL },
        document_id: DOC,
        storage_path: `documents/${PUPIL}/${DOC}/v.docx`,
        source: "assistant_edit",
        filename: "Demanda.docx",
        content_sha256: HASH,
    });
    return tables.document_versions.at(-1)!;
}

describe("an urgency pass and the output lock", () => {
    it("lifts the attempt only while in force; the pasante's draft stays sealed", async () => {
        const { db, tables } = setup();

        // Without a pass: the attempt is required.
        expect(await turnWithoutAttempt(db)).toMatchObject({
            ok: false,
            code: "training_attempt_required",
        });

        // With a pass in force on the matter: it is not, and an attempt sent
        // anyway is ignored (no note to keep).
        tables.training_urgency_passes.push({
            id: "pass-1",
            org_id: ORG,
            trainee_user_id: PUPIL,
            project_id: PROJECT,
            granted_by: MENTOR,
            starts_at: minutesFromNow(-5),
            expires_at: minutesFromNow(60),
            reason_code: "plazo",
            reason_note: null,
            revoked_at: null,
        });
        expect(await turnWithoutAttempt(db)).toEqual({ ok: true, attempt: null });
        const during = await resolveTurnTraining(db, PUPIL, { orgId: ORG, projectId: PROJECT });
        expect(checkTrainingTurn(turnStage(during), "x".repeat(80))).toEqual({ ok: true, attempt: null });

        // What the pupil writes during the pass is still a pasante's draft,
        // and it does not leave without an approval.
        const version = await writeVersion(db, tables);
        expect(version).toMatchObject({ training_stage: "pasante", training_author_user_id: PUPIL });
        expect(await assertReleasable(db, version.id as string)).toMatchObject({
            ok: false,
            kind: "conflict",
            code: "training_approval_required",
        });
        tables.training_version_approvals.push({ document_version_id: version.id, content_sha256: HASH });
        expect(await assertReleasable(db, version.id as string)).toEqual({ ok: true, data: undefined });

        // Once the pass has expired, the attempt is required again.
        tables.training_urgency_passes[0].expires_at = minutesFromNow(-1);
        expect(await turnWithoutAttempt(db)).toMatchObject({
            ok: false,
            code: "training_attempt_required",
        });
    });
});

describe("an urgency pass and the modes (hints, counterpart)", () => {
    const ATTEMPT = "x".repeat(80);
    const begin = (db: Db, mode: string) =>
        beginTrainingTurn(db, {
            surface: "project_chat",
            userId: PUPIL,
            scope: { orgId: ORG, projectId: PROJECT },
            body: { attempt: ATTEMPT, confidence: 3, training_mode: mode },
            chatId: null,
        });

    it("is on for a pasante, off while the pass is in force, and on again once it expires", async () => {
        const { db, tables } = setup();
        tables.training_turn_notes = [];
        tables.organizations = [{ id: ORG, kind: "team", deleted_at: null }];
        expect(await begin(db, "hint")).toMatchObject({ ok: true, plan: { mode: "hint", step: 1 } });

        tables.training_urgency_passes.push({
            id: "pass-1",
            org_id: ORG,
            trainee_user_id: PUPIL,
            project_id: PROJECT,
            granted_by: MENTOR,
            starts_at: minutesFromNow(-5),
            expires_at: minutesFromNow(60),
            reason_code: "plazo",
            reason_note: null,
            revoked_at: null,
        });
        for (const mode of ["hint", "counterpart", "counterpart_close"])
            expect(await begin(db, mode)).toMatchObject({ ok: false, status: 400, code: "training_mode_not_allowed" });
        // The stage itself did not change: the seal still reads it.
        const during = await resolveTurnTraining(db, PUPIL, { orgId: ORG, projectId: PROJECT });
        expect(during).toMatchObject({ stage: "pasante", passActive: true });

        tables.training_urgency_passes[0].expires_at = minutesFromNow(-1);
        expect(await begin(db, "hint")).toMatchObject({ ok: true });
    });
});

// D4's contract, read from the sources: the seal, the approvals and the AI
// review's approved report decide with the raw stage; the chat surfaces with
// an organization decide the turn with resolveTurnTraining; Word has no
// project, so it never consults a pass.
describe("D4: which rule each place reads", () => {
    const source = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

    it.each([
        "modules/documents/documents.lifecycle.ts",
        "modules/documents/documents.trainingApproval.ts",
        "modules/ai-recovery/ai-recovery.reports.ts",
    ])("%s seals or approves with resolveTrainingStage, never the pass", (path) => {
        const text = source(path);
        expect(text).toContain("resolveTrainingStage(");
        expect(text).not.toMatch(/trainingPass|resolveTurnTraining/);
    });

    it("keeps the release rule and the stage resolver unaware of passes", () => {
        expect(source("lib/trainingRelease.ts")).not.toMatch(/trainingPass|urgency/);
        expect(source("lib/training.ts")).not.toMatch(/trainingPass|urgency/);
    });

    // The turn is wired once, in lib/trainingTurn (card 1 of layer 3): each of
    // the four surfaces makes exactly ONE call to beginTrainingTurn, and its
    // `surface:` is an argument of that very call (not a string elsewhere in
    // the file). None of them reads a stage itself: Word included, whose own
    // stage rule is applied inside beginTrainingTurn.
    const SURFACES = [
        ["modules/chat/chat.prepare.ts", "chat"],
        ["modules/project-chat/projectChat.service.ts", "project_chat"],
        ["modules/tabular/tabular.chats.ts", "tabular"],
        ["modules/word-chat/wordChat.service.ts", "word"],
    ] as const;
    const STAGE_READERS =
        /resolveTrainingStage\(|resolveWordTrainingStage\(|resolveTurnTraining|checkTrainingTurn|trainingPass/;
    const begins = (text: string) => [...text.matchAll(/\bbeginTrainingTurn\(/g)];

    it.each(SURFACES)("%s decides the turn through beginTrainingTurn (%s)", (path, surface) => {
        const text = source(path);
        const calls = begins(text);
        expect(calls).toHaveLength(1);
        // The object literal opening the call carries the surface, before its first closing brace.
        const call = text.slice(calls[0].index!, text.indexOf("});", calls[0].index!) + 3);
        expect(call).toMatch(new RegExp(`^beginTrainingTurn\\(\\s*db,\\s*\\{[^}]*\\bsurface:\\s*"${surface}"`));
        expect(call).toMatch(/\bbody:\s*\{[^}]*\battempt:\s*args\.attempt/);
        expect(call).toMatch(/\bbody:\s*\{[^}]*\bconfidence:\s*args\.confidence/);
        // The mode the person asks for rides on the same call; the rung is the server's.
        expect(call).toMatch(/\bbody:\s*\{[^}]*\btraining_mode:\s*args\.trainingMode/);
        expect(call).not.toMatch(/\b(step|hint_level|level)\b/);
        expect(text).not.toMatch(STAGE_READERS);
        // The note is recorded from the plan that call returned, and from nowhere else.
        expect(text).toMatch(/recordTrainingNote\(db,\s*\{\s*plan:\s*trainingPlan/);
        // No other surface name rides on this file's call.
        for (const [, other] of SURFACES)
            if (other !== surface) expect(call).not.toContain(`surface: "${other}"`);
    });

    // Word with `storage: "local"` keeps no notes, so the server cannot count a
    // rung there: it tells the turn so, and the modes refuse (modes.test.ts).
    it("tells the turn whether Word keeps its chat", () => {
        const call = source("modules/word-chat/wordChat.service.ts");
        expect(call).toMatch(/persisted:\s*persistChat/);
        expect(call).toMatch(/chatId:\s*persistChat \? chatId : null/);
    });

    it("gives each surface a different name: the four calls are four distinct surfaces", () => {
        const names = SURFACES.map(([path]) => /surface:\s*"(\w+)"/.exec(source(path))?.[1]);
        expect(new Set(names).size).toBe(SURFACES.length);
    });

    it("decides the turn of those surfaces with resolveTurnTraining, in one place", () => {
        const text = source("lib/trainingTurn/index.ts");
        expect(text).toContain("resolveTurnTraining(");
        expect(text).toContain("resolved.passActive ? null : resolved.stage");
        expect(text).not.toContain("resolveTrainingStage(");
    });

    // Hints and the counterparty's lawyer (card 6) are behaviors of the turn,
    // so they read the turn's rule: a pass turns them off, and they never read
    // the raw stage or a pass themselves.
    it("gives the modes the turn's rule: off under a pass, never reading a stage or a pass", () => {
        const modes = source("lib/trainingTurn/modes.ts");
        expect(modes).toContain("resolved.passActive");
        expect(modes).not.toMatch(STAGE_READERS);
        expect(modes).not.toMatch(/urgency/i);
        expect(source("lib/trainingHint.ts")).not.toMatch(STAGE_READERS);
    });

    it("leaves Word on its own stage rule, without passes", () => {
        const word = source("modules/word-chat/wordChat.service.ts");
        expect(word).not.toMatch(STAGE_READERS);
        const wired = source("lib/trainingTurn/index.ts");
        // beginTrainingTurn applies the Word rule for the "word" surface only,
        // and gives it no pass.
        expect(wired).toMatch(/args\.surface === "word"[\s\S]{0,200}resolveWordTrainingStage\(/);
        expect(wired).toMatch(/passActive: false/);
        expect(wired.match(/resolveWordTrainingStage\(/g)).toHaveLength(1);
    });
});
