// The model route of the machine's reading (docs/training.md, layer 3): the
// PERSON's own, governed BYOK. It is fixed on the reading row the first time
// the machine reads, and reused afterwards unless the person explicitly picks
// another of their keys. If it no longer serves them it fails closed
// (chat_route_credential_unavailable) and no other model or key is tried; a
// person with no usable key is not offered the reading
// (training_review_key_required). Never the mentor's route.

import type { TrainingReviewGeneration } from "@mike/contracts";
import { failure, ok, type ServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import {
    chatRouteOf,
    listChatCredentialOptions,
    loadPinnedChatRoute,
    pinChatRoute,
    resolveUserChatSelection,
    type ChatRouteFailure,
    type ResolvedChatRoute,
} from "../user/user.service";
import { REVIEW_KEY_REQUIRED_CODE } from "../training-supervision/trainingSupervision.service";

const KEY_REQUIRED = "Add a key for your model in Settings → Bring Your Own Keys to compare your reading.";

function routeFailure(failed: ChatRouteFailure): ServiceFailure {
    return failure(failed.status === 409 ? "conflict" : "validation", failed.detail, failed.code);
}

/** Whether the person can have the machine read, and on which of their keys. */
export async function readingGeneration(db: Db, userId: string, orgId: string): Promise<TrainingReviewGeneration> {
    const unavailable = { available: false as const, code: REVIEW_KEY_REQUIRED_CODE } as const;
    const selection = await resolveUserChatSelection(db, { userId, orgId });
    if (!selection.ok) return unavailable;
    const listed = await listChatCredentialOptions(db, { userId, orgId, model: selection.selectedModel });
    if (!listed || listed.options.length === 0) return unavailable;
    return {
        available: true,
        model: selection.selectedModel,
        credential_options: listed.options,
        default_credential_ref: listed.default,
    };
}

type StoredRoute = { model: string | null; model_provider: string | null; credential_ref: string | null };

/**
 * The route of one machine reading: the one stored on the row unless the
 * person explicitly chose a key; otherwise their model on the chosen or
 * default key.
 */
export async function readingRoute(
    db: Db,
    args: { userId: string; orgId: string; row: StoredRoute; credentialRef: string | null },
): Promise<ServiceResult<ResolvedChatRoute>> {
    const stored = chatRouteOf(args.row);
    if (stored && !args.credentialRef) {
        const loaded = await loadPinnedChatRoute(db, { userId: args.userId, orgId: args.orgId, route: stored });
        return loaded.ok ? ok(loaded) : routeFailure(loaded);
    }
    const generation = await readingGeneration(db, args.userId, args.orgId);
    if (!generation.available) return failure("validation", KEY_REQUIRED, REVIEW_KEY_REQUIRED_CODE);
    const pinned = await pinChatRoute(db, {
        userId: args.userId,
        orgId: args.orgId,
        model: generation.model,
        requestedCredentialRef: args.credentialRef,
    });
    return pinned.ok ? ok(pinned) : routeFailure(pinned);
}
