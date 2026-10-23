import { describe, expect, it, vi } from "vitest";

// Exercises the real AWS SDK signer: presigning is offline, so the endpoint a
// browser is sent to can be asserted without any store running.
const INTERNAL_ENDPOINT = "http://storage:9000";
const PUBLIC_ENDPOINT = "https://docs.example.test";

async function loadStorage(endpoint: string, publicEndpoint: string) {
  process.env.R2_ENDPOINT_URL = endpoint;
  process.env.R2_PUBLIC_ENDPOINT_URL = publicEndpoint;
  process.env.R2_ACCESS_KEY_ID = "test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.R2_BUCKET_NAME = "mike";
  vi.resetModules();
  return await import("../storage");
}

describe("signed download URLs", () => {
  it("signs for the public endpoint the browser can reach", async () => {
    const { getSignedUrl } = await loadStorage(
      INTERNAL_ENDPOINT,
      PUBLIC_ENDPOINT,
    );

    const url = await getSignedUrl("documents/u1/d1/source.pdf");

    expect(url).toBeTruthy();
    expect(new URL(url!).origin).toBe(PUBLIC_ENDPOINT);
    expect(url).not.toContain("storage:9000");
  });

  it("keeps downloads and direct uploads on the same origin", async () => {
    const { getSignedUrl, getSignedUploadUrl } = await loadStorage(
      INTERNAL_ENDPOINT,
      PUBLIC_ENDPOINT,
    );

    const download = await getSignedUrl("documents/u1/d1/source.pdf");
    const upload = await getSignedUploadUrl(
      "upload-sessions/u1/s1/f1/staging",
      "application/pdf",
      1_234,
    );

    expect(new URL(download!).origin).toBe(new URL(upload!).origin);
  });

  it("falls back to R2_ENDPOINT_URL when no public endpoint is configured", async () => {
    const { getSignedUrl } = await loadStorage(
      "https://account.r2.cloudflarestorage.com",
      "",
    );

    const url = await getSignedUrl("documents/u1/d1/source.pdf");

    expect(new URL(url!).origin).toBe("https://account.r2.cloudflarestorage.com");
  });

  it("keeps the server-controlled download filename in the signature", async () => {
    const { getSignedUrl } = await loadStorage(
      INTERNAL_ENDPOINT,
      PUBLIC_ENDPOINT,
    );

    const url = await getSignedUrl(
      "documents/u1/d1/source.pdf",
      3600,
      "Demanda laboral v2.pdf",
    );

    expect(new URL(url!).searchParams.get("response-content-disposition")).toBe(
      'attachment; filename="Demanda laboral v2.pdf"; filename*=UTF-8\'\'Demanda%20laboral%20v2.pdf',
    );
  });
});
