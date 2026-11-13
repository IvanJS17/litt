"use client";

import { useEffect, useState } from "react";
import { MODEL_API_KEY_FIELDS } from "@/app/components/settings/modelProviders";
import {
    PERSONAL_WORKSPACE,
    readStoredWorkspace,
} from "@/app/contexts/WorkspaceContext";
import { apiKeyStateFromStatus } from "@/app/lib/apiKeyState";
import { getOrgApiKeys, listOrgs, type ApiKeyState } from "@/app/lib/mikeApi";

export type KeySource = "user" | "org" | "env";

/** Whether any model provider can run on the given keys, from the named source. */
export function hasUsableProvider(
    keys: ApiKeyState | undefined,
    source?: KeySource,
): boolean {
    if (!keys) return false;
    return MODEL_API_KEY_FIELDS.some((field) => {
        const state = keys[field.provider];
        return (
            !!state?.configured &&
            state.enabled !== false &&
            (source === undefined || state.source === source)
        );
    });
}

export type JoinedOrganization = {
    name: string;
    hasModels: boolean;
    allowsOwnKeys: boolean;
};

/**
 * Whether the person joined an organization before this step. Onboarding runs
 * outside the app's WorkspaceProvider, so the workspace the invitation step
 * stored is read straight from storage; it is known at once, with no request.
 */
export function joinedOrganizationId(userId: string): string | null {
    const stored = readStoredWorkspace(userId);
    return stored === PERSONAL_WORKSPACE ? null : stored;
}

/**
 * The organization the person accepted an invitation to, and whether it has
 * models and takes members' own keys. `ready` turns true once that is known —
 * at once for somebody who joined nothing — and `joined` stays null when
 * there is nothing to say or the lookup failed (unknown is not "no models":
 * the steps keep their general wording and the server still decides).
 */
export function useJoinedOrganization(userId: string): {
    ready: boolean;
    joined: JoinedOrganization | null;
} {
    const orgId = joinedOrganizationId(userId);
    const [state, setState] = useState<{
        orgId: string;
        joined: JoinedOrganization | null;
    } | null>(null);

    useEffect(() => {
        if (!orgId) return;
        let cancelled = false;
        void Promise.all([listOrgs(), getOrgApiKeys(orgId)]).then(
            ([orgs, keys]) => {
                if (cancelled) return;
                const org = orgs.find((candidate) => candidate.id === orgId);
                setState({
                    orgId,
                    joined: org
                        ? {
                              name: org.name,
                              hasModels: hasUsableProvider(
                                  apiKeyStateFromStatus(keys.effective),
                              ),
                              // Members' own keys are allowed unless the
                              // owners turned them off (on by default).
                              allowsOwnKeys:
                                  keys.allow_personal_api_keys !== false,
                          }
                        : null,
                });
            },
            () => {
                if (!cancelled) setState({ orgId, joined: null });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [orgId]);

    if (!orgId) return { ready: true, joined: null };
    return state?.orgId === orgId
        ? { ready: true, joined: state.joined }
        : { ready: false, joined: null };
}

/**
 * The models step is for keys of one's own. A firm that does not take them
 * has nothing to ask for there, so the step is left out; the rest of the
 * time (including when nothing is known) it is shown.
 */
export function showsModelsStep(joined: JoinedOrganization | null): boolean {
    return joined === null || joined.allowsOwnKeys;
}

/** How many numbered steps the person goes through. */
export function onboardingStepCount(joined: JoinedOrganization | null): number {
    return showsModelsStep(joined) ? 3 : 2;
}
