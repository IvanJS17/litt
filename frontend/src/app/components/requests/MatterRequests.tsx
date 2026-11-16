"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import type {
  MatterRequest,
  MatterRequestDetail,
  MatterRequestInput,
  MatterRequestList,
} from "@mike/contracts";
import { EmptyState } from "@/app/components/ui/empty-state";
import { LIQUID_SUBTLE_PANEL_SURFACE_CLASS } from "@/app/components/ui/liquid-surface";
import {
  createMatterRequest,
  getMatterRequest,
  listMatterRequests,
  setMatterRetainer,
} from "@/app/lib/mikeApi";
import { errorCode, notifyError } from "@/app/lib/userFacingError";
import { RequestDetail } from "./RequestDetail";
import { RequestForm } from "./RequestForm";
import { SELECT_CLASS, useRequestWords } from "./requestFields";
import { isFinished, rowOf } from "./requestOptions";

type StateFilter = "all" | "open" | "finished";

/**
 * The requests of a retainer matter (docs/matter-requests.md): what each one
 * is, who has it and where it stands, with the negotiation rounds inside it.
 * It states dates and a round count, never hours.
 */
export function MatterRequests({ projectId, matterId }: { projectId: string; matterId: string }) {
  const t = useTranslations();
  const format = useFormatter();
  const words = useRequestWords();
  const [data, setData] = useState<MatterRequestList | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<StateFilter>("all");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<MatterRequestDetail | null>(null);
  const [retainerBusy, setRetainerBusy] = useState(false);
  const [retainerBlocked, setRetainerBlocked] = useState(false);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  useEffect(() => {
    let current = true;
    setData(null);
    setLoadFailed(false);
    setSelected(null);
    listMatterRequests(projectId, matterId).then(
      (next) => {
        if (current) setData(next);
      },
      (error) => {
        if (!current) return;
        setLoadFailed(true);
        notifyError(error, { action: tRef.current("requests.couldNotLoad") });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, matterId, reload]);

  // The list row follows the detail the server just answered.
  const refreshRow = useCallback((detail: MatterRequestDetail) => {
    const row = rowOf(detail);
    setSelected(detail);
    setData((current) =>
      current
        ? {
            ...current,
            requests: current.requests.map((request) => (request.id === row.id ? row : request)),
          }
        : current,
    );
  }, []);

  async function open(request: MatterRequest) {
    try {
      setSelected(await getMatterRequest(projectId, matterId, request.id));
      setCreating(false);
    } catch (error) {
      notifyError(error, { action: t("requests.couldNotOpen") });
    }
  }

  async function create(input: MatterRequestInput) {
    setSaving(true);
    try {
      const created = await createMatterRequest(projectId, matterId, input);
      setData((current) => (current ? { ...current, requests: [rowOf(created), ...current.requests] } : current));
      setSelected(created);
      setCreating(false);
    } catch (error) {
      notifyError(error, { action: t("requests.couldNotCreate") });
    } finally {
      setSaving(false);
    }
  }

  async function changeRetainer(next: boolean) {
    setRetainerBusy(true);
    setRetainerBlocked(false);
    try {
      await setMatterRetainer(projectId, matterId, next);
      setReload((value) => value + 1);
    } catch (error) {
      if (errorCode(error) === "retainer_has_requests") setRetainerBlocked(true);
      else notifyError(error, { action: t("requests.retainer.couldNotChange") });
    } finally {
      setRetainerBusy(false);
    }
  }

  const visible = (data?.requests ?? []).filter((request) =>
    filter === "all" ? true : filter === "finished" ? isFinished(request.status) : !isFinished(request.status),
  );
  const typeOf = (typeId: string) => data?.types.find((type) => type.id === typeId);
  const assigneeOf = (userId: string | null) => data?.assignees.find((person) => person.user_id === userId);
  const day = (value: string) => format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });

  return (
    <main className="min-h-full px-4 py-6 md:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="space-y-2">
          <Link
            href={`/projects/${encodeURIComponent(projectId)}`}
            className="inline-block rounded text-xs text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t("requests.backToMatter")}
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-serif text-2xl text-gray-900">{t("requests.title")}</h1>
              <p className="mt-1 text-sm text-gray-600">{t("requests.subtitle")}</p>
            </div>
            {data?.retainer && data.can_write ? (
              <PillButtonUI
                type="button"
                tone="black"
                size="normal"
                className="pointer-coarse:min-h-11"
                onClick={() => {
                  setCreating(true);
                  setSelected(null);
                }}
              >
                {t("requests.new")}
              </PillButtonUI>
            ) : null}
          </div>
        </header>

        {loadFailed ? (
          <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} space-y-3 p-5`} role="alert">
            <p className="text-sm text-red-700">{t("requests.couldNotLoad")}</p>
            <PillButtonUI type="button" tone="white" size="sm" onClick={() => setReload((value) => value + 1)}>
              {t("requests.retry")}
            </PillButtonUI>
          </section>
        ) : !data ? (
          <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} space-y-3 p-5`} aria-busy="true" aria-label={t("requests.loading")}>
            {[0, 1, 2].map((row) => (
              <div key={row} className="space-y-2" aria-hidden="true">
                <div className="h-4 w-2/3 animate-pulse rounded bg-app-surface" />
                <div className="h-3 w-full animate-pulse rounded bg-app-surface" />
              </div>
            ))}
          </section>
        ) : !data.retainer ? (
          <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} p-5 md:p-6`}>
            <EmptyState
              icon={<ClipboardList />}
              title={t("requests.retainer.offTitle")}
              description={
                data.can_manage_retainer ? t("requests.retainer.offOwner") : t("requests.retainer.offMember")
              }
              action={
                data.can_manage_retainer ? (
                  <PillButtonUI
                    type="button"
                    tone="black"
                    size="normal"
                    disabled={retainerBusy}
                    aria-busy={retainerBusy}
                    onClick={() => void changeRetainer(true)}
                  >
                    {t("requests.retainer.mark")}
                  </PillButtonUI>
                ) : undefined
              }
            />
          </section>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} min-w-0 space-y-3 p-4 md:p-5`} aria-label={t("requests.list.label")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="requests-filter" className="text-xs font-medium text-gray-900">
                  {t("requests.list.show")}
                </label>
                <select
                  id="requests-filter"
                  className={`${SELECT_CLASS} w-auto`}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as StateFilter)}
                >
                  <option value="all">{t("requests.list.all")}</option>
                  <option value="open">{t("requests.list.open")}</option>
                  <option value="finished">{t("requests.list.finished")}</option>
                </select>
              </div>
              {visible.length === 0 ? (
                <EmptyState
                  icon={<ClipboardList />}
                  title={t("requests.list.emptyTitle")}
                  description={data.can_write ? t("requests.list.emptyWrite") : t("requests.list.emptyRead")}
                />
              ) : (
                <ul className="space-y-1">
                  {visible.map((request) => {
                    const type = typeOf(request.type_id);
                    const person = assigneeOf(request.assignee_user_id);
                    const active = selected?.id === request.id;
                    return (
                      <li key={request.id}>
                        <button
                          type="button"
                          aria-current={active ? "true" : undefined}
                          onClick={() => void open(request)}
                          className={`w-full min-w-0 rounded-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                            active ? "bg-app-surface" : "hover:bg-app-surface"
                          }`}
                        >
                          <span className="block break-words text-sm font-medium text-gray-900">{request.title}</span>
                          <span className="mt-0.5 block break-words text-xs text-gray-600">
                            {[
                              type ? words.type(type) : null,
                              words.complexity(request.complexity),
                              words.status(request.status),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          <span className="mt-0.5 block break-words text-xs text-gray-500">
                            {[
                              request.assignee_user_id
                                ? t("requests.list.assignedTo", {
                                    name: words.person(person),
                                    level: words.level(request.assignee_level ?? "junior"),
                                  })
                                : t("requests.fields.unassigned"),
                              t("requests.rounds.count", { count: request.round_count }),
                              day(request.received_on),
                            ].join(" · ")}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {data.can_manage_retainer ? (
                <div className="space-y-1 border-t border-gray-200/70 pt-3">
                  <TextButtonUI
                    type="button"
                    size="sm"
                    className="pointer-coarse:min-h-11"
                    disabled={retainerBusy}
                    onClick={() => void changeRetainer(false)}
                  >
                    {t("requests.retainer.unmark")}
                  </TextButtonUI>
                  {retainerBlocked ? (
                    <p role="alert" className="text-xs text-red-700">
                      {t("requests.retainer.hasRequests")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} min-w-0 p-4 md:p-5`}>
              {creating ? (
                <RequestForm
                  types={data.types}
                  assignees={data.assignees}
                  saving={saving}
                  onSubmit={(input) => void create(input)}
                  onCancel={() => setCreating(false)}
                />
              ) : selected ? (
                <RequestDetail
                  key={selected.id}
                  projectId={projectId}
                  matterId={matterId}
                  request={selected}
                  types={data.types}
                  assignees={data.assignees}
                  canWrite={data.can_write}
                  onChanged={refreshRow}
                  onStale={() => {
                    void getMatterRequest(projectId, matterId, selected.id).then(refreshRow, () => undefined);
                  }}
                />
              ) : (
                <p className="text-sm text-gray-600">{t("requests.detail.pick")}</p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

export default MatterRequests;
