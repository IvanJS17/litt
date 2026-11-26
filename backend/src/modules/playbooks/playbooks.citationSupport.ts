// Citation support check (docs/citation-support-check.md) for playbook
// drafts: the source quotes the server already verified.
//
// A draft rule stands on a quote of an attachment in two ways: its origin
// (kind "clause") and its legal references. verifyDraftProvenance keeps those
// only when the quote is in the attachment it names, so what is left here is
// a verified quote and the rule it backs. The claim is the rule's own
// statement, short; the context is the attachment's text around the quote.
// The check runs after the draft is saved, detached from the job that saved
// it: never awaited, never throws, shown to nobody.
import {
    createCitationSupportRunner,
    inputFromSpans,
    MAX_CHECKED_CITATIONS,
    type CitationSupportInput,
} from "../../lib/citationSupport";
import type { Db } from "../../lib/supabase";
import { LEGAL_VERSION } from "../user/user.service";
import type { PlaybookContent } from "./playbooks.types";

type Rule = PlaybookContent["rules"][number];
/** The part of a draft source the check reads (see DraftSource in playbooks.draft.ts). */
type DraftSourceText = { label: string; text: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the rule says, short: its name and its standard, or its concept, or its guidance. */
function ruleClaim(rule: Rule): string {
    const statement = rule.standard?.criteria?.trim() || rule.concept?.trim() || rule.guidance?.trim() || "";
    return [rule.name?.trim(), statement].filter(Boolean).join(": ");
}

/** One verified quote a rule stands on: its origin (kind "clause") or a verified legal reference. */
type CitedQuote = {
    rule: Rule;
    claim: string;
    sourceLabel: string | undefined;
    quote: string | undefined;
    /** Index in `rule.legalRefs`; null for the rule's origin. */
    legalIndex: number | null;
};

/**
 * The quotes of a draft in the order they are checked, which is the order of
 * their `citation_ref`: top-level rules, then each topic's, and within a rule
 * its origin first and then its verified legal references. One walk for the
 * check and for reading its result back (reviewRulesFor), so they agree.
 */
function* citedQuotes(content: PlaybookContent): Generator<CitedQuote> {
    const rules = [...content.rules, ...content.topics.flatMap((topic) => topic.rules)];
    for (const rule of rules) {
        if (rule.origin?.kind === "clause")
            yield { rule, claim: ruleClaim(rule), sourceLabel: rule.origin.sourceId, quote: rule.origin.quote, legalIndex: null };
        for (const [index, legal] of (rule.legalRefs ?? []).entries())
            if (legal.verified)
                yield {
                    rule,
                    claim: `${rule.name?.trim() ?? ""}: ${legal.text}`.replace(/^: /, ""),
                    sourceLabel: legal.sourceId,
                    quote: legal.quote,
                    legalIndex: index,
                };
    }
}

/** A quote of a stored draft whose check was in the low band, located by rule id. */
export type PlaybookReviewSource = { ruleId: string; legalIndex: number | null };

/**
 * Which quotes of a stored draft the checks flagged. The numbers are the order
 * of the quotes when the draft was written (citedQuotes), so they are only
 * valid for that content: the caller passes refs only while the playbook is
 * unchanged since (readDraftReviewRefs). A rule is named by its stable id.
 */
export function reviewSourcesFor(content: PlaybookContent, refs: readonly number[]): PlaybookReviewSource[] {
    if (refs.length === 0) return [];
    const flagged = new Set(refs);
    const found: PlaybookReviewSource[] = [];
    let ref = 0;
    for (const quote of citedQuotes(content)) {
        if (!quote.claim || !quote.sourceLabel || !quote.quote) continue;
        ref += 1;
        if (flagged.has(ref) && quote.rule.id) found.push({ ruleId: quote.rule.id, legalIndex: quote.legalIndex });
    }
    return found;
}

/**
 * One input per verified quote of the draft, in rule order: a rule's origin
 * (when it stands on a clause) and each of its verified legal references.
 * `content` is the verified draft before its source labels (A1…) are replaced
 * by stored ids; `sourceIds` are those ids, one per attachment in order.
 */
export function playbookCitationInputs(args: {
    content: PlaybookContent;
    sources: readonly DraftSourceText[];
    sourceIds: readonly string[];
    /** Where a verified quote sits in its source (locateQuoteInSource in playbooks.draft.ts). */
    locate: (text: string, quote: string) => { start: number; end: number; excerpt: string } | null;
}): CitationSupportInput[] {
    const inputs: CitationSupportInput[] = [];
    let ref = 0;
    // Quotes placed in their source, found or not: a missed one costs as much as a found one.
    let examined = 0;
    const add = (claim: string, sourceLabel: string | undefined, quote: string | undefined) => {
        if (!claim || !sourceLabel || !quote || examined >= MAX_CHECKED_CITATIONS) return;
        const index = args.sources.findIndex((source) => source.label === sourceLabel);
        if (index < 0) return;
        const text = args.sources[index].text;
        examined += 1;
        const located = args.locate(text, quote);
        ref += 1;
        if (!located) return;
        const stored = args.sourceIds[index];
        inputs.push(
            inputFromSpans({
                ref,
                claim,
                source: text,
                documentId: stored && UUID.test(stored) ? stored : null,
                versionId: null,
                spans: [
                    {
                        start: located.start,
                        end: located.end,
                        text: located.excerpt,
                    },
                ],
            }),
        );
    };
    for (const quote of citedQuotes(args.content)) add(quote.claim, quote.sourceLabel, quote.quote);
    return inputs;
}

/** After a draft is saved: fire and forget. */
export function checkPlaybookDraftCitations(args: {
    db: Db;
    /** The person who asked for the draft. */
    userId: string;
    orgId: string | null;
    playbookId: string;
    content: PlaybookContent;
    sources: readonly DraftSourceText[];
    sourceIds: readonly string[];
    locate: Parameters<typeof playbookCitationInputs>[0]["locate"];
}): void {
    void (async () => {
        try {
            const runner = await createCitationSupportRunner({
                db: args.db,
                userId: args.userId,
                orgId: args.orgId,
                legalVersion: LEGAL_VERSION,
            });
            if (!runner) return;
            await runner.run({ surface: "playbook", ownerId: args.playbookId }, playbookCitationInputs(args));
        } catch {
            // Silent mode: nothing here reaches the draft.
        }
    })();
}
