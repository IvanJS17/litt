// HTTP layer for the auth module.
//
// Everything that genuinely needs req/res lives here: creating the
// cookie-bearing Supabase client, clearing auth cookies, reading the request
// origin, and rendering GoTrue's errors as safe responses. The payload
// schemas, the redirect-URL construction, and the GoTrue calls themselves are
// in auth.service.ts.

import { Router, type Request, type Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearRequestAuthCookies,
  createCookielessSupabase,
  createRequestSupabase,
  publicAuthUser,
} from "../../lib/authSession";
import {
  ssoConfiguration,
  ssoDomainSchema,
  ssoEnabled,
} from "../../lib/ssoConfig";
import {
  rateLimitedBody,
  sendInternalError,
  sendUpstreamUnavailable,
} from "../../lib/httpError";
import { anonymousMailCap, type MailKind } from "../../lib/anonymousMailCap";
import { betaMode, canSignUp, mayRecoverPassword } from "../../lib/platformAccess";
import { INVITE_COOLDOWN_MS, inviteAdmittedSignup } from "../../lib/inviteEmail";
import { createServerSupabase } from "../../lib/supabase";
import { markSessionsEnded } from "../mcp/mcp.service";
import { recordPasswordSet } from "../user/user.service";
import { authErrorShape, isAuthUpstreamFailure } from "../../lib/authUpstream";
import { AppError } from "../../lib/appError";
import { reportError, setOperation } from "../../lib/observability/report";
import { requestOriginIsWordAddin } from "../../lib/origins";
import { requireAuth } from "../../middleware/auth";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireTrustedOrigin } from "../../middleware/trustedOrigin";
import {
  applyHandoffSession,
  buildCallbackUrl,
  challengeAndVerifyMfa,
  challengeMfaFactor,
  confirmedInvitedAccount,
  consumeWordHandoff,
  credentialsSchema,
  currentUser,
  emailSchema,
  enrollMfaFactor,
  exchangeCodeForSession,
  exchangeSchema,
  factorSchema,
  friendlyNameSchema,
  handoffSchema,
  inviteSessionSchema,
  issueWordHandoff,
  listMfaFactors,
  mfaAssuranceLevel,
  passwordSchema,
  sendPasswordReset,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  googleSignInEnabled,
  startGoogleOAuth,
  ssoRequestSchema,
  startSsoSignIn,
  unenrollMfaFactor,
  updateEmail,
  updatePassword,
  verificationSchema,
  verifyEmailToken,
  verifyMfaChallenge,
  verifyOtpSchema,
  signupSchema,
} from "./auth.service";
import {
  describeAuthProviderError,
  describeAuthValidationIssues,
} from "./auth.messages";

export const authRouter = Router();

authRouter.use(requireTrustedOrigin);
authRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

function requestOrigin(req: Request): string {
  return new URL(req.get("origin") as string).origin;
}

function callbackUrl(
  req: Request,
  next: unknown,
  fallback: string,
  path = "/auth/callback",
): string {
  return buildCallbackUrl(requestOrigin(req), next, fallback, path);
}

function authError(
  res: Response,
  error: unknown,
  fallback = "Authentication could not be completed.",
) {
  const wire = describeAuthProviderError(error, fallback);
  if (wire.status < 500) {
    return res.status(wire.status).json({ code: wire.code, detail: wire.detail });
  }
  // A server-side failure goes through sendInternalError, the one place a
  // 5xx becomes a report line: reported once, logged, and marked so the
  // response sanitizer does not log it again. GoTrue being unreachable (no
  // answer, or a gateway 502/503/504) is an outage the user can only wait
  // out: 503 upstream_unavailable. A GoTrue 500 is GoTrue failing on
  // something of ours, so it stays a 500.
  const failure = new AppError(
    "auth.supabase_unavailable",
    "unexpected server-side authentication failure",
    { cause: error },
  );
  if (isAuthUpstreamFailure(error)) return sendUpstreamUnavailable(res, failure);
  return sendInternalError(res, failure);
}

/** What the identity service answers for a wrong email or password. */
const REFUSED_CREDENTIALS = {
  status: 400,
  code: "invalid_credentials",
  message: "Invalid login credentials",
};

/** What the identity service answers for an expired or unknown emailed value. */
const REFUSED_EMAIL_LINK = {
  status: 403,
  code: "otp_expired",
  message: "Email link is invalid or has expired",
};

function invalidBody(
  res: Response,
  issues?: ReadonlyArray<{ path: PropertyKey[]; code: string; message?: string }>,
) {
  res.status(400).json(describeAuthValidationIssues(issues ?? []));
}

function cookieClient(req: Request, res: Response): SupabaseClient | null {
  const client = res.locals.authClient as SupabaseClient | undefined;
  if (!client || res.locals.authSource !== "cookie") {
    res.status(401).json({
      code: "cookie_session_required",
      detail: "A cookie-authenticated session is required.",
    });
    return null;
  }
  return client;
}

authRouter.post("/login", asyncRoute(async (req, res) => {
  setOperation("auth.signin");
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res, parsed.error.issues);

  try {
    const client = createRequestSupabase(req, res);
    const { data, error } = await signInWithPassword(client, parsed.data);
    if (error || !data.user || !data.session) {
      // Read by the sign-in account limiters in app.ts: only a refused
      // email/password counts toward them. Any other failure (an unconfirmed
      // address, a suspended account, a provider outage) is not a wrong guess.
      const code = describeAuthProviderError(error, "").code;
      // A blocked account is answered, and counted, exactly as refused
      // credentials are: the answer must not tell the two apart.
      if (code === "user_banned") {
        res.locals.loginCredentialRejected = true;
        return authError(res, REFUSED_CREDENTIALS);
      }
      if (code === "invalid_credentials") {
        res.locals.loginCredentialRejected = true;
      }
      return authError(res, error);
    }
    res.json({ user: publicAuthUser(data.user) });
  } catch (error) {
    authError(res, error);
  }
}));

// The cache headers the auth client sets on the ordinary answer of the routes
// that start an email flow, repeated for the answer given without the request.
function setOrdinaryCacheHeaders(res: Response) {
  res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  res.setHeader("Expires", "0");
  res.setHeader("Pragma", "no-cache");
}

/**
 * Called once by each anonymous route that may have the auth service send a
 * mail, after the origin check and the validation of the body and before
 * anything is looked up; it counts the request. "send": the route goes on.
 * "silent": the address is at its cap (or, with `repeatWithinMs`, was counted
 * moments ago): the caller gives its ordinary answer and does nothing more.
 * "answered": the instance is at its cap and the 429 has been sent here.
 */
function admitAnonymousMail(
  res: Response,
  kind: MailKind,
  address: string,
  options: { repeatWithinMs?: number } = {},
): "send" | "silent" | "answered" {
  const admission = anonymousMailCap.admit(kind, address, options);
  if (admission.kind === "send") return "send";
  if (admission.kind === "overall_full") {
    res.setHeader("Retry-After", String(admission.retryAfterSeconds));
    res.setHeader("RateLimit-Limit", String(admission.limit));
    res.setHeader("RateLimit-Remaining", "0");
    res.setHeader("RateLimit-Reset", String(admission.retryAfterSeconds));
    res
      .status(429)
      .json(rateLimitedBody("Too many authentication requests. Please try again later."));
    return "answered";
  }
  return "silent";
}

// Beta mode: the same answer whether or not the email exists or is invited.
function inviteOnly(res: Response) {
  return res.status(403).json({
    code: "signup_invite_only",
    detail: "LiTT is in closed beta: an invitation is required.",
  });
}

/**
 * Closed beta: the caller proved nothing about the mailbox, so the answer to
 * an anonymous sign-up is one fixed reply sent before anything is looked up,
 * with no request-scoped client (no cookies) and nothing that depends on the
 * address. Only afterwards is the address checked and, if it is admitted by
 * an invitation or the administrator list, GoTrue mails its invitation link:
 * the person sets the password from it, the caller does not choose one. Asking
 * again for an address invited moments ago sends nothing. Never throws.
 */
async function admitBetaSignupAfterAnswer(email: string): Promise<void> {
  try {
    const db = createServerSupabase();
    if (!(await canSignUp(db, email))) return;
    const invited = await inviteAdmittedSignup(db, email);
    if (invited.kind === "failed") throw invited.error;
  } catch (error) {
    reportError(
      new AppError("auth.beta_signup_failed", "closed-beta sign-up invitation failed", { cause: error }),
      { level: "warning", tags: { component: "http" } },
    );
  }
}

authRouter.post("/signup", asyncRoute(async (req, res) => {
  setOperation("auth.signup");
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res, parsed.error.issues);

  // One decision per request, from the route, the mode and the address typed
  // only. Closed beta: a repeat within the invitation's own span is neither
  // counted nor carried on.
  const beta = betaMode();
  const admission = admitAnonymousMail(
    res,
    "signup",
    parsed.data.email,
    beta ? { repeatWithinMs: INVITE_COOLDOWN_MS } : {},
  );
  if (admission === "answered") return;

  if (beta) {
    res.status(201).json({ user: null, requiresEmailConfirmation: true });
    if (admission === "send") await admitBetaSignupAfterAnswer(parsed.data.email);
    return;
  }

  if (admission === "silent") {
    // Nothing is requested: the same kind of answer as a sign-up that sends
    // nothing new, with the cache headers the ordinary answer carries.
    setOrdinaryCacheHeaders(res);
    res.status(201).json({ user: null, requiresEmailConfirmation: true });
    return;
  }

  try {
    const client = createRequestSupabase(req, res);
    const { data, error } = await signUpWithPassword(
      client,
      parsed.data,
      callbackUrl(req, req.body?.next, "/onboarding/profile"),
    );
    if (error || !data.user) return authError(res, error);
    res.status(201).json({
      user: publicAuthUser(data.user),
      requiresEmailConfirmation: !data.session,
    });
  } catch (error) {
    authError(res, error);
  }
}));

async function startSso(req: Request, res: Response) {
  try {
    const config = ssoConfiguration();
    if (!config.enabled) {
      return res
        .status(403)
        .json({
          code: "sso_disabled",
          detail: "Single sign-on is not enabled.",
        });
    }
    const parsed = ssoRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalidBody(res);
    const emailDomain = parsed.data.email.slice(
      parsed.data.email.lastIndexOf("@") + 1,
    );
    const parsedDomain = ssoDomainSchema.safeParse(emailDomain);
    if (!parsedDomain.success) return invalidBody(res);
    const domain = parsedDomain.data;
    if (config.allowedDomains && !config.allowedDomains.includes(domain)) {
      return res
        .status(400)
        .json({
          code: "sso_domain_not_allowed",
          detail: "Single sign-on is not available for this domain.",
        });
    }
    const client = createRequestSupabase(req, res);
    const { data, error } = await startSsoSignIn(
      client,
      domain,
      callbackUrl(req, req.body?.next, "/onboarding/profile"),
    );
    if (error) {
      if (error.status && error.status >= 400 && error.status < 500) {
        return res
          .status(400)
          .json({
            code: "sso_unavailable",
            detail: "Unable to start single sign-on for this domain.",
          });
      }
      throw new Error("SSO provider request failed", { cause: error });
    }
    if (!data?.url) throw new Error("Missing SSO redirect");
    return res.json({ url: data.url });
  } catch (error) {
    // The thrown value stays the cause so the event names what failed
    // (a GoTrue status, a network code) without its message ever leaving.
    return sendInternalError(
      res,
      new AppError("auth.sso_failed", "SSO sign-in could not be started", {
        cause: error,
      }),
    );
  }
}

// Public and sessionless: the login and signup pages read it to decide
// whether to offer "Continue with SSO" and "Continue with Google". Only
// booleans leave the server (`google` is null when GoTrue can't be asked) —
// never the allowed domains or anything else about the providers.
authRouter.get("/providers", asyncRoute(async (_req, res) => {
  setOperation("auth.signin");
  res.json({
    sso: ssoEnabled(),
    google: await googleSignInEnabled(),
    // Closed beta: the sign-up page only works for someone invited, so the
    // login page words its footer accordingly. Not a secret: the sign-up
    // route says so to anyone who tries.
    inviteOnly: betaMode(),
  });
}));

authRouter.post("/oauth", asyncRoute(async (req, res) => {
  setOperation("auth.signin");
  if (betaMode()) return inviteOnly(res);
  if (req.body?.provider === "sso") return startSso(req, res);
  if (req.body?.provider !== "google") return invalidBody(res);
  try {
    const client = createRequestSupabase(req, res);
    const { data, error } = await startGoogleOAuth(
      client,
      callbackUrl(
        req,
        req.body?.next,
        "/onboarding/profile",
        req.body?.callbackPath === "/oauth-dialog.html"
          ? "/oauth-dialog.html"
          : "/auth/callback",
      ),
    );
    if (error || !data.url) return authError(res, error);
    res.json({ url: data.url });
  } catch (error) {
    authError(res, error);
  }
}));

authRouter.post("/exchange", asyncRoute(async (req, res) => {
  setOperation("auth.signin");
  const parsed = exchangeSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res);
  try {
    const client = createRequestSupabase(req, res);
    const { data, error } = await exchangeCodeForSession(
      client,
      parsed.data.code,
    );
    if (error || !data.user || !data.session) return authError(res, error);
    if (parsed.data.handoffRequestId) {
      setOperation("auth.handoff");
      if (!requestOriginIsWordAddin(req.get("origin"))) {
        res.status(403).json({
          code: "word_handoff_origin_required",
          detail: "The authentication handoff origin is not allowed.",
        });
        return;
      }
      const handoffTicket = await issueWordHandoff({
        userId: data.user.id,
        requestId: parsed.data.handoffRequestId,
        origin: requestOrigin(req),
        session: data.session,
      });
      res.json({ handoffTicket });
      return;
    }
    res.json({ user: publicAuthUser(data.user) });
  } catch (error) {
    authError(res, error);
  }
}));

// An invitation link (admin-issued, so no PKCE code) lands with the session
// in the URL hash; the page, once the person confirms, posts it here to become
// an HttpOnly cookie session. The pair is not tied to this browser, so it is
// adopted only when GoTrue vouches for the access token, the token comes from
// a just-redeemed invitation of an invited account, and this browser does not
// already hold another account's session.
const INVITE_SESSION_MAX_AGE_S = 60 * 60;

/**
 * The access token's own sign-in record: GoTrue records a redeemed email link
 * (invitation included) as an `otp` method with its time. Read only after
 * GoTrue has verified this exact token, so the claims are trusted.
 */
function isFreshInviteSession(accessToken: string, user: { invited_at?: string | null }): boolean {
  if (!user.invited_at) return false;
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    const now = Date.now() / 1000;
    return (
      Array.isArray(claims?.amr) &&
      claims.amr.some(
        (entry: { method?: unknown; timestamp?: unknown }) =>
          (entry?.method === "otp" || entry?.method === "invite") &&
          typeof entry.timestamp === "number" &&
          now - entry.timestamp >= -60 &&
          now - entry.timestamp < INVITE_SESSION_MAX_AGE_S,
      )
    );
  } catch {
    return false;
  }
}

const RECOVERY_SESSION_MAX_AGE_S = 60 * 60;

/**
 * Whether the access token records a sign-in by an emailed link (the recovery
 * link included) within the last hour: the holder proved control of the
 * mailbox. Read only for a token the session middleware has verified, so the
 * claims are trusted.
 */
function signedInByEmailedLink(accessToken: unknown): boolean {
  if (typeof accessToken !== "string") return false;
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    const now = Date.now() / 1000;
    return (
      Array.isArray(claims?.amr) &&
      claims.amr.some(
        (entry: { method?: unknown; timestamp?: unknown }) =>
          (entry?.method === "recovery" || entry?.method === "otp") &&
          typeof entry.timestamp === "number" &&
          now - entry.timestamp >= -60 &&
          now - entry.timestamp < RECOVERY_SESSION_MAX_AGE_S,
      )
    );
  } catch {
    return false;
  }
}

authRouter.post("/invite-session", asyncRoute(async (req, res) => {
  setOperation("auth.signin");
  const parsed = inviteSessionSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res);
  try {
    // Checked with the service client: the browser's own cookies stay untouched.
    const { data: linked, error: linkedError } = await createServerSupabase().auth.getUser(
      parsed.data.accessToken,
    );
    if (linkedError || !linked.user) return authError(res, linkedError);
    if (!isFreshInviteSession(parsed.data.accessToken, linked.user)) {
      return res.status(400).json({
        code: "invite_session_invalid",
        detail: "This invitation link is invalid or has expired.",
      });
    }
    const client = createRequestSupabase(req, res);
    const holder = await whoHoldsThisBrowser(client);
    if (holder && holder !== linked.user.id) {
      return res.status(409).json({
        code: "session_conflict",
        detail: "This browser is signed in as another account.",
      });
    }
    const { data, error } = await applyHandoffSession(client, {
      accessToken: parsed.data.accessToken,
      refreshToken: parsed.data.refreshToken,
    });
    if (error || !data.user || !data.session) {
      clearRequestAuthCookies(req, res);
      return authError(res, error);
    }
    res.json({ user: publicAuthUser(data.user) });
  } catch (error) {
    authError(res, error);
  }
}));

// The recovery, signup-confirmation and email-change emails link to
// /auth/confirm?token_hash=...&type=...; the page posts the hash here once the
// person clicks. Verifying server-side needs no PKCE
// verifier cookie, so the link works in any browser.
authRouter.post("/verify-otp", asyncRoute(async (req, res) => {
  setOperation("auth.signin");
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res);
  try {
    // Invitation-only mode: accounts are made by invitations, whose own door
    // opens the session. A sign-up value is refused as a wrong one is.
    if (parsed.data.type === "signup" && betaMode()) {
      clearRequestAuthCookies(req, res);
      return authError(res, REFUSED_EMAIL_LINK);
    }
    // The token is spent on a client that writes no cookies, so this browser
    // keeps its own session until we know whose session the token carries.
    const tokenClient = createCookielessSupabase();
    const startedAt = Date.now();
    const { data, error } = await verifyEmailToken(tokenClient, parsed.data);
    // Secure email change: the first of the two links GoTrue sends only
    // records its half (200, no user, no session). The change applies, and a
    // session is issued, when the second one is confirmed.
    if (
      parsed.data.type === "email_change" &&
      !error &&
      !data?.user &&
      !data?.session
    ) {
      return res.json({ user: null, pendingSecondConfirmation: true });
    }
    if (error || !data.user || !data.session) {
      // A spent email-change link must not sign out whoever is using this browser.
      if (parsed.data.type !== "email_change") clearRequestAuthCookies(req, res);
      return authError(res, error);
    }
    // A sign-up value opens a session only for an account that registered
    // itself. One an invitation created is answered as a wrong value is, and
    // the session just issued for it is ended.
    if (parsed.data.type === "signup" && confirmedInvitedAccount(data.user, startedAt)) {
      try {
        await tokenClient.auth.signOut({ scope: "local" });
      } catch (revokeError) {
        console.error("[auth/verify-otp] could not end the issued session", revokeError);
      }
      clearRequestAuthCookies(req, res);
      return authError(res, REFUSED_EMAIL_LINK);
    }
    // The token is spent either way. A browser that holds another account's
    // session never becomes this one by confirming a link: nothing is written.
    const client = createRequestSupabase(req, res);
    const holder = await whoHoldsThisBrowser(client);
    if (holder && holder !== data.user.id) {
      return res.status(409).json({
        code: "session_conflict",
        detail: "This browser is signed in as another account.",
      });
    }
    const { data: applied, error: applyError } = await applyHandoffSession(client, {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
    if (applyError || !applied.user || !applied.session) {
      clearRequestAuthCookies(req, res);
      return authError(res, applyError);
    }
    res.json({ user: publicAuthUser(applied.user) });
  } catch (error) {
    authError(res, error);
  }
}));

authRouter.post("/handoff", asyncRoute(async (req, res) => {
  setOperation("auth.handoff");
  const parsed = handoffSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res);
  if (!requestOriginIsWordAddin(req.get("origin"))) {
    res.status(403).json({
      code: "word_handoff_origin_required",
      detail: "The authentication handoff origin is not allowed.",
    });
    return;
  }

  try {
    const handoff = await consumeWordHandoff({
      ticket: parsed.data.ticket,
      requestId: parsed.data.requestId,
      origin: requestOrigin(req),
    });
    if (!handoff) {
      res.status(400).json({
        code: "invalid_auth_handoff",
        detail: "This authentication handoff is invalid or has expired.",
      });
      return;
    }

    const client = createRequestSupabase(req, res);
    const { data, error } = await applyHandoffSession(client, {
      accessToken: handoff.accessToken,
      refreshToken: handoff.refreshToken,
    });
    if (
      error ||
      !data.user ||
      !data.session ||
      data.user.id !== handoff.userId
    ) {
      clearRequestAuthCookies(req, res);
      return authError(
        res,
        error,
        "Authentication handoff could not be completed.",
      );
    }
    res.json({ user: publicAuthUser(data.user) });
  } catch (error) {
    authError(res, error, "Authentication handoff could not be completed.");
  }
}));

// A recovery request that fails is worth seeing (the auth service down, or its
// mailer), so it is reported, as a warning, with no trace of the address.
function reportPasswordResetFailure(error: unknown) {
  reportError(
    new AppError("auth.password_reset_failed", "password reset request failed", {
      cause: error,
    }),
    { level: "warning", tags: { component: "http" } },
  );
}

// A password set through LiTT is recorded on the account (best effort: the
// password is already changed, so a failure only leaves it unrecorded). It is
// reported as a warning, with no trace of the address or of the cause.
async function recordPasswordMark(userId: string) {
  let failure: string | null = null;
  try {
    const result = await recordPasswordSet(createServerSupabase(), userId);
    if (!result.ok) failure = result.kind;
  } catch {
    failure = "threw";
  }
  if (failure === null) return;
  reportError(
    new AppError("auth.password_mark_failed", `password set could not be recorded (${failure})`),
    { level: "warning", tags: { component: "http" } },
  );
}

/**
 * Closed beta: asked after the answer has gone out, so that nothing the answer
 * or its timing shows depends on the address. Never throws.
 */
async function requestRecoveryAfterAnswer(req: Request, email: string): Promise<void> {
  try {
    if (!(await mayRecoverPassword(createServerSupabase(), email))) return;
    const { error } = await sendPasswordReset(
      createCookielessSupabase(),
      email,
      callbackUrl(req, "/reset-password", "/reset-password"),
    );
    if (error) throw error;
  } catch (error) {
    reportPasswordResetFailure(error);
  }
}

authRouter.post("/password-reset", asyncRoute(async (req, res) => {
  setOperation("auth.signin");
  const email = emailSchema.safeParse(req.body?.email);
  if (email.success) {
    const beta = betaMode();
    const admission = admitAnonymousMail(res, "reset", email.data);
    if (admission === "answered") return;
    if (admission !== "send" || beta) setOrdinaryCacheHeaders(res);
    if (beta) {
      res.status(204).end();
      if (admission === "send") await requestRecoveryAfterAnswer(req, email.data);
      return;
    }
    if (admission === "send") try {
      const client = createRequestSupabase(req, res);
      const { error } = await sendPasswordReset(
        client,
        email.data,
        callbackUrl(req, "/reset-password", "/reset-password"),
      );
      if (error) throw error;
    } catch (error) {
      // Deliberately indistinguishable to prevent account enumeration: the
      // response is the same 204 either way.
      reportPasswordResetFailure(error);
    }
  }
  res.status(204).end();
}));

authRouter.get("/session", requireAuth, asyncRoute(async (_req, res) => {
  setOperation("auth.session");
  const client = cookieClient(_req, res);
  if (!client) return;
  const { user, error } = await currentUser(client);
  if (error || !user) return authError(res, error);
  res.json({ user: publicAuthUser(user) });
}));

/**
 * Who holds this browser's session: a person -> their id. A recognised "no
 * session" answer -> null. Anything else, including an answer with neither an
 * identified person nor an error, means we could not tell and throws.
 */
async function whoHoldsThisBrowser(client: ReturnType<typeof createRequestSupabase>): Promise<string | null> {
  const { data, error } = await client.auth.getUser();
  if (data.user?.id) return data.user.id;
  if (error) {
    const failure = authErrorShape(error);
    const status = failure?.status ?? 0;
    const noSession =
      !isAuthUpstreamFailure(error) &&
      (failure?.name === "AuthSessionMissingError" ||
        (failure?.name === "AuthApiError" && status >= 400 && status < 500 && status !== 429));
    if (noSession) return null;
  }
  throw new AppError("auth.supabase_unavailable", "could not tell who holds the session", { cause: error });
}

/** The identity service's own failure behind one that `signOut` threw. */
function revocationCause(error: unknown): unknown {
  return error instanceof AppError ? error.cause : error;
}

authRouter.post("/logout", asyncRoute(async (req, res) => {
  setOperation("auth.session");
  const scope = req.body?.scope === "global" ? "global" : "local";
  let connectionsFailure: unknown = null;
  let revokeFailure: unknown = null;
  let signingOut: string | null = null;
  try {
    const client = createRequestSupabase(req, res);
    // Signing out everywhere ends the connected applications too, once the
    // sessions are revoked. The sign-out goes ahead whatever the lookup says,
    // and a failure to record it is answered after the sessions are over.
    if (scope === "global") {
      try {
        signingOut = await whoHoldsThisBrowser(client);
      } catch (error) {
        connectionsFailure = error;
      }
    }
    await signOut(client, scope);
  } catch (error) {
    revokeFailure = error;
  } finally {
    // Stamped after the sign-out, whether or not it succeeded.
    if (signingOut) {
      try {
        await markSessionsEnded(createServerSupabase(), signingOut, "signed_out_everywhere");
      } catch (error) {
        connectionsFailure = error;
      }
    }
    clearRequestAuthCookies(req, res);
  }
  if (connectionsFailure) throw connectionsFailure;
  if (revokeFailure) {
    // Everywhere: other sessions may still be open, so the person is told so.
    if (scope === "global") return authError(res, revocationCause(revokeFailure));
    // This browser only: its cookies are cleared, so it is signed out; the
    // identity service's refusal to revoke the token is reported, not shown.
    const failure =
      revokeFailure instanceof AppError
        ? revokeFailure
        : new AppError("auth.supabase_unavailable", "upstream sign-out failed", { cause: revokeFailure });
    reportError(failure, { level: "warning", tags: { component: "http" } });
    console.error("[auth/logout] upstream sign-out failed", failure);
  }
  res.status(204).end();
}));

authRouter.patch("/email", requireAuth, asyncRoute(async (req, res) => {
  setOperation("auth.session");
  const email = emailSchema.safeParse(req.body?.email);
  if (!email.success) return invalidBody(res);
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await updateEmail(
    client,
    email.data,
    callbackUrl(req, req.body?.next, "/settings?emailChange=processed"),
  );
  if (error || !data.user) return authError(res, error);
  res.json({ user: publicAuthUser(data.user) });
}));

authRouter.patch("/password", requireAuth, asyncRoute(async (req, res) => {
  setOperation("auth.session");
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res, parsed.error.issues);
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await updatePassword(client, parsed.data.password);
  if (error || !data.user) return authError(res, error);
  await recordPasswordMark(res.locals.userId as string);
  // A password set through the emailed link proves control of the mailbox: the
  // refused sign-ins counted against this session's own address are forgotten,
  // so the next sign-in is judged on its own. Set by app.ts.
  const clearRefusals = res.locals.clearLoginRefusals as ((address: string) => void) | undefined;
  if (clearRefusals && res.locals.userEmail && signedInByEmailedLink(res.locals.token)) {
    clearRefusals(res.locals.userEmail as string);
  }
  if (parsed.data.signOut) {
    // Connected applications end with the sessions: stamped once they are
    // revoked. If that cannot be recorded the sessions are still over, and
    // the failure is answered after the cookies are cleared.
    let failure: unknown = null;
    let revokeFailure: unknown = null;
    try {
      await signOut(client, "global");
    } catch (error) {
      revokeFailure = error;
    }
    try {
      await markSessionsEnded(createServerSupabase(), res.locals.userId as string, "password_recovery_sign_out");
    } catch (error) {
      failure ??= error;
    }
    clearRequestAuthCookies(req, res);
    if (failure) throw failure;
    // Other sessions may still be open: the password changed, the sign-out did not finish.
    if (revokeFailure) return authError(res, revocationCause(revokeFailure));
  }
  res.json({ user: publicAuthUser(data.user) });
}));

authRouter.get("/mfa/factors", requireAuth, asyncRoute(async (req, res) => {
  setOperation("auth.mfa");
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await listMfaFactors(client);
  if (error) return authError(res, error);
  res.json(data);
}));

authRouter.get("/mfa/assurance", requireAuth, asyncRoute(async (req, res) => {
  setOperation("auth.mfa");
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await mfaAssuranceLevel(client);
  if (error) return authError(res, error);
  res.json(data);
}));

authRouter.post("/mfa/enroll", requireAuth, asyncRoute(async (req, res) => {
  setOperation("auth.mfa");
  const friendlyName = friendlyNameSchema.safeParse(req.body?.friendlyName);
  if (!friendlyName.success) return invalidBody(res);
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await enrollMfaFactor(client, friendlyName.data);
  if (error) return authError(res, error);
  res.status(201).json(data);
}));

authRouter.post("/mfa/challenge", requireAuth, asyncRoute(async (req, res) => {
  setOperation("auth.mfa");
  const parsed = factorSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res);
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await challengeMfaFactor(client, parsed.data);
  if (error) return authError(res, error);
  res.json(data);
}));

authRouter.post("/mfa/verify", requireAuth, asyncRoute(async (req, res) => {
  setOperation("auth.mfa");
  const parsed = verificationSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.challengeId) return invalidBody(res);
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await verifyMfaChallenge(client, {
    factorId: parsed.data.factorId,
    challengeId: parsed.data.challengeId,
    code: parsed.data.code,
  });
  if (error) return authError(res, error);
  res.json({ user: publicAuthUser(data.user) });
}));

authRouter.post("/mfa/challenge-and-verify", requireAuth, asyncRoute(async (req, res) => {
  setOperation("auth.mfa");
  const parsed = verificationSchema.safeParse(req.body);
  if (!parsed.success) return invalidBody(res);
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await challengeAndVerifyMfa(client, {
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error) return authError(res, error);
  res.json({ user: publicAuthUser(data.user) });
}));

authRouter.delete("/mfa/factors/:factorId", requireAuth, asyncRoute(async (req, res) => {
  setOperation("auth.mfa");
  const parsed = factorSchema.safeParse({ factorId: req.params.factorId });
  if (!parsed.success) return invalidBody(res);
  const client = cookieClient(req, res);
  if (!client) return;
  const { data, error } = await unenrollMfaFactor(client, parsed.data);
  if (error) return authError(res, error);
  res.json(data);
}));

authRouter.use(routerErrorHandler("[auth]"));
