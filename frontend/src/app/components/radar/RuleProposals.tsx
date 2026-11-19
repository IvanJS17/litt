"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileDown, Sparkles } from "lucide-react";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import type {
  ProfileExtractionRoute,
  RuleProposal,
  RuleProposalRun,
  RuleProposals as RuleProposalsData,
} from "@mike/contracts";
import { Field, SELECT_CLASS } from "@/app/components/requests/requestFields";
import { FormTextInput } from "@/app/components/ui/form-field";
import { LIQUID_SUBTLE_PANEL_SURFACE_CLASS } from "@/app/components/ui/liquid-surface";
import { extractionProviderName } from "@/app/components/profile/profileOptions";
import { downloadBlob } from "@/app/lib/downloadDocument";
import {
  decideRuleProposal,
  downloadRuleProposals,
  getRuleProposalRoute,
  getRuleProposals,
  proposeObligationRules,
} from "@/app/lib/mikeApi";
import { errorCode, notifyError } from "@/app/lib/userFacingError";

const REASON_MAX = 500;

/** What a run did: how many it proposed and why the rest were rejected. */
function RunResult({ result }: { result: RuleProposalRun }) {
  const t = useTranslations();
  const id = useId();
  const rejected: [string, number, string][] = [
    ["quote", result.discarded_quote_not_found, t("ruleProposals.result.discardedQuote", { count: result.discarded_quote_not_found })],
    ["duplicate", result.discarded_duplicate, t("ruleProposals.result.discardedDuplicate", { count: result.discarded_duplicate })],
    ["invalid", result.discarded_invalid, t("ruleProposals.result.discardedInvalid", { count: result.discarded_invalid })],
    ["term", result.discarded_term_has_date, t("ruleProposals.result.discardedTerm", { count: result.discarded_term_has_date })],
  ];
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-1">
      <h4 id={`${id}-title`} className="text-sm font-medium text-gray-900">
        {t("ruleProposals.result.title")}
      </h4>
      <p className="text-sm text-gray-900" role="status">
        {t("ruleProposals.result.proposed", { count: result.proposed })}
      </p>
      {rejected
        .filter(([, count]) => count > 0)
        .map(([key, , text]) => (
          <p key={key} className="text-sm text-gray-600">
            {text}
          </p>
        ))}
      <p className="text-xs text-gray-600">{t("ruleProposals.result.notExhaustive")}</p>
    </section>
  );
}

type Mode = "discard" | "implemented" | null;

function ProposalCard({
  proposal,
  canWrite,
  busy,
  onSend,
  onDiscard,
  onImplemented,
}: {
  proposal: RuleProposal;
  canWrite: boolean;
  busy: boolean;
  onSend: () => void;
  onDiscard: (reason: string) => void;
  onImplemented: (code: string) => void;
}) {
  const t = useTranslations();
  const id = useId();
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const obsolete = proposal.effective_status === "obsolete";
  const pending = proposal.status === "pending";
  const sent = proposal.status === "sent_to_legal";
  const statusText = obsolete
    ? t("ruleProposals.status.obsolete", { reason: t(`ruleProposals.stale.${proposal.stale_reason ?? "text_changed"}`) })
    : proposal.status === "implemented"
      ? t("ruleProposals.status.implemented", { code: proposal.catalog_code ?? "" })
      : sent
        ? t("ruleProposals.status.sent")
        : t("ruleProposals.status.pending");
  const source = t("ruleProposals.source", {
    name: proposal.source.filename ?? proposal.source.document_id,
    version: proposal.source.version_number ?? "–",
  });
  const stop = () => {
    setMode(null);
    setText("");
  };
  return (
    <article aria-labelledby={`${id}-name`} className="min-w-0 space-y-2 rounded-xl bg-app-surface/60 p-4">
      <header className="space-y-1">
        <h4 id={`${id}-name`} className="min-w-0 break-words text-sm font-medium text-gray-900">
          {proposal.obligation}
        </h4>
        <p className="break-words text-xs text-gray-600">{t("ruleProposals.lawArticle", { law: proposal.law, article: proposal.article })}</p>
        <p className="text-xs font-medium text-amber-800">{t("ruleProposals.legend")}</p>
      </header>
      <figure className="space-y-1 border-l-2 border-gray-300 pl-3">
        <figcaption className="text-xs text-gray-500">
          {source}
          {proposal.page ? ` · ${t("ruleProposals.page", { page: proposal.page })}` : ""}
        </figcaption>
        <blockquote className="break-words whitespace-pre-wrap text-sm text-gray-700" aria-label={t("ruleProposals.quote")}>
          {proposal.quote}
        </blockquote>
      </figure>
      <dl className="space-y-1 text-xs text-gray-600">
        <div className="break-words">
          <dt className="inline font-medium">{t("ruleProposals.anchorLabel")}: </dt>
          <dd className="inline">{proposal.anchor_name}</dd>
        </div>
        <div className="break-words">
          <dt className="inline font-medium">{t("ruleProposals.termLabel")}: </dt>
          <dd className="inline">{proposal.plazo_propuesto ?? t("ruleProposals.noTerm")}</dd>
          {proposal.plazo_propuesto ? <p className="text-amber-800">{t("ruleProposals.termLegend")}</p> : null}
        </div>
      </dl>
      <p className={`break-words text-sm ${obsolete ? "text-amber-800" : "text-gray-900"}`}>{statusText}</p>
      {mode ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-input`} className="block text-xs font-medium text-gray-900">
            {mode === "discard" ? t("ruleProposals.actions.discardReason") : t("ruleProposals.actions.implementedCode")}
          </label>
          <FormTextInput
            id={`${id}-input`}
            value={text}
            maxLength={mode === "discard" ? REASON_MAX : 80}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
          {mode === "implemented" ? <p className="text-xs text-gray-500">{t("ruleProposals.actions.implementedHint")}</p> : null}
        </div>
      ) : null}
      {canWrite && (pending || sent) ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {pending && !obsolete && !mode ? <p className="mr-auto text-xs text-gray-500">{t("ruleProposals.actions.sendHint")}</p> : null}
          {mode ? (
            <TextButtonUI type="button" size="sm" className="pointer-coarse:min-h-11" disabled={busy} onClick={stop}>
              {t("ruleProposals.actions.cancel")}
            </TextButtonUI>
          ) : null}
          {!mode || mode === "discard" ? (
            <PillButtonUI
              type="button"
              tone="white"
              size="sm"
              className="pointer-coarse:min-h-11"
              disabled={busy}
              onClick={() => {
                if (!mode) return setMode("discard");
                onDiscard(text.trim());
                stop();
              }}
            >
              {mode === "discard" ? t("ruleProposals.actions.discardConfirm") : t("ruleProposals.actions.discard")}
            </PillButtonUI>
          ) : null}
          {sent && (!mode || mode === "implemented") ? (
            <PillButtonUI
              type="button"
              tone="white"
              size="sm"
              className="pointer-coarse:min-h-11"
              disabled={busy || (mode === "implemented" && text.trim() === "")}
              onClick={() => {
                if (!mode) return setMode("implemented");
                onImplemented(text.trim());
                stop();
              }}
            >
              {mode === "implemented" ? t("ruleProposals.actions.implementedConfirm") : t("ruleProposals.actions.implemented")}
            </PillButtonUI>
          ) : null}
          {pending && !obsolete && !mode ? (
            <PillButtonUI type="button" tone="black" size="sm" className="pointer-coarse:min-h-11" disabled={busy} aria-busy={busy} onClick={onSend}>
              {busy ? t("ruleProposals.actions.sending") : t("ruleProposals.actions.send")}
            </PillButtonUI>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Proposals of NEW obligation rules from a law text (docs/obligation-rules.md,
 * "Rule proposals"), in a firm project (never a client matter). The lawyer
 * picks one version of the law's document and asks the AI for obligations;
 * every proposal is an unverified draft with the literal quote and its
 * article. "Send to legal" only records the send and downloads a file for the
 * person: nothing goes to LiTT. There is no way to turn a draft on.
 */
export function RuleProposals({ projectId }: { projectId: string }) {
  const t = useTranslations();
  const id = useId();
  const [data, setData] = useState<RuleProposalsData | null>(null);
  const [route, setRoute] = useState<ProfileExtractionRoute | null>(null);
  const [failed, setFailed] = useState(false);
  const [versionId, setVersionId] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RuleProposalRun | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  const load = useCallback(async () => {
    const next = await getRuleProposals(projectId);
    setData(next);
    setRoute(next.can_write ? await getRuleProposalRoute(projectId).catch(() => null) : null);
  }, [projectId]);

  useEffect(() => {
    let current = true;
    setData(null);
    setFailed(false);
    load().catch((error) => {
      if (!current) return;
      setFailed(true);
      notifyError(error, { action: tRef.current("ruleProposals.couldNotLoad") });
    });
    return () => {
      current = false;
    };
  }, [load]);

  const reload = useCallback(async () => {
    try {
      await load();
    } catch (error) {
      notifyError(error, { action: tRef.current("ruleProposals.couldNotLoad") });
    }
  }, [load]);

  async function run() {
    setRunning(true);
    setResult(null);
    setNotice(null);
    try {
      setResult(await proposeObligationRules(projectId, versionId));
      await load();
    } catch (error) {
      notifyError(error, { action: tRef.current("ruleProposals.couldNotPropose") });
    } finally {
      setRunning(false);
    }
  }

  async function download() {
    const file = await downloadRuleProposals(projectId);
    downloadBlob(file.blob, file.filename ?? "propuestas-reglas.md");
  }

  async function exportFile() {
    setDownloading(true);
    setNotice(null);
    try {
      await download();
    } catch (error) {
      notifyError(error, { action: tRef.current("ruleProposals.export.couldNotDownload") });
    } finally {
      setDownloading(false);
    }
  }

  async function decide(proposal: RuleProposal, kind: "send-to-legal" | "discard" | "implemented", input: { reason?: string; catalog_code?: string }) {
    setBusyId(proposal.id);
    setNotice(null);
    try {
      await decideRuleProposal(projectId, proposal.id, kind, input);
      await load();
      // "Send to legal" records the send and hands the person their file; nothing is transmitted.
      if (kind === "send-to-legal") {
        await download();
        setNotice(tRef.current("ruleProposals.export.sentAndDownloaded"));
      }
    } catch (error) {
      const unknownCode = errorCode(error) === "proposal_unknown_catalog_code";
      notifyError(error, {
        action: tRef.current(unknownCode ? "ruleProposals.actions.couldNotImplement" : "ruleProposals.actions.couldNotDecide"),
      });
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  const canWrite = data?.can_write === true;
  const shown = (data?.proposals ?? []).filter((proposal) => proposal.status !== "discarded");
  const busy = running || busyId !== null || downloading;

  return (
    <main className="min-h-full px-4 py-6 md:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="space-y-2">
          <Link
            href={`/projects/${encodeURIComponent(projectId)}`}
            className="inline-block rounded text-xs text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t("ruleProposals.backToProject")}
          </Link>
          <h1 className="flex items-center gap-2 font-serif text-2xl text-gray-900">
            <Sparkles aria-hidden="true" className="size-5 shrink-0 text-gray-500" />
            {t("ruleProposals.title")}
          </h1>
          <p className="text-sm text-gray-600">{t("ruleProposals.subtitle")}</p>
          <p className="text-sm font-medium text-gray-900">{t("ruleProposals.legend")}</p>
        </header>
        {failed ? (
          <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} p-5`} role="alert">
            <p className="text-sm text-red-700">{t("ruleProposals.couldNotLoad")}</p>
          </section>
        ) : !data ? (
          <div aria-busy="true" aria-label={t("ruleProposals.loading")} className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} h-16 animate-pulse`} />
        ) : (
          <>
            {canWrite && route ? (
              <section className="space-y-2">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-0 flex-1 basis-64">
                    <Field id={`${id}-version`} label={t("ruleProposals.version")}>
                      <select
                        id={`${id}-version`}
                        className={SELECT_CLASS}
                        value={versionId}
                        disabled={running}
                        onChange={(event) => setVersionId(event.target.value)}
                      >
                        <option value="">{t("ruleProposals.chooseVersion")}</option>
                        {data.versions.map((version) => (
                          <option key={version.version_id} value={version.version_id}>
                            {t("ruleProposals.source", { name: version.filename ?? version.document_id, version: version.version_number ?? "–" })}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <PillButtonUI
                    type="button"
                    tone="black"
                    size="normal"
                    className="pointer-coarse:min-h-11"
                    disabled={versionId === "" || busy}
                    aria-busy={running}
                    aria-describedby={`${id}-helper`}
                    onClick={() => void run()}
                  >
                    {running ? t("ruleProposals.running") : t("ruleProposals.button")}
                  </PillButtonUI>
                </div>
                <p id={`${id}-helper`} className="text-xs text-gray-600">
                  {t("ruleProposals.helper", { provider: extractionProviderName(route.provider) })}
                </p>
                <p className="text-xs text-gray-600">{t("ruleProposals.sizeNote")}</p>
              </section>
            ) : canWrite ? (
              <p className="text-xs text-gray-500">{t("ruleProposals.noRoute")}</p>
            ) : (
              <p className="text-xs text-gray-500">{t("ruleProposals.readOnly")}</p>
            )}
            {result ? <RunResult result={result} /> : null}
            <section className="space-y-2" aria-labelledby={`${id}-list`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`${id}-list`} className="text-sm font-medium text-gray-900">
                  {t("ruleProposals.listTitle")}
                </h2>
                <PillButtonUI
                  type="button"
                  tone="white"
                  size="sm"
                  className="pointer-coarse:min-h-11"
                  disabled={busy}
                  aria-busy={downloading}
                  aria-describedby={`${id}-export-hint`}
                  onClick={() => void exportFile()}
                >
                  <FileDown aria-hidden="true" className="mr-1.5 size-4" />
                  {downloading ? t("ruleProposals.export.downloading") : t("ruleProposals.export.button")}
                </PillButtonUI>
              </div>
              <p id={`${id}-export-hint`} className="text-xs text-gray-600">
                {t("ruleProposals.export.hint")}
              </p>
              {notice ? (
                <p className="text-sm text-gray-900" role="status">
                  {notice}
                </p>
              ) : null}
              {shown.length === 0 ? (
                <p className="text-sm text-gray-500">{t("ruleProposals.empty")}</p>
              ) : (
                <ul className="space-y-3">
                  {shown.map((proposal) => (
                    <li key={proposal.id}>
                      <ProposalCard
                        proposal={proposal}
                        canWrite={canWrite}
                        busy={busy}
                        onSend={() => void decide(proposal, "send-to-legal", {})}
                        onDiscard={(reason) => void decide(proposal, "discard", reason ? { reason } : {})}
                        onImplemented={(code) => void decide(proposal, "implemented", { catalog_code: code })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
