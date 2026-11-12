"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import {
  getSubagentRoutes,
  updateSubagentRoutes,
  type SubagentRoute,
  type SubagentRoutes,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import {
  REASONING_LEVELS,
  type ModelToggleOption,
  type ReasoningLevel,
} from "@mike/ui";
import { GlassCardUI } from "@mike/ui";
import { PillButtonUI } from "@mike/ui";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { SETTINGS_CONTROL_CLASS } from "@/app/components/settings/SettingsTextInput";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { useLocale, useTranslations } from "next-intl";

/** Mirrors the backend's checks (lib/subagentRoutes.ts); the server has the last word. */
const MAX_ROUTES = 8;
const NAME_PATTERN = /^[a-z0-9-]{1,32}$/;
const MAX_DESCRIPTION = 200;

const REASONING_LABEL_KEYS = {
  none: "settings.subagentRoutesSection.reasoning.none",
  low: "settings.subagentRoutesSection.reasoning.low",
  medium: "settings.subagentRoutesSection.reasoning.medium",
  high: "settings.subagentRoutesSection.reasoning.high",
  xhigh: "settings.subagentRoutesSection.reasoning.xhigh",
  max: "settings.subagentRoutesSection.reasoning.max",
} as const satisfies Record<ReasoningLevel, string>;

type Draft = { name: string; description: string; model: string; reasoning: string };
const EMPTY_DRAFT: Draft = { name: "", description: "", model: "", reasoning: "" };

/**
 * LiTT: the named routes chat subagents may run on, after the `model_map`
 * mode of the Hermes advanced-delegation plugin. The assistant sees only
 * each route's name and description; the user sees which provider, model
 * and reasoning it runs on.
 */
export function SubagentRoutesSection({
  models,
  modelPicker,
}: {
  /** Models the user can run now: those with a connected key. */
  models: ModelToggleOption[];
  /** Renders the model selector for the route being edited. */
  modelPicker: (value: string, onChange: (id: string) => void) => ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [saved, setSaved] = useState<SubagentRoutes | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  /** null: no editor; -1: a new route; otherwise the index being edited. */
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getSubagentRoutes(controller.signal)
      .then((routes) => {
        if (!controller.signal.aborted) setSaved(routes);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadFailed(true);
        notifyError(error, {
          action: t("settings.subagentRoutesSection.actions.loadTheSubagentRoutes"),
          onRetry: () => {
            setLoadFailed(false);
            setLoadAttempt((n) => n + 1);
          },
        });
      });
    return () => controller.abort();
  }, [loadAttempt, t]);

  const save = async (next: SubagentRoutes, action: string): Promise<boolean> => {
    setSaving(true);
    try {
      setSaved(await updateSubagentRoutes(next));
      return true;
    } catch (error) {
      notifyError(error, { action, onRetry: () => void save(next, action) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return (
      <GlassCardUI>
        <SettingsRow layout="stacked">
          <SettingsDescription>
            {t("settings.subagentRoutesSection.noSePudieronCargarLasRutas")}
          </SettingsDescription>
        </SettingsRow>
      </GlassCardUI>
    );
  }

  if (!saved) {
    return (
      <GlassCardUI>
        <SettingsRow layout="stacked">
          <div className="w-full space-y-2" aria-label={t("settings.subagentRoutesSection.cargandoRutas")}>
            <SkeletonLine className="h-3 w-24" />
            <SkeletonLine className="h-3 w-3/4" />
            <SkeletonLine className="h-3 w-1/2" />
          </div>
        </SettingsRow>
      </GlassCardUI>
    );
  }

  const describe = (route: SubagentRoute) => {
    const model = models.find((m) => m.id === route.model);
    const level = REASONING_LEVELS.find((l) => l === route.reasoning);
    const reasoning = level
      ? t("settings.subagentRoutesSection.reasoningWithLevel", {
          level: t(REASONING_LABEL_KEYS[level]).toLocaleLowerCase(locale),
        })
      : t("settings.subagentRoutesSection.reasoningByTask");
    if (route.unavailable) {
      return t("settings.subagentRoutesSection.routeUnavailable", { model: route.model, reasoning });
    }
    return model
      ? t("settings.subagentRoutesSection.routeSummary", { group: model.group, label: model.label, reasoning })
      : t("settings.subagentRoutesSection.routeNoKey", { model: route.model, reasoning });
  };

  const openEditor = (index: number) => {
    const route = saved.routes[index];
    setDraft(
      route
        ? {
            name: route.name,
            description: route.description,
            model: route.model,
            reasoning: route.reasoning ?? "",
          }
        : EMPTY_DRAFT,
    );
    setDraftError(null);
    setEditing(index);
  };

  const submitDraft = async () => {
    const name = draft.name.trim();
    const description = draft.description.trim();
    const others = saved.routes.filter((_, i) => i !== editing);
    const problem = !NAME_PATTERN.test(name)
      ? t("settings.subagentRoutesSection.problem.nameRules")
      : others.some((r) => r.name === name)
        ? t("settings.subagentRoutesSection.problem.nameTaken")
        : !description || description.includes("\n")
          ? t("settings.subagentRoutesSection.problem.descriptionRequired")
          : description.length > MAX_DESCRIPTION
            ? t("settings.subagentRoutesSection.problem.descriptionTooLong", { max: MAX_DESCRIPTION })
            : !draft.model
              ? t("settings.subagentRoutesSection.problem.chooseAModel")
              : null;
    if (problem) {
      setDraftError(problem);
      return;
    }
    const route: SubagentRoute = {
      name,
      description,
      model: draft.model,
      ...(draft.reasoning ? { reasoning: draft.reasoning } : {}),
    };
    const previousName = editing !== null ? saved.routes[editing]?.name : undefined;
    const routes =
      editing === -1 || editing === null
        ? [...saved.routes, route]
        : saved.routes.map((r, i) => (i === editing ? route : r));
    const nextDefault =
      saved.default && saved.default === previousName ? name : saved.default;
    if (await save({ routes, default: nextDefault }, t("settings.subagentRoutesSection.actions.saveTheSubagentRoute"))) {
      setEditing(null);
    }
  };

  const remove = (index: number) => {
    const name = saved.routes[index].name;
    void save(
      {
        routes: saved.routes.filter((_, i) => i !== index),
        default: saved.default === name ? null : saved.default,
      },
      t("settings.subagentRoutesSection.actions.deleteTheSubagentRoute"),
    );
  };

  const defaultChoices: { value: string | null; label: string }[] = [
    { value: null, label: t("settings.subagentRoutesSection.ningunaUsanElModeloDeLa") },
    ...saved.routes.map((r) => ({
      value: r.name,
      label: r.unavailable ? t("settings.subagentRoutesSection.nameNoDisponible", { name: r.name }) : r.name,
    })),
  ];

  return (
    <GlassCardUI>
      <SettingsRow layout="stacked">
        <div className="space-y-1">
          <SettingsLabel>{t("settings.subagentRoutesSection.rutas")}</SettingsLabel>
          <SettingsDescription>
            {t("settings.subagentRoutesSection.littEligeUnaRutaPorSu")}
          </SettingsDescription>
        </div>
        {saved.routes.length > 0 ? (
          <ul className="w-full space-y-2">
            {saved.routes.map((route, index) => (
              <li
                key={route.name}
                className="flex flex-wrap items-start justify-between gap-2"
              >
                <div className="min-w-0 flex-1 space-y-0.5 break-words">
                  <p className="text-sm font-medium text-gray-900">{route.name}</p>
                  <p className="text-sm text-gray-600">{route.description}</p>
                  <p className="text-xs text-gray-500">{describe(route)}</p>
                </div>
                <div className="flex gap-1">
                  <PillButtonUI
                    type="button"
                    tone="white"
                    size="icon-xs"
                    aria-label={t("settings.subagentRoutesSection.editarLaRutaName", { name: route.name })}
                    disabled={saving}
                    onClick={() => openEditor(index)}
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                  </PillButtonUI>
                  <PillButtonUI
                    type="button"
                    tone="white"
                    size="icon-xs"
                    aria-label={t("settings.subagentRoutesSection.borrarLaRutaName", { name: route.name })}
                    disabled={saving}
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </PillButtonUI>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <SettingsDescription>
            {t("settings.subagentRoutesSection.sinRutasLosSubagentesUsanEl")}
          </SettingsDescription>
        )}
        {editing === null && saved.routes.length < MAX_ROUTES && (
          <PillButtonUI
            type="button"
            tone="white"
            size="sm"
            disabled={saving}
            onClick={() => openEditor(-1)}
          >
            <Plus className="h-3 w-3" aria-hidden />
            {t("settings.subagentRoutesSection.agregarRuta")}
          </PillButtonUI>
        )}
      </SettingsRow>

      {editing !== null && (
        <SettingsRow layout="stacked">
          <form
            className="w-full space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitDraft();
            }}
          >
            <label className="block space-y-1">
              <SettingsLabel>{t("settings.subagentRoutesSection.nombre")}</SettingsLabel>
              <input
                className={SETTINGS_CONTROL_CLASS}
                value={draft.name}
                maxLength={32}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="block space-y-1">
              <SettingsLabel>{t("settings.subagentRoutesSection.descripcion")}</SettingsLabel>
              <input
                className={SETTINGS_CONTROL_CLASS}
                value={draft.description}
                maxLength={MAX_DESCRIPTION}
                placeholder={t("settings.subagentRoutesSection.paraQueSirveEnUnaLinea")}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <div className="space-y-1">
              <SettingsLabel>{t("settings.subagentRoutesSection.modelo")}</SettingsLabel>
              {modelPicker(draft.model, (model) => setDraft({ ...draft, model }))}
            </div>
            <label className="block space-y-1">
              <SettingsLabel>{t("settings.subagentRoutesSection.razonamiento")}</SettingsLabel>
              <select
                className={SETTINGS_CONTROL_CLASS}
                value={draft.reasoning}
                onChange={(e) => setDraft({ ...draft, reasoning: e.target.value })}
              >
                <option value="">{t("settings.subagentRoutesSection.segunLaTarea")}</option>
                {REASONING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(REASONING_LABEL_KEYS[level])}
                  </option>
                ))}
              </select>
            </label>
            {draftError && (
              <p role="alert" className="text-sm text-red-600">
                {draftError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <PillButtonUI type="submit" tone="black" size="sm" loading={saving}>
                {t("settings.subagentRoutesSection.guardarRuta")}
              </PillButtonUI>
              <PillButtonUI
                type="button"
                tone="white"
                size="sm"
                disabled={saving}
                onClick={() => setEditing(null)}
              >
                {t("settings.subagentRoutesSection.cancelar")}
              </PillButtonUI>
            </div>
          </form>
        </SettingsRow>
      )}

      <SettingsRow layout="stacked">
        <div className="space-y-1">
          <SettingsLabel>{t("settings.subagentRoutesSection.rutaPredeterminada")}</SettingsLabel>
          <SettingsDescription>
            {t("settings.subagentRoutesSection.laQueUsaUnSubagenteCuando")}
          </SettingsDescription>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("settings.subagentRoutesSection.rutaPredeterminada")}>
          {defaultChoices.map((choice) => {
            const selected = saved.default === choice.value;
            return (
              <PillButtonUI
                key={choice.value ?? "none"}
                type="button"
                tone={selected ? "black" : "white"}
                size="sm"
                aria-pressed={selected}
                disabled={saving}
                onClick={() =>
                  !selected &&
                  void save(
                    { routes: saved.routes, default: choice.value },
                    t("settings.subagentRoutesSection.actions.changeTheDefaultSubagentRoute"),
                  )
                }
              >
                {selected && <Check className="h-3 w-3" aria-hidden />}
                {choice.label}
              </PillButtonUI>
            );
          })}
        </div>
      </SettingsRow>
    </GlassCardUI>
  );
}
