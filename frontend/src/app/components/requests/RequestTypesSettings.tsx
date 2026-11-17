"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI, TextButtonUI } from "@mike/ui";
import type { MatterRequestType, MatterRequestTypeList } from "@mike/contracts";
import { FormTextInput } from "@/app/components/ui/form-field";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import {
  createRequestType,
  listRequestTypes,
  updateRequestType,
} from "@/app/lib/mikeApi";
import { errorCode, notifyError } from "@/app/lib/userFacingError";
import { TYPE_NAME_MAX, typeName } from "./requestOptions";

/**
 * The firm's catalog of request types, in Ajustes del despacho > General. Every
 * member reads it; owners and admins add, rename and archive. A type that
 * requests already use is archived, never deleted, so those requests keep
 * their type.
 */
export function RequestTypesSettings({ orgId }: { orgId: string }) {
  const t = useTranslations();
  const headingId = useId();
  const inputId = useId();
  const [list, setList] = useState<MatterRequestTypeList | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nameTaken, setNameTaken] = useState(false);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  useEffect(() => {
    let current = true;
    Promise.resolve()
      .then(() => listRequestTypes(orgId))
      .then(
        (next) => {
          if (current) setList(next);
        },
        (error) => {
          if (!current) return;
          setFailed(true);
          notifyError(error, { action: tRef.current("requests.types.couldNotLoad") });
        },
      );
    return () => {
      current = false;
    };
  }, [orgId]);

  const seedLabel = (seed: NonNullable<MatterRequestType["seed_key"]>) => t(`requests.typeSeed.${seed}`);
  const canManage = list?.can_manage === true;

  const replace = (next: MatterRequestType) =>
    setList((current) =>
      current
        ? { ...current, types: current.types.map((type) => (type.id === next.id ? next : type)) }
        : current,
    );

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setNameTaken(false);
    try {
      await action();
    } catch (error) {
      if (errorCode(error) === "request_type_name_taken") setNameTaken(true);
      else notifyError(error, { action: tRef.current("requests.types.couldNotSave") });
    } finally {
      setBusy(false);
    }
  }

  const rename = (type: MatterRequestType) =>
    run(async () => {
      const name = (drafts[type.id] ?? "").trim();
      if (!name) return;
      replace(await updateRequestType(orgId, type.id, { name }));
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== type.id)));
    });
  const archive = (type: MatterRequestType) =>
    run(async () => replace(await updateRequestType(orgId, type.id, { archived: !type.archived })));
  const add = () =>
    run(async () => {
      const created = await createRequestType(orgId, newName.trim());
      setList((current) => (current ? { ...current, types: [...current.types, created] } : current));
      setNewName("");
    });

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <SettingsHeading id={headingId}>{t("requests.types.title")}</SettingsHeading>
      <GlassCardUI>
        <SettingsRow layout="stacked">
          <div className="min-w-0 space-y-1">
            <SettingsDescription>{t("requests.types.help")}</SettingsDescription>
            {list && !canManage ? (
              <SettingsDescription>{t("requests.types.readOnly")}</SettingsDescription>
            ) : null}
          </div>
        </SettingsRow>
        {failed ? (
          <SettingsRow layout="stacked">
            <p role="alert" className="text-sm text-red-700">
              {t("requests.types.couldNotLoad")}
            </p>
          </SettingsRow>
        ) : !list ? (
          <SettingsRow layout="stacked">
            <div className="h-24 animate-pulse rounded-xl bg-app-surface" aria-hidden="true" />
          </SettingsRow>
        ) : (
          <SettingsRow layout="stacked">
            <ul className="space-y-3" aria-label={t("requests.types.title")}>
              {list.types.map((type) => {
                const label = typeName(type, seedLabel);
                const draft = drafts[type.id] ?? label;
                const changed = draft.trim() !== label && draft.trim() !== "";
                return (
                  <li key={type.id} className="min-w-0 space-y-2">
                    {canManage ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <FormTextInput
                          aria-label={t("requests.types.nameOf", { name: label })}
                          className="min-w-0 flex-1 basis-56"
                          value={draft}
                          maxLength={TYPE_NAME_MAX}
                          disabled={busy}
                          onChange={(event) => setDrafts((current) => ({ ...current, [type.id]: event.target.value }))}
                        />
                        <TextButtonUI
                          type="button"
                          size="sm"
                          className="pointer-coarse:min-h-11"
                          disabled={busy || !changed}
                          onClick={() => void rename(type)}
                        >
                          {t("requests.types.rename")}
                        </TextButtonUI>
                        <TextButtonUI
                          type="button"
                          size="sm"
                          className="pointer-coarse:min-h-11"
                          disabled={busy}
                          onClick={() => void archive(type)}
                        >
                          {type.archived ? t("requests.types.restore") : t("requests.types.archive")}
                        </TextButtonUI>
                      </div>
                    ) : (
                      <p className="break-words text-sm text-gray-900">{label}</p>
                    )}
                    {type.archived ? (
                      <p className="text-xs text-gray-500">{t("requests.types.archivedNote")}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {nameTaken ? (
              <p role="alert" className="text-sm text-red-700">
                {t("requests.types.nameTaken")}
              </p>
            ) : null}
            {canManage ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1 basis-56 space-y-1">
                  <label htmlFor={inputId} className="block text-xs font-medium text-gray-900">
                    {t("requests.types.newLabel")}
                  </label>
                  <FormTextInput
                    id={inputId}
                    value={newName}
                    maxLength={TYPE_NAME_MAX}
                    disabled={busy}
                    onChange={(event) => setNewName(event.target.value)}
                  />
                </div>
                <PillButtonUI
                  type="button"
                  tone="black"
                  size="normal"
                  className="pointer-coarse:min-h-11"
                  disabled={busy || newName.trim() === ""}
                  onClick={() => void add()}
                >
                  {t("requests.types.add")}
                </PillButtonUI>
              </div>
            ) : null}
          </SettingsRow>
        )}
      </GlassCardUI>
    </section>
  );
}
