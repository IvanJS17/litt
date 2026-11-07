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

    it.each([
        "modules/chat/chat.prepare.ts",
        "modules/project-chat/projectChat.service.ts",
        "modules/tabular/tabular.chats.ts",
    ])("%s decides the turn with resolveTurnTraining", (path) => {
        const text = source(path);
        expect(text).toContain("resolveTurnTraining(");
        expect(text).toContain("checkTrainingTurn(turnStage(turn)");
        expect(text).not.toContain("resolveTrainingStage(");
    });

    it("leaves Word on its own stage rule, without passes", () => {
        const text = source("modules/word-chat/wordChat.service.ts");
        expect(text).toContain("resolveWordTrainingStage(");
        expect(text).not.toMatch(/trainingPass|resolveTurnTraining/);
    });
});
