import type { Translate } from "@/i18n/Translate";
import type { OrgRole } from "@/app/lib/permissions";

/** The role's name, in the interface language. */
export function orgRoleLabel(t: Translate, role: OrgRole): string {
    return t(`organizations.role.${role}.label`);
}

/** What the role may do, in the interface language. */
export function orgRoleDescription(t: Translate, role: OrgRole): string {
    return t(`organizations.role.${role}.description`);
}
