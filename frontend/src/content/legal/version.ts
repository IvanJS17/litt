// The version of the legal texts in this folder. The server holds the same
// value (backend LEGAL_VERSION): raise both together, in the same release,
// whenever a change requires new acceptance (legal t_ce7d0315 §2.3), so every
// account accepts the new version. A change that does not require it is
// published without raising the version. version.test.ts fails if they differ.
export const LEGAL_VERSION = "2026-11-20";
