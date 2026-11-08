"use client";

import { useEffect, useState } from "react";
import { getReviewAudit } from "@/app/lib/mikeApi";

/**
 * Whether the caller audits this tabular review as a junior (docs/training.md),
 * so its page offers the audit. Only decides what to show: the server applies
 * the same rule to every audit route. Unknown, or if it cannot be read, the
 * review page looks exactly as it did.
 */
export function useReviewAuditEntry(reviewId: string, enabled = true): boolean {
    const [result, setResult] = useState<{ reviewId: string; applies: boolean } | null>(null);
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        void (async () => {
            try {
                const state = await getReviewAudit(reviewId);
                if (!cancelled) setResult({ reviewId, applies: state.applies });
            } catch {
                if (!cancelled) setResult({ reviewId, applies: false });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [reviewId, enabled]);
    return enabled && result?.reviewId === reviewId && result.applies;
}
