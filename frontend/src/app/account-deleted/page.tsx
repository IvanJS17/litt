"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { AccountDeletionReceipt } from "@mike/contracts";
import { useAuth } from "@/app/contexts/AuthContext";
import { GlassCardUI } from "@/shared/ui/GlassCardUI";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { getAccountDeletionReceipt } from "@/app/lib/mikeApi";
import { ACCOUNT_DELETION_TOKEN_KEY } from "@/app/lib/accountDeletion";
import { notifyError } from "@/app/lib/userFacingError";

const POLL_MS = process.env.NODE_ENV === "test" ? 10 : 2000;

function formatDate(value: string) {
  // A date-only value is a UTC calendar date; show it as that date.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : new Date(value);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? "UTC" : undefined,
  });
}

// The token is written before navigating here and only removed when leaving.
const subscribeToNothing = () => () => {};

/**
 * Progress and receipt of an account erasure. Public on purpose: the
 * session was revoked when deletion started, and the receipt token from
 * Settings (session storage) is what reads it. Signing out — clearing the
 * local session — happens only after the receipt has been shown.
 */
export default function AccountDeletedPage() {
  const router = useRouter();
  const { signOut } = useAuth();
  // undefined while prerendering; the stored token (or null) in the browser.
  const token = useSyncExternalStore<string | null | undefined>(
    subscribeToNothing,
    () => sessionStorage.getItem(ACCOUNT_DELETION_TOKEN_KEY),
    () => undefined,
  );
  const [receipt, setReceipt] = useState<AccountDeletionReceipt | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await getAccountDeletionReceipt(token);
        if (cancelled) return;
        setReceipt(next);
        if (next.status === "pending" || next.status === "running")
          timer = setTimeout(() => void poll(), POLL_MS);
      } catch (error) {
        if (cancelled) return;
        notifyError(error, {
          action: "load your deletion receipt",
          onRetry: () => void poll(),
          dedupeKey: "account-deletion-receipt",
        });
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  const finish = async () => {
    sessionStorage.removeItem(ACCOUNT_DELETION_TOKEN_KEY);
    try {
      await signOut();
    } catch {
      // The account no longer exists server-side; a failed local sign-out
      // leaves nothing usable behind, so leave the page regardless.
    }
    router.replace("/");
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4 py-10">
      <div className="w-full">
        <GlassCardUI>
          <div className="space-y-5 p-6">
            {token === null ? (
              <p className="text-sm text-gray-600">
                There is no account deletion to show in this tab.
              </p>
            ) : !receipt ||
              receipt.status === "pending" ||
              receipt.status === "running" ? (
              <div role="status" className="space-y-2">
                <h1 className="text-lg font-medium text-gray-900">
                  Deleting your account&hellip;
                </h1>
                <p className="text-sm text-gray-600">
                  This can take a few minutes. Keep this page open to see your
                  receipt.
                </p>
              </div>
            ) : receipt.status === "failed" ? (
              <div role="alert" className="space-y-2">
                <h1 className="text-lg font-medium text-gray-900">
                  Your account could not be fully deleted
                </h1>
                <p className="text-sm text-gray-600">
                  Your account stays locked and nobody can sign in to it.
                  Contact support to finish the deletion.
                </p>
              </div>
            ) : (
              <div className="space-y-4 text-sm text-gray-600">
                <h1 className="text-lg font-medium text-gray-900">
                  Your account has been deleted
                </h1>
                <p>Finished on {formatDate(receipt.completed_at)}.</p>
                <section className="space-y-1">
                  <h2 className="font-medium text-gray-900">Deleted</h2>
                  <ul className="list-disc space-y-1 pl-5">
                    {receipt.deleted.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
                <section className="space-y-1">
                  <h2 className="font-medium text-gray-900">Kept, and why</h2>
                  <ul className="list-disc space-y-1 pl-5">
                    {receipt.retained.map((entry) => (
                      <li key={entry.item}>
                        {entry.item}. {entry.reason}
                      </li>
                    ))}
                  </ul>
                </section>
                <p>
                  The last backup copy of your data is deleted by{" "}
                  <strong className="font-medium text-gray-900">
                    {formatDate(receipt.backups_expire_on)}
                  </strong>
                  .
                </p>
              </div>
            )}
            {(token === null ||
              receipt?.status === "completed" ||
              receipt?.status === "failed") && (
              <PillButtonUI
                tone="black"
                size="sm"
                onClick={() => void finish()}
              >
                {token === null ? "Go to LiTT" : "Finish and sign out"}
              </PillButtonUI>
            )}
          </div>
        </GlassCardUI>
      </div>
    </main>
  );
}
