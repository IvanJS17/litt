import { beforeEach, describe, expect, it, vi } from "vitest";

// A turn that is already running keeps asking the database, at each document it
// reads and at each document it creates, whether the person it runs for may do
// that NOW. The turn's own store, built while the person was allowed, decides
// nothing.

const mocks = vi.hoisted(() => ({
  text: vi.fn(), bytes: vi.fn(), active: vi.fn(), download: vi.fn(), upload: vi.fn(),
  extract: vi.fn(), reportError: vi.fn(),
}));
vi.mock("../../../../lib/observability/report", async (load) => ({
  ...await load<object>(), reportError: mocks.reportError,
}));
vi.mock("../../../../lib/documentTextCache", async (load) => ({ ...await load<object>(), loadVersionTextState: mocks.text }));
vi.mock("../../../../lib/documentVersions", async (load) => ({ ...await load<object>(), loadActiveVersion: mocks.active }));
vi.mock("../../../documents/documents.service", async (load) => ({ ...await load<object>(), loadCurrentVersionBytes: mocks.bytes }));
vi.mock("../../../../lib/extraction/isolated", async (load) => ({
  ...await load<object>(), withExtractionRequest: (work: (extract: typeof mocks.extract) => unknown) => work(mocks.extract),
}));
vi.mock("../../../../lib/storage", async (load) => ({
  ...await load<object>(),
  downloadFile: mocks.download, downloadFileIfAvailable: mocks.download, uploadFile: mocks.upload,
}));
// These tests are about what is copied; the room the copies fill is asked in
// workflowAssetReplication.test.ts.
vi.mock("../../../../lib/storageQuota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/storageQuota")>()),
  resolveUploadSpace: async () => ({ ok: true, space: { orgId: null, userId: "u" } }),
  storageSpaceUsage: async () => ({ usedBytes: 0, limitBytes: 1_000_000 }),
}));

vi.mock("../../../../lib/downloadTokens", () => ({ buildDownloadUrl: () => "/download/token" }));
vi.mock("../../../../lib/queue/conversionQueue", () => ({ enqueueConversion: vi.fn(async () => ({})) }));

import { withRequestPrincipal } from "../../../../lib/managedAccounts";
import { runToolCalls } from "../tools/toolDispatcher";
import { readDocumentContent } from "../tools/documentOps";
import { METHODOLOGY_TOOL_NAME } from "../tools/methodologyTool";
import type { DocIndex, DocStore } from "../types";

const ME = "11111111-1111-4111-8111-111111111111";
const EMAIL = "me@example.test";
const DOC = "22222222-2222-4222-8222-222222222222";
const SOURCE_TEXT = "The lease runs for twelve months.";
const NEUTRAL = "Document could not be read.";

type Row = Record<string, unknown>;
/**
 * A small stand-in for the database whose answers can change while a turn runs.
 * `readable` is what the document-access function answers; the tables feed the
 * project and organization verdicts the same way the real queries do.
 */
function world() {
  const state = {
    readable: new Set<string>([DOC]),
    deniedProjects: [] as string[],
    failReadCheck: false,
    tables: {
      projects: [{ id: "proj", user_id: "someone-else", org_id: "firm", visibility: "organization", archived_at: null }],
      org_members: [{ org_id: "firm", user_id: ME, role: "member" }],
      organizations: [{ id: "firm", kind: "team" }],
      project_org_access_overrides: [] as Row[],
    } as Record<string, Row[]>,
    inserted: [] as { table: string; payload: unknown }[],
    rpcs: [] as string[],
    /** Every question about who may do what, in order. */
    asked: [] as string[],
  };
  const ACCESS_TABLES = ["projects", "org_members", "organizations", "project_org_access_overrides", "project_access_grants"];
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let insert: unknown;
    if (ACCESS_TABLES.includes(table)) state.asked.push(table);
    const match = () => (state.tables[table] ?? []).filter((row) => filters.every(([c, v]) => row[c] === v));
    const builder: Record<string, unknown> = {
      select: () => builder, is: () => builder, in: () => builder, order: () => builder, limit: () => builder,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return builder; },
      insert: (payload: unknown) => { insert = payload; state.inserted.push({ table, payload }); return builder; },
      update: () => builder, delete: () => builder,
      single: async () => (insert !== undefined
        ? { data: { id: (insert as Row).id ?? "new-doc" }, error: null }
        : { data: match()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(
        insert !== undefined
          ? { data: (Array.isArray(insert) ? insert : [insert]).map((r) => ({ id: (r as Row).id ?? "new-doc" })), error: null }
          : table === "document_versions" ? { data: [{ training_author_user_id: null, training_stage: null }], error: null }
          : { data: match(), error: null },
      ).then(resolve, reject),
    };
    return builder;
  };
  const rpc = async (name: string, args: Row) => {
    state.rpcs.push(name);
    if (["document_text_access", "private_matter_denied_project_ids", "org_item_is_ownerless"].includes(name)) state.asked.push(name);
    if (name === "document_text_access") {
      if (state.failReadCheck) return { data: null, error: { code: "08006", message: "private database detail" } };
      return { data: state.readable.has(args.p_document_id as string), error: null };
    }
    if (name === "private_matter_denied_project_ids") return { data: state.deniedProjects, error: null };
    if (name === "org_item_is_ownerless") return { data: false, error: null };
    if (name === "create_document_versions")
      return { data: (args.p_versions as Row[]).map((row, i) => ({ ...row, id: `new-version-${i + 1}` })), error: null };
    return { data: { id: "version-1", version_number: 1 }, error: null };
  };
  return { state, db: { from, rpc } as never };
}

const store = (extra: Row = {}): DocStore => new Map([
  ["doc-0", { storage_path: "stored/lease.docx", file_type: "docx", filename: "lease.docx", ...extra }],
]);
const index = (): DocIndex => ({ "doc-0": { document_id: DOC, filename: "lease.docx", version_id: "v1", version_number: 1 } });
const call = (name: string, args: Row, id = "call") => ({ id, function: { name, arguments: JSON.stringify(args) } });
type RunOptions = { projectId?: string | null; orgId?: string | null; docStore?: DocStore; docIndex?: DocIndex; extra?: Row };
function run(tools: ReturnType<typeof call>[], w: ReturnType<typeof world>, o: RunOptions = {}) {
  return runToolCalls(tools, o.docStore ?? store(), ME, w.db, () => {}, undefined, undefined,
    o.docIndex ?? index(), undefined, new Map(), o.projectId ?? null, "nonce",
    { userEmail: EMAIL, orgId: o.orgId ?? null, ...o.extra });
}
const content = (r: { toolResults: unknown[] }, at = 0) => (r.toolResults[at] as { content: string }).content;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.text.mockResolvedValue({ revision: "r1", text: SOURCE_TEXT, textlessPageCount: 0 });
  mocks.active.mockResolvedValue({ id: "v1", version_number: 1, storage_path: "stored/lease.docx", text_revision: "r1" });
  mocks.bytes.mockResolvedValue({ bytes: Buffer.from("bytes"), storage_path: "stored/lease.docx" });
  mocks.download.mockResolvedValue(new TextEncoder().encode("docx").buffer);
  mocks.upload.mockResolvedValue(undefined);
  mocks.extract.mockResolvedValue(SOURCE_TEXT);
});

const nothingServed = () => {
  expect(mocks.text).not.toHaveBeenCalled();
  expect(mocks.bytes).not.toHaveBeenCalled();
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.extract).not.toHaveBeenCalled();
};

describe("reading a stored document in a running turn", () => {
  it("serves the whole text to a person who may open the document", async () => {
    const w = world();
    const r = await run([call("read_document", { doc_id: "doc-0" })], w);
    expect(content(r)).toContain(SOURCE_TEXT);
    expect(w.state.rpcs.filter((n) => n === "document_text_access")).toHaveLength(1);
  });

  it("refuses read_document, fetch_documents and find_in_document once access is withdrawn", async () => {
    const w = world();
    w.state.readable.delete(DOC);
    const docStore = store(); const docIndex = index();
    const r = await run([
      call("read_document", { doc_id: "doc-0" }, "a"),
      call("fetch_documents", { doc_ids: ["doc-0"] }, "b"),
      call("find_in_document", { doc_id: "doc-0", query: "lease" }, "c"),
    ], w, { docStore, docIndex });
    expect(content(r, 0)).toContain(NEUTRAL);
    expect(content(r, 1)).toContain(NEUTRAL);
    expect(JSON.parse(content(r, 2))).toMatchObject({ ok: false, error: NEUTRAL });
    expect(JSON.stringify(r.toolResults)).not.toContain(SOURCE_TEXT);
    nothingServed();
  });

  it("refuses a repeat read of text the turn already holds, and does not tell it from a missing document", async () => {
    const w = world();
    const docStore = store(); const docIndex = index();
    const first = await run([call("find_in_document", { doc_id: "doc-0", query: "lease" })], w, { docStore, docIndex });
    expect(JSON.parse(content(first)).ok).toBe(true);
    w.state.readable.delete(DOC);
    const again = await run([
      call("find_in_document", { doc_id: "doc-0", query: "lease" }, "a"),
      call("fetch_documents", { doc_ids: ["doc-0"] }, "b"),
    ], w, { docStore, docIndex });
    expect(JSON.parse(content(again, 0))).toMatchObject({ ok: false, error: NEUTRAL });
    expect(content(again, 1)).toContain(NEUTRAL);
    expect(JSON.stringify(again.toolResults)).not.toContain(SOURCE_TEXT);
  });

  it("does not answer 'already read' to a person whose access was withdrawn after the first read", async () => {
    const w = world();
    const docStore = store(); const docIndex = index(); const state = new Map();
    const run1 = (id: string) => runToolCalls([call("read_document", { doc_id: "doc-0" }, id)], docStore, ME, w.db, () => {},
      undefined, undefined, docIndex, undefined, state, null, "nonce", { userEmail: EMAIL });
    expect(content(await run1("a"))).toContain(SOURCE_TEXT);
    w.state.readable.delete(DOC);
    const again = await run1("b");
    expect(content(again)).toContain(NEUTRAL);
    expect(content(again)).not.toContain("already");
    expect(again.docsRead).toHaveLength(0);
  });

  it("serves no text from a version that became current after access was withdrawn", async () => {
    const w = world();
    w.state.readable.delete(DOC);
    mocks.active.mockResolvedValue({ id: "v2", version_number: 2, storage_path: "stored/lease-v2.docx", text_revision: "r2" });
    mocks.text.mockResolvedValue({ revision: "r2", text: "Newer clause text", textlessPageCount: 0 });
    const r = await run([call("read_document", { doc_id: "doc-0" })], w);
    expect(content(r)).toContain(NEUTRAL);
    expect(JSON.stringify(r)).not.toContain("Newer clause");
    nothingServed();
  });

  it("reads the stored document behind a workflow asset only while the person may open it", async () => {
    const w = world();
    const asset = () => store({ source_kind: "workflow_asset", asset_document_id: DOC });
    const ok = await run([call("read_document", { doc_id: "doc-0" })], w, { docStore: asset(), docIndex: {} });
    expect(content(ok)).toContain(SOURCE_TEXT);
    w.state.readable.delete(DOC);
    mocks.bytes.mockClear(); mocks.download.mockClear(); mocks.extract.mockClear(); mocks.text.mockClear();
    const denied = await run([call("read_document", { doc_id: "doc-0" })], w, { docStore: asset(), docIndex: {} });
    expect(content(denied)).toContain(NEUTRAL);
    nothingServed();
  });

  it("keeps the request-scoped Word text readable without any lookup", async () => {
    const w = world();
    const docStore: DocStore = new Map([["word", { storage_path: "inline:x", file_type: "text/markdown", filename: "open.docx", inline_text: "Open document text" }]]);
    const r = await run([call("read_document", { doc_id: "word" })], w, { docStore, docIndex: {} });
    expect(content(r)).toContain("Open document text");
    expect(w.state.rpcs).toEqual([]);
  });

  it("refuses, and reports once without database detail, when the check cannot be made", async () => {
    const w = world();
    w.state.failReadCheck = true;
    const r = await run([call("read_document", { doc_id: "doc-0" })], w);
    expect(content(r)).toContain(NEUTRAL);
    nothingServed();
    expect(mocks.reportError).toHaveBeenCalledTimes(1);
    const [reported] = mocks.reportError.mock.calls[0];
    expect((reported as Error).cause).toMatchObject({ code: "08006" });
    expect(JSON.stringify(r)).not.toContain("private database detail");
  });

  it("gives the methodology tool no text of a document the person may no longer open", async () => {
    const quote = "twelve months";
    const methodology = (w: ReturnType<typeof world>) => run([call(METHODOLOGY_TOOL_NAME, {
      calculation: "proportion", annex: false,
      inputs: [
        { name: "numerator", value: "1", source: { kind: "document", doc_id: "doc-0", quote } },
        { name: "denominator", value: "2" },
      ],
    })], w, { extra: { methodology: true } });
    const w = world();
    expect(content(await methodology(w))).toContain("cita verificada");
    w.state.readable.delete(DOC);
    mocks.text.mockClear();
    const denied = await methodology(w);
    expect(content(denied)).not.toContain("cita verificada");
    expect(mocks.text).not.toHaveBeenCalled();
  });
});

describe("what the checks cost", () => {
  it("one read_document asks one question, and a repeat of text already held asks one more", async () => {
    const w = world();
    const docStore = store(); const docIndex = index();
    await run([call("read_document", { doc_id: "doc-0" })], w, { docStore, docIndex });
    expect(w.state.asked).toEqual(["document_text_access"]);
    w.state.asked.length = 0;
    await run([call("find_in_document", { doc_id: "doc-0", query: "lease" })], w, { docStore, docIndex });
    expect(w.state.asked).toEqual(["document_text_access"]);
  });

  it("one generated document asks the destination's verdict twice: before the upload and before the row", async () => {
    const generate = async (o: RunOptions) => {
      const w = world();
      await run([call("generate_excel", { title: "Sheet", sheets: [] })], w, o);
      return w.state.asked;
    };
    const project = ["projects", "private_matter_denied_project_ids", "org_members", "project_org_access_overrides"];
    expect(await generate({ projectId: "proj", orgId: "firm" })).toEqual([...project, ...project]);
    expect(await generate({ orgId: "firm" })).toEqual(["organizations", "org_members", "organizations", "org_members"]);
    expect(await generate({})).toEqual([]);
  });
});

describe("creating a document in a running turn", () => {
  const generators = [
    ["generate_docx", { title: "Memo", sections: [{ heading: "A", content: "text" }] }],
    ["generate_excel", { title: "Sheet", sheets: [{ name: "S", rows: [["a"]] }] }],
    ["generate_ppt", { title: "Deck", slides: [{ title: "T", bullets: ["b"] }] }],
  ] as const;
  const nothingWritten = (w: ReturnType<typeof world>) => {
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(w.state.inserted).toEqual([]);
  };
  const inProject = { projectId: "proj", orgId: "firm" };

  it.each(generators)("%s creates the document for a person who may edit the project", async (name, args) => {
    const w = world();
    const r = await run([call(name, args)], w, inProject);
    expect(JSON.parse(content(r))).not.toHaveProperty("error");
    expect(mocks.upload).toHaveBeenCalled();
    expect(w.state.inserted.some((i) => i.table === "documents")).toBe(true);
  });

  it.each(generators)("%s writes nothing once the person has left the firm", async (name, args) => {
    const w = world();
    w.state.tables.org_members = [];
    const r = await run([call(name, args)], w, inProject);
    expect(JSON.parse(content(r))).toMatchObject({ ok: false });
    nothingWritten(w);
    expect(r.docsCreated).toHaveLength(0);
  });

  it.each(generators)("%s writes nothing once the matter was made private to others", async (name, args) => {
    const w = world();
    w.state.deniedProjects = ["proj"];
    await run([call(name, args)], w, inProject);
    nothingWritten(w);
  });

  it.each(generators)("%s writes nothing for a Viewer of the project", async (name, args) => {
    const w = world();
    w.state.tables.project_org_access_overrides = [{ project_id: "proj", org_id: "firm", user_id: ME, role: "viewer" }];
    await run([call(name, args)], w, inProject);
    nothingWritten(w);
  });

  it.each(generators)("%s records no row when access is withdrawn while its file uploads", async (name, args) => {
    const w = world();
    mocks.upload.mockImplementation(async () => { w.state.tables.org_members = []; });
    const r = await run([call(name, args)], w, inProject);
    expect(JSON.parse(content(r))).toMatchObject({ ok: false });
    expect(w.state.inserted).toEqual([]);
    expect(r.docsCreated).toHaveLength(0);
  });

  it("writes nothing outside a project once the person left the firm, and still writes while a member", async () => {
    const w = world();
    const ok = await run([call("generate_docx", generators[0][1])], w, { orgId: "firm" });
    expect(JSON.parse(content(ok))).not.toHaveProperty("error");
    mocks.upload.mockClear(); w.state.inserted.length = 0;
    w.state.tables.org_members = [];
    await run([call("generate_docx", generators[0][1])], w, { orgId: "firm" });
    nothingWritten(w);
  });

  it("refuses, and reports once, when the check cannot be made", async () => {
    const w = world();
    const failing = { ...(w.db as object), from: () => { throw new Error("private lookup detail"); } } as never;
    const r = await runToolCalls([call("generate_docx", generators[0][1])], store(), ME, failing, () => {}, undefined, undefined,
      index(), undefined, new Map(), null, "nonce", { userEmail: EMAIL, orgId: "firm" });
    expect(JSON.parse(content(r))).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain("private lookup detail");
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledTimes(1);
  });

  it("the methodology annex is not created once the person has left the firm", async () => {
    const methodology = (w: ReturnType<typeof world>) => run([call(METHODOLOGY_TOOL_NAME, {
      calculation: "proportion",
      inputs: [{ name: "numerator", value: "1" }, { name: "denominator", value: "2" }],
    })], w, { ...inProject, extra: { methodology: true, allowDocumentMutation: true } });
    const w = world();
    expect((await methodology(w)).docsCreated).toHaveLength(1);
    mocks.upload.mockClear(); w.state.inserted.length = 0;
    w.state.tables.org_members = [];
    const denied = await methodology(w);
    expect(denied.docsCreated).toHaveLength(0);
    nothingWritten(w);
    // The calculation still comes back; the annex does not.
    expect(JSON.parse(content(denied))).toMatchObject({ ok: false, calculation: { result: { value: "50.00 %" } } });
  });

  const replicate = (w: ReturnType<typeof world>, o: RunOptions = inProject) =>
    run([call("replicate_document", { doc_id: "doc-0", count: 2 })], w, o);

  it("replicate_document copies for a person who may edit the project", async () => {
    const w = world();
    const r = await replicate(w);
    expect(JSON.parse(content(r))).toMatchObject({ ok: true, count: 2 });
    expect(w.state.inserted.filter((i) => i.table === "documents")).toHaveLength(1);
  });

  it("replicate_document uploads and inserts nothing once the person has left the firm", async () => {
    const w = world();
    w.state.tables.org_members = [];
    const r = await replicate(w);
    expect(JSON.parse(content(r))).toMatchObject({ ok: false });
    nothingWritten(w);
  });

  it("replicate_document does not insert when access is withdrawn while its copies upload", async () => {
    const w = world();
    mocks.upload.mockImplementation(async () => { w.state.tables.org_members = []; });
    const r = await replicate(w);
    expect(JSON.parse(content(r))).toMatchObject({ ok: false });
    expect(w.state.inserted).toEqual([]);
  });

  it("replicate_document copies nothing from a document the person may no longer open", async () => {
    const w = world();
    w.state.readable.delete(DOC);
    const r = await replicate(w);
    expect(JSON.parse(content(r))).toMatchObject({ ok: false });
    expect(mocks.download).not.toHaveBeenCalled();
    nothingWritten(w);
  });

  it("a managed account whose personal workspace is closed creates nothing there", async () => {
    const w = world();
    const r = await withRequestPrincipal({ userId: ME, personalWorkspaceDisabled: true }, () =>
      run([call("generate_docx", generators[0][1])], w));
    expect(JSON.parse(content(r))).toMatchObject({ ok: false });
    nothingWritten(w);
  });
});

describe("a refused stored document is asked about before anything else happens", () => {
  const runWithEvents = (tools: ReturnType<typeof call>[], w: ReturnType<typeof world>, o: RunOptions = {}) => {
    const events: string[] = [];
    const result = runToolCalls(tools, o.docStore ?? store(), ME, w.db, (s) => { events.push(s); }, undefined, undefined,
      o.docIndex ?? index(), undefined, new Map(), o.projectId ?? null, "nonce",
      { userEmail: EMAIL, orgId: o.orgId ?? null, ...o.extra });
    return result.then((r) => ({ r, events }));
  };
  const methodologyCall = call(METHODOLOGY_TOOL_NAME, {
    calculation: "proportion", annex: false,
    inputs: [
      { name: "numerator", value: "1", source: { kind: "document", doc_id: "doc-0", quote: "twelve months" } },
      { name: "denominator", value: "2" },
    ],
  });
  const readers = [
    ["read_document", call("read_document", { doc_id: "doc-0" }), {}],
    ["fetch_documents", call("fetch_documents", { doc_ids: ["doc-0"] }), {}],
    ["find_in_document", call("find_in_document", { doc_id: "doc-0", query: "lease" }), {}],
    ["the methodology reader", methodologyCall, { extra: { methodology: true } }],
  ] as const;

  it.each(readers)("%s does not resolve the current version, and emits nothing, for a refused document", async (_name, tool, o) => {
    const w = world();
    w.state.readable.delete(DOC);
    mocks.active.mockResolvedValue({ id: "v2-later", version_number: 7, storage_path: "stored/lease-v2.docx", text_revision: "r2" });
    const { r, events } = await runWithEvents([tool], w, o);
    expect(mocks.active).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(JSON.stringify(r)).not.toContain("v2-later");
    nothingServed();
  });

  it("the citation read does not resolve the current version for a refused document", async () => {
    const w = world();
    w.state.readable.delete(DOC);
    const events: string[] = [];
    const text = await readDocumentContent("doc-0", store(), (s) => { events.push(s); }, index(), w.db,
      { emitEvents: false, actor: { userId: ME, userEmail: EMAIL } });
    expect(text).toBe(NEUTRAL);
    expect(mocks.active).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("find_in_document on a refused document tells the client and the turn record nothing about it", async () => {
    const w = world();
    w.state.readable.delete(DOC);
    mocks.active.mockResolvedValue({ id: "v2-later", version_number: 7, storage_path: "stored/lease-v2.docx", text_revision: "r2" });
    const { r, events } = await runWithEvents([call("find_in_document", { doc_id: "doc-0", query: "lease" })], w);
    expect(events).toEqual([]);
    expect(r.docsFound).toEqual([]);
    expect(JSON.parse(content(r))).toEqual({ ok: false, filename: "lease.docx", error: NEUTRAL });
  });

  it("find_in_document for a person who may open the document emits the same events in the same order, with one question", async () => {
    const w = world();
    const { r, events } = await runWithEvents([call("find_in_document", { doc_id: "doc-0", query: "lease" })], w);
    expect(events.map((e) => JSON.parse(e.slice(6)).type)).toEqual(["doc_find_start", "doc_find"]);
    expect(JSON.parse(events[0].slice(6))).toMatchObject({ document_id: DOC, version_id: "v1", version_number: 1, query: "lease" });
    expect(r.docsFound).toEqual([expect.objectContaining({ document_id: DOC, version_id: "v1", version_number: 1, total_matches: 1 })]);
    expect(w.state.asked).toEqual(["document_text_access"]);
  });

  it("refuses a search entry recorded for another person, with no query sent for it", async () => {
    const entry = (userId: string) => store({ search_source: { revision: "r1", userId, userEmail: null } });
    const w = world();
    const denied = await run([call("read_document", { doc_id: "doc-0" })], w, { docStore: entry("someone-else") });
    expect(content(denied)).toContain(NEUTRAL);
    expect(w.state.rpcs).toEqual([]);
    nothingServed();
    // The same entry bound to the turn's own person does reach the database.
    await run([call("read_document", { doc_id: "doc-0" })], w, { docStore: entry(ME) });
    expect(w.state.rpcs).toContain("read_document_text");
  });
});

describe("a search result is read only while the person may open its document", () => {
  const entry = () => store({ search_source: { revision: "r1", userId: ME, userEmail: EMAIL } });
  /** The database double, with a ready stored text for the search read, and every question it is asked. */
  const searching = () => {
    const w = world();
    const asked: string[] = [];
    const base = (w.db as unknown as { rpc: (n: string, a: Row) => Promise<unknown>; from: unknown });
    const db = {
      from: base.from,
      rpc: async (name: string, args: Row) => {
        asked.push(name);
        if (name === "read_document_text") return { data: { revision: "r1", status: "ready", text: SOURCE_TEXT, textless_page_count: 0 }, error: null };
        return base.rpc(name, args);
      },
    } as never;
    w.state.tables.document_versions = [{ id: "v1", document_id: DOC, text_revision: "r1", deleted_at: null }];
    return { w, db, asked };
  };
  const turn = (db: never, docStore: DocStore, readState: Map<string, unknown>, tool: ReturnType<typeof call>) => {
    const events: string[] = [];
    return runToolCalls([tool], docStore, ME, db, (e) => { events.push(e); }, undefined, undefined, index(), undefined,
      readState as never, null, "nonce", { userEmail: EMAIL }).then((r) => ({ r, events }));
  };
  const textQuestions = (asked: string[]) => asked.filter((n) => n === "read_document_text");

  it.each([
    ["read_document", call("read_document", { doc_id: "doc-0" })],
    ["fetch_documents", call("fetch_documents", { doc_ids: ["doc-0"] })],
  ] as const)("%s: a repeat read after access was withdrawn gets the neutral answer, no notice, no event, no text question", async (_n, tool) => {
    const { w, db, asked } = searching();
    const docStore = entry(); const readState = new Map();
    const first = await turn(db, docStore, readState, tool);
    expect(content(first.r)).toContain(SOURCE_TEXT);
    w.state.readable.delete(DOC);
    asked.length = 0;
    const again = await turn(db, docStore, readState, tool);
    expect(content(again.r)).toContain(NEUTRAL);
    expect(content(again.r)).not.toContain("already");
    expect(again.events).toEqual([]);
    expect(again.r.docsRead).toEqual([]);
    expect(asked).toEqual(["document_text_access"]);
  });

  it("a first read after access was withdrawn gets the neutral answer and emits nothing", async () => {
    const { w, db, asked } = searching();
    w.state.readable.delete(DOC);
    const { r, events } = await turn(db, entry(), new Map(), call("read_document", { doc_id: "doc-0" }));
    expect(content(r)).toContain(NEUTRAL);
    expect(events).toEqual([]);
    expect(r.docsRead).toEqual([]);
    expect(textQuestions(asked)).toEqual([]);
  });

  it("for a person who keeps access: first read serves the text, repeat gives the notice, with the questions listed", async () => {
    const { db, asked } = searching();
    const docStore = entry(); const readState = new Map();
    const first = await turn(db, docStore, readState, call("read_document", { doc_id: "doc-0" }));
    expect(content(first.r)).toContain(SOURCE_TEXT);
    expect(asked).toEqual(["document_text_access", "read_document_text"]);
    asked.length = 0;
    const again = await turn(db, docStore, readState, call("read_document", { doc_id: "doc-0" }));
    expect(content(again.r)).toContain("already_read");
    expect(asked).toEqual(["document_text_access"]);
  });
});
