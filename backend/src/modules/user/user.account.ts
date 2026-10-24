// Account / data deletion (destructive).
//
// Service layer behind user.routes.ts — see user.shared.ts for the module's
// contract. Account erasure itself runs in user.accountJobs.ts.

import { createHash, randomBytes } from "node:crypto";
import type { AccountDeletionReceipt } from "@mike/contracts";
import { deleteUserPrivateMemories } from "../../lib/memory/bulk";
import { dbJobsEnabled } from "../../lib/dbq/runner";
import {
    deleteAllUserChats,
    deleteAllUserTabularReviews,
    deleteUserProjects,
    listOrgsBlockingAccountDeletion,
    type AccountDeletionOrgBlocker,
} from "./user.dataCleanup";
import { eraseAccount } from "./user.accountJobs";
import { type Db, errorMessage } from "./user.shared";

/** Explain which organizations need an owner before account deletion. */
export function describeAccountDeletionBlockers(
    blockers: AccountDeletionOrgBlocker[],
): string {
    // LiTT never deletes an organization (C5), so the only way forward is
    // another owner.
    return blockers
        .map((blocker) =>
            blocker.reason === "members"
                ? `You are the only owner of ${blocker.name}. Transfer ownership to another member first, then delete your account.`
                : `You are the only member of ${blocker.name}. Invite someone and make them an owner first, then delete your account.`,
        )
        .join(" ");
}

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

/**
 * Start erasing the caller's account (owner decision 2026-10-24).
 *
 * One transaction removes the account from its organizations (advancing
 * their authorization epochs), flags it so requireAuth refuses it, opens the
 * receipt and queues the erasure job; sessions are then revoked. The caller
 * gets the receipt token: the only way to read the receipt once the session
 * is gone, stored server-side as its hash.
 */
export async function deleteUserAccount(
    db: Db,
    userId: string,
    token: string | undefined,
): Promise<
    | { ok: true; receiptToken: string }
    | {
          ok: false;
          kind: "org_successor_required";
          blockers: AccountDeletionOrgBlocker[];
          error?: undefined;
      }
    | { ok: false; kind?: undefined; error: unknown }
> {
    try {
        // ORGANIZATIONS FIRST. An account that is the only owner of a team
        // organization cannot be deleted: promoting an arbitrary successor
        // hands a firm's matters to whoever joined first, and the last-owner
        // guard refuses to leave the organization ownerless. Answer 409
        // BEFORE anything is scheduled, revoked or destroyed. The request
        // transaction asks again under lock (23514).
        const blockers = await listOrgsBlockingAccountDeletion(db, userId);
        if (blockers.length > 0)
            return { ok: false, kind: "org_successor_required", blockers };

        const receiptToken = randomBytes(32).toString("base64url");
        const { data: jobId, error: requestError } = await db.rpc(
            "request_account_deletion",
            { p_user_id: userId, p_token_sha256: sha256(receiptToken) },
        );
        if (requestError) {
            if (requestError.code === "23514") {
                const current = await listOrgsBlockingAccountDeletion(db, userId);
                if (current.length)
                    return { ok: false, kind: "org_successor_required", blockers: current };
            }
            return { ok: false, error: requestError };
        }

        // Best-effort session revocation. requireAuth already refuses this
        // account by its durable deletion flag, whatever the auth provider
        // does with the token.
        if (token) {
            try {
                await db.auth.admin.signOut(token, "global");
            } catch (signOutErr) {
                console.error("[user/account] session revoke failed", {
                    userId,
                    error: errorMessage(signOutErr),
                });
            }
        }

        if (!dbJobsEnabled()) {
            // No runner will drain the queue: erase now, as the job would.
            await eraseAccount(db, userId, jobId as string);
            const done = await db
                .from("db_jobs")
                .update({ status: "done", finished_at: new Date().toISOString() })
                .eq("id", jobId);
            if (done.error) return { ok: false, error: done.error };
        }
        return { ok: true, receiptToken };
    } catch (err) {
        console.error("[user/account] delete failed", {
            userId,
            error: errorMessage(err),
        });
        return { ok: false, error: err };
    }
}

/** How long a receipt token stays readable after the request. */
const RECEIPT_TOKEN_DAYS = 7;

/** The receipt a bearer token unlocks, or null for an unknown/expired one. */
export async function readAccountDeletionReceipt(
    db: Db,
    token: string,
): Promise<{ ok: true; receipt: AccountDeletionReceipt | null } | { ok: false; error: unknown }> {
    const { data, error } = await db
        .from("account_deletion_receipts")
        .select("job_id, status, requested_at, completed_at, backups_expire_on, receipt")
        .eq("token_sha256", sha256(token))
        .maybeSingle();
    if (error) return { ok: false, error };
    const row = data as {
        job_id: string;
        status: "pending" | "completed";
        requested_at: string;
        completed_at: string | null;
        backups_expire_on: string | null;
        receipt: { deleted: string[]; retained: { item: string; reason: string }[] } | null;
    } | null;
    const ageMs = row ? Date.now() - Date.parse(row.requested_at) : Infinity;
    if (!row || !(ageMs <= RECEIPT_TOKEN_DAYS * 24 * 60 * 60 * 1000))
        return { ok: true, receipt: null };

    if (row.status === "completed" && row.receipt && row.completed_at && row.backups_expire_on) {
        return {
            ok: true,
            receipt: {
                status: "completed",
                requested_at: row.requested_at,
                completed_at: row.completed_at,
                backups_expire_on: row.backups_expire_on,
                deleted: row.receipt.deleted,
                retained: row.receipt.retained,
            },
        };
    }
    // Not finished: the job says whether it is running or gave up.
    const job = await db.from("db_jobs").select("status").eq("id", row.job_id).maybeSingle();
    if (job.error) return { ok: false, error: job.error };
    const jobStatus = (job.data as { status?: string } | null)?.status;
    return {
        ok: true,
        receipt: {
            status: jobStatus === "running" ? "running" : jobStatus === "failed" ? "failed" : "pending",
            requested_at: row.requested_at,
        },
    };
}

export async function deleteUserChats(
    db: Db,
    userId: string,
    orgId: string | null,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
    try {
        await deleteAllUserChats(db, userId, orgId);
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        console.error("[user/chats] delete failed", {
            userId,
            error: detail,
        });
        return { ok: false, error: err };
    }
}

export async function deleteUserProjectsData(
    db: Db,
    userId: string,
    orgId: string | null,
    userEmail?: string | null,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
    try {
        await deleteUserProjects(db, userId, orgId, userEmail);
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        console.error("[user/projects] delete failed", {
            userId,
            error: detail,
        });
        return { ok: false, error: err };
    }
}

export async function deleteUserTabularReviews(
    db: Db,
    userId: string,
    orgId: string | null,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
    try {
        await deleteAllUserTabularReviews(db, userId, orgId);
        return { ok: true };
    } catch (err) {
        const detail = errorMessage(err);
        console.error("[user/tabular-reviews] delete failed", {
            userId,
            error: detail,
        });
        return { ok: false, error: err };
    }
}

/**
 * Wipe the user's own memory for one workspace (`orgId` null is Personal)
 * and, in Personal, the memories of private projects they created.
 * Organization and merely shared projects are intentionally outside this
 * destructive action.
 */
export async function deletePrivateMemories(
    db: Db,
    userId: string,
    orgId: string | null,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
    try {
        await deleteUserPrivateMemories(db, userId, orgId);
        return { ok: true };
    } catch (err) {
        console.error("[user/memories] delete failed", {
            userId,
            error: errorMessage(err),
        });
        return { ok: false, error: err };
    }
}
