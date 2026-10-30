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
  REASONING_LEVEL_LABELS,
  type ModelToggleOption,
} from "@/shared/ui/ModelToggleUI";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { SETTINGS_CONTROL_CLASS } from "@/app/components/settings/SettingsTextInput";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";

/** Mirrors the backend's checks (lib/subagentRoutes.ts); the server has the last word. */
const MAX_ROUTES = 8;
const NAME_PATTERN = /^[a-z0-9-]{1,32}$/;
const MAX_DESCRIPTION = 200;

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
  const [saved, setSaved] = useState<SubagentRoutes | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  /** null: no editor; -1: a new route; otherwise the index being edited. */
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getSubagentRoutes(controller.signal)
      .then((routes) => {
        if (!controller.signal.aborted) setSaved(routes);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true);
      });
    return () => controller.abort();
  }, []);

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
            No se pudieron cargar las rutas de subagentes. Recarga la página para
            intentarlo de nuevo.
          </SettingsDescription>
        </SettingsRow>
      </GlassCardUI>
    );
  }

  if (!saved) {
    return (
      <GlassCardUI>
        <SettingsRow layout="stacked">
          <div className="w-full space-y-2" aria-label="Cargando rutas">
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
      ? `razonamiento ${REASONING_LEVEL_LABELS[level].toLocaleLowerCase("es")}`
      : "razonamiento según la tarea";
    return model
      ? `${model.group} · ${model.label} · ${reasoning}`
      : `${route.model} · sin llave conectada · ${reasoning}`;
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
      ? "El nombre solo admite minúsculas, números y guiones, hasta 32 caracteres."
      : others.some((r) => r.name === name)
        ? "Ya hay una ruta con ese nombre."
        : !description || description.includes("\n")
          ? "Escribe una descripción de una línea."
          : description.length > MAX_DESCRIPTION
            ? `La descripción admite hasta ${MAX_DESCRIPTION} caracteres.`
            : !draft.model
              ? "Elige un modelo."
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
    if (await save({ routes, default: nextDefault }, "save the subagent route")) {
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
      "delete the subagent route",
    );
  };

  const defaultChoices: { value: string | null; label: string }[] = [
    { value: null, label: "Ninguna: usan el modelo de la conversación" },
    ...saved.routes.map((r) => ({ value: r.name, label: r.name })),
  ];

  return (
    <GlassCardUI>
      <SettingsRow layout="stacked">
        <div className="space-y-1">
          <SettingsLabel>Rutas</SettingsLabel>
          <SettingsDescription>
            LiTT elige una ruta por su descripción; solo ve el nombre y la
            descripción, nunca el modelo. Si una ruta pierde su llave, el
            subagente no corre en otro modelo: falla y te avisa.
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
                    aria-label={`Editar la ruta ${route.name}`}
                    disabled={saving}
                    onClick={() => openEditor(index)}
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                  </PillButtonUI>
                  <PillButtonUI
                    type="button"
                    tone="white"
                    size="icon-xs"
                    aria-label={`Borrar la ruta ${route.name}`}
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
            Sin rutas, los subagentes usan el modelo de la conversación.
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
            Agregar ruta
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
              <SettingsLabel>Nombre</SettingsLabel>
              <input
                className={SETTINGS_CONTROL_CLASS}
                value={draft.name}
                maxLength={32}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="block space-y-1">
              <SettingsLabel>Descripción</SettingsLabel>
              <input
                className={SETTINGS_CONTROL_CLASS}
                value={draft.description}
                maxLength={MAX_DESCRIPTION}
                placeholder="Para qué sirve, en una línea"
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <div className="space-y-1">
              <SettingsLabel>Modelo</SettingsLabel>
              {modelPicker(draft.model, (model) => setDraft({ ...draft, model }))}
            </div>
            <label className="block space-y-1">
              <SettingsLabel>Razonamiento</SettingsLabel>
              <select
                className={SETTINGS_CONTROL_CLASS}
                value={draft.reasoning}
                onChange={(e) => setDraft({ ...draft, reasoning: e.target.value })}
              >
                <option value="">Según la tarea</option>
                {REASONING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {REASONING_LEVEL_LABELS[level]}
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
                Guardar ruta
              </PillButtonUI>
              <PillButtonUI
                type="button"
                tone="white"
                size="sm"
                disabled={saving}
                onClick={() => setEditing(null)}
              >
                Cancelar
              </PillButtonUI>
            </div>
          </form>
        </SettingsRow>
      )}

      <SettingsRow layout="stacked">
        <div className="space-y-1">
          <SettingsLabel>Ruta predeterminada</SettingsLabel>
          <SettingsDescription>
            La que usa un subagente cuando LiTT no elige ninguna.
          </SettingsDescription>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Ruta predeterminada">
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
                    "change the default subagent route",
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
