"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { AddUserInput } from "@/app/components/shared/AddUserInput";
import { Modal } from "@/app/components/modals/Modal";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { FieldLabel, FormTextInput } from "@/app/components/ui/form-field";
import {
  cancelOrgInvitation,
  createOrg,
  createOrgInvitation,
  resendOrgInvitation,
  type Org,
  type OrgInvitation,
} from "@/app/lib/mikeApi";
import {
  INVITABLE_ORG_ROLES,
  canManageOrgRole,
  type InvitableOrgRole,
} from "@/app/lib/permissions";
import { errorCode, userFacingApiError } from "@/app/lib/userFacingError";
import { settleBulkRequests } from "@/app/lib/bulkRequests";
import { invalidatePlatformMe } from "@/app/hooks/usePlatformMe";
import { orgRoleDescription, orgRoleLabel } from "./orgRoleText";
import {
  invitationIssueReason,
  invitationIssueText,
  type InvitationIssueReason,
} from "./invitationIssues";

function friendlyError(error: unknown, fallback: string) {
  return userFacingApiError(error, fallback);
}

/**
 * A refresh runs *after* its mutation has already succeeded, so a failing
 * refresh must never be reported as a failed mutation. Callers await this
 * outside their mutation's try block.
 *
 * Quiet is not the same as invisible, though: it returns whether the refresh
 * worked, because the list on screen is now a claim about the server that the
 * page cannot back up. "Invitation sent" beside an unchanged list reads as
 * "…and nothing happened", which is precisely wrong.
 */
async function refreshQuietly(
  onChanged: () => Promise<void> | void,
): Promise<boolean> {
  try {
    await onChanged();
    return true;
  } catch (error) {
    console.error("Failed to refresh organization data", error);
    return false;
  }
}

export function CreateOrganizationModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (org: Org) => void;
}) {
  const t = useTranslations();
  const [name, setName] = useState("");
  const [memberEmails, setMemberEmails] = useState<string[]>([]);
  const [createdOrg, setCreatedOrg] = useState<Org | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which invitations did not go out after the organization was created, and
  // why: one line per address.
  const [invitationIssues, setInvitationIssues] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName("");
    setMemberEmails([]);
    setCreatedOrg(null);
    setError(null);
    setInvitationIssues([]);
  }, [open]);

  const trimmedName = name.trim();
  async function submit() {
    if (creating) return;
    if (createdOrg) {
      onCreated(createdOrg);
      return;
    }
    if (!trimmedName) return;
    setCreating(true);
    setError(null);
    try {
      const org = await createOrg(trimmedName);
      // Whether this person may create another organization just changed.
      invalidatePlatformMe();
      if (memberEmails.length === 0) {
        onCreated(org);
        return;
      }
      // Each address keeps its own reason: the request that refused it, or
      // an invitation that exists but whose email did not go out.
      const reasons = new Map<string, InvitationIssueReason>();
      await settleBulkRequests(memberEmails, async (email) => {
        try {
          const invitation = await createOrgInvitation(org.id, email, "member");
          if (invitation?.email_sent === false) reasons.set(email, "email_not_sent");
          return invitation;
        } catch (failure) {
          reasons.set(email, invitationIssueReason(failure));
          throw failure;
        }
      });
      if (reasons.size > 0) {
        setCreatedOrg(org);
        setInvitationIssues(
          memberEmails
            .filter((email) => reasons.has(email))
            .map((email) =>
              invitationIssueText(t, email, reasons.get(email) ?? "other"),
            ),
        );
        setError(
          t("organizations.organizationModals.organizationCreatedButSomeInvitationsCould"),
        );
        return;
      }
      onCreated(org);
    } catch (err) {
      setError(
        errorCode(err) === "org_creation_restricted"
          ? t("access.noOrgInvite")
          : friendlyError(err, t("organizations.organizationModals.couldNotCreateTheOrganization")),
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        // A create in flight owns the organization's fate: dismissing the
        // modal (Escape, backdrop, close button) mid-request would strand the
        // result with nowhere to report it.
        onClose={() => {
          if (creating) return;
          onClose();
        }}
        breadcrumbs={[
          t("settings.map.tab.organizations.title"),
          t("organizations.organizationModals.newOrganization"),
        ]}
        primaryAction={{
          label: createdOrg
            ? t("organizations.organizationModals.openOrganization")
            : creating
              ? t("organizations.organizationModals.creating")
              : t("organizations.organizationModals.create"),
          icon: creating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : undefined,
          onClick: () => void submit(),
          disabled: (!trimmedName && !createdOrg) || creating,
        }}
      >
        <div className="space-y-5 py-1">
          <div>
            <FieldLabel htmlFor="new-organization-name">
              {t("organizations.organizationModals.organizationName")}
            </FieldLabel>
            <FormTextInput
              id="new-organization-name"
              autoFocus
              value={name}
              placeholder={t("organizations.organizationModals.eGEliteLawLlp")}
              disabled={creating || createdOrg !== null}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <p className="mt-2 text-xs text-gray-400">
              {t("organizations.organizationModals.youWillBecomeTheFirstAdministrator")}
            </p>
          </div>

          <div>
            <FieldLabel as="p">{t("organizations.organizationModals.inviteMembers")}</FieldLabel>
            <AddUserInput
              requireExistingUser={false}
              busy={creating || createdOrg !== null}
              placeholder={t("organizations.organizationModals.addMemberByEmail")}
              submitLabel={t("organizations.organizationModals.addMember")}
              validateEmail={(email) =>
                memberEmails.includes(email)
                  ? t("organizations.organizationModals.thisEmailHasAlreadyBeenAdded")
                  : null
              }
              onAdd={(user) => {
                setMemberEmails((current) => [...current, user.email]);
                setError(null);
                return true;
              }}
            />
            {memberEmails.length > 0 ? (
              <div className="mt-2 space-y-1">
                {memberEmails.map((email) => (
                  <div
                    key={email}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-gray-600 hover:bg-app-surface-hover"
                  >
                    <span className="min-w-0 flex-1 truncate">{email}</span>
                    <button
                      type="button"
                      aria-label={t("organizations.organizationModals.removeEmail", { email })}
                      disabled={creating || createdOrg !== null}
                      onClick={() =>
                        setMemberEmails((current) =>
                          current.filter((value) => value !== email),
                        )
                      }
                      className="rounded-full p-1 text-gray-400 hover:bg-app-surface-active hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="mt-2 text-xs text-gray-400">
              {t("organizations.organizationModals.membersReceiveAnInvitationYouCan")}
            </p>
          </div>
        </div>
      </Modal>
      <WarningPopup
        open={open && error !== null}
        title={
          createdOrg
            ? t("organizations.organizationModals.someInvitationsWereNotSent")
            : t("organizations.organizationModals.organizationNotCreated")
        }
        message={
          error !== null && invitationIssues.length > 0 ? (
            <>
              {error}
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {invitationIssues.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : (
            error
          )
        }
        onClose={() => setError(null)}
      />
    </>
  );
}

export function InviteOrganizationMemberModal({
  open,
  org,
  invitations,
  onClose,
  onChanged,
}: {
  open: boolean;
  org: Org;
  invitations: OrgInvitation[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const t = useTranslations();
  const [role, setRole] = useState<InvitableOrgRole>("member");
  // Inviting somebody as an admin is appointing one, which only an owner may
  // do, so an admin is offered Member alone and the picker has nothing to ask.
  const invitableRoles = INVITABLE_ORG_ROLES.filter((candidate) =>
    canManageOrgRole(org.role, candidate),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = invitations.filter(
    (invitation) =>
      invitation.status === "pending" || invitation.status === "expired",
  );

  useEffect(() => {
    if (!open) return;
    setRole("member");
    setNotice(null);
    setError(null);
  }, [open]);

  async function invite(email: string) {
    setError(null);
    setNotice(null);
    let sent: boolean;
    try {
      sent = Boolean((await createOrgInvitation(org.id, email, role)).email_sent);
    } catch (err) {
      const reason = invitationIssueReason(err);
      setError(
        reason === "other"
          ? friendlyError(err, t("organizations.organizationModals.couldNotSendTheInvitation"))
          : invitationIssueText(t, email, reason),
      );
      return false;
    }
    const sentNotice = t(sent ? "access.invite.sent" : "access.invite.notSent");
    setNotice(sentNotice);
    // The invitation really was sent, so the notice stands — but if the list
    // behind this modal could not be re-read, say that rather than let the
    // unchanged list quietly contradict the notice.
    if (!(await refreshQuietly(onChanged)))
      setNotice(t("organizations.organizationModals.staleAfterInvite", { notice: sentNotice }));
    return true;
  }

  async function runInvitationAction(
    invitation: OrgInvitation,
    action: "resend" | "cancel",
  ) {
    setBusyId(invitation.id);
    setError(null);
    setNotice(null);
    let changed = false;
    let successNotice: string | null = null;
    try {
      if (action === "resend") {
        await resendOrgInvitation(org.id, invitation.id);
        successNotice = t("organizations.organizationModals.invitationResentTo", { email: invitation.email });
      } else {
        await cancelOrgInvitation(org.id, invitation.id);
        successNotice = t("organizations.organizationModals.invitationToCancelled", { email: invitation.email });
      }
      setNotice(successNotice);
      changed = true;
    } catch (err) {
      setError(friendlyError(
          err,
          action === "resend"
            ? t("organizations.organizationModals.couldNotResendTheInvitation")
            : t("organizations.organizationModals.couldNotCancelTheInvitation"),
        ));
    } finally {
      setBusyId(null);
    }
    if (changed && !(await refreshQuietly(onChanged)) && successNotice)
      setNotice(t("organizations.organizationModals.staleAfterAction", { notice: successNotice }));
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        breadcrumbs={[
          t("settings.map.tab.organizations.title"),
          org.name,
          t("organizations.organizationModals.addMemberBreadcrumb"),
        ]}
        size="md"
        footerStatus={
          notice ? (
            <span className="text-sm text-gray-400">{notice}</span>
          ) : null
        }
        cancelAction={false}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-5 py-1">
          <div>
            {invitableRoles.length > 1 ? (
              <>
                <FieldLabel htmlFor="organization-invite-role">{t("organizations.organizationModals.role")}</FieldLabel>
                <ModalSelect
                  id="organization-invite-role"
                  value={role}
                  options={invitableRoles.map((candidate) => ({
                    value: candidate,
                    label: orgRoleLabel(t, candidate),
                  }))}
                  onChange={(value) => setRole(value as InvitableOrgRole)}
                />
              </>
            ) : (
              <>
                <FieldLabel as="p">{t("organizations.organizationModals.role")}</FieldLabel>
                <p className="text-sm text-gray-700">
                  {orgRoleLabel(t, role)}
                </p>
              </>
            )}
            <p className="mt-2 text-xs text-gray-400">
              {orgRoleDescription(t, role)}
              {invitableRoles.length > 1
                ? null
                : t("organizations.organizationModals.onlyAnOrganizationOwnerCanInvite")}
            </p>
          </div>

          <div>
            <FieldLabel as="p">{t("organizations.organizationModals.emailAddress")}</FieldLabel>
            <AddUserInput
              autoFocus
              requireExistingUser={false}
              placeholder={t("organizations.organizationModals.inviteByEmail")}
              submitLabel={t("organizations.organizationModals.sendInvitation")}
              onAdd={(user) => invite(user.email)}
            />
          </div>

          {pending.length > 0 ? (
            <div className="min-h-0 border-t border-gray-100 pt-4">
              <p className="mb-2 text-xs font-medium text-gray-600">
                {t("organizations.organizationModals.pendingInvitations")}
              </p>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {pending.map((invitation) => {
                  // An admin invitation is an owner's appointment in
                  // progress, so an admin can see it but not act on it.
                  const canManage = canManageOrgRole(
                    org.role,
                    invitation.role,
                  );
                  return (
                    <div
                      key={invitation.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-app-surface-hover"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-gray-700">
                          {invitation.email}
                        </p>
                        <p className="text-3xs text-gray-400">
                          {orgRoleLabel(t, invitation.role)} ·{" "}
                          {invitation.status === "expired"
                            ? t("organizations.organizationModals.expired")
                            : t("organizations.organizationModals.pending")}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={t("organizations.organizationModals.resendInvitationToEmail", { email: invitation.email })}
                        title={canManage ? undefined : t("organizations.organizationModals.onlyAnOwnerCanChangeAnAdminInvitation")}
                        disabled={!canManage || busyId === invitation.id}
                        onClick={() =>
                          void runInvitationAction(invitation, "resend")
                        }
                        className="rounded-full p-1.5 text-gray-400 hover:bg-app-surface-active hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40"
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("organizations.organizationModals.cancelInvitationToEmail", { email: invitation.email })}
                        title={canManage ? undefined : t("organizations.organizationModals.onlyAnOwnerCanChangeAnAdminInvitation")}
                        disabled={!canManage || busyId === invitation.id}
                        onClick={() =>
                          void runInvitationAction(invitation, "cancel")
                        }
                        className="rounded-full p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-40"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
      <WarningPopup
        open={open && error !== null}
        title={t("organizations.organizationModals.invitationActionFailed")}
        message={error}
        onClose={() => setError(null)}
      />
    </>
  );
}
