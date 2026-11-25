import { afterEach, describe, expect, it, vi } from "vitest";
import { childProcessEnv, CHILD_ENV_ALLOWLIST } from "../childEnv";

const FAKE_SECRETS: Record<string, string> = {
  SUPABASE_SECRET_KEY: "fake-supabase-secret-not-real",
  DATABASE_URL: "postgres://fake:fake@localhost/fake",
  R2_SECRET_ACCESS_KEY: "fake-r2-secret-not-real",
  ANTHROPIC_API_KEY: "fake-anthropic-key-not-real",
  USER_API_KEYS_ENCRYPTION_SECRET: "fake-encryption-secret-not-real",
};

afterEach(() => vi.unstubAllEnvs());

describe("childProcessEnv", () => {
  it("returns none of the backend's credentials", () => {
    for (const [name, value] of Object.entries(FAKE_SECRETS)) vi.stubEnv(name, value);
    const env = childProcessEnv();
    for (const name of Object.keys(FAKE_SECRETS)) expect(env).not.toHaveProperty(name);
    expect(JSON.stringify(env)).not.toContain("not-real");
  });

  it("returns the allowlisted variables that are set, and only those", () => {
    vi.stubEnv("PATH", "/fake/bin");
    vi.stubEnv("LANG", "C.UTF-8");
    vi.stubEnv("HOME", "/fake/home");
    vi.stubEnv("SOFFICE_BINARY_PATH", "/fake/soffice");
    vi.stubEnv("NODE_OPTIONS", "--require /fake/hook.js");
    vi.stubEnv("SUPABASE_SECRET_KEY", FAKE_SECRETS.SUPABASE_SECRET_KEY);
    const env = childProcessEnv();
    expect(env).toMatchObject({ PATH: "/fake/bin", LANG: "C.UTF-8", HOME: "/fake/home", SOFFICE_BINARY_PATH: "/fake/soffice" });
    expect(Object.keys(env).every((name) => CHILD_ENV_ALLOWLIST.includes(name))).toBe(true);
    expect(env).not.toHaveProperty("NODE_OPTIONS");
  });

  it("omits allowlisted variables that are not set", () => {
    vi.stubEnv("LIBRE_OFFICE_EXE", undefined as unknown as string);
    delete process.env.LIBRE_OFFICE_EXE;
    expect(childProcessEnv()).not.toHaveProperty("LIBRE_OFFICE_EXE");
  });

  it("adds the caller's explicit extras, which win over the allowlist", () => {
    vi.stubEnv("TMPDIR", "/ambient");
    const env = childProcessEnv({ TMPDIR: "/scratch", MALLOC_ARENA_MAX: "2" });
    expect(env.TMPDIR).toBe("/scratch");
    expect(env.MALLOC_ARENA_MAX).toBe("2");
  });
});
