// Sequential requests reuse parser imports. No database or application boot.
import { EXTRACTION_OPS, type ExtractionOp } from "./ops";
import type { OcrFill } from "../ocr/pages";
import { EXTRACTION_MAX_BINARY_BYTES, EXTRACTION_MAX_TEXT_BYTES, ExtractionLimitError, isAllocationFailure } from "./limits";
import { extractionFailureToWire } from "./failure";

process.on("message", (request: { op: ExtractionOp; bytes: ArrayBuffer; fileType: string; ocr?: OcrFill; args?: unknown }) => {
  void (async () => {
    try {
      const result = await EXTRACTION_OPS[request.op](request.bytes, request.fileType, request.ocr, request.args as never);
      // Text results are measured as text; a counts object (docxInventory) as its JSON.
      // A binary result (docxCompare) is measured in bytes and has its own cap.
      // Several files (pdfCopyPages) are measured by their total.
      if (result instanceof Uint8Array || (Array.isArray(result) && result.every((item) => item instanceof Uint8Array))) {
        const bytes = result instanceof Uint8Array ? result.byteLength : result.reduce((sum, item) => sum + item.byteLength, 0);
        if (bytes > EXTRACTION_MAX_BINARY_BYTES) throw new ExtractionLimitError("result exceeds 64 MB");
      } else {
        const text = typeof result === "string" ? result : "text" in result ? result.text : JSON.stringify(result);
        // Bound IPC output before it can allocate a large string in the parent.
        if (Buffer.byteLength(text) > EXTRACTION_MAX_TEXT_BYTES) {
          throw new ExtractionLimitError("extracted text exceeds 16 MB");
        }
      }
      process.send?.({ ok: true, result });
    } catch (error) {
      const limited = error instanceof ExtractionLimitError || isAllocationFailure(error);
      // A thrown Error does not survive IPC as itself; send its labels, and
      // whether the parser rejected the bytes, so the parent can rebuild the
      // same kind and code and a job knows whether to retry.
      process.send?.(limited
        ? { ok: false, limited, message: "parser resource budget exceeded" }
        : { ok: false, limited, ...extractionFailureToWire(error) });
    }
  })();
});

process.on("disconnect", () => {
  if (process.platform !== "win32") {
    try { process.kill(-process.pid, "SIGKILL"); } catch { process.exit(1); }
  } else process.exit(1);
});
