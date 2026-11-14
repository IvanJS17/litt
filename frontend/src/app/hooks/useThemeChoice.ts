"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { userFacingApiError } from "@/app/lib/userFacingError";
import {
    resolveTheme,
    type ResolvedTheme,
    type Theme,
} from "@/app/lib/theme";
import { systemPrefersDark, watchSystemTheme } from "@mike/client";

/**
 * The theme preference for its two homes, the account menu and Settings >
 * Appearance: both read and write the same profile field through this hook,
 * so changing one moves the other.
 *
 * `theme` is what the control shows. A choice shows at once (the page
 * already changed; the profile answers a moment later) and several choices in
 * a row are saved in order, the last one winning. If a save fails the page
 * goes back to the saved theme (the provider does that) and `error` says so.
 * `resolved` is what the page is drawn as, so Automático can say "now: dark".
 */
export function useThemeChoice(): {
    theme: Theme | null;
    resolved: ResolvedTheme;
    saving: boolean;
    error: string | null;
    choose: (next: Theme) => Promise<void>;
} {
    const t = useTranslations();
    const { profile, updateTheme } = useUserProfile();
    const [pending, setPending] = useState<Theme | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [systemDark, setSystemDark] = useState(false);
    const inFlight = useRef(false);
    const queued = useRef<Theme | null>(null);

    // The device's answer is read after mounting (never while rendering on
    // the server), then followed while it can change what is shown.
    useEffect(() => {
        setSystemDark(systemPrefersDark());
        return watchSystemTheme(setSystemDark);
    }, []);

    const theme: Theme | null = pending ?? profile?.theme ?? null;

    const choose = useCallback(
        async (next: Theme): Promise<void> => {
            setError(null);
            setPending(next);
            if (inFlight.current) {
                queued.current = next;
                return;
            }
            inFlight.current = true;
            try {
                let target: Theme | null = next;
                while (target) {
                    queued.current = null;
                    await updateTheme(target);
                    target = queued.current;
                }
            } catch (changeError) {
                queued.current = null;
                setError(
                    userFacingApiError(
                        changeError,
                        t("settings.appearance.couldNotUpdateTheAppearanceSetting"),
                    ),
                );
            } finally {
                inFlight.current = false;
                setPending(null);
            }
        },
        [updateTheme, t],
    );

    return {
        theme,
        resolved: resolveTheme(theme ?? "light", systemDark),
        saving: pending !== null,
        error,
        choose,
    };
}
