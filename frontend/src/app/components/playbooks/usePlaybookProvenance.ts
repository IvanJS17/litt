"use client";

// LiTT playbooks with a starting point, layer 1: what a drafted rule's origin
// needs to show besides the rule itself. The name of the attached document a
// rule quotes (any reader can list the playbook's documents) and, for an
// editor, the answer a rule rests on (GET /playbooks/:id only gives answers to
// editors). Neither is read for a playbook without drafted rules.

import { useEffect, useState } from "react";
import {
  getPlaybook,
  listPlaybookSources,
  type Playbook,
  type PlaybookContent,
  type PlaybookRule,
} from "@/app/lib/mikeApi";

export type PlaybookProvenance = {
  /** Answers by question id; empty for a viewer or a playbook not drafted. */
  answers: Record<string, string>;
  /** Reference document names by id. */
  sourceNames: Record<string, string>;
};

export const NO_PROVENANCE: PlaybookProvenance = { answers: {}, sourceNames: {} };

/** Every rule of the playbook, outside topics and inside them. */
export function allPlaybookRules(content: PlaybookContent): PlaybookRule[] {
  return [
    ...(content.rules ?? []),
    ...content.topics.flatMap((topic) => topic.rules),
  ];
}

/** What marking a draft ready confirms: rules without backing, unverified references. */
export function provenanceCounts(content: PlaybookContent) {
  const rules = allPlaybookRules(content);
  return {
    unbacked: rules.filter((rule) => rule.origin?.unbacked).length,
    unverified: rules.reduce(
      (count, rule) =>
        count + (rule.legalRefs ?? []).filter((ref) => !ref.verified).length,
      0,
    ),
  };
}

function needs(content: PlaybookContent) {
  const rules = allPlaybookRules(content);
  return {
    answers: rules.some((rule) => rule.origin?.kind === "answer"),
    sources: rules.some(
      (rule) =>
        !!rule.origin?.sourceId ||
        (rule.legalRefs ?? []).some((ref) => !!ref.sourceId),
    ),
  };
}

/**
 * The provenance of the open playbook. A read that fails leaves the origin
 * line without the name or the answer: it never hides the origin itself.
 */
export function usePlaybookProvenance(
  playbook: Pick<Playbook, "id" | "canEdit" | "content"> | null,
): PlaybookProvenance {
  const [state, setState] = useState<{ id: string; value: PlaybookProvenance } | null>(null);
  const id = playbook?.id ?? null;
  const wanted = playbook ? needs(playbook.content) : null;
  const wantAnswers = !!wanted?.answers && !!playbook?.canEdit;
  const wantSources = !!wanted?.sources;
  useEffect(() => {
    if (!id || (!wantAnswers && !wantSources)) return;
    let current = true;
    void Promise.all([
      wantAnswers
        ? getPlaybook(id).then(
            (loaded) => loaded.intake?.answers ?? {},
            () => ({}),
          )
        : Promise.resolve({}),
      wantSources
        ? listPlaybookSources(id).then(
            (sources) =>
              Object.fromEntries(sources.map((source) => [source.id, source.filename])),
            () => ({}),
          )
        : Promise.resolve({}),
    ]).then(([answers, sourceNames]) => {
      if (current) setState({ id, value: { answers, sourceNames } });
    });
    return () => {
      current = false;
    };
  }, [id, wantAnswers, wantSources]);
  return state && state.id === id ? state.value : NO_PROVENANCE;
}
