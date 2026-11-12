import type { Translate } from "@/i18n/Translate";
import type { OrgRole } from "@/app/lib/permissions";

const LABELS = {
    owner: "organizations.role.owner.label",
    admin: "organizations.role.admin.label",
    member: "organizations.role.member.label",
} as const;

const DESCRIPTIONS = {
    owner: "organizations.role.owner.description",
    admin: "organizations.role.admin.description",
    member: "organizations.role.member.description",
} as const;

/** The role's name, in the interface language. */
export function orgRoleLabel(t: Translate, role: OrgRole): string {
    return t(LABELS[role]);
}

/** What the role may do, in the interface language. */
export function orgRoleDescription(t: Translate, role: OrgRole): string {
    return t(DESCRIPTIONS[role]);
}
