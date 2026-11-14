"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
  MfaVerificationPopup,
  needsMfaVerification,
} from "@/app/components/popups/MfaVerificationPopup";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import {
  SettingsDescription,
  SettingsLabel,
  SettingsNotice,
  SettingsTag,
  SettingsTagRow,
} from "@/app/components/settings/SettingsText";
import { OrganizationSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { EmptyState } from "@/app/components/ui/empty-state";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import {
  deleteOrgData,
  isMfaRequiredError,
  setOrgMemberDataPolicy,
  type OrgDataKind,
  type OrgMemberDataPolicy,
} from "@/app/lib/mikeApi";
import { isOrgOwner } from "@/app/lib/permissions";
import { notifyError } from "@/app/lib/userFacingError";
import { GlassCardUI, PillButtonUI, ToggleSwitchUI } from "@mike/ui";
import { cn } from "@/app/lib/utils";
import {
  organizationSettingsHref,
  useOrganizationSettings,
} from "./OrganizationSettingsShell";
import { useTranslations } from "next-intl";
import type { SettingsKey } from "@/i18n/Translate";

// The Privacy & Data section of an organization's settings: the
// organization-wide twin of a person's own Privacy & Data page. Each action
// reaches every member's work in the organization, so the section is its
// owners' alone; the server refuses anyone else.

const DELETE_ROWS = [
  {
    kind: "chats",
    label: "organizations.organizationPrivacyData.deleteRows.chats.label",
    description: "organizations.organizationPrivacyData.deleteRows.chats.description",
    title: "organizations.organizationPrivacyData.deleteRows.chats.title",
    message: "organizations.organizationPrivacyData.deleteRows.chats.message",
  },
  {
    kind: "tabular-reviews",
    label: "organizations.organizationPrivacyData.deleteRows.tabularReviews.label",
    description: "organizations.organizationPrivacyData.deleteRows.tabularReviews.description",
    title: "organizations.organizationPrivacyData.deleteRows.tabularReviews.title",
    message: "organizations.organizationPrivacyData.deleteRows.tabularReviews.message",
  },
  {
    kind: "projects",
    label: "organizations.organizationPrivacyData.deleteRows.projects.label",
    description: "organizations.organizationPrivacyData.deleteRows.projects.description",
    title: "organizations.organizationPrivacyData.deleteRows.projects.title",
    message: "organizations.organizationPrivacyData.deleteRows.projects.message",
  },
  {
    kind: "playbooks",
    label: "organizations.organizationPrivacyData.deleteRows.playbooks.label",
    description: "organizations.organizationPrivacyData.deleteRows.playbooks.description",
    title: "organizations.organizationPrivacyData.deleteRows.playbooks.title",
    message: "organizations.organizationPrivacyData.deleteRows.playbooks.message",
  },
  {
    kind: "memories",
    label: "organizations.organizationPrivacyData.deleteRows.memory.label",
    description: "organizations.organizationPrivacyData.deleteRows.memory.description",
    title: "organizations.organizationPrivacyData.deleteRows.memory.title",
    message: "organizations.organizationPrivacyData.deleteRows.memory.message",
  },
] as const satisfies readonly {
  kind: OrgDataKind;
  label: SettingsKey;
  description: SettingsKey;
  title: SettingsKey;
  message: SettingsKey;
}[];

const POLICY_ROWS = [
  {
    key: "allow_member_exports",
    label: "organizations.organizationPrivacyData.letMembersExport",
    description: "organizations.organizationPrivacyData.letMembersExportDescription",
  },
  {
    key: "allow_member_deletes",
    label: "organizations.organizationPrivacyData.letMembersDelete",
    description: "organizations.organizationPrivacyData.letMembersDeleteDescription",
  },
] as const satisfies readonly {
  key: keyof OrgMemberDataPolicy;
  label: SettingsKey;
  description: SettingsKey;
}[];

/**
 * Whether members may export, and bulk-delete, their own work here. Both
 * start off; when neither is allowed, members do not see Privacy & Data in
 * this organization's workspace at all.
 */
function MemberDataPolicySection() {
  const t = useTranslations();
  const { orgId, org, setOrg } = useOrganizationSettings();
  const { refreshOrganizations } = useWorkspace();
  const [savingKey, setSavingKey] = useState<keyof OrgMemberDataPolicy | null>(
    null,
  );
  // A change the server asked a second factor for, to send again after it.
  const [pendingMfa, setPendingMfa] = useState<{
    next: OrgMemberDataPolicy;
    key: keyof OrgMemberDataPolicy;
  } | null>(null);
  const policy: OrgMemberDataPolicy = {
    allow_member_exports: org?.allow_member_exports === true,
    allow_member_deletes: org?.allow_member_deletes === true,
  };

  async function save(next: OrgMemberDataPolicy, key: keyof OrgMemberDataPolicy) {
    setSavingKey(key);
    try {
      const saved = await setOrgMemberDataPolicy(orgId, next);
      if (org) setOrg({ ...org, ...saved });
      // Members' own Settings follow the organization list.
      void refreshOrganizations();
    } catch (error) {
      if (isMfaRequiredError(error)) setPendingMfa({ next, key });
      else
        notifyError(error, {
          action: t("organizations.organizationPrivacyData.actions.changeWhatMembersCanDo"),
          onRetry: () => void save(next, key),
        });
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <section aria-labelledby="org-privacy-members" className="space-y-3">
      <SettingsTagRow>
        <SettingsHeading id="org-privacy-members">{t("organizations.organizationPrivacyData.membersData")}</SettingsHeading>
        <SettingsTag kind="audience" icon="firm">
          {t("settings.signals.firmWide")}
        </SettingsTag>
      </SettingsTagRow>
      <GlassCardUI>
        {POLICY_ROWS.map((row) => (
          <SettingsRow key={row.key}>
            <div className="space-y-1">
              <SettingsLabel>{t(row.label)}</SettingsLabel>
              <SettingsDescription>
                {t(row.description, { orgName: org?.name ?? t("organizations.organizationPrivacyData.thisOrganization") })}
              </SettingsDescription>
            </div>
            <ToggleSwitchUI
              checked={policy[row.key]}
              aria-label={t(row.label)}
              disabled={!org || savingKey !== null}
              onCheckedChange={(checked) =>
                void save({ ...policy, [row.key]: checked }, row.key)
              }
              className="shrink-0"
            />
          </SettingsRow>
        ))}
      </GlassCardUI>
      <MfaVerificationPopup
        open={pendingMfa !== null}
        onCancel={() => setPendingMfa(null)}
        onVerified={() => {
          const pending = pendingMfa;
          setPendingMfa(null);
          if (pending) void save(pending.next, pending.key);
        }}
        title={t("organizations.organizationPrivacyData.twoFactorVerificationRequired")}
        message={t("organizations.organizationPrivacyData.thisSettingIsSensitiveEnterA")}
      />
    </section>
  );
}

/** Text-shaped placeholder: the real words, invisible, over a pulse. */
function SkeletonText({ children }: { children: string }) {
  return (
    <span className="animate-pulse rounded bg-gray-200/70 text-transparent [box-decoration-break:clone] motion-reduce:animate-none">
      {children}
    </span>
  );
}

/**
 * Where a row's toggle or button will be. Below `sm` the rows stack, so the
 * control takes a line of its own: while the role is unknown the space is
 * kept but left empty (no shape to promise a control), so the owner's
 * controls arriving do not push the sections below them down.
 */
function SkeletonControl({
  owner,
  className,
}: {
  owner: boolean;
  className: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0",
        className,
        owner
          ? "animate-pulse bg-gray-200 motion-reduce:animate-none"
          : "invisible",
      )}
    />
  );
}

/**
 * Stands in for the two owner-only sections while the organization loads,
 * with their real headings, rows and wording, so nothing below moves when
 * they arrive. `owner` is whether the workspace list already says the caller
 * owns the organization; when it does not say (the list is still loading),
 * the same layout is drawn without the toggles and the button, so it
 * promises no control. Owners are the commonest visitors, hence their height.
 */
function OwnerSectionsSkeleton({
  orgName,
  owner,
}: {
  orgName: string;
  owner: boolean;
}) {
  const t = useTranslations();
  return (
    <div
      aria-hidden="true"
      data-slot="org-privacy-skeleton"
      data-role={owner ? "owner" : "unknown"}
      className="space-y-8"
    >
      <div className="space-y-3">
        <SettingsHeading>
          <SkeletonText>{t("organizations.organizationPrivacyData.membersData")}</SkeletonText>
        </SettingsHeading>
        <GlassCardUI>
          {POLICY_ROWS.map((row) => (
            <SettingsRow key={row.key}>
              <div className="space-y-1">
                <SettingsLabel>
                  <SkeletonText>{t(row.label)}</SkeletonText>
                </SettingsLabel>
                <SettingsDescription>
                  <SkeletonText>{t(row.description, { orgName })}</SkeletonText>
                </SettingsDescription>
              </div>
              <SkeletonControl
                owner={owner}
                className="h-5 w-9 rounded-full"
              />
            </SettingsRow>
          ))}
        </GlassCardUI>
      </div>
      <div className="space-y-3">
        <SettingsHeading>
          <SkeletonText>{t("organizations.organizationPrivacyData.departedMembers")}</SkeletonText>
        </SettingsHeading>
        <GlassCardUI>
          <SettingsRow>
            <div className="space-y-1">
              <SettingsLabel>
                <SkeletonText>{t("organizations.organizationPrivacyData.workLeftByDepartedMembers")}</SkeletonText>
              </SettingsLabel>
              <SettingsDescription>
                <SkeletonText>
                  {`${t("settings.signals.deadline30")} ${t("organizations.organizationPrivacyData.departedDescription")}`}
                </SkeletonText>
              </SettingsDescription>
            </div>
            <SkeletonControl
              owner={owner}
              className="h-7 w-full rounded-full sm:w-[4.25rem]"
            />
          </SettingsRow>
        </GlassCardUI>
      </div>
    </div>
  );
}

export function OrganizationPrivacyData() {
  const t = useTranslations();
  const router = useRouter();
  const { orgId, org } = useOrganizationSettings();
  // The name is already in the workspace's organization list; the skeleton
  // uses it so its descriptions wrap like the loaded ones.
  const listedOrg = useWorkspace().organizations?.find(
    (candidate) => candidate.id === orgId,
  );
  const listedOrgName = listedOrg?.name;
  // The organization itself decides; until it arrives, the role the
  // workspace list already carries says what to hold a place for.
  const knownRole = org?.role ?? listedOrg?.role;
  const { loadChats, setCurrentChatId } = useChatHistoryContext();
  const [pendingKind, setPendingKind] = useState<OrgDataKind | null>(null);
  const [deletingKind, setDeletingKind] = useState<OrgDataKind | null>(null);
  const [mfaKind, setMfaKind] = useState<OrgDataKind | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  if (knownRole && !isOrgOwner(knownRole))
    return (
      <EmptyState
        icon={<OrganizationSkeuoIcon />}
        title={t("organizations.organizationPrivacyData.privacyData")}
        description={t("organizations.organizationPrivacyData.onlyThisOrganizationsOwnersCanManage")}
        action={
          <PillButtonUI
            tone="white"
            size="sm"
            onClick={() => router.push(organizationSettingsHref(orgId))}
          >
            {t("organizations.organizationPrivacyData.backToGeneral")}
          </PillButtonUI>
        }
      />
    );

  const deleteData = async (kind: OrgDataKind) => {
    setDeletingKind(kind);
    try {
      if (await needsMfaVerification()) {
        setPendingKind(null);
        setMfaKind(kind);
        return;
      }
      await deleteOrgData(orgId, kind);
      if (kind === "chats" || kind === "projects") {
        // The chat this tab had open may be one of those just deleted.
        setCurrentChatId(null);
        await loadChats();
      }
      setPendingKind(null);
    } catch (error) {
      setPendingKind(null);
      if (isMfaRequiredError(error)) {
        setMfaKind(kind);
        return;
      }
      setWarningMessage(t("organizations.organizationPrivacyData.failedToDeleteData"));
    } finally {
      setDeletingKind(null);
    }
  };

  const pendingRow = DELETE_ROWS.find((row) => row.kind === pendingKind);

  return (
    <div className="space-y-8">
      {org ? null : (
        <OwnerSectionsSkeleton
          orgName={listedOrgName ?? t("organizations.organizationPrivacyData.thisOrganization")}
          owner={knownRole !== undefined && isOrgOwner(knownRole)}
        />
      )}
      {org && isOrgOwner(org.role) ? <MemberDataPolicySection /> : null}
      {/* The archive itself is a table of people and their work, so it
          lives with the roster; this is the way to it from here. */}
      {org && isOrgOwner(org.role) ? (
        <section aria-labelledby="org-privacy-departed" className="space-y-3">
          <SettingsHeading id="org-privacy-departed">
            {t("organizations.organizationPrivacyData.departedMembers")}
          </SettingsHeading>
          <GlassCardUI>
            <SettingsRow>
              <div className="min-w-0 space-y-2">
                <SettingsLabel>{t("organizations.organizationPrivacyData.workLeftByDepartedMembers")}</SettingsLabel>
                {/* A deadline is a notice: it is never folded. */}
                <SettingsNotice entries={[{ icon: "clock", label: t("settings.signals.deadline30") }]}>
                  {t("organizations.organizationPrivacyData.departedDescription")}
                </SettingsNotice>
              </div>
              <PillButtonUI
                tone="white"
                size="sm"
                aria-label={t("organizations.organizationPrivacyData.reviewDepartedMembers")}
                onClick={() =>
                  router.push(
                    `${organizationSettingsHref(orgId, "members")}?view=departed`,
                  )
                }
                className="w-full shrink-0 sm:w-auto"
              >
                {t("organizations.organizationPrivacyData.review")}
              </PillButtonUI>
            </SettingsRow>
          </GlassCardUI>
        </section>
      ) : null}
      <section aria-labelledby="org-privacy-delete" className="space-y-3">
        <SettingsHeading id="org-privacy-delete">{t("organizations.organizationPrivacyData.deleteData")}</SettingsHeading>
        {/* Once, above the group of actions that delete; the only red. */}
        <SettingsNotice
          tone="irreversible"
          entries={[{ icon: "alert", label: t("settings.signals.cannotUndo") }]}
        >
          {t("organizations.organizationPrivacyData.deleteNotice.body")}
        </SettingsNotice>
        <GlassCardUI>
          {DELETE_ROWS.map((row) => (
            <SettingsRow key={row.kind}>
              <div className="space-y-1">
                <SettingsLabel>{t(row.label)}</SettingsLabel>
                <SettingsDescription>{t(row.description)}</SettingsDescription>
              </div>
              <PillButtonUI
                tone="whiteDanger"
                size="sm"
                aria-label={t(row.label)}
                onClick={() => setPendingKind(row.kind)}
                // Not offered until the caller is known to be an owner.
                disabled={!org || deletingKind !== null}
                loading={deletingKind === row.kind}
                className="w-full shrink-0 sm:w-auto"
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                {t("settings.privacyData.deleteButton")}
              </PillButtonUI>
            </SettingsRow>
          ))}
        </GlassCardUI>
      </section>
      <ConfirmPopup
        open={pendingKind !== null}
        title={pendingRow ? t(pendingRow.title) : undefined}
        message={pendingRow ? t(pendingRow.message) : undefined}
        confirmLabel={t("settings.privacyData.deleteButton")}
        confirmVariant="danger"
        confirmStatus={deletingKind ? "loading" : "idle"}
        cancelLabel={t("common.cancel")}
        onCancel={() => {
          if (deletingKind) return;
          setPendingKind(null);
        }}
        onConfirm={() => {
          if (!pendingKind) return;
          void deleteData(pendingKind);
        }}
      />
      <MfaVerificationPopup
        open={mfaKind !== null}
        onCancel={() => setMfaKind(null)}
        onVerified={() => {
          const kind = mfaKind;
          setMfaKind(null);
          if (kind) void deleteData(kind);
        }}
        title={t("organizations.organizationPrivacyData.twoFactorVerificationRequired")}
        message={t("organizations.organizationPrivacyData.thisActionIsSensitiveEnterA")}
      />
      <WarningPopup
        open={!!warningMessage}
        title={t("organizations.organizationPrivacyData.actionFailed")}
        message={warningMessage}
        onClose={() => setWarningMessage(null)}
      />
    </div>
  );
}
