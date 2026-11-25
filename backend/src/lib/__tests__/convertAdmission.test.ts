import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A fake converter that only finishes when told to, so the test can hold
// conversions open and count how many run at once.
const converter = vi.hoisted(() => ({
  started: 0,
  finish: [] as Array<() => void>,
}));
vi.mock("libreoffice-convert", () => ({
  default: {
    convertWithOptions: (
      _buf: Buffer,
      _ext: string,
      _filter: undefined,
      _options: unknown,
      callback: (err: Error | null, result: Buffer) => void,
    ) => {
      converter.started += 1;
      converter.finish.push(() => callback(null, Buffer.from("%PDF-")));
    },
  },
}));

// A fake LibreOffice process for the file-based conversion: it stays open
// until the test closes it, so the test can count how many are alive at once.
const processes = vi.hoisted(() => ({ alive: 0, peak: 0, close: [] as Array<() => void> }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: () => {
      const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), pid: undefined, kill: () => true });
      processes.alive += 1;
      processes.peak = Math.max(processes.peak, processes.alive);
      processes.close.push(() => {
        processes.alive -= 1;
        child.emit("close", 1);
      });
      return child;
    },
  };
});

let docxToPdf: typeof import("../convert").docxToPdf;
let officeFileToPdf: typeof import("../convert").officeFileToPdf;
let ExtractionBusyError: typeof import("../extraction/limits").ExtractionBusyError;

beforeEach(async () => {
  converter.started = 0;
  converter.finish = [];
  // Any existing executable: the converter itself is the fake above.
  process.env.SOFFICE_BINARY_PATH = process.execPath;
  vi.resetModules();
  processes.alive = 0;
  processes.peak = 0;
  processes.close = [];
  ({ docxToPdf, officeFileToPdf } = await import("../convert.js"));
  ({ ExtractionBusyError } = await import("../extraction/limits.js"));
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.SOFFICE_BINARY_PATH;
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("conversion admission", () => {
  it("runs a few conversions at once, queues some, and refuses the rest instead of starting more", async () => {
    const calls = Array.from({ length: 40 }, () =>
      docxToPdf(Buffer.from("x")).then(
        () => "done",
        (error: Error) => error.message,
      ),
    );
    await tick();

    const running = converter.started;
    expect(running).toBeGreaterThan(0);
    expect(running).toBeLessThan(10);

    // Refused calls have already settled; the running and queued ones have not.
    const settled = await Promise.race([
      Promise.all(calls),
      tick().then(() => null),
    ]);
    expect(settled).toBeNull();
    const refused = (
      await Promise.all(calls.map((call) => Promise.race([call, Promise.resolve("pending")])))
    ).filter((outcome) => outcome !== "pending" && outcome !== "done");
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.length).toBeLessThan(40);
    expect(refused[0]).toMatch(/busy/i);

    // Finishing the running ones lets queued ones start; never more than the limit at once.
    let finished = 0;
    while (converter.finish.length > finished) {
      converter.finish[finished]!();
      finished += 1;
      await tick();
      expect(converter.started - finished).toBeLessThanOrEqual(running);
    }
    await Promise.all(calls);
    expect(converter.started).toBe(40 - refused.length);
  });

  it("refuses with its own busy error, not the generic conversion failure", async () => {
    const calls = Array.from({ length: 40 }, () => docxToPdf(Buffer.from("x")).catch((error: unknown) => error));
    await tick();
    const refusals = (await Promise.all(calls.map((call) => Promise.race([call, Promise.resolve("pending")])))).filter(
      (outcome) => outcome instanceof Error,
    );
    expect(refusals.length).toBeGreaterThan(0);
    for (const refusal of refusals) expect(refusal).toBeInstanceOf(ExtractionBusyError);
  });

  it("refuses a queued conversion that has waited its fixed time without a place", async () => {
    vi.useFakeTimers();
    const running = [docxToPdf(Buffer.from("x")), docxToPdf(Buffer.from("x"))];
    await vi.advanceTimersByTimeAsync(10);
    const waiting = docxToPdf(Buffer.from("x")).then(
      () => "done",
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await waiting).toBeInstanceOf(ExtractionBusyError);
    for (const finish of converter.finish) finish();
    await Promise.all(running);
  });

  it("takes a queued conversion out of the queue when its request is aborted", async () => {
    const running = [docxToPdf(Buffer.from("x")), docxToPdf(Buffer.from("x"))];
    await tick();
    const request = new AbortController();
    const aborted = docxToPdf(Buffer.from("x"), { signal: request.signal }).then(
      () => "done",
      (error: unknown) => error,
    );
    const next = docxToPdf(Buffer.from("x"));
    await tick();
    request.abort();
    expect(await aborted).toBeInstanceOf(Error);

    converter.finish[0]!();
    await tick();
    // The place went to the next in line; the aborted one never started.
    expect(converter.started).toBe(3);
    for (const finish of converter.finish) finish();
    await Promise.all([...running, next]);
    expect(converter.started).toBe(3);
  });

  it("limits the file-based conversion the upload worker uses to the same few at once", async () => {
    const calls = Array.from({ length: 12 }, (_, index) =>
      officeFileToPdf(`/tmp/in-${index}.docx`, `/tmp/mike-convert-admission-${index}`).catch((error: unknown) => error),
    );
    // Wait for the first conversions to start, however busy the machine is.
    for (let waited = 0; waited < 200 && processes.peak === 0; waited++) await tick();
    await tick();
    expect(processes.peak).toBeLessThan(10);
    expect(processes.peak).toBeGreaterThan(0);
    let closed = 0;
    while (closed < processes.close.length || closed < 12) {
      if (processes.close[closed]) processes.close[closed++]!();
      else await tick();
      if (closed >= processes.close.length && (await Promise.race([Promise.all(calls), tick().then(() => null)]))) break;
    }
    await Promise.all(calls);
    expect(processes.peak).toBeLessThanOrEqual(2);
  });
});
