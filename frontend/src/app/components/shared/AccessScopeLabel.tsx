import { useTranslations } from "next-intl";
import type { ResourceAccessScope } from "./types";

interface AccessScopeLabelProps {
  scope?: ResourceAccessScope;
  organizationName?: string | null;
  directGrantCount?: number;
}

// The Access column says one of three things, and the first word answers the
// question people scan it for: is this open to everyone, or not?
//
//   Public            every member of its organization can open it
//   Private           its creator only (and, in an organization, its owners)
//   Private (Shared)  not public, but shared with at least one other person
const ACCESS_SCOPE_LABEL_KEYS = {
  organization: "shared.accessScopeLabel.public",
  private: "shared.accessScopeLabel.private",
  shared: "shared.accessScopeLabel.privateShared",
} as const;

export function AccessScopeLabel({
  scope = "private",
  organizationName,
  directGrantCount,
}: AccessScopeLabelProps) {
  const t = useTranslations();
  const hasDirectGrantCount =
    scope === "shared" &&
    typeof directGrantCount === "number" &&
    Number.isInteger(directGrantCount) &&
    directGrantCount >= 0;
  const accessUserCount = hasDirectGrantCount ? directGrantCount + 1 : null;
  // The detail the label leaves out, for anyone who hovers: who "everyone"
  // is, or how many people a private item is shared with.
  const description =
    scope === "organization"
      ? organizationName
        ? t("shared.accessScopeLabel.sharedWithEveryoneIn", { organizationName })
        : t("shared.accessScopeLabel.sharedWithEveryoneInTheOrganisation")
      : hasDirectGrantCount
        ? t("shared.accessScopeLabel.sharedWithCountUsers", { count: accessUserCount ?? 0 })
        : scope === "shared"
          ? t("shared.accessScopeLabel.sharedWithIndividuals")
          : t("shared.accessScopeLabel.private");

  return (
    <span
      aria-label={description}
      className="inline-flex min-w-0 items-center text-xs text-gray-600"
      title={description}
    >
      <span className="truncate">{t(ACCESS_SCOPE_LABEL_KEYS[scope])}</span>
    </span>
  );
}
