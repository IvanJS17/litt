"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI, TextButtonUI } from "@mike/ui";
import type { SplitClassesSettings } from "@mike/contracts";
import { ModalTextInput } from "@/app/components/modals/ModalTextInput";
import { ModalTextarea } from "@/app/components/modals/ModalTextarea";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsDescription, SettingsLabel } from "@/app/components/settings/SettingsText";
import { showToast } from "@/app/components/ui/toast";
import {
  SPLIT_DESCRIPTION_MAX,
  SPLIT_IDENTIFIER_MAX,
  SPLIT_NAME_MAX,
  draftFrom,
  draftProblem,
  draftToClasses,
  isBuiltIn,
  isChanged,
  type DraftClass,
} from "@/app/lib/splitClassesDraft";
import { notifyError } from "@/app/lib/userFacingError";

/**
 * The list of document types "Separar expediente" sorts pages into, for a
 * person or a firm: name, description and an optional identifier, up to
 * Split's limit of 19. The included Mexican list can be restored. The text of
 * each description and identifier is also sent to LandingAI, so the note
 * under the fields says not to write client data in them. The list itself is
 * product data and is not translated; only the labels around it are.
 */
export function SplitClassesCard({
  title,
  intro,
  load,
  save,
}: {
  title: string;
  intro: string;
  load: () => Promise<SplitClassesSettings>;
  /** Saves the list; `null` restores the included one. */
  save: (classes: ReturnType<typeof draftToClasses> | null) => Promise<SplitClassesSettings>;
}) {
  const t = useTranslations();
  const headingId = useId();
  const noteId = useId();
  const [settings, setSettings] = useState<SplitClassesSettings | null>(null);
  const [draft, setDraft] = useState<DraftClass[]>([]);
  const [saving, setSaving] = useState(false);
  const nextKey = useRef(1000);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const apply = useCallback((next: SplitClassesSettings) => {
    setSettings(next);
    setDraft(draftFrom(next.classes));
  }, []);

  useEffect(() => {
    let current = true;
    Promise.resolve().then(() => loadRef.current()).then(
      (next) => {
        if (current) apply(next);
      },
      (error) => {
        if (current) notifyError(error, { action: t("settings.splitClasses.couldNotLoad") });
      },
    );
    return () => {
      current = false;
    };
    // Loaded once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply]);

  const canManage = settings?.can_manage !== false;
  const max = settings?.max ?? 19;
  const problem = settings ? draftProblem(draft, max) : null;
  const changed = settings ? isChanged(draft, settings.classes) : false;

  async function persist(builtIn: boolean) {
    if (!settings || saving) return;
    setSaving(true);
    try {
      apply(await save(builtIn ? null : draftToClasses(draft)));
      showToast({ tone: "success", message: t("settings.splitClasses.saved") });
    } catch (error) {
      notifyError(error, { action: t("settings.splitClasses.couldNotSave"), onRetry: () => void persist(builtIn) });
    } finally {
      setSaving(false);
    }
  }

  const edit = (key: number, patch: Partial<DraftClass>) =>
    setDraft((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <SettingsHeading id={headingId}>{title}</SettingsHeading>
      <GlassCardUI>
        <SettingsRow layout="stacked">
          <div className="min-w-0 space-y-1">
            <SettingsDescription>{intro}</SettingsDescription>
            {settings ? (
              <SettingsDescription>
                {settings.custom ? t("settings.splitClasses.usingOwn") : t("settings.splitClasses.usingBuiltIn")}
              </SettingsDescription>
            ) : null}
            {!canManage ? <SettingsDescription>{t("settings.splitClasses.readOnly")}</SettingsDescription> : null}
          </div>
        </SettingsRow>
        {!settings ? (
          <SettingsRow layout="stacked">
            <div className="h-24 animate-pulse rounded-xl bg-app-surface" aria-hidden="true" />
          </SettingsRow>
        ) : (
          <>
            <ol className="divide-y divide-gray-100" aria-label={title}>
              {draft.map((row, index) => (
                <li key={row.key} className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <SettingsLabel>{t("settings.splitClasses.typeNumber", { number: index + 1 })}</SettingsLabel>
                    {canManage ? (
                      <TextButtonUI
                        size="sm"
                        type="button"
                        disabled={saving || draft.length <= 1}
                        aria-label={t("settings.splitClasses.remove", { name: row.name || String(index + 1) })}
                        onClick={() => setDraft((rows) => rows.filter((r) => r.key !== row.key))}
                      >
                        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                        {t("settings.splitClasses.removeShort")}
                      </TextButtonUI>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label htmlFor={`${headingId}-n${row.key}`} className="text-xs font-medium text-gray-900">
                        {t("settings.splitClasses.name")}
                      </label>
                      <ModalTextInput
                        id={`${headingId}-n${row.key}`}
                        className="h-9"
                        value={row.name}
                        maxLength={SPLIT_NAME_MAX}
                        readOnly={!canManage}
                        disabled={saving}
                        onChange={(event) => edit(row.key, { name: event.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={`${headingId}-i${row.key}`} className="text-xs font-medium text-gray-900">
                        {t("settings.splitClasses.identifier")}
                      </label>
                      <ModalTextInput
                        id={`${headingId}-i${row.key}`}
                        className="h-9"
                        value={row.identifier}
                        maxLength={SPLIT_IDENTIFIER_MAX}
                        readOnly={!canManage}
                        disabled={saving}
                        aria-describedby={noteId}
                        onChange={(event) => edit(row.key, { identifier: event.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={`${headingId}-d${row.key}`} className="text-xs font-medium text-gray-900">
                      {t("settings.splitClasses.description")}
                    </label>
                    <ModalTextarea
                      id={`${headingId}-d${row.key}`}
                      className="min-h-16 text-xs"
                      rows={3}
                      value={row.description}
                      maxLength={SPLIT_DESCRIPTION_MAX}
                      readOnly={!canManage}
                      disabled={saving}
                      aria-describedby={noteId}
                      onChange={(event) => edit(row.key, { description: event.target.value })}
                    />
                  </div>
                </li>
              ))}
            </ol>
            <SettingsRow layout="stacked">
              {/* Description and identifier also go to LandingAI: no client data in them. */}
              <p id={noteId} className="text-xs text-gray-600">
                {t("settings.splitClasses.noClientData")}
              </p>
              <p className="text-xs text-gray-500">{t("settings.splitClasses.count", { count: draft.length, max })}</p>
              {problem ? (
                <p role="alert" className="text-xs text-red-700">
                  {t(`settings.splitClasses.problem.${problem}`, { max })}
                </p>
              ) : null}
              {canManage ? (
                <div className="flex flex-wrap items-center gap-2">
                  <TextButtonUI
                    size="sm"
                    type="button"
                    disabled={saving || draft.length >= max}
                    onClick={() =>
                      setDraft((rows) => [...rows, { key: nextKey.current++, name: "", description: "", identifier: "" }])
                    }
                  >
                    <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                    {t("settings.splitClasses.add")}
                  </TextButtonUI>
                  <TextButtonUI
                    size="sm"
                    type="button"
                    disabled={saving || isBuiltIn(draft, settings.defaults)}
                    onClick={() => setDraft(draftFrom(settings.defaults, nextKey.current += settings.defaults.length))}
                  >
                    <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                    {t("settings.splitClasses.restore")}
                  </TextButtonUI>
                  <PillButtonUI
                    type="button"
                    tone="black"
                    size="normal"
                    className="ml-auto"
                    disabled={!!problem || !changed || saving}
                    aria-busy={saving}
                    onClick={() => void persist(isBuiltIn(draft, settings.defaults))}
                  >
                    {saving ? t("settings.splitClasses.saving") : t("settings.splitClasses.save")}
                  </PillButtonUI>
                </div>
              ) : null}
            </SettingsRow>
          </>
        )}
      </GlassCardUI>
    </section>
  );
}
