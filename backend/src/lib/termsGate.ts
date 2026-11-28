// The Terms gate: every signed-in request needs the person to have accepted
// the CURRENT version of the Terms, except the few routes listed here.
//
import { LEGAL_VERSION } from "./legalVersion";

/** The one question every entry asks: has this person accepted the current Terms? */
export function hasAcceptedCurrentTerms(
  accepted: string | null | undefined,
): boolean {
  return accepted === LEGAL_VERSION;
}

export const TERMS_ACCEPTANCE_REQUIRED = "terms_acceptance_required";
export const TERMS_ACCEPTANCE_REQUIRED_DETAIL =
  "Accept the current Terms in LiTT on the web to continue.";
/** The same refusal said to a connected application, which has no Terms screen of its own. */
export const TERMS_ACCEPTANCE_REQUIRED_MCP_MESSAGE =
  "Accept the current Terms in LiTT to continue.";

/** Routes a person may call before accepting the current Terms. `:id` is one path segment. */
export const TERMS_GATE_ALLOW_LIST: ReadonlyArray<{
  method: string;
  path: string;
  reason: string;
}> = [
  { method: "GET", path: "/auth/session", reason: "the web asks who is signed in before it shows anything" },
  { method: "GET", path: "/auth/mfa/factors", reason: "second-factor step that comes before the Terms screen" },
  { method: "GET", path: "/auth/mfa/assurance", reason: "second-factor step that comes before the Terms screen" },
  { method: "POST", path: "/auth/mfa/challenge", reason: "second-factor step that comes before the Terms screen" },
  { method: "POST", path: "/auth/mfa/verify", reason: "second-factor step that comes before the Terms screen" },
  { method: "POST", path: "/auth/mfa/challenge-and-verify", reason: "second-factor step that comes before the Terms screen" },
  { method: "PATCH", path: "/auth/password", reason: "setting a password from an invitation or recovery link happens before the Terms screen" },
  { method: "GET", path: "/user/profile", reason: "tells the web the Terms are outdated" },
  { method: "POST", path: "/user/terms-acceptance", reason: "accepting the current Terms" },
  { method: "DELETE", path: "/user/account", reason: "the person's right to have the account erased" },
  { method: "POST", path: "/user/exports", reason: "the person's right to export their data" },
  { method: "GET", path: "/user/exports/:id", reason: "following the export of their own data" },
  { method: "GET", path: "/user/exports/:id/download", reason: "downloading the export of their own data" },
];

function segments(path: string): string[] {
  return path.split("/").filter((part) => part !== "");
}

const PATTERNS = TERMS_GATE_ALLOW_LIST.map((entry) => ({
  method: entry.method,
  parts: segments(entry.path),
}));

/** Whether this request may pass without the current Terms accepted. */
export function isTermsGateExempt(method: string, originalUrl: string): boolean {
  const parts = segments(originalUrl.split("?")[0]);
  return PATTERNS.some(
    (p) =>
      p.method === method &&
      p.parts.length === parts.length &&
      p.parts.every((part, i) => part === ":id" || part === parts[i]),
  );
}
