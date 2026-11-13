/**
 * The Word add-in's session start outside an Office host.
 *
 * Fail-without-fix: `initialize()` removed two legacy keys through the
 * `OfficeRuntime` global. Where Office did not inject it (taskpane.html in a
 * plain browser tab, or a Word host without that storage API) the
 * ReferenceError was thrown before the `.catch(() => {})` existed, rejected
 * the whole sign-in chain, and was logged as a failure in
 * word.session / notify while the pane said "LiTT couldn't sign you in".
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    getSessionState,
    initialize,
    subscribe,
} from "../../../word-addin/src/taskpane/auth/session";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("initialize without the OfficeRuntime global", () => {
    it("asks the backend for the session and reports nothing", async () => {
        expect("OfficeRuntime" in globalThis).toBe(false);
        const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
        const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
        vi.stubGlobal("fetch", fetchMock);
        const settled = new Promise<void>((resolve) => {
            subscribe(() => {
                if (!getSessionState().loading) resolve();
            });
        });

        expect(() => initialize()).not.toThrow();
        await settled;

        expect(errorLog).not.toHaveBeenCalled();
        expect(getSessionState()).toEqual({ user: null, loading: false, error: null });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
