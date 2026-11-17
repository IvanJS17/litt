// Per-grant call budgets for /mcp (design §7.3).
//
// Everything Claude (or ChatGPT, or Hermes) sends comes from a few vendor
// addresses, so an IP limit would let one noisy person lock out everyone.
// The budget belongs to the connection (grant) instead. Two lanes: `read`
// (cheap lookups, and the protocol's own requests) and `write` (anything that
// writes, runs an engine, spends or chats). The store is in memory, like the
// rest of the API's limiters: one process, reset on restart.

import { mcpConfig, type McpRateLimits } from "./mcp.config";

export type McpLane = "read" | "write";

export type LimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Bucket = { count: number; resetAt: number };

const MAX_BUCKETS = 10_000;
const buckets = new Map<string, Bucket>();

function sweep(now: number): void {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
    // Still too many live windows: forget the oldest rather than grow without bound.
    while (buckets.size > MAX_BUCKETS) {
        const oldest = buckets.keys().next().value;
        if (oldest === undefined) break;
        buckets.delete(oldest);
    }
}

function budget(lane: McpLane, limits: McpRateLimits): { max: number; windowMs: number } {
    return lane === "read"
        ? { max: limits.readMax, windowMs: limits.readWindowMs }
        : { max: limits.writeMax, windowMs: limits.writeWindowMs };
}

/** Count one call against the grant's lane; says when to come back if it is spent. */
export function takeGrantBudget(
    grantId: string,
    lane: McpLane,
    now = Date.now(),
): LimitDecision {
    const { max, windowMs } = budget(lane, mcpConfig().rateLimits);
    const key = `${grantId}:${lane}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        if (buckets.size >= MAX_BUCKETS) sweep(now);
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
    }
    if (bucket.count >= max)
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    bucket.count += 1;
    return { allowed: true };
}

/** Tests only. */
export function resetGrantBudgets(): void {
    buckets.clear();
}
