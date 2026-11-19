"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { PillButtonUI } from "@mike/ui";
import type {
  ClientProfile as ClientProfileData,
  ProfileExtraction,
  ProfileExtractionRoute,
  ProfileFactInput,
} from "@mike/contracts";
import { EmptyState } from "@/app/components/ui/empty-state";
import { LIQUID_SUBTLE_PANEL_SURFACE_CLASS } from "@/app/components/ui/liquid-surface";
import {
  confirmProfileFact,
  createProfileFact,
  decideProfileFacts,
  extractProfileFacts,
  getClientProfile,
  getProfileExtractionRoute,
  rejectProfileFact,
} from "@/app/lib/mikeApi";
import { errorCode, notifyError } from "@/app/lib/userFacingError";
import { MatterSectionNav } from "./MatterSectionNav";
import { BatchResult, ProfileBatchBar, ProposalCheckbox, type BatchSummary } from "./ProfileBatchBar";
import { ProfileFactCard } from "./ProfileFactCard";
import { ProfileExtractPanel, ProfileExtractResult } from "./ProfileExtractPanel";
import { ProfileFactForm } from "./ProfileFactForm";
import { groupFacts, pendingProposals, type FormErrorKey } from "./profileOptions";

// What the server refuses about a quote, as the form words it.
const FORM_ERRORS: Record<string, FormErrorKey> = {
  quote_not_found: "quoteNotFound",
  source_text_unavailable: "sourceTextUnavailable",
  version_not_in_matter: "versionNotInMatter",
};

/**
 * The client's profile in a retainer matter (docs/client-profile.md): facts a
 * lawyer captured by hand, grouped by kind, each with the passage of the
 * document that backs it and its state (awaiting confirmation, confirmed,
 * rejected, or out of date when the cited text changed). Reading is for the
 * whole team; adding, confirming and rejecting are for owners and editors.
 */
export function ClientProfile({ projectId, matterId }: { projectId: string; matterId: string }) {
  const t = useTranslations();
  const [data, setData] = useState<ClientProfileData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<FormErrorKey | null>(null);
  const [busyFact, setBusyFact] = useState<string | null>(null);
  // Assisted extraction: where the text would go (null: no button), the run in
  // flight and the last run's counts and proposals.
  const [route, setRoute] = useState<ProfileExtractionRoute | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extraction, setExtraction] = useState<ProfileExtraction | null>(null);
  // Batch review of the proposals: the ids ticked, the call in flight and its outcome.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [batching, setBatching] = useState(false);
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  useEffect(() => {
    let current = true;
    setData(null);
    setLoadFailed(false);
    setAdding(false);
    setRoute(null);
    setExtraction(null);
    setPicked(new Set());
    setBatchSummary(null);
    getClientProfile(projectId, matterId).then(
      (next) => {
        if (current) setData(next);
      },
      (error) => {
        if (!current) return;
        setLoadFailed(true);
        notifyError(error, { action: tRef.current("clientProfile.couldNotLoad") });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, matterId, reload]);

  // The button exists only when the space's AI has a route for this person; the
  // answer is read after the profile and a failure to read it just hides the button.
  const canExtract = Boolean(data?.retainer && data.can_write);
  useEffect(() => {
    if (!canExtract) return;
    let current = true;
    getProfileExtractionRoute(projectId, matterId).then(
      (next) => {
        if (current) setRoute(next);
      },
      () => {
        if (current) setRoute(null);
      },
    );
    return () => {
      current = false;
    };
  }, [canExtract, projectId, matterId, reload]);

  // After a change the page reads the profile again, so the names, the state of
  // every fact and the list of versions are the server's, not a guess.
  const refresh = useCallback(async () => {
    try {
      setData(await getClientProfile(projectId, matterId));
    } catch (error) {
      notifyError(error, { action: tRef.current("clientProfile.couldNotLoad") });
    }
  }, [projectId, matterId]);

  async function create(input: ProfileFactInput) {
    setSaving(true);
    setFormError(null);
    try {
      await createProfileFact(projectId, matterId, input);
      setAdding(false);
      await refresh();
    } catch (error) {
      const known = FORM_ERRORS[errorCode(error) ?? ""];
      if (known) setFormError(known);
      else notifyError(error, { action: t("clientProfile.form.couldNotCreate") });
    } finally {
      setSaving(false);
    }
  }

  async function extract(versionId: string) {
    setExtracting(true);
    setExtraction(null);
    try {
      setExtraction(await extractProfileFacts(projectId, matterId, versionId));
      await refresh();
    } catch (error) {
      notifyError(error, { action: t("clientProfile.extract.couldNotExtract") });
    } finally {
      setExtracting(false);
    }
  }

  async function decide(factId: string, choice: "confirm" | "reject", reason = "") {
    setBusyFact(factId);
    try {
      const call = choice === "confirm" ? confirmProfileFact : rejectProfileFact;
      await call(projectId, matterId, factId, reason ? { reason } : {});
      await refresh();
    } catch (error) {
      const conflict = errorCode(error) === "fact_already_decided" || errorCode(error) === "fact_stale";
      notifyError(error, {
        action: t(
          conflict
            ? "clientProfile.actions.alreadyDecided"
            : choice === "confirm"
              ? "clientProfile.actions.couldNotConfirm"
              : "clientProfile.actions.couldNotReject",
        ),
      });
      if (conflict) await refresh();
    } finally {
      setBusyFact(null);
    }
  }

  async function decideBatch(choice: "confirm" | "reject", reason: string, ids: string[]) {
    setBatching(true);
    setBatchSummary(null);
    try {
      const { results } = await decideProfileFacts(projectId, matterId, {
        action: choice,
        factIds: ids,
        ...(reason ? { reason } : {}),
      });
      const done = results.filter((item) => item.outcome === "ok").length;
      setBatchSummary({ action: choice, ok: done, failed: results.length - done });
      setPicked(new Set());
      await refresh();
    } catch (error) {
      notifyError(error, { action: t("clientProfile.batch.couldNotDecide") });
    } finally {
      setBatching(false);
    }
  }

  const names = new Map((data?.people ?? []).map((person) => [person.user_id, person.name] as const));
  // What the last run proposed and nobody has decided yet is listed apart, on top.
  const proposals = pendingProposals(data?.facts ?? [], extraction?.fact_ids ?? []);
  const proposalIds = new Set(proposals.map((fact) => fact.id));
  const groups = groupFacts((data?.facts ?? []).filter((fact) => !proposalIds.has(fact.id)));
  // Only what is still a proposal can be ticked, whatever was ticked before.
  const ticked = proposals.filter((fact) => picked.has(fact.id)).map((fact) => fact.id);
  const tick = (id: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const card = (fact: ClientProfileData["facts"][number]) => (
    <ProfileFactCard
      fact={fact}
      names={names}
      canWrite={data?.can_write ?? false}
      busy={busyFact === fact.id}
      onConfirm={() => void decide(fact.id, "confirm")}
      onReject={(reason) => void decide(fact.id, "reject", reason)}
    />
  );

  return (
    <main className="min-h-full px-4 py-6 md:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="space-y-2">
          <Link
            href={`/projects/${encodeURIComponent(projectId)}`}
            className="inline-block rounded text-xs text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t("clientProfile.backToMatter")}
          </Link>
          <MatterSectionNav projectId={projectId} matterId={matterId} current="profile" />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-serif text-2xl text-gray-900">{t("clientProfile.title")}</h1>
              <p className="mt-1 text-sm text-gray-600">{t("clientProfile.subtitle")}</p>
            </div>
            {data?.retainer && data.can_write && !adding ? (
              <PillButtonUI
                type="button"
                tone="black"
                size="normal"
                className="pointer-coarse:min-h-11"
                onClick={() => {
                  setFormError(null);
                  setAdding(true);
                }}
              >
                {t("clientProfile.add")}
              </PillButtonUI>
            ) : null}
          </div>
        </header>

        {loadFailed ? (
          <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} space-y-3 p-5`} role="alert">
            <p className="text-sm text-red-700">{t("clientProfile.couldNotLoad")}</p>
            <PillButtonUI type="button" tone="white" size="sm" onClick={() => setReload((value) => value + 1)}>
              {t("clientProfile.retry")}
            </PillButtonUI>
          </section>
        ) : !data ? (
          <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} space-y-3 p-5`} aria-busy="true" aria-label={t("clientProfile.loading")}>
            {[0, 1, 2].map((row) => (
              <div key={row} className="space-y-2" aria-hidden="true">
                <div className="h-4 w-1/3 animate-pulse rounded bg-app-surface" />
                <div className="h-16 w-full animate-pulse rounded bg-app-surface" />
              </div>
            ))}
          </section>
        ) : !data.retainer ? (
          <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} p-5 md:p-6`}>
            <EmptyState
              icon={<FileText />}
              title={t("clientProfile.retainer.offTitle")}
              description={t("clientProfile.retainer.offDescription")}
            />
          </section>
        ) : (
          <div className="space-y-5">
            {adding ? (
              <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} p-4 md:p-5`}>
                <ProfileFactForm
                  versions={data.versions}
                  saving={saving}
                  errorKey={formError}
                  onSubmit={(input) => void create(input)}
                  onCancel={() => setAdding(false)}
                />
              </section>
            ) : null}
            {route && data.versions.length > 0 ? (
              <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} space-y-4 p-4 md:p-5`}>
                <ProfileExtractPanel versions={data.versions} route={route} running={extracting} onRun={(id) => void extract(id)} />
                {extraction ? <ProfileExtractResult result={extraction} /> : null}
              </section>
            ) : null}
            {proposals.length > 0 ? (
              <section aria-labelledby="profile-proposals" className="space-y-2">
                <h2 id="profile-proposals" className="font-serif text-lg text-gray-900">
                  {t("clientProfile.extract.proposals")}
                </h2>
                {data.can_write && proposals.length > 1 ? (
                  <ProfileBatchBar
                    total={proposals.length}
                    selected={ticked.length}
                    busy={batching}
                    onSelectAll={(on) => setPicked(on ? new Set(proposalIds) : new Set())}
                    onDecide={(choice, reason) => void decideBatch(choice, reason, ticked)}
                  />
                ) : null}
                <ul className="space-y-3">
                  {proposals.map((fact) => (
                    <li key={fact.id} className="flex items-start">
                      {data.can_write && proposals.length > 1 ? (
                        <ProposalCheckbox
                          label={fact.label}
                          checked={picked.has(fact.id)}
                          disabled={batching}
                          onChange={(on) => tick(fact.id, on)}
                        />
                      ) : null}
                      <div className="min-w-0 flex-1">{card(fact)}</div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <BatchResult summary={batchSummary} />
            {groups.length === 0 && proposals.length === 0 ? (
              <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} p-5 md:p-6`}>
                <EmptyState
                  icon={<FileText />}
                  title={t("clientProfile.empty.title")}
                  description={data.can_write ? t("clientProfile.empty.write") : t("clientProfile.empty.read")}
                />
              </section>
            ) : (
              groups.map(([kind, facts]) => (
                <section key={kind} aria-labelledby={`profile-group-${kind}`} className="space-y-2">
                  <h2 id={`profile-group-${kind}`} className="font-serif text-lg text-gray-900">
                    {t(`clientProfile.group.${kind}`)}
                  </h2>
                  <ul className="space-y-3">
                    {facts.map((fact) => (
                      <li key={fact.id}>{card(fact)}</li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default ClientProfile;
