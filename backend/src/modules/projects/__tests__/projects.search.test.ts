import { createClient } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../../lib/documentVersions", () => ({
  attachActiveVersionPaths: vi.fn(), attachLatestVersionNumbers: vi.fn(),
}));
vi.mock("../projects.shared", async original => ({
  ...(await original<typeof import("../projects.shared")>()),
  attachDocumentOwnerLabels: vi.fn(),
}));
import { attachActiveVersionPaths, attachLatestVersionNumbers } from "../../../lib/documentVersions";
import { attachDocumentOwnerLabels } from "../projects.shared";
import { searchProjectDirectory } from "../projects.service";

beforeEach(() => vi.clearAllMocks());

it("pages authorized projects in SQL before enriching only the returned documents in bounded chunks", async () => {
  const documents = Array.from({ length: 121 }, (_, i) => ({
    id: `d${i}`, project_id: "mine", current_version_id: `v${1000 + i}`,
  }));
  const requests: URL[] = [];
  const db = createClient("https://supabase.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      requests.push(url);
      // LiTT C2: the private-matter backstop asks for the returned ids only.
      if (url.pathname === "/rest/v1/rpc/private_matter_denied_project_ids") {
        expect(JSON.parse(String(init?.body))).toEqual({ p_user_id: "owner", p_project_ids: ["mine"] });
        return new Response("[]", { headers: { "Content-Type": "application/json" } });
      }
      expect(url.pathname).toBe("/rest/v1/rpc/search_project_directory");
      expect(JSON.parse(String(init?.body))).toEqual({
        p_user_id: "owner", p_user_email: "owner@example.com", p_search_term: "contract%_\\",
        p_limit: 20, p_offset: 40, p_workspace: "personal",
      });
      return new Response(JSON.stringify([{ id: "mine", documents, folders: [] }]), {
        headers: { "Content-Type": "application/json" },
      });
    } },
  });
  const result = await searchProjectDirectory(db, {
    userId: "owner", userEmail: " OWNER@EXAMPLE.COM ", searchTerm: "contract%_\\",
    pagination: { offset: 40, limit: 20 }, workspace: "personal",
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data).toHaveLength(1);
  expect((result.data[0] as { documents: unknown[] }).documents).toEqual(documents);
  expect(requests.map(url => url.pathname)).toEqual([
    "/rest/v1/rpc/search_project_directory", "/rest/v1/rpc/private_matter_denied_project_ids",
  ]);
  for (const enrich of [attachLatestVersionNumbers, attachActiveVersionPaths, attachDocumentOwnerLabels]) {
    expect(vi.mocked(enrich).mock.calls.map(call => call[1].length)).toEqual([50, 50, 21]);
    expect(vi.mocked(enrich).mock.calls.flatMap(call => call[1] as readonly unknown[])).toEqual(documents);
  }
});

it("does not enrich any documents after a failed authorization query", async () => {
  const error = { message: "query failed" };
  const db = { rpc: vi.fn().mockResolvedValue({ data: null, error }) };
  const result = await searchProjectDirectory(db as never, {
    userId: "caller", searchTerm: "", pagination: { limit: 20, offset: 0 },
  });
  expect(result).toEqual({ ok: false, error });
  expect(attachActiveVersionPaths).not.toHaveBeenCalled();
});

// LiTT C2: search_project_directory already resolves projects through
// project_access_role; the service asks the private-matter guard again and
// fails closed, before any document of a refused matter is hydrated.
it("drops a private matter the caller is not on before hydrating its documents", async () => {
  const rpc = vi.fn(async (name: string) => name === "search_project_directory"
    ? { data: [
        { id: "matter", documents: [{ id: "secret", project_id: "matter" }], folders: [] },
        { id: "mine", documents: [{ id: "d1", project_id: "mine" }], folders: [] },
      ], error: null }
    : { data: ["matter"], error: null });
  const result = await searchProjectDirectory({ rpc } as never, {
    userId: "caller", searchTerm: "x", pagination: { limit: 20, offset: 0 },
  });
  expect(result.ok && result.data.map(project => (project as { id: string }).id)).toEqual(["mine"]);
  expect(rpc).toHaveBeenCalledWith("private_matter_denied_project_ids", { p_user_id: "caller", p_project_ids: ["matter", "mine"] });
  expect(vi.mocked(attachActiveVersionPaths).mock.calls.flatMap(call => call[1] as readonly unknown[])).toEqual([{ id: "d1", project_id: "mine" }]);
});

it("fails closed when the private-matter guard cannot answer", async () => {
  const error = { message: "guard unavailable" };
  const rpc = vi.fn(async (name: string) => name === "search_project_directory"
    ? { data: [{ id: "matter", documents: [{ id: "secret", project_id: "matter" }], folders: [] }], error: null }
    : { data: null, error });
  const result = await searchProjectDirectory({ rpc } as never, {
    userId: "caller", searchTerm: "x", pagination: { limit: 20, offset: 0 },
  });
  expect(result.ok).toBe(false);
  expect(attachActiveVersionPaths).not.toHaveBeenCalled();
});
