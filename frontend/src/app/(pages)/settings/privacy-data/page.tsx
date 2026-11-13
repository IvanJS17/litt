"use client";

import { useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { PillButtonUI, GlassCardUI } from "@mike/ui";
import {
  SettingsDescription,
  SettingsLabel,
} from "@/app/components/settings/SettingsText";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import {
  PERSONAL_WORKSPACE,
  PERSONAL_WORKSPACE_LABEL,
  useWorkspace,
} from "@/app/contexts/WorkspaceContext";
import { useHasMultipleWorkspaces } from "@/app/hooks/useHasMultipleWorkspaces";
import { useMemberDataActions } from "@/app/hooks/useMemberDataActions";
import { EmptyState } from "@/app/components/ui/empty-state";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
  MfaVerificationPopup,
  needsMfaVerification,
} from "@/app/components/popups/MfaVerificationPopup";
import {
  deleteAllChats,
  deleteAllMemories,
  deleteAllProjects,
  deleteAllTabularReviews,
  isMfaRequiredError,
  type UserExportType,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { saveUserExport } from "@/app/lib/userExportDownload";
import { useTranslations } from "next-intl";
import type { Translate } from "@/i18n/Translate";

type DeleteDataAction = "chats" | "tabular-reviews" | "projects" | "memory";
type ExportDataAction =
  | "export-chats"
  | "export-tabular-reviews"
  | "export-account"
  | "export-memory";
type MfaRetryAction = DeleteDataAction | ExportDataAction;

const isDev = process.env.NODE_ENV !== "production";
const devLog = (...args: Parameters<typeof console.log>) => {
  if (isDev) console.log(...args);
};

/**
 * The confirmation for deleting data in one workspace. Each "Delete all"
 * reaches the active workspace only. `workspaceName` is set when the person
 * has more than one workspace, and the copy then says which; with only
 * Personal there is nothing to tell apart, and it names none.
 */
function deleteDataCopy(
  t: Translate,
  action: DeleteDataAction,
  personal: boolean,
  workspaceName: string | null,
): { title: string; message: string } {
  const values = {
    scoped: workspaceName ? "yes" : "no",
    workspace: workspaceName ?? "",
  };
  const undo = t("settings.privacyData.cannotBeUndone");
  switch (action) {
    case "chats":
      return {
        title: t("settings.privacyData.deleteTitle.chats", values),
        message: `${t("settings.privacyData.deleteBody.chats", values)} ${undo}`,
      };
    case "tabular-reviews":
      return {
        title: t("settings.privacyData.deleteTitle.tabularReviews", values),
        message: `${t("settings.privacyData.deleteBody.tabularReviews", values)} ${undo}`,
      };
    case "projects":
      return {
        title: t("settings.privacyData.deleteTitle.projects", values),
        message: `${t(personal ? "settings.privacyData.deleteBody.projectsPersonal" : "settings.privacyData.deleteBody.projectsShared", values)} ${undo}`,
      };
    case "memory":
      return {
        title: t("settings.privacyData.deleteTitle.memory", values),
        message: `${t(personal ? "settings.privacyData.deleteBody.memoryPersonal" : "settings.privacyData.deleteBody.memoryShared", values)} ${undo}`,
      };
  }
}

/** Imperative, lower case: "Couldn't delete your chats". */
const DELETE_ACTION_KEYS = {
  chats: "settings.privacyData.actions.deleteYourChats",
  "tabular-reviews": "settings.privacyData.actions.deleteYourTabularReviews",
  projects: "settings.privacyData.actions.deleteYourProjects",
  memory: "settings.privacyData.actions.deleteYourMemory",
} as const satisfies Record<DeleteDataAction, string>;

// Exports and deletion work on the active workspace, and in an organization
// only as far as its owners allow members. Keyed by workspace, so switching
// drops a confirmation or verification still open for the old one rather
// than carrying it into the new one.
export default function PrivacyDataPage() {
  const t = useTranslations();
  const { workspaceId, activeOrganization, personalWorkspaceDisabled } =
    useWorkspace();
  const multipleWorkspaces = useHasMultipleWorkspaces();
  const { canExport, canDelete } = useMemberDataActions();
  // A firm-managed account cannot open its personal space, but the data in it
  // is still the person's: they keep downloading and deleting it from here.
  if (personalWorkspaceDisabled) {
    return (
      <PrivacyData
        key={PERSONAL_WORKSPACE}
        workspace={PERSONAL_WORKSPACE}
        workspaceName={null}
        canExport
        canDelete
      />
    );
  }
  const workspace = workspaceId ?? PERSONAL_WORKSPACE;
  if (!canExport && !canDelete) {
    return (
      <EmptyState
        title={t("settings.privacyData.managedByYourOrganization")}
        description={t("settings.privacyData.managedByOwnersDescription", { name: activeOrganization?.name ?? t("settings.privacyData.thisOrganization") })}
      />
    );
  }
  return (
    <PrivacyData
      key={workspace}
      workspace={workspace}
      workspaceName={
        multipleWorkspaces
          ? (activeOrganization?.name ?? PERSONAL_WORKSPACE_LABEL)
          : null
      }
      canExport={canExport}
      canDelete={canDelete}
    />
  );
}

function PrivacyData({
  workspace,
  workspaceName,
  canExport,
  canDelete,
}: {
  /** "personal" or an organization id. */
  workspace: string;
  /** The workspace's name when the person has more than one, else null. */
  workspaceName: string | null;
  canExport: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations();
  const { loadChats, setCurrentChatId } = useChatHistoryContext();
  const [pendingDeleteAction, setPendingDeleteAction] =
    useState<DeleteDataAction | null>(null);
  const [deletingAction, setDeletingAction] = useState<DeleteDataAction | null>(
    null,
  );
  const [pendingMfaAction, setPendingMfaAction] =
    useState<MfaRetryAction | null>(null);
  const [isExportingAccount, setIsExportingAccount] = useState(false);
  const [isExportingChats, setIsExportingChats] = useState(false);
  const [isExportingTabularReviews, setIsExportingTabularReviews] =
    useState(false);
  const [isExportingMemory, setIsExportingMemory] = useState(false);

  const runAsyncExport = (type: UserExportType, fallbackFilename: string) =>
    saveUserExport(type, { workspace }, fallbackFilename);

  const handleExportAccountData = async () => {
    devLog("[privacy-data/mfa] export account requested");
    setIsExportingAccount(true);
    try {
      if (await needsMfaVerification()) {
        setPendingMfaAction("export-account");
        return;
      }
      await runAsyncExport("account", "litt-account-export.json");
    } catch (error) {
      devLog("[privacy-data/mfa] export account failed", {
        isMfaRequired: isMfaRequiredError(error),
        error,
      });
      if (isMfaRequiredError(error)) {
        setPendingMfaAction("export-account");
        return;
      }
      notifyError(error, {
        action: t("settings.privacyData.actions.exportYourAccountData"),
        onRetry: () => void handleExportAccountData(),
      });
    } finally {
      setIsExportingAccount(false);
    }
  };

  const handleExportChatData = async () => {
    devLog("[privacy-data/mfa] export chats requested");
    setIsExportingChats(true);
    try {
      if (await needsMfaVerification()) {
        setPendingMfaAction("export-chats");
        return;
      }
      await runAsyncExport("chats", "litt-chat-export.json");
    } catch (error) {
      devLog("[privacy-data/mfa] export chats failed", {
        isMfaRequired: isMfaRequiredError(error),
        error,
      });
      if (isMfaRequiredError(error)) {
        setPendingMfaAction("export-chats");
        return;
      }
      notifyError(error, {
        action: t("settings.privacyData.actions.exportYourChats"),
        onRetry: () => void handleExportChatData(),
      });
    } finally {
      setIsExportingChats(false);
    }
  };

  const handleExportTabularReviewsData = async () => {
    devLog("[privacy-data/mfa] export tabular reviews requested");
    setIsExportingTabularReviews(true);
    try {
      if (await needsMfaVerification()) {
        setPendingMfaAction("export-tabular-reviews");
        return;
      }
      await runAsyncExport(
        "tabular-reviews",
        "litt-tabular-reviews-export.json",
      );
    } catch (error) {
      devLog("[privacy-data/mfa] export tabular reviews failed", {
        isMfaRequired: isMfaRequiredError(error),
        error,
      });
      if (isMfaRequiredError(error)) {
        setPendingMfaAction("export-tabular-reviews");
        return;
      }
      notifyError(error, {
        action: t("settings.privacyData.actions.exportYourTabularReviews"),
        onRetry: () => void handleExportTabularReviewsData(),
      });
    } finally {
      setIsExportingTabularReviews(false);
    }
  };

  const handleExportMemoryData = async () => {
    devLog("[privacy-data/mfa] export memory requested");
    setIsExportingMemory(true);
    try {
      if (await needsMfaVerification()) {
        setPendingMfaAction("export-memory");
        return;
      }
      await runAsyncExport("memory-zip", "litt-memory-export.zip");
    } catch (error) {
      devLog("[privacy-data/mfa] export memory failed", {
        isMfaRequired: isMfaRequiredError(error),
        error,
      });
      if (isMfaRequiredError(error)) {
        setPendingMfaAction("export-memory");
        return;
      }
      notifyError(error, {
        action: t("settings.privacyData.actions.exportYourMemory"),
        onRetry: () => void handleExportMemoryData(),
      });
    } finally {
      setIsExportingMemory(false);
    }
  };

  const handleDeleteData = async (action: DeleteDataAction) => {
    devLog("[privacy-data/mfa] delete requested", { action });
    setDeletingAction(action);
    try {
      if (await needsMfaVerification()) {
        setPendingDeleteAction(null);
        setPendingMfaAction(action);
        return;
      }
      if (action === "chats") {
        await deleteAllChats(workspace);
        setCurrentChatId(null);
        await loadChats();
      } else if (action === "tabular-reviews") {
        await deleteAllTabularReviews(workspace);
      } else if (action === "memory") {
        await deleteAllMemories(workspace);
      } else {
        await deleteAllProjects(workspace);
        setCurrentChatId(null);
        await loadChats();
      }
      setPendingDeleteAction(null);
    } catch (error) {
      devLog("[privacy-data/mfa] delete failed", {
        action,
        isMfaRequired: isMfaRequiredError(error),
        error,
      });
      if (isMfaRequiredError(error)) {
        setPendingDeleteAction(null);
        setPendingMfaAction(action);
        return;
      }
      notifyError(error, {
        action: t(DELETE_ACTION_KEYS[action]),
        // Re-open the confirmation rather than deleting again from the
        // notice: this erases data permanently, so it is always the dialog
        // that starts it.
        onRetry: () => setPendingDeleteAction(action),
      });
    } finally {
      setDeletingAction(null);
    }
  };

  const handleMfaVerified = async () => {
    const action = pendingMfaAction;
    devLog("[privacy-data/mfa] verification callback", { action });
    setPendingMfaAction(null);
    if (!action) return;

    if (action === "export-account") {
      await handleExportAccountData();
    } else if (action === "export-chats") {
      await handleExportChatData();
    } else if (action === "export-tabular-reviews") {
      await handleExportTabularReviewsData();
    } else if (action === "export-memory") {
      await handleExportMemoryData();
    } else {
      await handleDeleteData(action);
    }
  };

  const personal = workspace === PERSONAL_WORKSPACE;
  const pendingDeleteCopy = pendingDeleteAction
    ? deleteDataCopy(t, pendingDeleteAction, personal, workspaceName)
    : null;

  return (
    <div className="space-y-8">
      {canExport && (
        <section className="space-y-3">
          <SettingsHeading id="export-data">{t("settings.privacyData.exportData")}</SettingsHeading>
          {workspaceName && (
            <SettingsDescription>
              {t("settings.privacyData.exportsDataInWorkspacenameOnlyTo", { workspaceName })}
            </SettingsDescription>
          )}
          <GlassCardUI>
            <SettingsRow>
              <div className="space-y-1">
                <SettingsLabel>{t("settings.privacyData.exportChats")}</SettingsLabel>
                <SettingsDescription>
                  {t("settings.privacyData.downloadAssistantAndTabularReviewChat")}
                </SettingsDescription>
              </div>
              <PillButtonUI
                tone="black"
                size="sm"
                onClick={handleExportChatData}
                disabled={isExportingChats}
                loading={isExportingChats}
                className="shrink-0"
              >
                <Download className="h-4 w-4 shrink-0" />
                {isExportingChats ? t("settings.privacyData.exporting") : t("settings.privacyData.export")}
              </PillButtonUI>
            </SettingsRow>
            <SettingsRow>
              <div className="space-y-1">
                <SettingsLabel>{t("settings.privacyData.exportTabularReviews")}</SettingsLabel>
                <SettingsDescription>
                  {t("settings.privacyData.downloadAllOwnedTabularReviewsCells")}
                </SettingsDescription>
              </div>
              <PillButtonUI
                tone="black"
                size="sm"
                onClick={handleExportTabularReviewsData}
                disabled={isExportingTabularReviews}
                loading={isExportingTabularReviews}
                className="shrink-0"
              >
                <Download className="h-4 w-4 shrink-0" />
                {isExportingTabularReviews ? t("settings.privacyData.exporting") : t("settings.privacyData.export")}
              </PillButtonUI>
            </SettingsRow>
            <SettingsRow>
              <div className="space-y-1">
                <SettingsLabel>{t("settings.privacyData.exportAccountJson")}</SettingsLabel>
                <SettingsDescription>
                  {workspace === PERSONAL_WORKSPACE
                    ? t("settings.privacyData.downloadAccountMetadataProjectsDocumentMetadata")
                    : t("settings.privacyData.downloadYourProjectsDocumentMetadataWorkflows")}
                </SettingsDescription>
              </div>
              <PillButtonUI
                tone="black"
                size="sm"
                onClick={handleExportAccountData}
                disabled={isExportingAccount}
                loading={isExportingAccount}
                className="shrink-0"
              >
                <Download className="h-4 w-4 shrink-0" />
                {isExportingAccount ? t("settings.privacyData.exporting") : t("settings.privacyData.export")}
              </PillButtonUI>
            </SettingsRow>
            <SettingsRow>
              <div className="space-y-1">
                <SettingsLabel>{t("settings.privacyData.exportMemory")}</SettingsLabel>
                <SettingsDescription>
                  {t("settings.privacyData.downloadYourAppMemoryAndEvery")}
                </SettingsDescription>
              </div>
              <PillButtonUI
                tone="black"
                size="sm"
                aria-label={t("settings.privacyData.exportMemory")}
                onClick={handleExportMemoryData}
                disabled={isExportingMemory}
                loading={isExportingMemory}
                className="shrink-0"
              >
                <Download className="h-4 w-4 shrink-0" />
                {isExportingMemory ? t("settings.privacyData.exporting") : t("settings.privacyData.export")}
              </PillButtonUI>
            </SettingsRow>
          </GlassCardUI>
        </section>
      )}

      {canDelete && (
        <section className="space-y-3">
          <SettingsHeading id="delete-data">{t("settings.privacyData.deleteData")}</SettingsHeading>
          {workspaceName && (
            <SettingsDescription>
              {t("settings.privacyData.deletesDataInWorkspacenameOnlyTo", { workspaceName })}
            </SettingsDescription>
          )}
          <GlassCardUI>
            <SettingsRow>
              <div className="space-y-1">
                <SettingsLabel>{t("settings.privacyData.deleteAllChats")}</SettingsLabel>
                <SettingsDescription>
                  {t("settings.privacyData.permanentlyDeleteYourAssistantAndTabular")}
                </SettingsDescription>
              </div>
              <PillButtonUI
                tone="danger"
                size="sm"
                onClick={() => setPendingDeleteAction("chats")}
                disabled={!!deletingAction}
                loading={deletingAction === "chats"}
                className="w-full shrink-0 sm:w-auto"
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                {t("common.delete")}
              </PillButtonUI>
            </SettingsRow>
            <SettingsRow>
              <div className="space-y-1">
                <SettingsLabel>{t("settings.privacyData.deleteAllTabularReviews")}</SettingsLabel>
                <SettingsDescription>
                  {t("settings.privacyData.permanentlyDeleteAllTabularReviewsYou")}
                </SettingsDescription>
              </div>
              <PillButtonUI
                tone="danger"
                size="sm"
                onClick={() => setPendingDeleteAction("tabular-reviews")}
                disabled={!!deletingAction}
                loading={deletingAction === "tabular-reviews"}
                className="w-full shrink-0 sm:w-auto"
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                {t("common.delete")}
              </PillButtonUI>
            </SettingsRow>
            <SettingsRow>
              <div className="space-y-1">
                <SettingsLabel>{t("settings.privacyData.deleteAllProjects")}</SettingsLabel>
                <SettingsDescription>
                  {personal
                    ? t("settings.privacyData.permanentlyDeleteAllProjectsYouOwn")
                    : t("settings.privacyData.permanentlyDeleteAllProjectsYouCreated")}
                </SettingsDescription>
              </div>
              <PillButtonUI
                tone="danger"
                size="sm"
                onClick={() => setPendingDeleteAction("projects")}
                disabled={!!deletingAction}
                loading={deletingAction === "projects"}
                className="w-full shrink-0 sm:w-auto"
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                {t("common.delete")}
              </PillButtonUI>
            </SettingsRow>
            <SettingsRow>
              <div className="space-y-1">
                <SettingsLabel>{t("settings.privacyData.deleteAllMemory")}</SettingsLabel>
                <SettingsDescription>
                  {!personal
                    ? t("settings.privacyData.permanentlyDeleteYourMemoryInWorkspace", { workspace: workspaceName ?? t("settings.privacyData.thisWorkspace") })
                    : workspaceName
                      ? t("settings.privacyData.permanentlyDeleteYourWorkspacenameMemoryAnd", { workspaceName })
                      : t("settings.privacyData.permanentlyDeleteYourAppMemoryAnd")}
                </SettingsDescription>
              </div>
              <PillButtonUI
                tone="danger"
                size="sm"
                aria-label={t("settings.privacyData.deleteAllMemory")}
                onClick={() => setPendingDeleteAction("memory")}
                disabled={!!deletingAction}
                loading={deletingAction === "memory"}
                className="w-full shrink-0 sm:w-auto"
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                {t("common.delete")}
              </PillButtonUI>
            </SettingsRow>
          </GlassCardUI>
        </section>
      )}
      <ConfirmPopup
        open={!!pendingDeleteAction}
        title={pendingDeleteCopy?.title}
        message={pendingDeleteCopy?.message}
        confirmLabel={t("common.delete")}
        confirmVariant="danger"
        confirmStatus={deletingAction ? "loading" : "idle"}
        cancelLabel={t("common.cancel")}
        onCancel={() => {
          if (deletingAction) return;
          setPendingDeleteAction(null);
        }}
        onConfirm={() => {
          if (!pendingDeleteAction) return;
          void handleDeleteData(pendingDeleteAction);
        }}
      />
      <MfaVerificationPopup
        open={!!pendingMfaAction}
        onCancel={() => setPendingMfaAction(null)}
        onVerified={() => void handleMfaVerified()}
        title={t("settings.privacyData.twoFactorVerificationRequired")}
        message={t("settings.privacyData.thisActionIsSensitiveEnterA")}
      />
    </div>
  );
}
