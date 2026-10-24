// @vitest-environment node
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addPresetTemplate,
  PRESET_TEMPLATES,
  presetDirectory,
  presetTemplateUrl,
} from "./presetTemplates";
import { uploadLibraryDocument } from "@/app/lib/mikeApi";

// LiTT ships the catalog empty; the mechanism is exercised on a synthetic one.
const fixture = vi.hoisted(() => {
  const bytes = {
    docx: new TextEncoder().encode("synthetic docx bytes"),
    pdf: new TextEncoder().encode("%PDF synthetic bytes"),
  };
  const entry = (id: string, format: string, data: Uint8Array) => ({
    id,
    filename: id.split("/").at(-1)!,
    title: id.split("/").at(-1)!.replace(/\.[^.]+$/, ""),
    publisher: id.split("/")[0],
    group: id.split("/").slice(0, -1).join("/"),
    format,
    sourceUrl: "https://example.invalid/source",
    license: "Synthetic",
    licenseUrl: "https://example.invalid/license",
    size: data.length,
    sha256: "",
  });
  return {
    bytes,
    catalog: [
      entry("Editorial A/Contrato.docx", "docx", bytes.docx),
      entry("Editorial A/anexos/Anexo.pdf", "pdf", bytes.pdf),
      entry("Editorial B/Guia.md", "md", new Uint8Array(3)),
    ],
  };
});
vi.mock("./presetTemplates.json", async () => {
  const { createHash: hash } = await import("node:crypto");
  for (const item of fixture.catalog) {
    const data = fixture.bytes[item.format as "docx" | "pdf"];
    if (data) item.sha256 = hash("sha256").update(data).digest("hex");
  }
  return { default: fixture.catalog };
});
vi.mock("@/app/lib/mikeApi", () => ({ uploadLibraryDocument: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("shipped preset catalog", () => {
  it("is empty: no US forms are offered as a base for Mexican practice", () => {
    const shipped = JSON.parse(
      readFileSync(join(process.cwd(), "src/app/components/library/presetTemplates.json"), "utf8"),
    );
    expect(shipped).toEqual([]);
  });
});

describe("preset catalog mechanism", () => {
  it("files every preset under its publisher's folder, keeping package directories", () => {
    const { documents, folders } = presetDirectory();
    expect(documents.map((document) => document.id)).toEqual(
      PRESET_TEMPLATES.map((preset) => preset.id),
    );
    expect(
      folders
        .filter((folder) => folder.parent_folder_id === null)
        .map((folder) => folder.name)
        .sort(),
    ).toEqual(["Editorial A", "Editorial B"]);

    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    for (const document of documents) {
      const path = [document.filename];
      let folder = byId.get(document.folder_id ?? "");
      while (folder) {
        path.unshift(folder.name);
        folder = byId.get(folder.parent_folder_id ?? "");
      }
      expect(path.join("/")).toBe(document.id);
    }
  });

  it.each(["docx", "pdf"] as const)(
    "uploads original %s bytes to the selected Templates folder",
    async (format) => {
      const preset = PRESET_TEMPLATES.find((item) => item.format === format)!;
      const bytes = fixture.bytes[format];
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(preset.sha256);
      vi.stubGlobal("crypto", webcrypto);
      const fetchMock = vi
        .fn()
        .mockResolvedValue({
          ok: true,
          arrayBuffer: async () => Uint8Array.from(bytes).buffer,
        });
      vi.stubGlobal("fetch", fetchMock);
      const controller = new AbortController();
      vi.mocked(uploadLibraryDocument).mockResolvedValue({
        id: "personal-copy",
      } as never);
      expect(
        await addPresetTemplate(preset, "folder-1", controller.signal),
      ).toEqual({ id: "personal-copy" });
      expect(fetchMock).toHaveBeenCalledWith(presetTemplateUrl(preset), {
        signal: controller.signal,
      });
      // No workspace named: the template library is not narrowed.
      expect(uploadLibraryDocument).toHaveBeenCalledWith(
        { kind: "templates" },
        expect.any(File),
        "folder-1",
        { signal: controller.signal },
      );
      // In a workspace, the copy is added to that workspace's templates.
      await addPresetTemplate(preset, "folder-1", controller.signal, "org-1");
      expect(uploadLibraryDocument).toHaveBeenLastCalledWith(
        { kind: "templates", workspace: "org-1" },
        expect.any(File),
        "folder-1",
        { signal: controller.signal },
      );
      const file = vi.mocked(uploadLibraryDocument).mock.calls[0][1];
      expect(file.name).toBe(preset.filename);
      expect(file.size).toBe(bytes.length);
      const result = await file.arrayBuffer();
      expect(new Uint8Array(result)).toEqual(new Uint8Array(bytes));
    },
  );

  it("rejects an unavailable asset and a 200 response with corrupt bytes before upload", async () => {
    const preset = PRESET_TEMPLATES.find((item) => item.format === "docx")!;
    vi.stubGlobal("crypto", webcrypto);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(12),
      });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      addPresetTemplate(preset, null, new AbortController().signal),
    ).rejects.toThrow("download failed");
    await expect(
      addPresetTemplate(preset, null, new AbortController().signal),
    ).rejects.toThrow("integrity check failed");
    expect(uploadLibraryDocument).not.toHaveBeenCalled();
  });

  it("keeps Markdown reference files download-only", async () => {
    const preset = PRESET_TEMPLATES.find((item) => item.format === "md")!;
    await expect(
      addPresetTemplate(preset, null, new AbortController().signal),
    ).rejects.toThrow("download only");
    expect(uploadLibraryDocument).not.toHaveBeenCalled();
  });
});
