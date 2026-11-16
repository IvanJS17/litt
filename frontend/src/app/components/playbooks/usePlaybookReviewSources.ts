"use client";

// «Revisar esta cita» for a drafted playbook: which of a draft rule's source
// quotes (its origin, or one of its legal references) the automatic citation
// check put in the low band. The server names them by rule id and only while
// the draft is as it was generated (GET /playbooks/:id, `reviewSources`).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDelayedReviewRefs } from "@/app/hooks/useDelayedReviewRefs";
import { getPlaybook, type Playbook } from "@/app/lib/mikeApi";

/** A draft this young may still be waiting for its check results. */
const FRESH_DRAFT_MS = 3 * 60_000;

export function playbookReviewKey(ruleId: string, legalIndex: number | null): string {
  return legalIndex === null ? `${ruleId}:origin` : `${ruleId}:legal:${legalIndex}`;
}

const NONE: ReadonlySet<string> = new Set();

function keysOf(playbook: Pick<Playbook, "reviewSources">): string[] {
  return (playbook.reviewSources ?? []).map((source) =>
    playbookReviewKey(source.ruleId, source.legalIndex),
  );
}

export function usePlaybookReviewSources(
  playbook: Pick<Playbook, "id" | "status" | "updatedAt"> | null,
): ReadonlySet<string> {
  const id = playbook?.id ?? null;
  const isDraft = playbook?.status === "draft";
  const [mountedAt] = useState(() => Date.now());
  const [loaded, setLoaded] = useState<{ id: string; keys: ReadonlySet<string> } | null>(null);

  useEffect(() => {
    if (!id || !isDraft) return;
    let current = true;
    void getPlaybook(id)
      .then((value) => {
        if (current) setLoaded({ id, keys: new Set(keysOf(value)) });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [id, isDraft]);

  const fresh =
    !!id && isDraft && !!playbook && mountedAt - Date.parse(playbook.updatedAt) < FRESH_DRAFT_MS;
  const load = useCallback(async () => {
    if (!id) return {};
    const value = await getPlaybook(id);
    return Object.fromEntries(keysOf(value).map((key) => [key, [1]]));
  }, [id]);
  const later = useDelayedReviewRefs(fresh ? id : null, load);

  return useMemo(() => {
    const keys = new Set([...(loaded && loaded.id === id ? loaded.keys : NONE), ...Object.keys(later)]);
    return isDraft && keys.size > 0 ? keys : NONE;
  }, [loaded, id, later, isDraft]);
}
