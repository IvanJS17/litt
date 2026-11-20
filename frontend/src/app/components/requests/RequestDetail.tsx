"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import type {
  MatterRequestAssignee,
  MatterRequestDetail,
  MatterRequestLevel,
  MatterRequestPatch,
  MatterRequestType,
} from "@mike/contracts";
import { FormTextInput } from "@/app/components/ui/form-field";
import type { Document } from "@/app/components/shared/types";
import {
  getMatterRequest,
  getProject,
  linkMatterRequestRound,
  listDocumentVersions,
  type DocumentVersion,
  unlinkMatterRequestRound,
  updateMatterRequest,
} from "@/app/lib/mikeApi";
import { errorCode, notifyError } from "@/app/lib/userFacingError";
import {
  AssigneeFields,
  ComplexitySelect,
  Field,
  SELECT_CLASS,
  StatusSelect,
  TypeSelect,
} from "./requestFields";
import { TITLE_MAX } from "./requestOptions";
import { TriageCard } from "./TriageCard";

type Props = {
  projectId: string;
  matterId: string;
  request: MatterRequestDetail;
  types: MatterRequestType[];
  assignees: MatterRequestAssignee[];
  canWrite: boolean;
  /** The server's answer after any change, so the list and the detail agree. */
  onChanged: (next: MatterRequestDetail) => void;
  /** Another change came first: read the request again. */
  onStale: () => void;
};

/** An ISO date (no time) shown without shifting a day across time zones. */
function useDateOnly() {
  const format = useFormatter();
  return (value: string) =>
    format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
}

export function RequestDetail({ projectId, matterId, request, types, assignees, canWrite, onChanged, onStale }: Props) {
  const t = useTranslations();
  const format = useFormatter();
  const dateOnly = useDateOnly();
  const id = useId();
  const [draft, setDraft] = useState(() => draftOf(request));
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });
  // A newer answer from the server (a save, a reload) is the new starting point.
  const seen = useRef(request.version);
  useEffect(() => {
    if (seen.current !== request.version) {
      seen.current = request.version;
      setDraft(draftOf(request));
    }
  }, [request]);

  const patch = patchOf(request, draft);
  const levelMissing = draft.assigneeUserId !== "" && draft.assigneeLevel === "";
  const titleMissing = draft.title.trim() === "";
  const canSave = canWrite && !saving && Object.keys(patch).length > 0 && !levelMissing && !titleMissing;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setConflict(false);
    try {
      onChanged(await updateMatterRequest(projectId, matterId, request.id, { ...patch, version: request.version }));
    } catch (error) {
      if (errorCode(error) === "request_version_conflict") {
        setConflict(true);
        onStale();
      } else notifyError(error, { action: tRef.current("requests.detail.couldNotSave") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <article aria-label={request.title} className="min-w-0 space-y-6">
      <section aria-labelledby={`${id}-fields`} className="space-y-4">
        <h2 id={`${id}-fields`} className="break-words font-serif text-lg text-gray-900">
          {request.title}
        </h2>
        <p className="text-sm text-gray-600">
          {request.closed_on
            ? t("requests.detail.datesClosed", { received: dateOnly(request.received_on), closed: dateOnly(request.closed_on) })
            : t("requests.detail.datesOpen", { received: dateOnly(request.received_on) })}
        </p>
        <Field id={`${id}-title`} label={t("requests.fields.title")}>
          <FormTextInput
            id={`${id}-title`}
            value={draft.title}
            maxLength={TITLE_MAX}
            readOnly={!canWrite}
            disabled={saving}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${id}-type`} label={t("requests.fields.type")}>
            <TypeSelect
              id={`${id}-type`}
              value={draft.typeId}
              types={types}
              keepArchived={request.type_id}
              disabled={!canWrite || saving}
              onChange={(typeId) => setDraft({ ...draft, typeId })}
            />
          </Field>
          <Field id={`${id}-complexity`} label={t("requests.fields.complexity")}>
            <ComplexitySelect
              id={`${id}-complexity`}
              value={draft.complexity}
              disabled={!canWrite || saving}
              onChange={(complexity) => setDraft({ ...draft, complexity })}
            />
          </Field>
          <Field id={`${id}-status`} label={t("requests.fields.status")}>
            <StatusSelect
              id={`${id}-status`}
              value={draft.status}
              disabled={!canWrite || saving}
              onChange={(status) => setDraft({ ...draft, status })}
            />
          </Field>
          <AssigneeFields
            idPrefix={id}
            assignees={assignees}
            userId={draft.assigneeUserId}
            level={draft.assigneeLevel}
            keepUser={request.assignee_user_id}
            disabled={!canWrite || saving}
            onChange={({ userId, level }) => setDraft({ ...draft, assigneeUserId: userId, assigneeLevel: level })}
          />
        </div>
        {!canWrite ? <p className="text-xs text-gray-500">{t("requests.detail.readOnly")}</p> : null}
        {conflict ? (
          <p role="alert" className="text-sm text-red-700">
            {t("requests.detail.changedMeanwhile")}
          </p>
        ) : null}
        {canWrite ? (
          <div className="flex justify-end">
            <PillButtonUI
              type="button"
              tone="black"
              size="normal"
              className="pointer-coarse:min-h-11"
              disabled={!canSave}
              aria-busy={saving}
              onClick={() => void save()}
            >
              {saving ? t("requests.detail.saving") : t("requests.detail.save")}
            </PillButtonUI>
          </div>
        ) : null}
      </section>

      <TriageCard
        projectId={projectId}
        matterId={matterId}
        request={request}
        types={types}
        assignees={assignees}
        onChanged={onChanged}
        onStale={onStale}
      />

      <RoundsSection
        projectId={projectId}
        matterId={matterId}
        request={request}
        canWrite={canWrite}
        onChanged={onChanged}
        onStale={onStale}
      />

      <section aria-labelledby={`${id}-history`} className="space-y-2">
        <h3 id={`${id}-history`} className="text-sm font-medium text-gray-900">
          {t("requests.history.title")}
        </h3>
        <ol className="space-y-1">
          {request.events.map((event) => (
            <li key={event.id} className="break-words text-sm text-gray-600">
              {t(`requests.event.${event.action}`)}
              {" · "}
              {format.dateTime(new Date(event.created_at), { dateStyle: "medium", timeStyle: "short" })}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

type Draft = {
  title: string;
  typeId: string;
  complexity: MatterRequestDetail["complexity"];
  status: MatterRequestDetail["status"];
  assigneeUserId: string;
  assigneeLevel: MatterRequestLevel | "";
};

function draftOf(request: MatterRequestDetail): Draft {
  return {
    title: request.title,
    typeId: request.type_id,
    complexity: request.complexity,
    status: request.status,
    assigneeUserId: request.assignee_user_id ?? "",
    assigneeLevel: request.assignee_level ?? "",
  };
}

/** Only what changed: the server records one event per kind of change. */
function patchOf(request: MatterRequestDetail, draft: Draft): Omit<MatterRequestPatch, "version"> {
  const patch: Omit<MatterRequestPatch, "version"> = {};
  if (draft.title.trim() !== request.title) patch.title = draft.title.trim();
  if (draft.typeId !== request.type_id) patch.type_id = draft.typeId;
  if (draft.complexity !== request.complexity) patch.complexity = draft.complexity;
  if (draft.status !== request.status) patch.status = draft.status;
  if (draft.assigneeUserId !== (request.assignee_user_id ?? "") || draft.assigneeLevel !== (request.assignee_level ?? "")) {
    patch.assignee_user_id = draft.assigneeUserId || null;
    patch.assignee_level = draft.assigneeUserId ? (draft.assigneeLevel as MatterRequestLevel) : null;
  }
  return patch;
}

function RoundsSection({
  projectId,
  matterId,
  request,
  canWrite,
  onChanged,
  onStale,
}: Pick<Props, "projectId" | "matterId" | "request" | "canWrite" | "onChanged" | "onStale">) {
  const t = useTranslations();
  const dateOnly = useDateOnly();
  const id = useId();
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [documentId, setDocumentId] = useState("");
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [versionId, setVersionId] = useState("");
  const [roundNumber, setRoundNumber] = useState("");
  const [roundDate, setRoundDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  // The documents of the matter's project, read once the lawyer can link one.
  useEffect(() => {
    if (!canWrite) return;
    let current = true;
    getProject(projectId).then(
      (project) => {
        if (current) setDocuments((project.documents ?? []).filter((document) => document.status === "ready"));
      },
      (error) => {
        if (current) notifyError(error, { action: tRef.current("requests.rounds.couldNotLoadDocuments") });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, canWrite]);

  async function pickDocument(next: string) {
    setDocumentId(next);
    setVersionId("");
    setVersions([]);
    if (!next) return;
    try {
      const listed = await listDocumentVersions(next);
      setVersions(listed.versions.filter((version) => !version.deleted_at));
    } catch (error) {
      notifyError(error, { action: tRef.current("requests.rounds.couldNotLoadVersions") });
    }
  }

  async function reload(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setRepeat(false);
    try {
      await action();
      onChanged(await getMatterRequest(projectId, matterId, request.id));
    } catch (error) {
      const code = errorCode(error);
      if (code === "round_already_linked") setRepeat(true);
      else if (code === "request_version_conflict") onStale();
      else notifyError(error, { action: tRef.current("requests.rounds.couldNotSave") });
    } finally {
      setBusy(false);
    }
  }

  const link = () =>
    reload(async () => {
      await linkMatterRequestRound(projectId, matterId, request.id, {
        version_id: versionId,
        ...(roundNumber.trim() ? { round_number: Number(roundNumber) } : {}),
        ...(roundDate ? { round_date: roundDate } : {}),
      });
      setVersionId("");
      setRoundNumber("");
    });

  return (
    <section aria-labelledby={`${id}-rounds`} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 id={`${id}-rounds`} className="text-sm font-medium text-gray-900">
          {t("requests.rounds.title")}
        </h3>
        <p className="text-xs text-gray-600">{t("requests.rounds.count", { count: request.round_count })}</p>
      </div>
      {request.rounds.length === 0 ? (
        <p className="text-sm text-gray-600">{t("requests.rounds.none")}</p>
      ) : (
        <ul className="space-y-2">
          {request.rounds.map((round) => (
            <li key={round.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 break-words text-sm text-gray-900">
                {t("requests.rounds.row", {
                  number: round.round_number,
                  date: dateOnly(round.round_date),
                  name: round.filename ?? t("requests.rounds.unnamed"),
                  version: round.version_number ?? 0,
                })}
              </p>
              {canWrite ? (
                <TextButtonUI
                  type="button"
                  size="sm"
                  className="pointer-coarse:min-h-11"
                  disabled={busy}
                  onClick={() =>
                    void reload(() => unlinkMatterRequestRound(projectId, matterId, request.id, round.id))
                  }
                >
                  {t("requests.rounds.unlink")}
                </TextButtonUI>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${id}-document`} label={t("requests.rounds.document")}>
              <select
                id={`${id}-document`}
                className={SELECT_CLASS}
                value={documentId}
                disabled={busy || documents === null}
                onChange={(event) => void pickDocument(event.target.value)}
              >
                <option value="">{t("requests.rounds.chooseDocument")}</option>
                {(documents ?? []).map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.filename}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-version`} label={t("requests.rounds.version")}>
              <select
                id={`${id}-version`}
                className={SELECT_CLASS}
                value={versionId}
                disabled={busy || versions.length === 0}
                onChange={(event) => setVersionId(event.target.value)}
              >
                <option value="">{t("requests.rounds.chooseVersion")}</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {t("requests.rounds.versionOption", {
                      version: version.version_number ?? 0,
                      name: version.filename ?? t("requests.rounds.unnamed"),
                    })}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-number`} label={t("requests.rounds.number")}>
              <FormTextInput
                id={`${id}-number`}
                type="number"
                min={1}
                max={99}
                inputMode="numeric"
                value={roundNumber}
                placeholder={t("requests.rounds.numberNext")}
                disabled={busy}
                onChange={(event) => setRoundNumber(event.target.value)}
              />
            </Field>
            <Field id={`${id}-date`} label={t("requests.rounds.date")}>
              <FormTextInput
                id={`${id}-date`}
                type="date"
                value={roundDate}
                disabled={busy}
                onChange={(event) => setRoundDate(event.target.value)}
              />
            </Field>
          </div>
          {repeat ? (
            <p role="alert" className="text-sm text-red-700">
              {t("requests.rounds.alreadyLinked")}
            </p>
          ) : null}
          <div className="flex justify-end">
            <PillButtonUI
              type="button"
              tone="white"
              size="normal"
              className="pointer-coarse:min-h-11"
              disabled={busy || versionId === ""}
              aria-busy={busy}
              onClick={() => void link()}
            >
              {t("requests.rounds.link")}
            </PillButtonUI>
          </div>
        </div>
      ) : null}
    </section>
  );
}
