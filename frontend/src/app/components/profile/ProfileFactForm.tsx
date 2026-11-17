"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import type { ProfileFactInput, ProfileFactKind, ProfileSourceVersion } from "@mike/contracts";
import { FORM_CONTROL_GLASS_CLASS, FormTextInput } from "@/app/components/ui/form-field";
import { Field, SELECT_CLASS } from "@/app/components/requests/requestFields";
import {
  DAY_TYPES,
  DATE_KINDS,
  dataOf,
  FACT_KINDS,
  FIELDS,
  fieldWord,
  isDraftReady,
  LABEL_MAX,
  QUOTE_MAX,
  type FactDraft,
  type FormErrorKey,
} from "./profileOptions";

const AREA_CLASS = `${FORM_CONTROL_GLASS_CLASS} min-h-24 py-2`;

/**
 * The form that adds a fact: what it is, its fields and the passage of a
 * document version that backs it. The server looks the passage up in the
 * version's text and saves nothing if it is not there; `errorKey` is its
 * answer, shown next to the quote so the lawyer can fix it and try again.
 */
export function ProfileFactForm({
  versions,
  saving,
  errorKey,
  onSubmit,
  onCancel,
}: {
  versions: ProfileSourceVersion[];
  saving: boolean;
  /** The last refusal of the citation, if any. */
  errorKey: FormErrorKey | null;
  onSubmit: (input: ProfileFactInput) => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const id = useId();
  const [kind, setKind] = useState<ProfileFactKind>("contract");
  const [label, setLabel] = useState("");
  const [draft, setDraft] = useState<FactDraft>({ date_kind: "expiry", notice_day_type: "calendar" });
  const [versionId, setVersionId] = useState("");
  const [quote, setQuote] = useState("");
  const set = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const ready = isDraftReady(kind, draft, label) && versionId !== "" && quote.trim() !== "";

  return (
    <form
      aria-label={t("clientProfile.form.title")}
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || saving) return;
        onSubmit({
          kind,
          label: label.trim(),
          data: dataOf(kind, draft),
          source: { version_id: versionId, quote },
        });
      }}
    >
      <h2 className="font-serif text-lg text-gray-900">{t("clientProfile.form.title")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-kind`} label={t("clientProfile.form.kind")}>
          <select
            id={`${id}-kind`}
            className={SELECT_CLASS}
            value={kind}
            disabled={saving}
            onChange={(event) => setKind(event.target.value as ProfileFactKind)}
          >
            {FACT_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`clientProfile.kind.${value}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-label`} label={t("clientProfile.fields.label")}>
          <FormTextInput
            id={`${id}-label`}
            value={label}
            maxLength={LABEL_MAX}
            disabled={saving}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {kind === "date" ? (
          <>
            <Field id={`${id}-date_kind`} label={t("clientProfile.fields.dateKind")}>
              <select
                id={`${id}-date_kind`}
                className={SELECT_CLASS}
                value={draft.date_kind}
                disabled={saving}
                onChange={(event) => set("date_kind", event.target.value)}
              >
                {DATE_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {t(`clientProfile.dateKind.${value}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-date_on`} label={t("clientProfile.fields.dateOn")}>
              <FormTextInput
                id={`${id}-date_on`}
                type="date"
                value={draft.date_on ?? ""}
                disabled={saving}
                onChange={(event) => set("date_on", event.target.value)}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field id={`${id}-rule_text`} label={t("clientProfile.fields.ruleText")}>
                <FormTextInput
                  id={`${id}-rule_text`}
                  value={draft.rule_text ?? ""}
                  maxLength={300}
                  disabled={saving}
                  onChange={(event) => set("rule_text", event.target.value)}
                />
              </Field>
            </div>
            <Field id={`${id}-notice_days`} label={t("clientProfile.fields.noticeDays")}>
              <FormTextInput
                id={`${id}-notice_days`}
                type="number"
                min={0}
                max={3650}
                step={1}
                value={draft.notice_days ?? ""}
                disabled={saving}
                onChange={(event) => set("notice_days", event.target.value)}
              />
            </Field>
            <Field id={`${id}-notice_day_type`} label={t("clientProfile.fields.noticeDayType")}>
              <select
                id={`${id}-notice_day_type`}
                className={SELECT_CLASS}
                value={draft.notice_day_type}
                disabled={saving || (draft.notice_days ?? "") === ""}
                onChange={(event) => set("notice_day_type", event.target.value)}
              >
                {DAY_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {t(`clientProfile.dayType.${value}`)}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          FIELDS[kind].map((field) => (
            <div key={field.key} className={field.kind === "area" ? "sm:col-span-2" : undefined}>
              <Field id={`${id}-${field.key}`} label={t(`clientProfile.fields.${fieldWord(field.key)}`)}>
                {field.kind === "area" ? (
                  <textarea
                    id={`${id}-${field.key}`}
                    className={AREA_CLASS}
                    value={draft[field.key] ?? ""}
                    maxLength={field.max}
                    disabled={saving}
                    onChange={(event) => set(field.key, event.target.value)}
                  />
                ) : (
                  <FormTextInput
                    id={`${id}-${field.key}`}
                    type={field.kind === "date" ? "date" : "text"}
                    value={draft[field.key] ?? ""}
                    maxLength={field.max}
                    disabled={saving}
                    onChange={(event) => set(field.key, event.target.value)}
                  />
                )}
              </Field>
            </div>
          ))
        )}
      </div>

      <div className="space-y-3 border-t border-gray-200/70 pt-3">
        <Field id={`${id}-version`} label={t("clientProfile.form.version")}>
          {versions.length === 0 ? (
            <p id={`${id}-version`} className="text-sm text-gray-600">
              {t("clientProfile.form.noVersions")}
            </p>
          ) : (
            <select
              id={`${id}-version`}
              className={SELECT_CLASS}
              value={versionId}
              disabled={saving}
              onChange={(event) => setVersionId(event.target.value)}
            >
              <option value="">{t("clientProfile.form.chooseVersion")}</option>
              {versions.map((version) => (
                <option key={version.version_id} value={version.version_id}>
                  {t("clientProfile.form.versionOption", {
                    name: version.filename ?? version.document_id,
                    version: version.version_number ?? "–",
                  })}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id={`${id}-quote`} label={t("clientProfile.form.quote")}>
          <textarea
            id={`${id}-quote`}
            className={AREA_CLASS}
            value={quote}
            maxLength={QUOTE_MAX}
            disabled={saving}
            aria-describedby={`${id}-quote-help`}
            aria-invalid={errorKey ? true : undefined}
            onChange={(event) => setQuote(event.target.value)}
          />
        </Field>
        <p id={`${id}-quote-help`} className="text-xs text-gray-500">
          {t("clientProfile.form.quoteHelp")}
        </p>
        {errorKey ? (
          <p role="alert" className="text-sm text-red-700">
            {t(`clientProfile.form.${errorKey}`)}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <TextButtonUI type="button" size="sm" className="pointer-coarse:min-h-11" disabled={saving} onClick={onCancel}>
          {t("clientProfile.form.cancel")}
        </TextButtonUI>
        <PillButtonUI
          type="submit"
          tone="black"
          size="normal"
          className="pointer-coarse:min-h-11"
          disabled={!ready || saving}
          aria-busy={saving}
        >
          {saving ? t("clientProfile.form.saving") : t("clientProfile.form.submit")}
        </PillButtonUI>
      </div>
    </form>
  );
}
