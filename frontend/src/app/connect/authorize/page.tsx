"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { PillButtonUI, authGlassCardUIClassName } from "@mike/ui";
import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { TABLE_CHECKBOX_CLASS } from "@/app/components/shared/TablePrimitive";
import { useAuth } from "@/app/contexts/AuthContext";
import {
    decideMcpConsent,
    getMcpConsentRequest,
    isMfaRequiredError,
    MikeApiError,
    type McpConsentRequest,
} from "@/app/lib/mikeApi";
import { reportFault, type UserFacingError } from "@/app/lib/userFacingError";

const KNOWN_SCOPES = ["litt.read", "litt.run", "litt.write", "litt.chat"] as const;
/** The catalog key of a scope text: next-intl reads a dot as nesting. */
const scopeKey = (scope: (typeof KNOWN_SCOPES)[number]) => scope.slice("litt.".length) as "read" | "run" | "write" | "chat";

/**
 * Where an AI app asks to use the person's LiTT account. The request id in the
 * URL was minted by the backend's /oauth/authorize; the person's own session
 * decides, here, which workspaces and permissions the app gets. Approving or
 * denying sends the browser back to the app with a code or an error.
 */
function ConnectAuthorizeContent() {
    const t = useTranslations();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, authLoading } = useAuth();
    const requestId = searchParams.get("request") ?? "";
    const [consent, setConsent] = useState<McpConsentRequest | null>(null);
    const [expired, setExpired] = useState(requestId === "");
    const [loading, setLoading] = useState(requestId !== "");
    const [error, setError] = useState<UserFacingError | null>(null);
    const [deciding, setDeciding] = useState(false);
    const [workspaces, setWorkspaces] = useState<string[]>([]);
    const [scopes, setScopes] = useState<string[]>([]);

    const here = `/connect/authorize?request=${encodeURIComponent(requestId)}`;

    useEffect(() => {
        if (authLoading || !requestId) return;
        if (!user) {
            router.replace(`/login?next=${encodeURIComponent(here)}`);
            return;
        }
        let cancelled = false;
        async function load() {
            setLoading(true);
            setError(null);
            try {
                const loaded = await getMcpConsentRequest(requestId);
                if (cancelled) return;
                setConsent(loaded);
                // Only what the app asked for, and only the default workspace
                // pre-selected: widening is the person's choice.
                setScopes(loaded.scopes);
                setWorkspaces(loaded.default_workspace ? [loaded.default_workspace] : []);
            } catch (caught) {
                if (cancelled) return;
                if (isMfaRequiredError(caught)) {
                    router.replace(`/verify-mfa?next=${encodeURIComponent(here)}`);
                    return;
                }
                if (caught instanceof MikeApiError && caught.code === "mcp_request_expired") {
                    setExpired(true);
                } else {
                    setError(
                        reportFault(caught, {
                            action: t("connect.loadAction"),
                            operation: "mcp.consent",
                        }),
                    );
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void load();
        return () => {
            cancelled = true;
        };
        // `t` is stable per locale; reloading on it would refetch for nothing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, requestId, user?.id]);

    async function decide(approve: boolean) {
        if (deciding || !consent) return;
        setDeciding(true);
        setError(null);
        try {
            const result = await decideMcpConsent(
                requestId,
                approve
                    ? {
                          decision: "approve",
                          workspaces,
                          scopes,
                          default_workspace: workspaces.includes("personal")
                              ? "personal"
                              : workspaces[0],
                      }
                    : { decision: "deny" },
            );
            // Back to the app (claude.ai, or a loopback port on this machine).
            window.location.assign(result.redirect_url);
        } catch (caught) {
            if (caught instanceof MikeApiError && caught.code === "mcp_request_expired") {
                setExpired(true);
            } else {
                setError(
                    reportFault(caught, {
                        action: t("connect.allowAction"),
                        operation: "mcp.consent",
                    }),
                );
            }
            setDeciding(false);
        }
    }

    const toggle = (list: string[], set: (next: string[]) => void, id: string) =>
        set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    const canAllow = !deciding && workspaces.length > 0 && scopes.length > 0;

    return (
        <AuthPageShell>
            <div className={`w-full max-w-md ${authGlassCardUIClassName}`}>
                {loading || authLoading || (!user && !expired) ? (
                    <div className="flex h-13 items-center justify-center text-sm text-gray-500">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t("connect.loading")}
                    </div>
                ) : expired ? (
                    <p role="alert" className="text-sm text-gray-700">
                        {t("connect.expired")}
                    </p>
                ) : consent ? (
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <h1 className="font-serif text-2xl font-medium break-words text-gray-950">
                                {t("connect.heading", { client: consent.client.name })}
                            </h1>
                            <p className="text-sm text-gray-500">
                                {t("connect.intro", { client: consent.client.name })}
                            </p>
                            <p className="text-sm break-all text-gray-600">
                                {t("connect.returnTo", { host: consent.client.redirect_host })}
                            </p>
                            {consent.client.loopback_only && (
                                <p role="note" className="text-sm text-amber-700">
                                    {t("connect.localApp")}
                                </p>
                            )}
                        </div>

                        <fieldset className="space-y-2">
                            <legend className="mb-1 text-sm font-medium text-gray-950">
                                {t("connect.workspaces.title")}
                            </legend>
                            {consent.workspaces.length === 0 && (
                                <p className="text-sm text-gray-500">{t("connect.workspaces.none")}</p>
                            )}
                            {consent.workspaces.map((workspace) => (
                                <label
                                    key={workspace.id}
                                    className="flex items-start gap-2 text-sm text-gray-700"
                                >
                                    <input
                                        type="checkbox"
                                        className={TABLE_CHECKBOX_CLASS}
                                        checked={workspaces.includes(workspace.id)}
                                        disabled={deciding}
                                        onChange={() => toggle(workspaces, setWorkspaces, workspace.id)}
                                    />
                                    <span className="break-words">
                                        {workspace.kind === "personal"
                                            ? t("connect.workspaces.personal")
                                            : (workspace.name ?? t("connect.unknownFirm"))}
                                    </span>
                                </label>
                            ))}
                        </fieldset>

                        <fieldset className="space-y-2">
                            <legend className="mb-1 text-sm font-medium text-gray-950">
                                {t("connect.scopes.title")}
                            </legend>
                            {consent.scopes
                                .filter((scope): scope is (typeof KNOWN_SCOPES)[number] =>
                                    (KNOWN_SCOPES as readonly string[]).includes(scope),
                                )
                                .map((scope) => (
                                    <label
                                        key={scope}
                                        className="flex items-start gap-2 text-sm text-gray-700"
                                    >
                                        <input
                                            type="checkbox"
                                            className={TABLE_CHECKBOX_CLASS}
                                            checked={scopes.includes(scope)}
                                            disabled={deciding}
                                            onChange={() => toggle(scopes, setScopes, scope)}
                                        />
                                        <span className="break-words">{t(`connect.scopes.${scopeKey(scope)}`)}</span>
                                    </label>
                                ))}
                        </fieldset>

                        {error && (
                            <p role="alert" className="text-sm text-red-600">
                                {error.message}
                            </p>
                        )}

                        <div className="flex items-center justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => void decide(false)}
                                disabled={deciding}
                                className="px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:text-gray-950 disabled:cursor-not-allowed disabled:text-gray-400"
                            >
                                {t("connect.deny")}
                            </button>
                            <PillButtonUI
                                tone="black"
                                size="normal"
                                type="button"
                                onClick={() => void decide(true)}
                                disabled={!canAllow}
                                loading={deciding}
                            >
                                {t("connect.allow")}
                            </PillButtonUI>
                        </div>
                    </div>
                ) : (
                    error && (
                        <p role="alert" className="text-sm text-red-600">
                            {error.message}
                        </p>
                    )
                )}
            </div>
        </AuthPageShell>
    );
}

export default function ConnectAuthorizePage() {
    return (
        <Suspense fallback={null}>
            <ConnectAuthorizeContent />
        </Suspense>
    );
}
