import { describe, expect, it } from "vitest";
import { safeRequestPath } from "./safeRequestPath";

describe("safeRequestPath", () => {
  it("drops the query string", () => {
    // OAuth callbacks carry the authorization code and state here.
    expect(
      safeRequestPath("/oauth/callback?code=abc&state=def"),
    ).toBe("/oauth/callback");
  });

  it("drops a fragment", () => {
    expect(safeRequestPath("/projects/p-1#token=abc")).toBe("/projects/p-1");
  });

  it("masks the download token carried in the path", () => {
    expect(safeRequestPath("/download/abc.def")).toBe("/download/[redacted]");
  });

  it("masks the download token when a query is also present", () => {
    expect(safeRequestPath("/download/abc.def?x=1")).toBe(
      "/download/[redacted]",
    );
  });

  it("keeps ordinary paths intact", () => {
    expect(safeRequestPath("/projects/p-1/versions/v-2")).toBe(
      "/projects/p-1/versions/v-2",
    );
  });

  it("passes an absent URL through", () => {
    expect(safeRequestPath(undefined)).toBeUndefined();
  });
});
