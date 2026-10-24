import { mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { syncWorkflowCatalog } from "../workflowCatalogSync";

const storage = vi.hoisted(() => ({
  enabled: true,
  uploadFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../storage", () => ({
  get storageEnabled() {
    return storage.enabled;
  },
  uploadFile: storage.uploadFile,
}));

const COMMIT = "b".repeat(40);

async function sourceArchive(extraWorkflowKey?: string) {
  const zip = new JSZip();
  const archiveRoot = "mike-workflows-test";
  const root = `${archiveRoot}/assistant-workflows/proofread`;
  zip.file(
    `${root}/SKILL.md`,
    `---
name: "proofread"
description: "Proofread documents"
license: "MIT"
metadata:
  version: "1.0.0"
  author: "Open Legal Products"
  language: "English"
  mike-display-name: "Proofread"
  mike-type: "assistant"
  mike-availability: "system"
  practice: "General Transactions"
  jurisdictions: "General"
---
Proofread the document.
`,
  );
  zip.file(`${root}/assets/template.docx`, Buffer.from("template"));
  for (const [key, title] of [
    ["compare-documents", "Compare Documents"],
    ["extract-key-terms", "Extract Key Terms"],
    ["draft-from-template", "Draft From Template"],
  ] as const) {
    zip.file(
      `${archiveRoot}/assistant-workflows/${key}/SKILL.md`,
      `---
name: "${key}"
description: "Test workflow"
license: "MIT"
metadata:
  version: "1.0.0"
  author: "Open Legal Products"
  language: "English"
  mike-display-name: "${title}"
  mike-type: "assistant"
  practice: "General Transactions"
  jurisdictions: "General"
---
Run the workflow.
`,
    );
  }
  if (extraWorkflowKey) {
    zip.file(
      `${archiveRoot}/assistant-workflows/${extraWorkflowKey}/SKILL.md`,
      `---
name: "${extraWorkflowKey}"
description: "Test workflow"
license: "MIT"
metadata:
  version: "1.0.0"
  author: "Open Legal Products"
  language: "English"
  mike-display-name: "Collision"
  mike-type: "assistant"
  practice: "General Transactions"
  jurisdictions: "General"
---
Run the workflow.
`,
    );
  }
  const tabularKey = "commercial-agreement-tabular-review";
  const tabularRoot = `${archiveRoot}/tabular-review-workflows/${tabularKey}`;
  zip.file(
    `${tabularRoot}/SKILL.md`,
    `---
name: "${tabularKey}"
description: "Test workflow"
license: "MIT"
metadata:
  version: "1.0.0"
  author: "Open Legal Products"
  language: "English"
  mike-display-name: "Commercial Agreement Review"
  mike-type: "tabular"
  practice: "General Transactions"
  jurisdictions: "General"
---
Run the workflow.
`,
  );
  zip.file(
    `${tabularRoot}/table-columns.yaml`,
    `columns:
  - index: 0
    name: "Issue"
    prompt: "Identify the issue"
`,
  );
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

describe("workflow catalog synchronization", () => {
  it("uploads assets, sends no temporary paths to Postgres, and cleans up", async () => {
    storage.enabled = true;
    storage.uploadFile.mockClear();
    const bytes = await sourceArchive();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value =
        url instanceof Request ? url.url : url instanceof URL ? url.href : url;
      if (new URL(value).hostname === "api.github.com") {
        return new Response(JSON.stringify({ sha: COMMIT }), { status: 200 });
      }
      return new Response(bytes, { status: 200 });
    }) as typeof fetch;
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "catalog-sync-test-"),
    );
    try {
      await expect(
        syncWorkflowCatalog({ rpc } as never, { temporaryRoot, fetchImpl }),
      ).resolves.toEqual({
        workflows: 6,
        assets: 1,
        sourceCommit: COMMIT,
      });
      expect(storage.uploadFile).toHaveBeenCalledOnce();
      const [name, args] = rpc.mock.calls[0];
      expect(name).toBe("replace_mike_workflows");
      expect(args.p_source_commit).toBe(COMMIT);
      expect(args.p_workflows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workflow_key: "proofread",
            assets: [
              expect.objectContaining({
                filename: "template.docx",
                storage_path: expect.stringContaining(
                  "mike-workflows/proofread/",
                ),
              }),
            ],
          }),
        ]),
      );
      expect(JSON.stringify(args)).not.toContain("temporary_path");
      await expect(readdir(temporaryRoot)).resolves.toEqual([]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("fails and cleans up instead of dropping assets without storage", async () => {
    storage.enabled = false;
    const bytes = await sourceArchive();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value =
        url instanceof Request ? url.url : url instanceof URL ? url.href : url;
      if (new URL(value).hostname === "api.github.com") {
        return new Response(JSON.stringify({ sha: COMMIT }), { status: 200 });
      }
      return new Response(bytes, { status: 200 });
    }) as typeof fetch;
    const rpc = vi.fn();
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "catalog-sync-test-"),
    );
    try {
      await expect(
        syncWorkflowCatalog({ rpc } as never, { temporaryRoot, fetchImpl }),
      ).rejects.toThrow("require configured S3-compatible storage");
      expect(rpc).not.toHaveBeenCalled();
      await expect(readdir(temporaryRoot)).resolves.toEqual([]);
    } finally {
      storage.enabled = true;
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  async function runSync(archive: Buffer, dbExtra: Record<string, unknown> = {}) {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const value =
        url instanceof Request ? url.url : url instanceof URL ? url.href : url;
      if (new URL(value).hostname === "api.github.com") {
        return new Response(JSON.stringify({ sha: COMMIT }), { status: 200 });
      }
      return new Response(new Uint8Array(archive), { status: 200 });
    }) as typeof fetch;
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "catalog-sync-test-"),
    );
    try {
      const result = await syncWorkflowCatalog(
        { rpc, ...dbExtra } as never,
        { temporaryRoot, fetchImpl },
      );
      return { result, args: rpc.mock.calls[0]?.[1], rpc };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  // TD-006: the Mexican Civil/Mercantile playbook is governed catalog content.
  // It is seeded into `mike_workflows` with its own source commit, and the
  // `playbooks` table — user-authored rule sets only — is never written by a
  // system sync.
  it("seeds the governed MX playbook into mike_workflows and never into playbooks", async () => {
    storage.enabled = true;
    const from = vi.fn(() => {
      throw new Error("a catalog sync must not write tables directly");
    });
    const { args } = await runSync(await sourceArchive(), { from });

    const seeded = (args.p_workflows as Record<string, unknown>[]).find(
      (workflow) => workflow.workflow_key === "civil-commercial-mx-triage",
    );
    expect(seeded).toMatchObject({
      workflow_key: "civil-commercial-mx-triage",
      version: "0.1.0",
      distribution: "addon",
      type: "assistant",
      source_commit: "d9fa8380e63837b6441cef169cf5ef80dfb55e54",
      source: "docs/playbooks/PLAYBOOK_CIVIL_MERCANTIL_MX_v0.1.md",
    });
    expect(seeded?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(seeded?.approval_provenance).toContain("pending");
    expect(seeded?.prompt_md).toContain("R6");
    expect(from).not.toHaveBeenCalled();
  });

  it("states where every imported entry came from and what review it passed", async () => {
    storage.enabled = true;
    const { args } = await runSync(await sourceArchive());
    const imported = (args.p_workflows as Record<string, unknown>[]).filter(
      (workflow) => workflow.workflow_key !== "civil-commercial-mx-triage",
    );
    expect(imported).toHaveLength(5);
    for (const workflow of imported) {
      expect(workflow.source).toBe(
        `https://github.com/Open-Legal-Products/mike-workflows/tree/${COMMIT}`,
      );
      expect(workflow.approval_provenance).toContain("pending");
    }
  });

  it("refuses an upstream catalog that claims the reserved owned key", async () => {
    storage.enabled = true;
    await expect(
      runSync(await sourceArchive("civil-commercial-mx-triage")),
    ).rejects.toThrow("reserved workflow key 'civil-commercial-mx-triage'");
  });
});
