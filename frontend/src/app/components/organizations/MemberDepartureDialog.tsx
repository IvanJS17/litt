"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Modal } from "@/app/components/modals/Modal";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { textButtonUIClassName } from "@mike/ui";
import {
  getOrgMemberHandover,
  listOrgMembers,
  removeOrgMember,
  type OrgMember,
  type OrgMemberHandover,
} from "@/app/lib/mikeApi";
import { useTranslations } from "next-intl";

// Shared work is handed to one successor; unshared work is archived for
// 30 days. Existing co-owned items stay with their remaining owners.

export interface DepartingMember {
  user_id: string;
  display_name?: string | null;
  email?: string | null;
}

export interface MemberDepartureResult {
  /** The members who are gone. */
  removedUserIds: string[];
  /** Why the first of the others is not, if any could not be removed. */
  error: unknown | null;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function joinCounts(parts: string[]): string {
  return parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const nameOf = (member: DepartingMember) =>
  member.display_name?.trim() || member.email || "This member";

export function MemberDepartureDialog({
  orgId,
  departing,
  leaving = false,
  members,
  onCancel,
  onDone,
}: {
  orgId: string;
  /** Who is going: one person, or several removed together. */
  departing: DepartingMember[];
  /** The one person going is the signed-in user. */
  leaving?: boolean;
  /** The organization's members, when the caller already has them. */
  members?: OrgMember[];
  onCancel: () => void;
  onDone: (result: MemberDepartureResult) => void;
}) {
  const t = useTranslations();
  const [handover, setHandover] = useState<OrgMemberHandover | null>(null);
  const [loadedMembers, setLoadedMembers] = useState<OrgMember[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [successor, setSuccessor] = useState("");
  const [working, setWorking] = useState(false);

  const departingIds = departing.map((member) => member.user_id).join(",");
  const hasRoster = members !== undefined;
  useEffect(() => {
    let cancelled = false;
    const ids = departingIds.split(",").filter(Boolean);
    Promise.all([
      ids.length > 1
        ? getOrgMemberHandover(orgId, ids[0], ids)
        : getOrgMemberHandover(orgId, ids[0]),
      hasRoster ? Promise.resolve(null) : listOrgMembers(orgId),
    ]).then(
      ([loaded, roster]) => {
        if (cancelled) return;
        setHandover(loaded);
        setLoadedMembers(roster);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [orgId, departingIds, hasRoster]);

  const roster = members ?? loadedMembers;
  const candidates = useMemo(
    () =>
      (roster ?? [])
        .filter(
          (member) =>
            !departing.some((gone) => gone.user_id === member.user_id),
        )
        .map((member) => {
          const name = member.display_name?.trim();
          return {
            value: member.user_id,
            label: name || member.email || "Unnamed member",
            suffix: name && member.email ? `(${member.email})` : undefined,
          };
        }),
    [roster, departing],
  );

  const projects = handover?.projects ?? [];
  const workflows = handover?.workflows ?? [];
  const privateProjects = handover?.privateProjects ?? 0;
  const privateWorkflows = handover?.privateWorkflows ?? 0;
  const chats = handover?.chats ?? 0;
  const reviews = handover?.reviews ?? 0;
  const documents = handover?.documents ?? 0;
  const sharedChats = handover?.sharedChats ?? 0;
  const sharedReviews = handover?.sharedReviews ?? 0;
  const sharedDocuments = handover?.sharedDocuments ?? 0;
  const owed = projects.length + workflows.length + sharedChats + sharedReviews + sharedDocuments;
  const defaultSuccessor = (roster ?? []).find((member) => member.role === "owner" &&
    !departing.some((gone) => gone.user_id === member.user_id))?.user_id ?? "";
  const selectedSuccessor = successor || defaultSuccessor;
  const titles = [...projects, ...workflows]
    .map((item) => item.title.trim()).filter(Boolean);

  const several = departing.length > 1;
  const who = leaving
    ? "You"
    : several
      ? "These members"
      : nameOf(departing[0] ?? { user_id: "" });
  const lead = leaving
    ? "You will lose access to this organization's shared resources."
    : several
      ? `${departing.length} selected members will lose access to this organization.`
      : `${who} will lose organization access.`;
  const owedSummary = joinCounts([
    ...(projects.length ? [count(projects.length, "project")] : []),
    ...(workflows.length ? [count(workflows.length, "workflow")] : []),
    ...(sharedChats ? [count(sharedChats, "shared chat")] : []),
    ...(sharedReviews ? [count(sharedReviews, "shared tabular review")] : []),
    ...(sharedDocuments ? [count(sharedDocuments, "document")] : []),
  ]);
  const archivedSummary = joinCounts([
    ...(privateProjects ? [count(privateProjects, "private project")] : []),
    ...(privateWorkflows ? [count(privateWorkflows, "private workflow")] : []),
    ...(chats ? [count(chats, "private chat")] : []),
    ...(reviews ? [count(reviews, "tabular review")] : []),
    ...(documents ? [count(documents, "document")] : []),
  ]);

  const ready = handover !== null && roster !== null && !loadFailed;
  const canConfirm = ready && !working && (owed === 0 || selectedSuccessor !== "");

  async function confirm() {
    if (!canConfirm) return;
    setWorking(true);
    // Remove one at a time: an item retained for a selected co-owner must
    // be rechecked when that final owner is removed as well.
    const results: PromiseSettledResult<void>[] = [];
    for (const member of departing) {
      try {
        await removeOrgMember(orgId, member.user_id, owed > 0 ? selectedSuccessor : undefined);
        results.push({ status: "fulfilled", value: undefined });
      } catch (reason) {
        results.push({ status: "rejected", reason });
      }
    }
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    onDone({
      removedUserIds: departing
        .filter((_, index) => results[index]?.status === "fulfilled")
        .map((member) => member.user_id),
      error: failure ? failure.reason : null,
    });
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!working) onCancel();
      }}
      breadcrumbs={["Organization", "Members", leaving ? "Leave" : "Remove"]}
      size="sm"
      className="h-auto max-h-[calc(100vh-2rem)]"
      cancelAction={{
        label: t("common.cancel"),
        disabled: working,
        onClick: onCancel,
      }}
      primaryAction={{
        label: working
          ? leaving
            ? "Leaving..."
            : "Removing..."
          : leaving
            ? "Leave"
            : "Remove",
        variant: "danger",
        disabled: !canConfirm,
        onClick: () => void confirm(),
      }}
    >
      <div
        data-modal-scroll="vertical"
        className="min-h-0 min-w-0 space-y-5 overflow-y-auto pb-4"
      >
        <p className="text-sm text-gray-700 [overflow-wrap:anywhere]">{lead}</p>

        {loadFailed ? (
          <p role="alert" className="text-sm text-red-600">
            {t("organizations.memberDepartureDialog.couldNotCheckWhatWouldBe")}
          </p>
        ) : !ready ? (
          <div
            role="status"
            aria-label={t("organizations.memberDepartureDialog.checkingWhatWouldBeTransferredOr")}
            className="space-y-5"
          >
            <div className="space-y-2">
              <SkeletonLine className="w-32" />
              <SkeletonLine className="w-3/4" />
              <SkeletonLine className="w-24" />
              <span className="block h-10 w-full animate-pulse rounded-xl bg-gray-100" />
            </div>
            <div className="space-y-2">
              <SkeletonLine className="w-24" />
              <SkeletonLine className="w-full" />
              <SkeletonLine className="w-1/2" />
            </div>
          </div>
        ) : (
          <>
            {owed > 0 ? (
              <section
                className="space-y-2"
                aria-labelledby="member-departure-transfer"
              >
                <h2
                  id="member-departure-transfer"
                  className="text-sm font-medium text-gray-700"
                >
                  {t("organizations.memberDepartureDialog.transferOwnership")}
                </h2>
                <p className="text-sm text-gray-500">
                  {t("organizations.memberDepartureDialog.owedsummaryNeedANewOwnerShared", { owed, owedSummary })}
                </p>
                {titles.length === 0 ? null : titles.length === 1 ? (
                  <p className="text-xs text-gray-500 [overflow-wrap:anywhere]">
                    {titles[0]}
                  </p>
                ) : (
                  <details className="group/items">
                    <summary
                      className={textButtonUIClassName({
                        className:
                          "list-none px-0 [&::-webkit-details-marker]:hidden",
                      })}
                    >
                      {t("organizations.memberDepartureDialog.viewItems")}
                      <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/items:rotate-180" />
                    </summary>
                    <ul className="mt-2 space-y-1 text-xs text-gray-500">
                      {titles.map((title, index) => (
                        <li
                          key={`${index}-${title}`}
                          className="[overflow-wrap:anywhere]"
                        >
                          {title}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {candidates.length > 0 ? (
                  <ModalSelect
                    id="member-departure-successor"
                    aria-label={t("organizations.memberDepartureDialog.handOverTo")}
                    value={selectedSuccessor}
                    onChange={setSuccessor}
                    options={candidates}
                    placeholder={t("organizations.memberDepartureDialog.chooseAMember")}
                    disabled={working}
                    wrapLabels
                  />
                ) : (
                  <p role="alert" className="text-sm text-red-600">
                    {t("organizations.memberDepartureDialog.thereIsNoOtherMemberTo")}
                  </p>
                )}
              </section>
            ) : null}

            {archivedSummary ? (
              <section
                className="space-y-2"
                aria-labelledby="member-departure-private-activity"
              >
                <h2
                  id="member-departure-private-activity"
                  className="text-sm font-medium text-gray-700"
                >
                  {t("organizations.memberDepartureDialog.privateWorkRetainedFor30Days")}
                </h2>
                <p className="text-sm text-gray-500">
                  {t("organizations.memberDepartureDialog.archivedsummaryWillBeArchivedFor30", { archivedSummary })}
                </p>
                <p className="text-xs text-gray-500">
                  {t("organizations.memberDepartureDialog.onlyOrganizationOwnersCanRecoverReassign")}
                </p>
              </section>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
