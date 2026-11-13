"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * What a person must read before the invitation creates a firm-managed
 * account: the firm manages it, there is no personal workspace, what they do
 * stays with the firm, and leaving the firm gives the space back. Shown only
 * when the invitation says `managed_account` (it creates the account and the
 * firm has the setting on). Mount it on the invitation screen, before the
 * Accept button.
 */
export function ManagedAccountNotice({ firm }: { firm: string }) {
  const t = useTranslations();
  return (
    <section
      aria-label={t("managedAccount.title", { firm })}
      className="space-y-1 rounded-lg bg-app-surface px-4 py-3 text-sm text-gray-800"
    >
      <h2 className="font-medium">{t("managedAccount.title", { firm })}</h2>
      <p>{t("managedAccount.body", { firm })}</p>
      <Link href="/terminos" className="underline">
        {t("managedAccount.termsLink")}
      </Link>
    </section>
  );
}
