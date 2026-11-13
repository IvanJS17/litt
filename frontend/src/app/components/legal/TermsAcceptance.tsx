"use client";

import { clientTranslator } from "@mike/client";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI, authGlassCardUIClassName } from "@mike/ui";
import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { LegalLinks } from "@/app/components/legal/LegalLinks";
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
    const [missing, setMissing] = useState(false);

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        // The button is always live; unticked, it says what is missing.
        if (!checked) {
            setMissing(true);
            return;
        }
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
                <div>
                    <label className="flex cursor-pointer items-start gap-2 py-1 text-sm text-gray-800">
                        <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 accent-black"
                            checked={checked}
                            aria-describedby={missing && !checked ? "terms-missing" : undefined}
                            onChange={(e) => {
                                setChecked(e.target.checked);
                                if (e.target.checked) setMissing(false);
                            }}
                        />
                        {t("checkbox")}
                    </label>
                    {missing && !checked ? (
                        <p id="terms-missing" role="alert" className="mt-2 text-sm text-red-600">
                            {t("checkRequired")}
                        </p>
                    ) : null}
                </div>
                <PillButtonUI
                    type="submit"
                    tone="black"
                    size="normal"
                    disabled={saving}
                    className="w-full"
                >
                    {saving ? t("saving") : t("submit")}
                </PillButtonUI>
            </form>
        </AuthPageShell>
    );
}
