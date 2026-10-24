import { afterEach, describe, expect, it, vi } from "vitest";
import { bestEffort } from "../bestEffort";

describe("bestEffort", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes a resolved value through", async () => {
    await expect(bestEffort(Promise.resolve("done"), { what: "tail" })).resolves.toBe(
      "done",
    );
  });

  it("swallows a rejection, logs it once, and resolves to undefined", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("rollback failed");

    await expect(
      bestEffort(Promise.reject(error), {
        what: "storage-delete:rollback",
        tags: { component: "storage", storage_operation: "delete" },
        extra: { documentId: "d-1" },
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[best-effort] storage-delete:rollback failed",
      expect.objectContaining({
        component: "storage",
        storage_operation: "delete",
        documentId: "d-1",
        error,
      }),
    );
  });
});
