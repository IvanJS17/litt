"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { FieldLabel, FormTextInput } from "@/app/components/ui/form-field";
import { PillButtonUI as PillButton } from "@mike/ui";
import { LIQUID_SUBTLE_PANEL_SURFACE_CLASS } from "@/app/components/ui/liquid-surface";
import { errorCode } from "@/app/lib/userFacingError";
import {
  getMatterDriveFolder,
  isMfaRequiredError,
  updateMatterDriveFolder,
  type MatterDriveFolderRole,
  type MatterDriveFolderSettings,
} from "@/app/lib/mikeApi";
import { useTranslations } from "next-intl";
import type { NsTranslate } from "@/i18n/Translate";

const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const ROLES: ReadonlySet<MatterDriveFolderRole> = new Set([
  "matter_owner",
  "editor",
  "viewer",
  "technical_operator",
  "org_owner",
  "workspace_admin",
]);


function isMatterDriveFolderSettings(
  value: unknown,
  projectId: string,
  matterId: string,
): value is MatterDriveFolderSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const role = candidate.role;
  const folderId = candidate.drive_folder_id;
  return (
    candidate.project_id === projectId &&
    candidate.matter_id === matterId &&
    typeof role === "string" &&
    ROLES.has(role as MatterDriveFolderRole) &&
    typeof candidate.can_edit === "boolean" &&
    candidate.can_edit === (role === "matter_owner") &&
    (folderId === null ||
      (typeof folderId === "string" && FOLDER_ID_PATTERN.test(folderId)))
  );
}

function safeErrorMessage(error: unknown, fallback: string, t: NsTranslate<"recovery">) {
  if (isMfaRequiredError(error)) return t("recovery.mfaRequiredToSave");
  if (errorCode(error) === "invalid_drive_folder_id") {
    return t("recovery.folderIdNotValid");
  }
  return fallback;
}

function roleLabel(role: MatterDriveFolderRole, t: NsTranslate<"recovery">) {
  switch (role) {
    case "matter_owner":
      return t("recovery.roleMatterOwner");
    case "org_owner":
      return t("recovery.roleOrgOwner");
    case "workspace_admin":
      return t("recovery.roleWorkspaceAdmin");
    case "technical_operator":
      return t("recovery.roleTechnicalOperator");
    case "editor":
      return t("recovery.roleEditor");
    case "viewer":
      return t("recovery.roleViewer");
  }
}

export interface MatterDriveSettingsProps {
  projectId: string;
  matterId: string;
}

export function MatterDriveSettings({
  projectId,
  matterId,
}: MatterDriveSettingsProps) {
  const t = useTranslations();
  const [settings, setSettings] = useState<MatterDriveFolderSettings | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const generation = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    let active = true;
    setLoading(true);
    busyRef.current = false;
    setBusy(false);
    setSettings(null);
    setDraft("");
    setLoadError(null);
    setActionError(null);
    setSuccess(null);

    void getMatterDriveFolder(projectId, matterId)
      .then((result) => {
        if (!active || requestGeneration !== generation.current) return;
        if (!isMatterDriveFolderSettings(result, projectId, matterId)) {
          setLoadError(t("recovery.invalidServerResponse"));
          return;
        }
        setSettings(result);
        setDraft(result.drive_folder_id ?? "");
      })
      .catch((error: unknown) => {
        if (!active || requestGeneration !== generation.current) return;
        setLoadError(safeErrorMessage(error, t("recovery.driveSettingsUnavailable"), t));
      })
      .finally(() => {
        if (!active || requestGeneration !== generation.current) return;
        setLoading(false);
      });

    return () => {
      active = false;
      generation.current += 1;
    };
  }, [matterId, projectId, reloadToken]);

  function isCurrent(requestGeneration: number) {
    return requestGeneration === generation.current;
  }

  async function persist(driveFolderId: string | null) {
    if (busyRef.current || !settings?.can_edit) return;
    const requestGeneration = generation.current;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    setSuccess(null);
    try {
      const result = await updateMatterDriveFolder(
        projectId,
        matterId,
        driveFolderId,
      );
      if (!isCurrent(requestGeneration)) return;
      if (
        !isMatterDriveFolderSettings(result, projectId, matterId) ||
        result.drive_folder_id !== driveFolderId
      ) {
        setSettings(null);
        setLoadError(t("recovery.invalidServerResponse"));
        return;
      }
      setSettings(result);
      setDraft(result.drive_folder_id ?? "");
      setSuccess(t("recovery.savedSuccessfully"));
    } catch (error: unknown) {
      if (!isCurrent(requestGeneration)) return;
      setSettings(null);
      setLoadError(safeErrorMessage(error, t("recovery.couldNotSaveDriveSettings"), t));
    } finally {
      if (isCurrent(requestGeneration)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  function handleSave() {
    if (!FOLDER_ID_PATTERN.test(draft)) {
      setActionError(
        draft === ""
          ? "Usa «Limpiar configuración» para quitar la carpeta."
          : "Introduce un ID válido de carpeta de Google Drive.",
      );
      setSuccess(null);
      return;
    }
    void persist(draft);
  }

  function handleClear() {
    void persist(null);
  }

  const canEdit = settings?.role === "matter_owner" && settings.can_edit;

  return (
    <main className="min-h-full px-4 py-6 md:px-8">
      <div className="mx-auto max-w-2xl">
        <header className="mb-5">
          <p className="mb-1 text-xs text-gray-500">{t("recovery.asunto")}</p>
          <h1 className="font-serif text-2xl text-gray-900">
            {t("recovery.configuracionDeCarpetaDeGoogleDrive")}
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            {t("recovery.referenciaDeCarpetaDeEsteAsunto")}
          </p>
        </header>

        <section
          className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} p-5 md:p-6`}
          aria-busy={loading || busy}
        >
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>{t("recovery.cargandoConfiguracion")}</span>
            </div>
          ) : loadError ? (
            <div className="space-y-3" role="alert">
              <p className="text-sm text-red-700">{loadError}</p>
              <PillButton
                tone="white"
                size="sm"
                onClick={() => setReloadToken((value) => value + 1)}
              >
                {t("recovery.reintentar")}
              </PillButton>
            </div>
          ) : settings ? (
            <>
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium text-gray-900">
                    {settings.drive_folder_id
                      ? t("recovery.carpetaConfigurada")
                      : t("recovery.sinCarpetaConfigurada")}
                  </h2>
                  <p className="mt-1 text-xs text-gray-600">
                    {t("recovery.rol")} {roleLabel(settings.role, t)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {t("recovery.configuracionGuardadaEnElServidor")}
                  </p>
                </div>
                <p className="text-xs text-gray-600">
                  {canEdit
                    ? t("recovery.puedeEditar")
                    : t("recovery.noPuedeCambiarEstaConfiguracion")}
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <FieldLabel htmlFor="matter-drive-folder-id">
                    {t("recovery.idDeCarpetaDeGoogleDrive")}
                  </FieldLabel>
                  <FormTextInput
                    id="matter-drive-folder-id"
                    value={draft}
                    disabled={!canEdit || busy}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setActionError(null);
                      setSuccess(null);
                    }}
                    placeholder={t("recovery.ej1abcDef234")}
                    aria-describedby="matter-drive-folder-help"
                  />
                  <p
                    id="matter-drive-folder-help"
                    className="mt-2 text-xs text-gray-500"
                  >
                    {canEdit
                      ? t("recovery.usaElIdExactoLetrasNumeros")
                      : t("recovery.referenciaGuardadaParaEsteAsunto")}
                  </p>
                </div>

                {actionError && (
                  <p className="text-sm text-red-700" role="alert">
                    {actionError}
                  </p>
                )}
                {success && (
                  <p className="text-sm text-green-700" role="status">
                    {success}
                  </p>
                )}

                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    <PillButton
                      tone="blue"
                      className="h-10"
                      onClick={handleSave}
                      disabled={busy}
                    >
                      {busy ? t("recovery.guardando") : t("recovery.guardar")}
                    </PillButton>
                    <PillButton
                      tone="white"
                      className="h-10"
                      onClick={handleClear}
                      disabled={busy || settings.drive_folder_id === null}
                    >
                      {t("recovery.limpiarConfiguracion")}
                    </PillButton>
                  </div>
                )}
              </div>

              <p className="mt-5 border-t border-gray-200/70 pt-4 text-sm leading-5 text-gray-600">
                {t("recovery.estaConfiguracionSoloGuardaLaReferencia")}
              </p>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default MatterDriveSettings;
