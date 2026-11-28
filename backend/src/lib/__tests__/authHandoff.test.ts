import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../appError";

const reportError = vi.hoisted(() => vi.fn((..._args: unknown[]) => "event-1"));
vi.mock("../observability/report", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reportError,
}));
import { consumeAuthHandoff, issueAuthHandoff } from "../authHandoff";

describe("Word OAuth handoff tickets", () => {
  beforeEach(() => {
    process.env.AUTH_HANDOFF_ENCRYPTION_SECRET = "x".repeat(48);
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("still issues the ticket when expired-ticket cleanup fails, reporting that as a warning", async () => {
    const cleanupError = { code: "57014", message: "statement timeout" };
    const database = {
      from: () => ({
        delete: () => ({ lt: async () => ({ error: cleanupError }) }),
        insert: async () => ({ error: null }),
      }),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const ticket = await issueAuthHandoff({
      userId: "user-1",
      requestId: "request-id-123456",
      origin: "https://word.example.test",
      session: { access_token: "a", refresh_token: "r" } as never,
      db: database as never,
    });

    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(reportError).toHaveBeenCalledOnce();
    const [failure, context] = reportError.mock.calls[0] as unknown as [
      AppError,
      { level?: string },
    ];
    expect(failure).toBeInstanceOf(AppError);
    expect(failure.kind).toBe("auth.handoff_failed");
    expect(failure.cause).toBe(cleanupError);
    expect(context.level).toBe("warning");
    // The log keeps only the code: no message, no ticket material.
    expect(warn).toHaveBeenCalledWith(
      "[auth/handoff] expired-ticket cleanup failed",
      { code: "57014" },
    );
  });

  it("stores encrypted session data and consumes a ticket only once", async () => {
    let stored: Record<string, unknown> | null = null;
    let consumed = false;
    const database = {
      from: () => ({
        delete: () => ({
          lt: async () => ({ error: null }),
        }),
        insert: async (row: Record<string, unknown>) => {
          stored = row;
          return { error: null };
        },
        update: () => {
          const chain = {
            eq: () => chain,
            is: () => chain,
            gt: () => chain,
            select: () => chain,
            maybeSingle: async () => {
              if (consumed || !stored) return { data: null, error: null };
              consumed = true;
              return { data: stored, error: null };
            },
          };
          return chain;
        },
      }),
    };
    const session = {
      access_token: "raw-access-token",
      refresh_token: "raw-refresh-token",
    };

    const ticket = await issueAuthHandoff({
      userId: "user-1",
      requestId: "request-id-123456",
      origin: "https://word.example.test",
      session: session as never,
      db: database as never,
    });

    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain(session.access_token);
    expect(JSON.stringify(stored)).not.toContain(session.refresh_token);
    expect((stored as Record<string, unknown> | null)?.ticket_hash).not.toBe(
      ticket,
    );

    await expect(
      consumeAuthHandoff({
        ticket,
        requestId: "request-id-123456",
        origin: "https://word.example.test",
        db: database as never,
      }),
    ).resolves.toEqual({
      userId: "user-1",
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
    });

    await expect(
      consumeAuthHandoff({
        ticket,
        requestId: "request-id-123456",
        origin: "https://word.example.test",
        db: database as never,
      }),
    ).resolves.toBeNull();
  });
});

describe("how long a handoff ticket lives", () => {
  const lifetime = async (value: string | undefined) => {
    if (value === undefined) delete process.env.AUTH_HANDOFF_TTL_SECONDS;
    else process.env.AUTH_HANDOFF_TTL_SECONDS = value;
    process.env.AUTH_HANDOFF_ENCRYPTION_SECRET = "x".repeat(48);
    let expiresAt = "";
    const database = {
      from: () => ({
        delete: () => ({ lt: async () => ({ error: null }) }),
        insert: async (row: { expires_at: string }) => {
          expiresAt = row.expires_at;
          return { error: null };
        },
      }),
    };
    const before = Date.now();
    await issueAuthHandoff({
      userId: "user-1",
      requestId: "request-id-123456",
      origin: "https://word.example.test",
      session: { access_token: "a", refresh_token: "r" } as never,
      db: database as never,
    });
    return Math.round((Date.parse(expiresAt) - before) / 1000);
  };
  afterEach(() => {
    delete process.env.AUTH_HANDOFF_TTL_SECONDS;
    vi.restoreAllMocks();
  });

  it("is the default when the setting is unset or not a plain whole number", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const value of [undefined, "", "90abc", "1e2", "2.5", "-5", "+90", "090", "1,000", "9".repeat(16)])
      expect(await lifetime(value), String(value)).toBe(120);
  });

  it("takes a plain number and keeps it between 30 and 300 seconds", async () => {
    expect(await lifetime("90")).toBe(90);
    expect(await lifetime(" 90 ")).toBe(90);
    expect(await lifetime("5")).toBe(30);
    expect(await lifetime("0")).toBe(30);
    expect(await lifetime("900")).toBe(300);
    expect(await lifetime("9".repeat(15))).toBe(300);
  });
});
