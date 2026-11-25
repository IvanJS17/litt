import { describe, expect, it } from "vitest";
import {
  PASSWORD_TOO_LONG_DETAIL,
  PASSWORD_TOO_SHORT_DETAIL,
  describeAuthProviderError,
  describeAuthValidationIssues,
} from "../auth.messages";

const fallback = "Authentication could not be completed.";

describe("describeAuthProviderError", () => {
  it("replaces GoTrue prose with our sentence for a known code", () => {
    expect(
      describeAuthProviderError(
        {
          status: 400,
          code: "weak_password",
          message:
            "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.",
        },
        fallback,
      ),
    ).toEqual({
      status: 400,
      code: "weak_password",
      detail: expect.stringMatching(/too weak/i),
    });
  });

  it("never relays provider text for an unknown 4xx code", () => {
    const wire = describeAuthProviderError(
      { status: 422, code: "some_new_code", message: "pgsql: relation missing" },
      fallback,
    );
    expect(wire).toEqual({ status: 422, code: "some_new_code", detail: fallback });
  });

  it("recognises legacy message-only failures", () => {
    expect(
      describeAuthProviderError(
        { status: 400, message: "Invalid login credentials" },
        fallback,
      ),
    ).toMatchObject({
      code: "invalid_credentials",
      detail: "The email or password is incorrect.",
    });
    expect(
      describeAuthProviderError(
        { status: 422, message: "Password cannot be longer than 72 characters" },
        fallback,
      ),
    ).toMatchObject({ code: "password_too_long", detail: PASSWORD_TOO_LONG_DETAIL });
  });

  it("refines validation_failed into the specific password problem", () => {
    expect(
      describeAuthProviderError(
        {
          status: 422,
          code: "validation_failed",
          message: "Password cannot be longer than 72 characters",
        },
        fallback,
      ),
    ).toMatchObject({ code: "password_too_long", detail: PASSWORD_TOO_LONG_DETAIL });
    expect(
      describeAuthProviderError(
        {
          status: 422,
          code: "validation_failed",
          message: "Password should be at least 6 characters",
        },
        fallback,
      ),
    ).toMatchObject({ code: "password_too_short" });
  });

  it("maps rate limits and expired sessions to actionable text", () => {
    expect(
      describeAuthProviderError(
        { status: 429, code: "over_email_send_rate_limit", message: "x" },
        fallback,
      ).detail,
    ).toMatch(/Wait a few minutes/);
    expect(
      describeAuthProviderError(
        { status: 401, code: "session_expired", message: "x" },
        fallback,
      ).detail,
    ).toMatch(/Sign in again/);
  });

  it.each([undefined, null, {}, { status: 500, message: "boom" }, { status: 302 }])(
    "collapses %o to a 500 with the fallback",
    (error) => {
      expect(describeAuthProviderError(error, fallback)).toEqual({
        status: 500,
        code: null,
        detail: fallback,
      });
    },
  );
});

describe("describeAuthValidationIssues", () => {
  it("names the password length problem", () => {
    expect(
      describeAuthValidationIssues([
        { path: ["password"], code: "too_big" },
      ]),
    ).toEqual({ code: "password_too_long", detail: PASSWORD_TOO_LONG_DETAIL });
    expect(
      describeAuthValidationIssues([
        { path: ["password"], code: "too_small" },
      ]),
    ).toEqual({ code: "password_too_short", detail: PASSWORD_TOO_SHORT_DETAIL });
  });

  it("names a bad email and stays generic otherwise", () => {
    expect(
      describeAuthValidationIssues([{ path: ["email"], code: "invalid_string" }]),
    ).toMatchObject({ code: "email_address_invalid" });
    expect(describeAuthValidationIssues([])).toEqual({
      code: "invalid_request",
      detail: "The authentication request is invalid.",
    });
  });
});

describe("describeAuthProviderError on messages without a code", () => {
  const codeOf = (message: string) => describeAuthProviderError({ status: 400, message }, fallback).code;

  it.each([
    ["Password is too weak", "weak_password"],
    ["password too short", "weak_password"],
    ["The new PASSWORD is TOO Short for this project", "weak_password"],
    ["password too weaker than allowed", "weak_password"],
    ["first line\npassword x\nPassword y too short", "weak_password"],
    ["password a\u2028x password b too weak", "weak_password"],
    ["password  too weak", "weak_password"],
    ["Password should be at least 6 characters", "password_too_short"],
    ["passwordtoo weak", null],
    ["password is too strong", null],
    ["password a\nb too weak", null],
    ["password a\r\ntoo short", null],
    ["password a\u2028too weak", null],
    ["too weak a password ", null],
    ["pass word too weak", null],
    ["password", null],
    ["", null],
  ])("reads %j as %j", (message, code) => {
    expect(codeOf(message)).toBe(code);
  });

  it("reads a very long message in time proportional to its length", () => {
    const elapsed = (repeats: number, tail: string) => {
      const message = `${"password ".repeat(repeats)}${tail}`;
      const started = performance.now();
      const code = codeOf(message);
      return { ms: performance.now() - started, code };
    };
    elapsed(100, "");
    const small = elapsed(6_000, "");
    expect(small.code).toBeNull();
    expect(small.ms, `6000 repeats took ${small.ms.toFixed(0)} ms`).toBeLessThan(1_500);
    const large = elapsed(24_000, "");
    expect(large.ms, `24000 repeats took ${large.ms.toFixed(0)} ms`).toBeLessThan(6_000);
    expect(large.ms / Math.max(small.ms, 50), "ratio").toBeLessThan(10);
    expect(elapsed(24_000, " too short").code).toBe("weak_password");
  }, 120_000);
});
