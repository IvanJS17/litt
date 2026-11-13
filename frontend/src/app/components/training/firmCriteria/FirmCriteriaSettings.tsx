"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI } from "@mike/ui";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsDescription, SettingsLabel } from "@/app/components/settings/SettingsText";
import {
  createFirmCriterion,
  deleteFirmCriterion,
  listFirmCriteria,
  listPlaybooks,
  updateFirmCriterion,
  type FirmCriteriaList,
  type FirmCriterion,
  type FirmCriterionInput,
  type Playbook,
} from "@/app/lib/mikeApi";
import { notifyError, userFacingApiError } from "@/app/lib/userFacingError";
import { FirmCriterionForm } from "./FirmCriterionForm";
import { usePracticeOptionLabel } from "../trainingShared";

// Ajustes del despacho → Formación → Criterios del despacho (docs/training.md,
// "One mold of criterion"). Every member reads the firm's criteria; a member
// with no training stage writes their own; an owner or admin may remove any.
// The server decides all of it and says so in the list (can_write,
// can_manage): this page only offers what it allows. A criterion is a position
// a person wrote, shown with their name and the date. LiTT gives it no legal
// authority and stores no legal source for it.

export function FirmCriteriaSection({ orgId, orgName }: { orgId: string; orgName: string }) {
  const t = useTranslations("training.firmCriteria.settings");
  return (
    <div className="space-y-6">
      <section className="min-w-0 space-y-3">
        <SettingsHeading id="criterios-del-despacho">{t("title")}</SettingsHeading>
        <SettingsDescription>{t("intro")}</SettingsDescription>
        <SettingsDescription>{t("who")}</SettingsDescription>
      </section>
      <OrgCriteria orgId={orgId} orgName={orgName} showName={false} />
    </div>
  );
}

type Editing = { kind: "new" } | { kind: "edit"; id: string } | null;

export function OrgCriteria({ orgId, orgName, showName }: { orgId: string; orgName: string; showName: boolean }) {
  const t = useTranslations("training.firmCriteria.settings");
  const practiceLabel = usePracticeOptionLabel();
  const [data, setData] = useState<FirmCriteriaList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playbooks, setPlaybooks] = useState<Playbook[] | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await listFirmCriteria(orgId));
      setLoadError(null);
    } catch (error) {
      setLoadError(userFacingApiError(error, t("loadFailed")));
    }
  }, [orgId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // The playbooks a dissenting opinion can name, and the names of the ones it already does.
  // A failure only leaves the names out: the criteria are what the page is for.
  useEffect(() => {
    let cancelled = false;
    listPlaybooks(orgId).then(
      (list) => {
        if (!cancelled) setPlaybooks(list.filter((playbook) => playbook.orgId === orgId));
      },
      () => {
        if (!cancelled) setPlaybooks([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const run = async (action: string, change: () => Promise<void>, done: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await change();
      setEditing(null);
      setRemoving(null);
      await load();
      setNotice(done);
    } catch (error) {
      notifyError(error, { action, operation: "firm_criteria.write" });
    } finally {
      setBusy(false);
    }
  };

  const save = (input: FirmCriterionInput) => {
    const target = editing;
    if (!target) return;
    void run(
      "save the criterion",
      async () => {
        if (target.kind === "new") await createFirmCriterion(orgId, input);
        else await updateFirmCriterion(orgId, target.id, input);
      },
      t("saved"),
    );
  };

  const ruleLine = (criterion: FirmCriterion): string | null => {
    if (!criterion.rule_id) return null;
    const playbook = playbooks?.find((candidate) => candidate.id === criterion.playbook_id);
    const rule = playbook?.content.topics.flatMap((topic) => topic.rules).find((candidate) => candidate.id === criterion.rule_id);
    return playbook && rule ? t("rule", { rule: rule.name, playbook: playbook.name }) : t("ruleUnknown");
  };

  if (loadError) return <p role="alert" className="text-sm text-red-600">{loadError}</p>;
  if (data === null) return <SkeletonCard />;

  const atLimit = data.criteria.length >= data.max_per_organization;
  return (
    <section className="min-w-0 space-y-3" aria-label={showName ? orgName : t("title")}>
      {showName && <SettingsLabel>{orgName}</SettingsLabel>}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">{t("count", { count: data.criteria.length })}</p>
        {data.can_write && editing === null && (
          <PillButtonUI type="button" tone="black" size="sm" disabled={busy || atLimit} onClick={() => setEditing({ kind: "new" })}>
            {t("write")}
          </PillButtonUI>
        )}
      </div>
      {!data.can_write && <SettingsDescription>{t("readOnly")}</SettingsDescription>}
      {data.can_write && atLimit && <SettingsDescription>{t("limit")}</SettingsDescription>}
      <p role="status" aria-live="polite" className={notice ? "text-sm text-gray-700" : "sr-only"}>{notice}</p>
      <GlassCardUI>
        {editing?.kind === "new" && (
          <SettingsRow layout="stacked">
            <FirmCriterionForm existing={null} playbooks={playbooks} busy={busy} onSave={save} onCancel={() => setEditing(null)} />
          </SettingsRow>
        )}
        {data.criteria.length === 0 && editing === null && (
          <SettingsRow>
            <SettingsDescription>{t("empty")}</SettingsDescription>
          </SettingsRow>
        )}
        {data.criteria.map((criterion) =>
          editing?.kind === "edit" && editing.id === criterion.id ? (
            <SettingsRow key={criterion.id} layout="stacked">
              <FirmCriterionForm existing={criterion} playbooks={playbooks} busy={busy} onSave={save} onCancel={() => setEditing(null)} />
            </SettingsRow>
          ) : (
            <SettingsRow key={criterion.id} layout="stacked">
              <div className="min-w-0">
                <h3 className="break-words text-sm font-medium text-gray-900">{criterion.topic}</h3>
                <p className="mt-0.5 break-words text-xs text-gray-600">
                  {criterion.kind === "criterio" ? t("kind.criterio") : t("kind.voto_particular")}
                  {criterion.practice ? ` · ${practiceLabel(criterion.practice)}` : ""}
                  {criterion.mine ? ` · ${t("mine")}` : ""}
                </p>
                {ruleLine(criterion) && <p className="mt-0.5 break-words text-xs text-gray-600">{ruleLine(criterion)}</p>}
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-800">{criterion.position}</p>
                <p className="mt-2 break-words text-xs text-gray-600">
                  {criterion.author_name
                    ? t("author", { author: criterion.author_name, date: new Date(criterion.created_at) })
                    : t("authorDeleted", { date: new Date(criterion.created_at) })}
                  {criterion.updated_at !== criterion.created_at && ` · ${t("changed", { date: new Date(criterion.updated_at) })}`}
                </p>
              </div>
              {removing === criterion.id ? (
                <div className="flex min-w-0 flex-wrap items-center gap-3" role="group" aria-label={t("removeName", { topic: criterion.topic })}>
                  <p className="min-w-0 text-sm text-gray-700">{t("confirmRemove")}</p>
                  <PillButtonUI type="button" tone="black" size="sm" disabled={busy} loading={busy} onClick={() => void run("remove the criterion", () => deleteFirmCriterion(orgId, criterion.id).then(() => undefined), t("removed"))}>
                    {t("confirmRemoveYes")}
                  </PillButtonUI>
                  <PillButtonUI type="button" tone="white" size="sm" disabled={busy} onClick={() => setRemoving(null)}>
                    {t("cancel")}
                  </PillButtonUI>
                </div>
              ) : (
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  {criterion.mine && data.can_write && (
                    <PillButtonUI type="button" tone="white" size="sm" disabled={busy || editing !== null} aria-label={t("editName", { topic: criterion.topic })} onClick={() => setEditing({ kind: "edit", id: criterion.id })}>
                      {t("edit")}
                    </PillButtonUI>
                  )}
                  {(criterion.mine || data.can_manage) && (
                    <PillButtonUI type="button" tone="white" size="sm" disabled={busy} aria-label={t("removeName", { topic: criterion.topic })} onClick={() => setRemoving(criterion.id)}>
                      {t("remove")}
                    </PillButtonUI>
                  )}
                </div>
              )}
            </SettingsRow>
          ),
        )}
      </GlassCardUI>
    </section>
  );
}

function SkeletonCard() {
  return (
    <GlassCardUI>
      {[0, 1].map((row) => (
        <SettingsRow key={row} layout="stacked">
          <div className="h-4 w-40 animate-pulse rounded bg-gray-100" />
          <div className="h-16 w-full animate-pulse rounded bg-gray-100" />
          <div className="h-3 w-56 animate-pulse rounded bg-gray-100" />
        </SettingsRow>
      ))}
    </GlassCardUI>
  );
}
