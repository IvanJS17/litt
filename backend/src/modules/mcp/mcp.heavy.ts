// The cap on heavy work started from /mcp (design §9.4): at most 2 heavy jobs
// per person and 4 in the whole process. The VPS has 2 CPU and 3.7 GB, so the
// risk is not the call rate (mcp.limits.ts) but several LLM turns, tabular
// runs, comparisons, conversions, readings and splits running at once.
//
// What counts is work STARTED FROM MCP that has not ended. A tool declares
// `heavy: "sync"` (the work is the call: held until the handler settles) or
// `heavy: "background"` (the work outlives the call: the handler registers a
// `probe` with `call.heavy.hold`, and the slot stays taken until the probe says
// the job is over). The probes read the state that already exists: a chat,
// tabular or review-chat run's `finished` flag, playbook_runs.status, and
// document_version_ocr.status. Nothing new is written to the database.
//
// SINGLE REPLICA: the table of slots is in memory, like the grant budgets in
// mcp.limits.ts and the run registry the chat and tabular probes read. The
// design runs ONE backend replica; with two, each would cap on its own (the
// real ceiling doubles). After a restart the table is empty, so a job the
// queue resumes (playbook, OCR) is not counted until its owner starts another.
// The web UI is NOT capped: its work does not take or wait for these slots.
//
// A refusal happens before the strict audit row and before anything starts,
// so a call that is turned away is recorded as an `error` call (not an
// action) and has left nothing behind.

import { settingInt } from "../../lib/runtimeConfig";

export type HeavyClass = "sync" | "background";

export const HEAVY_JOBS_BUSY = "heavy_jobs_busy";
export const DEFAULT_HEAVY_PER_USER = 2;
export const DEFAULT_HEAVY_GLOBAL = 4;
/** Seconds a client is told to wait; a chat turn or a short run usually ends by then. */
export const HEAVY_RETRY_AFTER_SECONDS = 30;
/** A slot never outlives this, whatever its probe says (the longest run lives 4 h). */
export const HEAVY_MAX_HOLD_MS = 4 * 60 * 60_000;

/** True while the work this slot stands for is still running. */
export type HeavyProbe = () => boolean | Promise<boolean>;

/** What a handler gets to say its work goes on after the call returns. */
export type HeavyHold = { hold: (probe: HeavyProbe) => void };

type Slot = {
    userId: string;
    tool: string;
    since: number;
    /** The handler has not settled yet. */
    inHandler: boolean;
    probes: HeavyProbe[];
};

const slots = new Set<Slot>();

export function heavyLimits(env: NodeJS.ProcessEnv = process.env): { perUser: number; global: number } {
    return {
        perUser: settingInt("LITT_MCP_HEAVY_PER_USER", DEFAULT_HEAVY_PER_USER, env),
        global: settingInt("LITT_MCP_HEAVY_GLOBAL", DEFAULT_HEAVY_GLOBAL, env),
    };
}

async function stillRunning(slot: Slot, now: number): Promise<boolean> {
    if (now - slot.since >= HEAVY_MAX_HOLD_MS) return false;
    if (slot.inHandler) return true;
    for (const probe of slot.probes) {
        try {
            if (await probe()) return true;
        } catch {
            // Cannot tell: assume it still runs (the hold time above ends it).
            return true;
        }
    }
    return false;
}

/** Forget the slots whose work has ended. Only async step of an acquisition. */
async function prune(now: number): Promise<void> {
    await Promise.all(
        [...slots].map(async (slot) => {
            if (!(await stillRunning(slot, now))) slots.delete(slot);
        }),
    );
}

/** A turned-away call: authored text, safe to show, and when to come back. */
export type HeavyRefusal = {
    code: typeof HEAVY_JOBS_BUSY;
    detail: string;
    suggestedAction: string;
    retryAfterSeconds: number;
};

export type HeavyLease = HeavyHold & {
    /** The handler settled (success, error or abort): only background work still holds. */
    release: () => void;
};

/**
 * Takes a slot for `userId`, or answers `heavy_jobs_busy` without taking it.
 * The count and the insert happen with no await between them, so two calls
 * cannot both take the last slot.
 */
export async function acquireHeavySlot(
    userId: string,
    tool: string,
    now = Date.now(),
): Promise<{ lease: HeavyLease } | { refusal: HeavyRefusal }> {
    await prune(now);
    const { perUser, global } = heavyLimits();
    const all = [...slots];
    const mine = all.filter((slot) => slot.userId === userId).length;
    if (mine >= perUser)
        return busy(`You already have ${mine} heavy jobs running through this connection (the limit is ${perUser}).`);
    if (all.length >= global)
        return busy("LiTT is running as many heavy jobs for MCP clients as it can right now.");
    const slot: Slot = { userId, tool, since: now, inHandler: true, probes: [] };
    slots.add(slot);
    const lease: HeavyLease = {
        hold: (probe) => {
            slot.probes.push(probe);
        },
        release: () => {
            slot.inHandler = false;
            // Nothing went on in the background: free the slot now.
            if (slot.probes.length === 0) slots.delete(slot);
        },
    };
    return { lease };
}

function busy(detail: string): { refusal: HeavyRefusal } {
    return {
        refusal: {
            code: HEAVY_JOBS_BUSY,
            detail: `${detail} Nothing was started.`,
            suggestedAction: `Try again in about ${HEAVY_RETRY_AFTER_SECONDS} seconds, or follow the running jobs (get_chat_turn, get_playbook_run, get_tabular_run_status, get_scan_reading_state) and start this one when one ends.`,
            retryAfterSeconds: HEAVY_RETRY_AFTER_SECONDS,
        },
    };
}

/** In flight now (after dropping the ended ones), for diagnostics and tests. */
export async function heavyInFlight(): Promise<{ total: number; byUser: Record<string, number> }> {
    await prune(Date.now());
    const byUser: Record<string, number> = {};
    for (const slot of slots) byUser[slot.userId] = (byUser[slot.userId] ?? 0) + 1;
    return { total: slots.size, byUser };
}

/** Tests only. */
export function resetHeavySlots(): void {
    slots.clear();
}
