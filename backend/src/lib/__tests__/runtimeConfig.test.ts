import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { diagnosticErrorTags } from "../observability/diagnostics";
import {
  extractionLauncherWarnings,
  scanReadingStoreLimits,
  uploadConversionTimeoutMs,
  uploadJobWallClockMs,
  uploadProcessingConfiguration,
  storagePublicEndpointWarnings,
  uploadSessionRateLimitConfiguration,
  validateRuntimeConfiguration,
} from "../runtimeConfig";

const validProduction = {
  NODE_ENV: "production",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  SUPABASE_SECRET_KEY: "service-role-key",
  FRONTEND_URL: "https://app.example.test",
  API_PUBLIC_URL: "https://app.example.test/api",
  GIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  DOWNLOAD_SIGNING_SECRET: "d".repeat(64),
  USER_API_KEYS_ENCRYPTION_SECRET: "u".repeat(64),
} as NodeJS.ProcessEnv;

// Shaped like the keys that `supabase start` and the local compose file ship:
// a JWT whose issuer is "supabase-demo", signed with a published secret. The
// value here is synthetic; only the payload matters to the check.
function jwtIssuedBy(issuer: string): string {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ iss: issuer, role: "anon" })}.synthetic-signature`;
}
const SUPABASE_DEMO_KEY = jwtIssuedBy("supabase-demo");

describe("runtime authentication configuration", () => {
  it("accepts a complete production configuration", () => {
    expect(() => validateRuntimeConfiguration(validProduction)).not.toThrow();
  });

  it("rejects insecure production callback configuration", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        FRONTEND_URL: "http://app.example.test",
        API_PUBLIC_URL: "http://app.example.test/api",
      }),
    ).toThrow(/FRONTEND_URL must use https in production/);
  });

  // MIKE-BACKEND-2: the backend image defaults NODE_ENV=production, so a bare
  // `docker run` with no public URLs dies here. The message must name the
  // variables AND the switch a local run actually needs.
  it("tells a local run of the production image how to proceed", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        FRONTEND_URL: undefined,
        API_PUBLIC_URL: undefined,
      }),
    ).toThrow(
      /FRONTEND_URL is required in production\n- API_PUBLIC_URL is required in production\n\n.*set NODE_ENV=development/s,
    );
  });

  it("does not suggest NODE_ENV when only non-production settings are wrong", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        SUPABASE_SECRET_KEY: undefined,
      }),
    ).toThrow(/^(?![\s\S]*NODE_ENV)[\s\S]*SUPABASE_SECRET_KEY is required$/);
  });

  it("does not weaken the https rule for production URLs", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        FRONTEND_URL: "http://localhost:3000",
        API_PUBLIC_URL: "http://localhost:3000/api",
      }),
    ).toThrow(/FRONTEND_URL must use https in production/);
  });

  it("refuses to run a production build without its full commit SHA", () => {
    for (const GIT_SHA of [undefined, "", "0123456"]) {
      expect(() =>
        validateRuntimeConfiguration({ ...validProduction, GIT_SHA }),
      ).toThrow(/GIT_SHA \(the full commit SHA of the build\) is required/);
    }
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        NODE_ENV: "development",
        GIT_SHA: undefined,
      }),
    ).not.toThrow();
  });

  it("accepts local http URLs outside production", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        NODE_ENV: "development",
        FRONTEND_URL: "http://localhost:3000",
        API_PUBLIC_URL: "http://localhost:3000/api",
      }),
    ).not.toThrow();
  });

  it("requires a handoff encryption secret when Word auth is enabled", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        WORD_ADDIN_URL: "https://word.example.test",
      }),
    ).toThrow(/AUTH_HANDOFF_ENCRYPTION_SECRET/);
  });

  it("rejects the .env.example placeholder download and key-encryption secrets", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        DOWNLOAD_SIGNING_SECRET: "replace-with-a-random-32-byte-hex-string",
        USER_API_KEYS_ENCRYPTION_SECRET: "your-long-random-secret",
      }),
    ).toThrow(/DOWNLOAD_SIGNING_SECRET[\s\S]*USER_API_KEYS_ENCRYPTION_SECRET/s);
  });

  it("rejects real secrets that are too short to be meaningful", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        DOWNLOAD_SIGNING_SECRET: "too-short",
        USER_API_KEYS_ENCRYPTION_SECRET: "also-short",
      }),
    ).toThrow(/DOWNLOAD_SIGNING_SECRET[\s\S]*USER_API_KEYS_ENCRYPTION_SECRET/s);
  });

  describe.each([
    "DOWNLOAD_SIGNING_SECRET",
    "USER_API_KEYS_ENCRYPTION_SECRET",
  ])("%s", (name) => {
    it.each([" ", "\t\r\n", " ".repeat(32)])(
      "rejects a whitespace-only value %j",
      (value) => {
        expect(() =>
          validateRuntimeConfiguration({ ...validProduction, [name]: value }),
        ).toThrow(`${name} must contain at least 32 characters`);
      },
    );

    // Unset, the consumer fails closed on first use (no fallback key, no
    // plaintext), so a hosted deployment would boot and then break downloads
    // or stored credentials. Production refuses that at boot instead.
    it.each([undefined, ""])("is required in production (%j)", (value) => {
      expect(() =>
        validateRuntimeConfiguration({ ...validProduction, [name]: value }),
      ).toThrow(`${name} is required in production`);
    });

    it.each([undefined, ""])("may be absent outside production (%j)", (value) => {
      expect(() =>
        validateRuntimeConfiguration({
          ...validProduction,
          NODE_ENV: "development",
          [name]: value,
        }),
      ).not.toThrow();
    });

    it("accepts a value at the minimum length", () => {
      expect(() =>
        validateRuntimeConfiguration({
          ...validProduction,
          [name]: "a".repeat(32),
        }),
      ).not.toThrow();
    });
  });

  it.each([
    ["SUPABASE_SECRET_KEY", { SUPABASE_SECRET_KEY: SUPABASE_DEMO_KEY }],
    ["SUPABASE_PUBLISHABLE_KEY", { SUPABASE_PUBLISHABLE_KEY: SUPABASE_DEMO_KEY }],
    [
      "SUPABASE_ANON_KEY",
      { SUPABASE_PUBLISHABLE_KEY: undefined, SUPABASE_ANON_KEY: SUPABASE_DEMO_KEY },
    ],
  ])("rejects the published Supabase demo key in %s in production", (name, keys) => {
    let message = "";
    try {
      validateRuntimeConfiguration({ ...validProduction, ...keys });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(`${name} is a published Supabase demo key`);
    // Name the variable, never echo the credential.
    expect(message).not.toContain(SUPABASE_DEMO_KEY);
    expect(message).not.toContain("eyJ");
  });

  it("accepts keys with another issuer or that are not JWTs in production", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        SUPABASE_SECRET_KEY: jwtIssuedBy("supabase"),
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_not-a-jwt",
      }),
    ).not.toThrow();
  });

  // The local stack (NODE_ENV=development, the bundled Supabase's demo keys,
  // the two app secrets optional) must keep booting.
  it("still boots a local development configuration with the demo keys", () => {
    expect(() =>
      validateRuntimeConfiguration({
        NODE_ENV: "development",
        FRONTEND_URL: "http://localhost:3000",
        API_PUBLIC_URL: "http://localhost:3000/api",
        SUPABASE_URL: "http://gateway:8000",
        SUPABASE_PUBLISHABLE_KEY: SUPABASE_DEMO_KEY,
        SUPABASE_SECRET_KEY: SUPABASE_DEMO_KEY,
      }),
    ).not.toThrow();
  });

  it("accepts the legacy anon key name for the user-session client", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        SUPABASE_PUBLISHABLE_KEY: undefined,
        SUPABASE_ANON_KEY: "legacy-anon-key",
      }),
    ).not.toThrow();
  });
});

describe("LLM_PROVIDER_DATA_RETENTION", () => {
  it.each(["deny", "allow", "ALLOW", ""])("accepts %j", (value) => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        LLM_PROVIDER_DATA_RETENTION: value,
      }),
    ).not.toThrow();
  });

  it("rejects a value that is neither deny nor allow", () => {
    expect(() =>
      validateRuntimeConfiguration({
        ...validProduction,
        LLM_PROVIDER_DATA_RETENTION: "off",
      }),
    ).toThrow(/LLM_PROVIDER_DATA_RETENTION must be "deny" \(the default\) or "allow"/);
  });
});

describe("upload-session rate-limit configuration", () => {
  it("uses safe defaults when overrides are absent or invalid", () => {
    expect(
      uploadSessionRateLimitConfiguration({
        RATE_LIMIT_UPLOAD_SESSION_MUTATION_MAX: "0",
        RATE_LIMIT_UPLOAD_SESSION_POLL_MAX: "not-a-number",
      }),
    ).toEqual({
      mutationWindowMinutes: 15,
      mutationMax: 300,
      pollingWindowMinutes: 15,
      pollingMax: 3_000,
      sessionCreationMaxPerHour: 50,
    });
  });

  it("accepts positive environment overrides", () => {
    expect(
      uploadSessionRateLimitConfiguration({
        RATE_LIMIT_UPLOAD_SESSION_MUTATION_WINDOW_MINUTES: "10",
        RATE_LIMIT_UPLOAD_SESSION_MUTATION_MAX: "900",
        RATE_LIMIT_UPLOAD_SESSION_POLL_WINDOW_MINUTES: "20",
        RATE_LIMIT_UPLOAD_SESSION_POLL_MAX: "6000",
        RATE_LIMIT_UPLOAD_SESSION_CREATE_MAX_PER_HOUR: "250",
      }),
    ).toEqual({
      mutationWindowMinutes: 10,
      mutationMax: 900,
      pollingWindowMinutes: 20,
      pollingMax: 6_000,
      sessionCreationMaxPerHour: 250,
    });
  });

  it("clamps an hourly creation limit the database cannot represent", () => {
    expect(
      uploadSessionRateLimitConfiguration({
        RATE_LIMIT_UPLOAD_SESSION_CREATE_MAX_PER_HOUR: "9999999999",
      }).sessionCreationMaxPerHour,
    ).toBe(1_000_000);
  });
});

describe("upload-processing configuration", () => {
  it("uses an eight-job pool with at most two active jobs per user by default", () => {
    expect(uploadProcessingConfiguration({})).toEqual({
      concurrency: 8,
      maxRunningPerUser: 2,
    });
  });

  it("accepts positive overrides and keeps the per-user cap within the pool", () => {
    expect(
      uploadProcessingConfiguration({
        UPLOAD_PROCESSING_CONCURRENCY: "8",
        UPLOAD_PROCESSING_MAX_RUNNING_PER_USER: "20",
      }),
    ).toEqual({
      concurrency: 8,
      maxRunningPerUser: 8,
    });
  });

  it("bounds accidental oversized pools", () => {
    expect(
      uploadProcessingConfiguration({
        UPLOAD_PROCESSING_CONCURRENCY: "1000",
      }),
    ).toEqual({
      concurrency: 64,
      maxRunningPerUser: 2,
    });
  });
});

describe("upload worker deadlines", () => {
  it("uses two-minute conversions and a fifteen-minute job budget by default", () => {
    expect(uploadConversionTimeoutMs({})).toBe(120_000);
    expect(uploadJobWallClockMs({})).toBe(900_000);
  });

  it("accepts overrides inside the supported range", () => {
    expect(
      uploadConversionTimeoutMs({ UPLOAD_CONVERT_TIMEOUT_MS: "45000" }),
    ).toBe(45_000);
    expect(uploadJobWallClockMs({ UPLOAD_JOB_WALL_CLOCK_MS: "300000" })).toBe(
      300_000,
    );
  });

  it("clamps overrides that would disable or never reach the deadline", () => {
    expect(uploadConversionTimeoutMs({ UPLOAD_CONVERT_TIMEOUT_MS: "1" })).toBe(
      10_000,
    );
    expect(
      uploadConversionTimeoutMs({ UPLOAD_CONVERT_TIMEOUT_MS: "9999999" }),
    ).toBe(600_000);
    expect(uploadJobWallClockMs({ UPLOAD_JOB_WALL_CLOCK_MS: "1" })).toBe(
      60_000,
    );
    expect(
      uploadJobWallClockMs({ UPLOAD_JOB_WALL_CLOCK_MS: "9999999999" }),
    ).toBe(3_600_000);
  });

  it("falls back to the defaults for unparseable values", () => {
    expect(
      uploadConversionTimeoutMs({ UPLOAD_CONVERT_TIMEOUT_MS: "soon" }),
    ).toBe(120_000);
    expect(uploadJobWallClockMs({ UPLOAD_JOB_WALL_CLOCK_MS: "-5" })).toBe(
      900_000,
    );
  });
});

it("identifies invalid configuration fields without keeping their values", () => {
  let failure: unknown;
  try {
    validateRuntimeConfiguration({
      NODE_ENV: "production",
      SUPABASE_URL: "PRIVATE_URL",
      SUPABASE_SECRET_KEY: "PRIVATE_KEY",
    });
  } catch (error) {
    failure = error;
  }
  const tags = diagnosticErrorTags(failure);
  expect(tags).toEqual({
    failure_code: "configuration_invalid",
    configuration_fields:
      "API_PUBLIC_URL,DOWNLOAD_SIGNING_SECRET,FRONTEND_URL,GIT_SHA,SUPABASE_PUBLISHABLE_KEY,SUPABASE_URL,USER_API_KEYS_ENCRYPTION_SECRET",
  });
  expect(JSON.stringify(tags)).not.toContain("PRIVATE");
});

// MIKE-FRONTEND-28/3D/2Z: the compose default R2_PUBLIC_ENDPOINT_URL
// (http://localhost:9000) on an install opened from a real host made every
// browser upload fail with "Failed to fetch" and nothing at boot said why.
describe("storagePublicEndpointWarnings", () => {
  const at = (frontend: string, publicEndpoint: string, internal = "http://storage:9000") =>
    storagePublicEndpointWarnings({
      FRONTEND_URL: frontend,
      R2_PUBLIC_ENDPOINT_URL: publicEndpoint,
      R2_ENDPOINT_URL: internal,
    } as NodeJS.ProcessEnv);

  it.each([
    ["https://mike.firm.example", "http://localhost:9000", /loopback/],
    ["http://192.168.1.20:3000", "http://127.0.0.1:9000", /loopback/],
    ["https://mike.firm.example", "", /internal service name/],
    ["https://mike.firm.example", "http://storage.firm.example:9000", /mixed content/],
  ])("warns for FRONTEND_URL %s with public storage %s", (frontend, endpoint, reason) => {
    const warnings = at(frontend, endpoint);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(reason);
  });

  it.each([
    ["http://localhost:3000", "http://localhost:9000"],
    ["https://mike.firm.example", "https://storage.firm.example"],
    ["https://mike.firm.example", "https://mike.firm.example"],
  ])("is quiet for FRONTEND_URL %s with public storage %s", (frontend, endpoint) => {
    expect(at(frontend, endpoint)).toEqual([]);
  });
});

// MIKE-BACKEND-EC/EE: an image without util-linux booted cleanly, then every
// text extraction and DOCX upload failed with a bare spawn ENOENT.
describe("extractionLauncherWarnings", () => {
  const empty = mkdtempSync(path.join(tmpdir(), "mike-path-empty-"));
  const withLauncher = mkdtempSync(path.join(tmpdir(), "mike-path-prlimit-"));
  writeFileSync(path.join(withLauncher, "prlimit"), "#!/bin/sh\n");
  chmodSync(path.join(withLauncher, "prlimit"), 0o755);
  afterAll(() => {
    rmSync(empty, { recursive: true, force: true });
    rmSync(withLauncher, { recursive: true, force: true });
  });
  const env = (PATH: string, isolation = "on") =>
    ({ PATH, EXTRACTION_ISOLATION: isolation }) as NodeJS.ProcessEnv;

  it("warns once on Linux when prlimit is not on PATH", () => {
    const warnings = extractionLauncherWarnings(env(empty), "linux");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/prlimit.*util-linux/s);
  });

  it("is quiet when an executable prlimit is on PATH", () => {
    expect(extractionLauncherWarnings(env(`${empty}${path.delimiter}${withLauncher}`), "linux")).toEqual([]);
  });

  it("is quiet off Linux, where the parser is not launched through prlimit", () => {
    expect(extractionLauncherWarnings(env(empty), "darwin")).toEqual([]);
  });

  it("is quiet when parser isolation is off", () => {
    expect(extractionLauncherWarnings(env(empty, "off"), "linux")).toEqual([]);
  });
});

describe("what a scan reading may store", () => {
  const defaults = { pageBytes: 200_000, readingBytes: 10_000_000, readingPages: 20_000 };
  const set = (page: string, reading: string, pages: string) =>
    ({ OCR_PAGE_MAX_BYTES: page, OCR_READING_MAX_BYTES: reading, OCR_READING_MAX_PAGES: pages }) as NodeJS.ProcessEnv;
  it("is 200,000 bytes a page, 10,000,000 a reading and 20,000 pages unless an operator sets whole numbers in range", () => {
    expect(scanReadingStoreLimits({})).toEqual(defaults);
    expect(scanReadingStoreLimits(set("50000", "3000000", "5000"))).toEqual({ pageBytes: 50_000, readingBytes: 3_000_000, readingPages: 5_000 });
    for (const bad of ["", "0", "-5", "12abc", "1.5", "1e6", "abc", " 7 ", "99999999999999999999"])
      expect(scanReadingStoreLimits(set(bad, bad, bad)), bad).toEqual(defaults);
  });
  it("accepts a value only inside its range, ends included, and otherwise uses the default", () => {
    expect(scanReadingStoreLimits(set("1000", "100000", "1"))).toEqual({ pageBytes: 1_000, readingBytes: 100_000, readingPages: 1 });
    expect(scanReadingStoreLimits(set("2000000", "32000000", "100000"))).toEqual({ pageBytes: 2_000_000, readingBytes: 32_000_000, readingPages: 100_000 });
    expect(scanReadingStoreLimits(set("999", "99999", "0"))).toEqual(defaults);
    expect(scanReadingStoreLimits(set("2000001", "32000001", "100001"))).toEqual(defaults);
    expect(scanReadingStoreLimits(set("9000000000", "1000000000", "1000000"))).toEqual(defaults);
  });
});
