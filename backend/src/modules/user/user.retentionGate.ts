// TD-008 retention gate for account deletion.
//
// Erasing an account deletes or rewrites rows that LiTT keeps as evidence:
// audit_events is insert-only (migration 20261023_11) and the AI evidence
// tables reference the account with ON DELETE RESTRICT. The upstream cascade
// issues its deletes concurrently, so on a real database it would erase part
// of the account and then fail. Until the retention decision (TD-008) says
// what may be anonymized, every account-deletion entry point refuses before
// its first mutation (docs/UPSTREAM_COMPATIBILITY_LEDGER.md §16.2 item 4).

export const ACCOUNT_DELETION_REFUSAL =
    "Account deletion is not available yet. Records of your work are kept until the firm's retention policy is in place; contact your administrator.";

/** False until TD-008 is implemented; the cascade below it stays upstream's. */
export function accountDeletionAvailable(): boolean {
    return false;
}
