"use client";

import { clientTranslator } from "@mike/client";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI, authGlassCardUIClassName } from "@mike/ui";
import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { LegalLinks } from "@/app/components/legal/LegalLinks";
import { TABLE_CHECKBOX_CLASS } from "@/app/components/shared/TablePrimitive";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { acceptTerms } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { LEGAL_VERSION } from "@/content/legal/version";

/** The screen that stands in for the app until the current Terms are accepted. */
export function TermsAcceptance() {
    const t = useTranslations("legal");
    const { reloadProfile } = useUserProfile();
    const [checked, setChecked] = useState(false);
    const [saving, setSaving] = useState(false);

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        setSaving(true);
        try {
            await acceptTerms(LEGAL_VERSION);
            await reloadProfile();
        } catch (error) {
            notifyError(error, { action: clientTranslator()("errors.action.saveYourAcceptance") });
        } finally {
            setSaving(false);
        }
    }

    return (
        <AuthPageShell>
            <form onSubmit={handleSubmit} className={`w-full max-w-md space-y-4 ${authGlassCardUIClassName}`}>
                <h2 className="text-left font-serif text-2xl font-medium text-gray-950">
                    {t("title")}
                </h2>
                <p className="text-sm text-gray-600">
                    <LegalLinks message="intro" />
                </p>
                <label className="flex items-start gap-2 text-sm text-gray-800">
                    <input
                        type="checkbox"
                        className={`${TABLE_CHECKBOX_CLASS} mt-0.5`}
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                    />
                    {t("checkbox")}
                </label>
                <PillButtonUI
                    type="submit"
                    tone="black"
                    size="normal"
                    disabled={!checked || saving}
                    className="w-full"
                >
                    {saving ? t("saving") : t("submit")}
                </PillButtonUI>
            </form>
        </AuthPageShell>
    );
}
