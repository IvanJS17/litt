import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeHttpServer,
  createShutdown,
  failBoot,
  listenOrFail,
  type LifecycleEffects,
} from "../processLifecycle";

function fakeEffects() {
  return {
    logError: vi.fn<LifecycleEffects["logError"]>(),
    logInfo: vi.fn<LifecycleEffects["logInfo"]>(),
    exit: vi.fn<LifecycleEffects["exit"]>(),
  } satisfies LifecycleEffects;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("failBoot (MIKE-BACKEND-2 / -3)", () => {
  it("logs the failure with its boot stage before exiting", async () => {
    const effects = fakeEffects();
    const failure = new Error("bad key");
    await failBoot(failure, "manifest-key", effects);
    expect(effects.logError).toHaveBeenCalledWith(
      "Mike backend failed to start:",
      { stage: "manifest-key", err: failure },
    );
    expect(effects.exit).toHaveBeenCalledWith(1);
  });

  // MIKE-BACKEND-N: 54 boot failures from a restart loop, none of which said
  // WHICH step was wrong. The log line names the stage and carries the error.
  it("names the configuration stage that failed", async () => {
    const effects = fakeEffects();
    const failure = Object.assign(
      new Error("Backend authentication configuration is invalid"),
      { code: "configuration_invalid" },
    );
    await failBoot(failure, "runtime-config", effects);

    const [, logged] = effects.logError.mock.calls[0] as [
      string,
      { stage: string; err: Error },
    ];
    expect(logged.stage).toBe("runtime-config");
    expect(logged.err).toBe(failure);
    expect(effects.exit).toHaveBeenCalledWith(1);
  });
});

describe("listenOrFail (MIKE-BACKEND-7 root cause)", () => {
  it("fails the boot instead of reporting 'running' when the port is taken", async () => {
    const holder = http.createServer();
    await new Promise<void>((resolve) => holder.listen(0, resolve));
    const port = (holder.address() as AddressInfo).port;
    const effects = fakeEffects();
    const onListening = vi.fn();
    try {
      const server = listenOrFail(express(), port, onListening, effects);
      await vi.waitFor(() => expect(effects.exit).toHaveBeenCalledWith(1));
      expect(onListening).not.toHaveBeenCalled();
      expect(effects.logError).toHaveBeenCalledWith(
        "Mike backend failed to start:",
        {
          stage: "listen",
          err: expect.objectContaining({ code: "EADDRINUSE" }),
        },
      );
      expect(server.listening).toBe(false);
    } finally {
      await new Promise((resolve) => holder.close(resolve));
    }
  });

  it("calls back once the port is bound", async () => {
    const effects = fakeEffects();
    const onListening = vi.fn();
    const server = listenOrFail(express(), 0, onListening, effects);
    await vi.waitFor(() => expect(onListening).toHaveBeenCalledOnce());
    expect(effects.exit).not.toHaveBeenCalled();
    await new Promise((resolve) => server.close(resolve));
  });

  it("binds only to the requested host", async () => {
    const effects = fakeEffects();
    const onListening = vi.fn();
    const server = listenOrFail(express(), 0, onListening, effects, "127.0.0.1");
    try {
      await vi.waitFor(() => expect(onListening).toHaveBeenCalledOnce());
      expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
      expect(effects.exit).not.toHaveBeenCalled();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("graceful shutdown (MIKE-BACKEND-7)", () => {
  it("treats a server that never bound its port as already closed", async () => {
    const neverListened = http.createServer();
    await expect(closeHttpServer(neverListened)).resolves.toBeUndefined();

    const effects = fakeEffects();
    const shutdown = createShutdown({
      closeServer: () => closeHttpServer(neverListened),
      stopBackgroundWork: async () => {},
      effects,
    });
    await shutdown("SIGTERM");
    expect(effects.logError).not.toHaveBeenCalled();
    expect(effects.exit).toHaveBeenCalledWith(0);
  });

  it("still rejects a genuine close failure", async () => {
    const broken = {
      close: (callback?: (err?: Error) => void) => {
        callback?.(Object.assign(new Error("boom"), { code: "EIO" }));
        return broken;
      },
    } as unknown as http.Server;
    await expect(closeHttpServer(broken)).rejects.toThrow("boom");
  });

  it("runs once when a second signal arrives mid-shutdown", async () => {
    const effects = fakeEffects();
    let release!: () => void;
    const stopBackgroundWork = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const onStart = vi.fn();
    const shutdown = createShutdown({
      closeServer: async () => {},
      stopBackgroundWork,
      onStart,
      effects,
    });
    const first = shutdown("SIGINT");
    await vi.waitFor(() => expect(stopBackgroundWork).toHaveBeenCalled());
    await shutdown("SIGTERM");
    release();
    await first;
    expect(onStart).toHaveBeenCalledOnce();
    expect(stopBackgroundWork).toHaveBeenCalledOnce();
    expect(effects.exit).toHaveBeenCalledOnce();
    expect(effects.exit).toHaveBeenCalledWith(0);
  });

  it("logs a genuine failure with the stage that failed", async () => {
    const effects = fakeEffects();
    const failure = new Error("worker would not stop");
    const shutdown = createShutdown({
      closeServer: async () => {},
      stopBackgroundWork: async () => {
        throw failure;
      },
      effects,
    });
    await shutdown("SIGTERM");
    expect(effects.logError).toHaveBeenCalledWith(
      "Error during graceful shutdown",
      { stage: "shutdown-workers", err: failure },
    );
    expect(effects.exit).toHaveBeenCalledWith(1);
  });
});
