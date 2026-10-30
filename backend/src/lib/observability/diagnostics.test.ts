import { describe, expect, it } from "vitest";
import { diagnosticErrorTags } from "./diagnostics";

describe("diagnosticErrorTags", () => {
  it("keeps a known storage operation and its dependency cause", () => {
    const error = {
      name: "StorageOperationError",
      operation: "HEAD",
      key: "private-document",
      cause: { name: "AccessDenied", $metadata: { httpStatusCode: 403 } },
    };
    expect(diagnosticErrorTags(error)).toEqual({
      storage_operation: "HEAD",
      failure_code: "AccessDenied",
      dependency_status: 403,
    });
    expect(diagnosticErrorTags({ operation: "private-document" })).toEqual({});
  });

  it("keeps known status and database codes, drops arbitrary codes and metadata", () => {
    expect(
      diagnosticErrorTags({
        name: "AccessDenied",
        $metadata: { httpStatusCode: 403, requestId: "private" },
      }),
    ).toEqual({ failure_code: "AccessDenied", dependency_status: 403 });
    expect(
      diagnosticErrorTags({ code: "42P01", message: "private table" }),
    ).toEqual({ failure_code: "42P01" });
    expect(
      diagnosticErrorTags({
        code: "private client",
        name: "private client",
        status: "private",
      }),
    ).toEqual({});
  });

  it("walks the cause chain and survives cycles, huge aggregates and throwing accessors", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(diagnosticErrorTags(cyclic)).toEqual({});
    expect(
      diagnosticErrorTags({
        get code() {
          throw new Error("private");
        },
      }),
    ).toEqual({});
    expect(diagnosticErrorTags({ errors: Array(1000).fill(cyclic) })).toEqual(
      {},
    );
    expect(
      diagnosticErrorTags(new Error("failed", { cause: { code: "ECONNREFUSED" } })),
    ).toEqual({ failure_code: "ECONNREFUSED" });
  });

  it("classifies provider failures and their retry status", () => {
    const api = {
      name: "AI_APICallError",
      statusCode: 401,
      responseBody: "PRIVATE_PROVIDER_RESPONSE",
    };
    const retry = { name: "AI_RetryError", lastError: api };
    const wrapped = {
      name: "AssistantStreamError",
      cause: { name: "InvalidApiKeyError", cause: retry },
    };
    expect(diagnosticErrorTags(wrapped)).toEqual({
      provider_error: "invalid_api_key",
      dependency_status: 401,
    });
    expect(diagnosticErrorTags(retry)).toEqual({
      provider_error: "retry_exhausted",
      dependency_status: 401,
    });
    expect(diagnosticErrorTags(api)).toEqual({
      provider_error: "api_call",
      dependency_status: 401,
    });
    const cyclic: { lastError?: unknown } = {};
    cyclic.lastError = cyclic;
    expect(diagnosticErrorTags(cyclic)).toEqual({});
  });

  it("allowlists configuration field names", () => {
    expect(
      diagnosticErrorTags({
        configurationFields: ["SUPABASE_URL", "private-value", "SUPABASE_URL"],
      }),
    ).toEqual({ configuration_fields: "SUPABASE_URL" });
  });

  it("recognises only the whole fixed fetch-failure messages", () => {
    expect(diagnosticErrorTags(new TypeError("Failed to fetch"))).toEqual({
      failure_code: "fetch_failed",
    });
    expect(
      diagnosticErrorTags(new TypeError("Failed to fetch private document")),
    ).toEqual({});
  });
});
