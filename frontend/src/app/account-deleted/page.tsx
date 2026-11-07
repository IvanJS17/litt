"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { AccountDeletionReceipt } from "@mike/contracts";
import { useAuth } from "@/app/contexts/AuthContext";
import { PillButtonUI, authGlassCardUIClassName } from "@mike/ui";
import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { getAccountDeletionReceipt } from "@/app/lib/mikeApi";
import { ACCOUNT_DELETION_TOKEN_KEY } from "@/app/lib/accountDeletion";
import { notifyError } from "@/app/lib/userFacingError";

const POLL_MS = process.env.NODE_ENV === "test" ? 10 : 2000;

/** The card title every signed-out screen uses; the wordmark is the h1. */
const TITLE_CLASS = "font-serif text-2xl font-medium text-gray-950";

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

  // The same frame as every other signed-out screen: the wordmark above,
  // the receipt in an auth card under it. `top` keeps the card still while
  // the receipt grows from "Deleting…" to the full list.
  return (
    <AuthPageShell align="top">
      <main className="w-full max-w-xl">
        <div className={authGlassCardUIClassName}>
          <div className="space-y-5">
            {token === null ? (
              <p className="text-sm text-gray-600">
                There is no account deletion to show in this tab.
              </p>
            ) : !receipt ||
              receipt.status === "pending" ||
              receipt.status === "running" ? (
              <div role="status" className="space-y-2">
                <h2 className={TITLE_CLASS}>Deleting your account&hellip;</h2>
                <p className="text-sm text-gray-600">
                  This can take a few minutes. Keep this page open to see your
                  receipt.
                </p>
              </div>
            ) : receipt.status === "failed" ? (
              <div role="alert" className="space-y-2">
                <h2 className={TITLE_CLASS}>
                  Your account could not be fully deleted
                </h2>
                <p className="text-sm text-gray-600">
                  Your account stays locked and nobody can sign in to it.
                  Contact support to finish the deletion.
                </p>
              </div>
            ) : (
              <div className="space-y-4 text-sm text-gray-600">
                <h2 className={TITLE_CLASS}>Your account has been deleted</h2>
                <p>Finished on {formatDate(receipt.completed_at)}.</p>
                <section className="space-y-1">
                  <h3 className="font-medium text-gray-900">Deleted</h3>
                  <ul className="list-disc space-y-1 pl-5">
                    {receipt.deleted.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
                <section className="space-y-1">
                  <h3 className="font-medium text-gray-900">Kept, and why</h3>
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
                size="normal"
                onClick={() => void finish()}
              >
                {token === null ? "Go to LiTT" : "Finish and sign out"}
              </PillButtonUI>
            )}
          </div>
        </div>
      </main>
    </AuthPageShell>
  );
}
