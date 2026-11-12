"use client";

import { useTranslations } from "next-intl";
import type { OrgMember } from "@/app/lib/mikeApi";
import { PRACTICE_OPTIONS } from "@/app/components/workflows/practices";

// LiTT training (docs/training.md): labels and identity shared by the
// training settings pages.

/** A stored (normalized) practice area as the option it came from, or as stored. */
export function practiceOptionLabel(practice: string): string {
    const option = (PRACTICE_OPTIONS as readonly string[]).find(
        (candidate) => candidate.trim().toLowerCase() === practice,
    );
    return option ?? practice;
}

/** A member's name and email, each on its own line and never truncated. */
export function MemberIdentity({
    member,
    userId,
}: {
    member: OrgMember | undefined;
    userId: string;
}) {
    const t = useTranslations("training");
    const name = member?.display_name?.trim();
    const email = member?.email ?? null;
    return (
        <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 break-words">
                {name || email || t("member")}
            </p>
            {name && email && (
                <p className="text-sm text-gray-500 break-all">{email}</p>
            )}
            {!member && <span className="sr-only">{userId}</span>}
        </div>
    );
}

export function membersById(members: OrgMember[]): Map<string, OrgMember> {
    return new Map(members.map((member) => [member.user_id, member]));
}
