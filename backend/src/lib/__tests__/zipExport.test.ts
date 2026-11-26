import { Readable } from "node:stream";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_ZIP_EXPORT_BYTES,
  MAX_ZIP_EXPORT_DOCUMENTS,
  uniqueArchiveFilename,
  zipExportLimitDetail,
} from "../zipExport";

describe("ZIP export limits", () => {
  it("accepts exports at the configured limits", () => {
    expect(
      zipExportLimitDetail(MAX_ZIP_EXPORT_DOCUMENTS, MAX_ZIP_EXPORT_BYTES),
    ).toBeNull();
  });

  it("rejects excessive document counts and total bytes", () => {
    expect(zipExportLimitDetail(MAX_ZIP_EXPORT_DOCUMENTS + 1, 0)).toMatch(
      /at most 200 documents/i,
    );
    expect(zipExportLimitDetail(1, MAX_ZIP_EXPORT_BYTES + 1)).toMatch(
      /at most 2 GB/i,
    );
  });

  it("keeps documents with duplicate filenames as separate archive entries", () => {
    const usedNames = new Set<string>();

    expect(uniqueArchiveFilename("Contract.pdf", usedNames)).toBe(
      "Contract.pdf",
    );
    expect(uniqueArchiveFilename("Contract.pdf", usedNames)).toBe(
      "Contract (2).pdf",
    );
    expect(uniqueArchiveFilename("Contract.pdf", usedNames)).toBe(
      "Contract (3).pdf",
    );
  });

  it("looks a name up a number of times proportional to the names, however many share one", () => {
    // Counting the lookups, not timing them: N names against 4N names.
    const lookups = (names: number) => {
      let count = 0;
      const used = new Set<string>();
      const has = used.has.bind(used);
      used.has = (value: string) => {
        count += 1;
        return has(value);
      };
      for (let index = 0; index < names; index++) uniqueArchiveFilename("Contract.pdf", used);
      return count;
    };
    const small = lookups(200);
    const large = lookups(800);
    expect(large).toBeLessThanOrEqual(small * 4 + 8);
  });

  describe("work grows linearly with the entries of one listing", () => {
    // Counting lookups, not timing them: a listing of N entries against one of 4N.
    const lookups = (names: string[]) => {
      let count = 0;
      const used = new Set<string>();
      const has = used.has.bind(used);
      used.has = (value: string) => {
        count += 1;
        return has(value);
      };
      const out = names.map((name) => uniqueArchiveFilename(name, used));
      expect(new Set(out.map((name) => name.toLowerCase())).size).toBe(names.length);
      return count;
    };
    const SMALL = 1000;
    const LARGE = 4000;
    const listing = (size: number, name: (index: number) => string) =>
      Array.from({ length: size }, (_, index) => name(index));

    it.each([
      ["one name", () => "Contract.pdf"],
      ["a name made of dots and spaces", () => " . . . "],
      ["dots and spaces after a stem", () => "Contract . . "],
      ["dots and spaces before an extension", () => "Contract. .pdf"],
      ["names that differ only by trailing dots and spaces", (i: number) => `Contract${". ".repeat(i % 7)}`],
      ["names that differ only by case", (i: number) => (i % 2 ? "CONTRACT.pdf" : "contract.pdf")],
      [
        "many spellings of one name that differ by case",
        (i: number) => [..."contractabc"].map((letter, bit) => ((i >> bit) & 1 ? letter.toUpperCase() : letter)).join("") + ".pdf",
      ],
    ])("%s", (_, name) => {
      const small = lookups(listing(SMALL, name));
      const large = lookups(listing(LARGE, name));
      expect(large).toBeLessThanOrEqual(small * 4 + 16);
    });
  });

  it("preserves path-like and normalized-collision document names as distinct leaf entries", async () => {
    const requested = [
      "Agreement.pdf", "../Agreement.pdf", "./Agreement.pdf",
      "folder/../Agreement.pdf", "folder\\..\\Agreement.pdf",
      "folder_.._Agreement.pdf", " .._Agreement.pdf ",
      "bad\u0000name.pdf", "bad_name.pdf",
    ];
    const expected = [
      "Agreement.pdf", ".._Agreement.pdf", "._Agreement.pdf",
      "folder_.._Agreement.pdf", "folder_.._Agreement (2).pdf",
      "folder_.._Agreement (3).pdf", ".._Agreement (2).pdf",
      "bad_name.pdf", "bad_name (2).pdf",
    ];
    const zip = new JSZip();
    const usedNames = new Set<string>();
    requested.forEach((name, index) => {
      zip.file(uniqueArchiveFilename(name, usedNames), `original-${index}`);
    });

    const reopened = await JSZip.loadAsync(await zip.generateAsync({ type: "nodebuffer" }));

    expect(Object.keys(reopened.files)).toEqual(expected);
    expect(Object.values(reopened.files).every(entry => !entry.dir)).toBe(true);
    for (const [index, name] of expected.entries()) {
      expect(await reopened.file(name)!.async("string")).toBe(`original-${index}`);
    }
  });

  it("preserves dot-only names and replacement-name collisions after reopening the archive", async () => {
    const requested = [".", "..", " . ", " .. ", "_", "_ (2)", "...", ".env"];
    // LiTT names a dot-only document "Untitled" (upstream writes "_").
    const expected = ["Untitled", "Untitled (2)", "Untitled (3)", "Untitled (4)", "_", "_ (2)", "...", ".env"];
    const zip = new JSZip();
    const usedNames = new Set<string>();
    requested.forEach((name, index) => {
      zip.file(uniqueArchiveFilename(name, usedNames), `original-${index}`);
    });

    const reopened = await JSZip.loadAsync(await zip.generateAsync({ type: "nodebuffer" }));

    expect(Object.keys(reopened.files)).toEqual(expected);
    expect(Object.values(reopened.files).every(entry => !entry.dir)).toBe(true);
    for (const [index, name] of expected.entries()) {
      expect(await reopened.file(name)!.async("string")).toBe(`original-${index}`);
    }
  });

  it.each([
    ["case", "Agreement.pdf", "agreement.pdf", "agreement (2).pdf"],
    ["Unicode normalisation", "Résumé.pdf", "Résumé.pdf", "Résumé (2).pdf"],
  ])("suffixes names that differ only by %s, which extract to one file", async (_, first, second, suffixed) => {
    const usedNames = new Set<string>();
    const zip = new JSZip();
    zip.file(uniqueArchiveFilename(first, usedNames), "first");
    zip.file(uniqueArchiveFilename(second, usedNames), "second");

    const reopened = await JSZip.loadAsync(await zip.generateAsync({ type: "nodebuffer" }));

    expect(Object.keys(reopened.files)).toEqual([first, suffixed]);
    expect(await reopened.file(suffixed)!.async("string")).toBe("second");
  });

  it("writes a name nothing folds onto in its own case and Unicode form", () => {
    const usedNames = new Set<string>();

    expect(uniqueArchiveFilename("NDA - ACME.pdf", usedNames)).toBe("NDA - ACME.pdf");
    expect(uniqueArchiveFilename("Résumé.PDF", usedNames)).toBe("Résumé.PDF");
  });

  it("consumes streamed ZIP entries one at a time", async () => {
    let firstStarted = false;
    let secondStarted = false;
    let releaseFirst = () => {};
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = Readable.from(
      (async function* () {
        firstStarted = true;
        await firstBlocked;
        yield Buffer.from("first");
      })(),
    );
    const second = Readable.from(
      (async function* () {
        secondStarted = true;
        yield Buffer.from("second");
      })(),
    );
    const zip = new JSZip();
    zip.file("first.txt", first);
    zip.file("second.txt", second);
    const archive = zip.generateNodeStream({
      type: "nodebuffer",
      streamFiles: true,
      compression: "STORE",
    });
    const output: Buffer[] = [];
    const completed = new Promise<void>((resolve, reject) => {
      archive
        .on("data", (chunk) => output.push(Buffer.from(chunk)))
        .once("error", reject)
        .once("end", resolve);
    });

    await vi.waitFor(() => expect(firstStarted).toBe(true));
    expect(secondStarted).toBe(false);
    releaseFirst();
    await completed;

    expect(secondStarted).toBe(true);
    const generated = await JSZip.loadAsync(Buffer.concat(output));
    await expect(generated.file("first.txt")?.async("text")).resolves.toBe(
      "first",
    );
    await expect(generated.file("second.txt")?.async("text")).resolves.toBe(
      "second",
    );
  });

  it("keeps a filename one entry of the archive, never a path out of it", () => {
    const used = new Set<string>();
    expect(uniqueArchiveFilename("../../.zshrc", used)).toBe(".._.._.zshrc");
    expect(uniqueArchiveFilename("deal\\..\\notes.pdf", used)).toBe("deal_.._notes.pdf");
    expect(uniqueArchiveFilename("a/b.pdf", used)).toBe("a_b.pdf");
    expect(uniqueArchiveFilename("..", used)).toBe("Untitled");
    expect(uniqueArchiveFilename(" ", used)).toBe("Untitled (2)");
  });

  it("keeps apart names a file system unpacks to one file", () => {
    const used = new Set<string>();
    expect(uniqueArchiveFilename("Contract.pdf", used)).toBe("Contract.pdf");
    expect(uniqueArchiveFilename("contract.pdf", used)).toBe("contract (2).pdf");
    expect(uniqueArchiveFilename("R\u00e9sum\u00e9.pdf", used)).toBe("R\u00e9sum\u00e9.pdf");
    // The same name as macOS stores it: letters followed by combining accents.
    expect(uniqueArchiveFilename("Re\u0301sume\u0301.pdf", used)).toBe("Re\u0301sume\u0301 (2).pdf");
    // Windows drops trailing dots and spaces.
    expect(uniqueArchiveFilename("Notes.txt", used)).toBe("Notes.txt");
    expect(uniqueArchiveFilename("Notes.txt.", used)).toBe("Notes.txt (2).");
  });

  it.each([
    ["one stem with different extensions and case spellings",
      ["a.pdf", "a.docx", "A.PDF", "a.pdf", "a.DOCX", "a.docx"],
      ["a.pdf", "a.docx", "A (2).PDF", "a (3).pdf", "a (2).DOCX", "a (3).docx"]],
    ["the same name in four case spellings",
      ["a.pdf", "A.pdf", "a.PDF", "A.PDF"],
      ["a.pdf", "A (2).pdf", "a (3).PDF", "A (4).PDF"]],
    ["a name that already looks like a copy, before the plain name",
      ["a (2).pdf", "a.pdf", "a.pdf", "a.pdf"],
      ["a (2).pdf", "a.pdf", "a (3).pdf", "a (4).pdf"]],
    ["a name that already looks like a copy, after the plain name",
      ["a.pdf", "a.pdf", "a (2).pdf", "a (2).pdf"],
      ["a.pdf", "a (2).pdf", "a (2) (2).pdf", "a (2) (3).pdf"]],
    ["full-width letters, which differ from plain ones until case folds them",
      ["\uFF21.pdf", "A.pdf", "\uFF41.pdf", "a.pdf"],
      ["\uFF21.pdf", "A.pdf", "\uFF41 (2).pdf", "a (2).pdf"]],
    ["a ligature, which differs from its letters",
      ["\uFB01le.pdf", "file.pdf", "FILE.pdf", "\uFB01le.pdf"],
      ["\uFB01le.pdf", "file.pdf", "FILE (2).pdf", "\uFB01le (2).pdf"]],
    ["accented letters in two Unicode forms and in capitals",
      ["R\u00e9sum\u00e9.pdf", "Re\u0301sume\u0301.pdf", "R\u00c9SUM\u00c9.pdf"],
      ["R\u00e9sum\u00e9.pdf", "Re\u0301sume\u0301 (2).pdf", "R\u00c9SUM\u00c9 (3).pdf"]],
    ["a name with and without a trailing dot or space",
      ["a", "a.", "a ", "A", "a.", "a (2)"],
      ["a", "a (2).", "a (3)", "A (4)", "a (5).", "a (2) (2)"]],
  ])("gives these exact names for %s", (_, listing, expected) => {
    const used = new Set<string>();
    expect(listing.map((name) => uniqueArchiveFilename(name, used))).toEqual(expected);
  });
});
