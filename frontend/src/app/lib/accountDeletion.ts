// Account deletion hands its receipt token from Settings to /account-deleted.
// Session storage: it survives the navigation, never reaches a server or a
// URL, and ends with the tab.
export const ACCOUNT_DELETION_TOKEN_KEY = "litt.accountDeletionReceipt";
