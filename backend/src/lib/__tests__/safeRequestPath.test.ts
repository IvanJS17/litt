import { describe, expect, it } from "vitest";
import { safeRequestPath } from "../safeRequestPath";

describe("safeRequestPath", () => {
  it("drops the query and the fragment", () => {
    expect(safeRequestPath("/oauth/callback?code=secret&state=s1#frag")).toBe(
      "/oauth/callback",
    );
  });

  it("masks the credential segment of a download URL", () => {
    expect(safeRequestPath("/download/signed-token-abc")).toBe(
      "/download/[redacted]",
    );
    expect(safeRequestPath("/download/signed-token-abc?expires=1")).toBe(
      "/download/[redacted]",
    );
  });

  it("leaves ordinary paths alone", () => {
    expect(safeRequestPath("/projects/p-1/documents/d-2")).toBe(
      "/projects/p-1/documents/d-2",
    );
    expect(safeRequestPath("/downloads/report.docx")).toBe(
      "/downloads/report.docx",
    );
  });

  it("passes a missing URL through", () => {
    expect(safeRequestPath(undefined)).toBeUndefined();
    expect(safeRequestPath("")).toBe("");
  });
});
