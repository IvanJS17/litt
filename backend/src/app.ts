import "dotenv/config";
import { rateLimitedBody } from "./lib/httpError";
import { createHash } from "node:crypto";
import http from "node:http";
import { PassThrough } from "node:stream";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { chatRouter } from "./modules/chat/chat.routes";
import { wordChatRouter } from "./modules/word-chat/wordChat.routes";
import { projectsRouter } from "./modules/projects/projects.routes";
import { orgsRouter } from "./modules/orgs/orgs.routes";
import { platformRouter } from "./modules/platform/platform.routes";
import { orgTrainingRouter, trainingRouter } from "./modules/training/training.routes";
import { pupilReadingsRouter, trainingReadingsRouter } from "./modules/training-full-reading/trainingFullReading.routes";
import { firmCriteriaRouter } from "./modules/firm-criteria/firmCriteria.routes";
import { gymCasesRouter, myGymRouter, pupilGymRouter } from "./modules/training-gym/trainingGym.routes";
import { trainingNotesRouter } from "./modules/training-notes/trainingNotes.routes";
import {
    pupilCriterionRouter,
    pupilNotesRouter,
    trainingCriterionRouter,
} from "./modules/training-criterion/trainingCriterion.routes";
import { myBackingRouter, pupilBackingRouter } from "./modules/training-backing/trainingBacking.routes";
import { myCriteriaContrastRouter, pupilCriteriaContrastRouter } from "./modules/training-criteria-contrast/trainingCriteriaContrast.routes";
import {
    pupilReviewAuditsRouter,
    reviewAuditRouter,
} from "./modules/training-review-audit/trainingReviewAudit.routes";
import {
    pupilDefensesRouter,
    pupilPassesRouter,
    pupilPromotionRouter,
    pupilWorksRouter,
    trainingSupervisionRouter,
} from "./modules/training-supervision/trainingSupervision.routes";
import { projectChatRouter } from "./modules/project-chat/projectChat.routes";
import { documentsRouter } from "./modules/documents/documents.routes";
import { libraryRouter } from "./modules/library/library.routes";
import { tabularRouter } from "./modules/tabular/tabular.routes";
import { workflowsRouter } from "./modules/workflows/workflows.routes";
import { quickActionsRouter } from "./modules/quick-actions/quickActions.routes";
import { workflowAddonsRouter } from "./modules/workflows/workflowAddons.routes";
import { userRouter } from "./modules/user/user.routes";
import { modelsRouter } from "./modules/models/models.routes";
import { downloadsRouter } from "./modules/downloads/downloads.routes";
import { auditRouter } from "./modules/audit/audit.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { uploadSessionsRouter } from "./modules/uploads/uploads.routes";
import {
  projectMemoryRouter,
  userMemoryRouter,
} from "./modules/memory/memory.routes";
import { playbooksRouter } from "./modules/playbooks/playbooks.routes";
import { aiRecoveryRouter } from "./modules/ai-recovery/ai-recovery.routes";
import { mcpConsentRouter, mcpPublicRouter } from "./modules/mcp/mcp.routes";
import { matterSettingsRouter, mattersRouter } from "./modules/matters/matters.routes";
import { clientProfileRouter } from "./modules/client-profile/client-profile.routes";
import { matterRadarRouter, radarTodayRouter, ruleProposalsRouter } from "./modules/radar/radar.routes";
import { retainerReportRouter } from "./modules/retainer-report/retainer-report.routes";
import { donnaUsageRouter, requestCountsRouter, requestsRouter, requestTypesRouter } from "./modules/requests/requests.routes";
import { manifestPublicKey } from "./lib/manifestSigning";
import {
  handleUnhandledError,
  protectInternalErrorResponses,
} from "./middleware/internalErrorResponse";
import { configuredAllowedOrigins } from "./lib/origins";
import { hours, minutes } from "./lib/limiterWindow";
import { envInt, sourceCommit } from "./lib/runtimeConfig";
import { requestDiagnostics } from "./middleware/requestDiagnostics";
import { startInTurn } from "./middleware/startInTurn";
import { requireAuth } from "./middleware/auth";

export const app = express();
const isProduction = process.env.NODE_ENV === "production";

// Ceiling for JSON API requests from an authenticated caller. The clients keep
// a copy as JSON_BODY_LIMIT_BYTES in packages/client/src/requestLimits.ts;
// change both together.
const JSON_BODY_LIMIT = "50mb";
// What any caller, signed in or not, makes the API read before it has been
// authenticated. The clients never send more than this unauthenticated, so
// the number has no client copy.
const PREAUTH_JSON_BODY_BYTES = 1024 * 1024;

// No client compresses a request body, so a compressed one is refused (415)
// instead of being inflated to the parser's limit from a few kilobytes.
function jsonBodyParser(limit: number | string): express.RequestHandler {
  const parse = express.json({ limit, inflate: false });
  return (req, res, next) =>
    parse(req, res, (error?: unknown) => {
      if ((error as { type?: unknown } | undefined)?.type === "encoding.unsupported") {
        return void res.status(415).json({
          code: "unsupported_content_encoding",
          detail: "Compressed request bodies are not accepted.",
        });
      }
      next(error);
    });
}
const preAuthJson = jsonBodyParser(PREAUTH_JSON_BODY_BYTES);
const authenticatedJson = jsonBodyParser(JSON_BODY_LIMIT);

// requireAuth resolves a request once, so the router's own requireAuth does not
// look the caller up again.
function authenticateThenReadAll(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
  paused = false,
) {
  requireAuth(req as never, res, (error?: unknown) => {
    if (error) return next(error);
    authenticatedJson(req, res, next);
    // The parser has attached its listeners; a stream paused while it was
    // buffered ahead of authentication does not flow on its own.
    if (paused) req.resume();
  }).catch(next);
}

// A body no larger than the pre-auth cap is parsed for everyone. A larger one
// is read only after the caller has been authenticated. Anything that is not
// JSON is not read here.
function jsonBodyAdmission(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  // A parser earlier on the path (the Word tool-result one) has read the body:
  // nothing is left on the stream to wait for.
  if (!req.readable) return next();
  const declared = Number(req.headers["content-length"] ?? Number.NaN);
  const encoding = req.headers["content-encoding"]?.toLowerCase();
  const compressed = encoding !== undefined && encoding !== "identity";
  if (
    (Number.isFinite(declared) && declared <= PREAUTH_JSON_BODY_BYTES) ||
    compressed || // refused by the parser before it reads anything
    !req.is("application/json")
  ) {
    return preAuthJson(req, res, next);
  }
  if (!Number.isFinite(declared)) return admitUndeclaredBody(req, res, next);
  authenticateThenReadAll(req, res, next);
}

// A body whose length is not declared (a chunked request: the web gateway
// streams bodies without a content-length) is read until it ends or passes the
// pre-auth cap. One that ends within the cap is an ordinary small body and is
// parsed by the pre-auth parser, anonymous or not. One that passes the cap is
// handed back to the stream untouched, then read only after authentication.
function admitUndeclaredBody(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const chunks: Buffer[] = [];
  let size = 0;
  const stop = () => {
    req.off("data", onData);
    req.off("end", onEnd);
    req.off("error", onError);
    req.off("close", onClose);
  };
  function onData(chunk: Buffer) {
    chunks.push(chunk);
    size += chunk.length;
    if (size <= PREAUTH_JSON_BODY_BYTES) return;
    req.pause();
    stop();
    req.unshift(Buffer.concat(chunks));
    // Refused before the body was read: discard the rest, as Node does for any
    // unread body, so the connection is not left stuck behind it.
    res.once("finish", () => {
      if (!req.complete) req.resume();
    });
    authenticateThenReadAll(req, res, next, true);
  }
  function onEnd() {
    stop();
    // The parser reads a stream that carries the same headers with a declared
    // length, so it gives the results and errors it gives for any small body.
    const body = new PassThrough() as PassThrough & {
      headers: http.IncomingHttpHeaders;
      body?: unknown;
    };
    const { "transfer-encoding": _chunked, ...headers } = req.headers;
    body.headers = { ...headers, "content-length": String(size) };
    body.end(Buffer.concat(chunks));
    preAuthJson(body as never, res, (error?: unknown) => {
      if (error) return next(error);
      req.body = body.body;
      next();
    });
  }
  function onError(error: Error) {
    stop();
    next(error);
  }
  // The caller left: nobody is waiting for an answer.
  function onClose() {
    stop();
  }
  req.on("data", onData);
  req.on("end", onEnd);
  req.on("error", onError);
  req.on("close", onClose);
}

function makeLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
  skip?: (req: express.Request) => boolean;
  keyGenerator?: (req: express.Request) => string;
  skipSuccessfulRequests?: boolean;
  requestWasSuccessful?: (req: express.Request, res: express.Response) => boolean;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS" || options.skip?.(req) === true,
    keyGenerator: options.keyGenerator,
    skipSuccessfulRequests: options.skipSuccessfulRequests,
    ...(options.requestWasSuccessful
      ? { requestWasSuccessful: options.requestWasSuccessful }
      : {}),
    // A machine code lets clients classify the failure without parsing
    // prose; the detail stays specific to the lane that was exhausted.
    message: rateLimitedBody(
      options.message ?? "Too many requests. Please try again later.",
    ),
  });
}

// The Word tool-result return channel gets its own lane: an edit-heavy turn
// makes one POST per forwarded tool call, and letting those drain the shared
// 300-request budget (per office NAT egress IP) turns a 429 into a full
// tool-deadline stall per call inside a held SSE stream.
const TOOL_RESULT_PATH = "/word-chat/tool-result";

const generalLimiter = makeLimiter({
  windowMs: minutes(envInt("RATE_LIMIT_GENERAL_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_GENERAL_MAX", 300),
  // Upload status polling has its own authenticated per-user limiter and
  // address lane (uploadSessionIpLimiter). Keep them and the dedicated Word
  // tool-result lane out of the shared IP budget.
  skip: (req) =>
    req.path === TOOL_RESULT_PATH ||
    req.path === "/upload-sessions" ||
    req.path.startsWith("/upload-sessions/"),
});

// Requests to /upload-sessions without a signed-in user are counted per
// address before the router, at the general lane's ceiling. Signed-in calls,
// including status polling, are not counted here: the per-user lanes in the
// router bound those.
const uploadSessionIpLimiter = makeLimiter({
  windowMs: minutes(envInt("RATE_LIMIT_UPLOAD_SESSION_IP_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_UPLOAD_SESSION_IP_MAX", 300),
  message: "Too many upload requests. Please try again later.",
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => typeof res.locals.userId === "string",
});

const toolResultLimiter = makeLimiter({
  windowMs: minutes(envInt("RATE_LIMIT_TOOL_RESULT_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_TOOL_RESULT_MAX", 2000),
  message: "Too many tool results. Please try again later.",
});

const chatLimiter = makeLimiter({
  windowMs: minutes(envInt("RATE_LIMIT_CHAT_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_CHAT_MAX", 30),
  message: "Too many chat requests. Please try again later.",
});

const chatCreateLimiter = makeLimiter({
  windowMs: minutes(envInt("RATE_LIMIT_CHAT_CREATE_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_CHAT_CREATE_MAX", 60),
});

const exportLimiter = makeLimiter({
  windowMs: hours(envInt("RATE_LIMIT_EXPORT_WINDOW_HOURS", 1)),
  max: envInt("RATE_LIMIT_EXPORT_MAX", 10),
  message: "Too many export requests. Please try again later.",
});

const workflowImportLimiter = makeLimiter({
  windowMs: hours(envInt("RATE_LIMIT_UPLOAD_WINDOW_HOURS", 1)),
  max: envInt("RATE_LIMIT_UPLOAD_MAX", 50),
  message: "Too many workflow imports. Please try again later.",
});

const playbookImportLimiter = makeLimiter({
  windowMs: hours(envInt("RATE_LIMIT_UPLOAD_WINDOW_HOURS", 1)),
  max: envInt("RATE_LIMIT_UPLOAD_MAX", 50),
  message: "Too many playbook imports. Please try again later.",
});

const dataDeleteLimiter = makeLimiter({
  windowMs: hours(envInt("RATE_LIMIT_DATA_DELETE_WINDOW_HOURS", 1)),
  max: envInt("RATE_LIMIT_DATA_DELETE_MAX", 20),
  message: "Too many data deletion requests. Please try again later.",
});

const authLoginIpLimiter = makeLimiter({
  windowMs: minutes(envInt("RATE_LIMIT_AUTH_LOGIN_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_AUTH_LOGIN_MAX", 30),
  message: "Too many login attempts. Please try again later.",
  skipSuccessfulRequests: true,
});

// Only a credential the identity provider refused spends an account budget:
// the auth router sets res.locals.loginCredentialRejected at that point.
// Origin and schema refusals, provider outages, an unconfirmed address and
// successful sign-ins never presented a wrong credential.
const loginWasNotCredentialRefusal = (
  _req: express.Request,
  res: express.Response,
) => res.locals.loginCredentialRejected !== true;

function loginAccountDigest(req: express.Request): string | null {
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  return email ? createHash("sha256").update(email).digest("hex") : null;
}

function loginClient(req: express.Request): string {
  return ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown");
}

// Per (account, client): one caller's refusals cannot spend the budget another
// caller needs to sign in to the same account.
const authLoginAccountLimiter = makeLimiter({
  windowMs: minutes(envInt("RATE_LIMIT_AUTH_ACCOUNT_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_AUTH_ACCOUNT_MAX", 10),
  message: "Too many login attempts. Please try again later.",
  skipSuccessfulRequests: true,
  requestWasSuccessful: loginWasNotCredentialRefusal,
  keyGenerator: (req) => {
    const digest = loginAccountDigest(req);
    return digest
      ? `email:${digest}:${loginClient(req)}`
      : `ip:${loginClient(req)}`;
  },
});

// Across clients, against guessing spread over many addresses: much larger
// than the lane above so it adds friction without being a lockout of its own.
const authLoginAccountGlobalLimiter = makeLimiter({
  windowMs: minutes(envInt("RATE_LIMIT_AUTH_ACCOUNT_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_AUTH_ACCOUNT_GLOBAL_MAX", 100),
  message: "Too many login attempts. Please try again later.",
  skipSuccessfulRequests: true,
  requestWasSuccessful: loginWasNotCredentialRefusal,
  keyGenerator: (req) => {
    const digest = loginAccountDigest(req);
    return digest ? `email:${digest}` : `ip:${loginClient(req)}`;
  },
});

const authEmailLimiter = makeLimiter({
  windowMs: hours(envInt("RATE_LIMIT_AUTH_EMAIL_WINDOW_HOURS", 1)),
  max: envInt("RATE_LIMIT_AUTH_EMAIL_MAX", 10),
  message: "Too many authentication requests. Please try again later.",
});

const authFlowLimiter = makeLimiter({
  windowMs: minutes(envInt("RATE_LIMIT_AUTH_FLOW_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_AUTH_FLOW_MAX", 30),
  message: "Too many authentication requests. Please try again later.",
});

const authMfaLimiter = makeLimiter({
  windowMs: minutes(envInt("RATE_LIMIT_AUTH_MFA_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_AUTH_MFA_MAX", 20),
  message: "Too many verification attempts. Please try again later.",
});

// The MCP server's public surface: /oauth/*, discovery and /mcp. Every MCP
// client behind one vendor shares a few egress IPs, so the IP lanes are
// generous; abuse is bounded by the registration lane below and by the
// purge of unused clients, and per-grant limits come with the MCP gate.
const mcpPublicLimiter = makeLimiter({
  windowMs: minutes(envInt("RATE_LIMIT_MCP_PUBLIC_WINDOW_MINUTES", 15)),
  max: envInt("RATE_LIMIT_MCP_PUBLIC_MAX", 3000),
  message: "Too many requests. Please try again later.",
});
const mcpAuthorizeLimiter = makeLimiter({
  windowMs: hours(envInt("RATE_LIMIT_MCP_AUTHORIZE_WINDOW_HOURS", 1)),
  max: envInt("RATE_LIMIT_MCP_AUTHORIZE_MAX", 120),
  message: "Too many authorization requests. Please try again later.",
});
const mcpRegisterLimiter = makeLimiter({
  windowMs: hours(envInt("RATE_LIMIT_MCP_REGISTER_WINDOW_HOURS", 1)),
  max: envInt("RATE_LIMIT_MCP_REGISTER_MAX", 60),
  message: "Too many client registrations. Please try again later.",
});

app.disable("x-powered-by");
app.set("trust proxy", envInt("TRUST_PROXY_HOPS", 1));
// First, before anything is counted or read for the request.
app.use(startInTurn);
app.use(requestDiagnostics);
app.use(protectInternalErrorResponses);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: isProduction
      ? {
          maxAge: 15552000,
          includeSubDomains: true,
        }
      : false,
    referrerPolicy: { policy: "no-referrer" },
  }),
);

export { configuredAllowedOrigins } from "./lib/origins";

// MCP: before the app CORS, the general limiter and the global JSON parser,
// because it has its own (open CORS for discovery and the token endpoints, an
// Origin allowlist for /mcp, body parsers sized for each endpoint). Nothing
// answers unless LITT_MCP_SERVER=enabled.
app.post("/oauth/register", mcpRegisterLimiter);
app.get("/oauth/authorize", mcpAuthorizeLimiter);
app.use(["/oauth", "/mcp", "/.well-known"], mcpPublicLimiter);
app.use(mcpPublicRouter);

const allowedOrigins = configuredAllowedOrigins();

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests (no Origin header) and any
      // explicitly listed origin. A disallowed origin resolves to `false`
      // (cors omits the Access-Control-Allow-Origin header and the browser
      // blocks the response) rather than calling back with an Error —
      // throwing here would propagate to Express's default handler and turn
      // every disallowed cross-origin request, including preflight, into an
      // HTTP 500.
      callback(null, !origin || allowedOrigins.has(origin));
    },
    credentials: true,
    allowedHeaders: ["Authorization", "Content-Type"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // The request id is the correlation key between a user report and the
    // access log. Browsers hide response headers from
    // cross-origin scripts unless they are listed here, so a dev build or a
    // self-hoster serving the API from another origin could not read it.
    exposedHeaders: ["X-Request-ID"],
  }),
);

app.use(generalLimiter);
app.use("/upload-sessions", uploadSessionIpLimiter);

app.post("/auth/login", authLoginIpLimiter);
app.post(["/auth/signup", "/auth/password-reset"], authEmailLimiter);
app.post(["/auth/oauth", "/auth/exchange", "/auth/verify-otp", "/auth/handoff"], authFlowLimiter);
app.post(
  ["/auth/mfa/verify", "/auth/mfa/challenge-and-verify"],
  authMfaLimiter,
);

app.post("/chat", chatLimiter);
app.post("/word-chat", chatLimiter);
// Own limiter lane plus a tight body cap: the largest legitimate payload is
// one live document read, which the backend truncates at 200k characters
// anyway — 2mb leaves headroom for UTF-8 and JSON escaping while keeping the
// 50mb ceiling out of reach of this endpoint. This parser runs before the
// general one; body-parser skips a request whose body is already parsed, so
// the smaller limit wins for this path. The route is for signed-in callers
// only, so the session is checked before the body is read.
app.post(TOOL_RESULT_PATH, toolResultLimiter, requireAuth, jsonBodyParser("2mb"));
app.post("/projects/:projectId/chat", chatLimiter);
app.post("/tabular-review/:reviewId/chat", chatLimiter);
app.post("/tabular-review/:reviewId/generate", chatLimiter);
// A playbook review is one large model call (or a tool loop when the playbook
// has supplementary documents), so it shares the chat lane's budget.
app.post("/playbooks/:playbookId/review", chatLimiter);
// A mentor's corrections turned into proposed rules are one model call too.
app.post("/playbooks/:playbookId/corrections", chatLimiter);
// A training work review is one model call on the mentor's key.
app.post("/orgs/:orgId/training/pupils/:userId/works/:surface/:chatId/review", chatLimiter);
// So are a defense's questions.
app.post("/orgs/:orgId/training/pupils/:userId/defenses/:defenseId/questions", chatLimiter);
// The machine's reading of a training reading is two model calls on the person's key.
app.post("/training/me/readings/:readingId/compare", chatLimiter);
// A retake is one model call to make the question and one to judge the answer, on the person's key.
app.post("/training/me/retakes", chatLimiter);
app.put("/training/me/retakes/:retakeId/answer", chatLimiter);
// A gym case draft is one model call on the mentor's key.
app.post("/orgs/:orgId/training/gym/cases/draft", chatLimiter);
app.post("/chat/create", chatCreateLimiter);
app.post("/workflow-addons/:addonId/import", workflowImportLimiter);
app.post(
  // A draft from the questionnaire, or changes proposed for a copy, is one
  // compile, like an import.
  [
    "/playbooks/import",
    "/playbooks/import/upload-url",
    "/playbooks/drafts",
    "/playbooks/:playbookId/proposals",
  ],
  playbookImportLimiter,
);
const legacyUploadRemoved = (_req: express.Request, res: express.Response) => {
  res.status(410).json({
    code: "upload_session_required",
    detail: "This upload endpoint has been replaced by /upload-sessions.",
  });
};

// Reject the former multipart endpoints before any body parser or route-level
// body-reading middleware can consume file bytes. Browser clients use the
// direct object-storage upload-session protocol instead.
app.post("/single-documents", legacyUploadRemoved);
app.post("/library/:kind/documents", legacyUploadRemoved);
app.post("/single-documents/:documentId/versions", legacyUploadRemoved);
app.put(
  "/single-documents/:documentId/versions/:versionId/file",
  legacyUploadRemoved,
);
app.post("/projects/:projectId/documents", legacyUploadRemoved);
app.get("/projects/:projectId/export", exportLimiter);
// Scheduling an async export costs what the synchronous project export above
// costs — a whole-corpus walk, just on a worker — so it shares its budget.
// Deliberately POST-only: the /user/exports/:id poll and its download
// stay on the general limiter, because a client polls every couple of seconds
// while an export builds and a 10/hour budget would lock the user out of an
// export they legitimately scheduled.
app.post("/user/exports", exportLimiter);
app.delete("/user/account", dataDeleteLimiter);
app.delete("/user/chats", dataDeleteLimiter);
app.delete("/user/projects", dataDeleteLimiter);
app.delete("/user/tabular-reviews", dataDeleteLimiter);

app.use(jsonBodyAdmission);

// Body-aware account throttling complements the per-IP login limiter. The key
// is a one-way digest, so email addresses never enter the limiter store.
app.post("/auth/login", authLoginAccountGlobalLimiter, authLoginAccountLimiter);

app.use("/auth", authRouter);
app.use("/mcp-connect", mcpConsentRouter);
app.use("/chat", chatRouter);
app.use("/word-chat", wordChatRouter);
app.use("/models", modelsRouter);
app.use("/projects/:projectId/ai-executions", aiRecoveryRouter);
app.use("/projects/:projectId/matters/:matterId/requests", requestsRouter);
app.use("/projects/:projectId/matters/:matterId/profile", clientProfileRouter);
app.use("/projects/:projectId/matters/:matterId/radar", matterRadarRouter);
app.use("/projects/:projectId/rule-proposals", ruleProposalsRouter);
app.use("/projects/:projectId/matters/:matterId/report", retainerReportRouter);
app.use("/projects/:projectId/matters", matterSettingsRouter);
app.use("/matters", mattersRouter);
app.use("/projects/:projectId/memory", projectMemoryRouter);
app.use("/projects", projectsRouter);
app.use("/orgs/:orgId/training/pupils/:userId/works", pupilWorksRouter);
app.use("/orgs/:orgId/training/pupils/:userId/passes", pupilPassesRouter);
app.use("/orgs/:orgId/training/pupils/:userId/defenses", pupilDefensesRouter);
app.use("/orgs/:orgId/training/pupils/:userId/promotion", pupilPromotionRouter);
app.use("/orgs/:orgId/training/pupils/:userId/notes", pupilNotesRouter);
app.use("/orgs/:orgId/training/pupils/:userId/criterion", pupilCriterionRouter);
app.use("/orgs/:orgId/training/pupils/:userId/backing", pupilBackingRouter);
app.use("/orgs/:orgId/training/pupils/:userId/criteria-contrasts", pupilCriteriaContrastRouter);
app.use("/orgs/:orgId/training/pupils/:userId/review-audits", pupilReviewAuditsRouter);
app.use("/orgs/:orgId/training/pupils/:userId/readings", pupilReadingsRouter);
app.use("/orgs/:orgId/training/pupils/:userId/gym/attempts", pupilGymRouter);
app.use("/orgs/:orgId/training/gym/cases", gymCasesRouter);
app.use("/orgs/:orgId/firm-criteria", firmCriteriaRouter);
app.use("/orgs/:orgId/request-types", requestTypesRouter);
app.use("/orgs/:orgId/requests", requestCountsRouter);
app.use("/orgs/:orgId/donna", donnaUsageRouter);
app.use("/orgs/:orgId/radar", radarTodayRouter);
app.use("/orgs/:orgId/training", orgTrainingRouter);
app.use("/orgs", orgsRouter);
app.use("/platform", platformRouter);
app.use("/training/me/chats", myBackingRouter);
app.use("/training/me/criteria-contrasts", myCriteriaContrastRouter);
app.use("/training/me/gym/attempts", myGymRouter);
app.use("/training", trainingRouter);
app.use("/training", trainingSupervisionRouter);
app.use("/training", trainingReadingsRouter);
app.use("/training", trainingCriterionRouter);
app.use("/training-notes", trainingNotesRouter);
app.use("/projects/:projectId/chat", projectChatRouter);
app.use("/single-documents", documentsRouter);
app.use("/library", libraryRouter);
// Mounted before the review router, so the audit hangs under a review
// without that router knowing about it.
app.use("/tabular-review/:reviewId/training-audit", reviewAuditRouter);
app.use("/tabular-review", tabularRouter);
app.use("/workflows", workflowsRouter);
app.use("/quick-actions", quickActionsRouter);
app.use("/workflow-addons", workflowAddonsRouter);
app.use("/user/memory", userMemoryRouter);
app.use("/user", userRouter);
app.use("/download", downloadsRouter);
app.use("/audit", auditRouter);
app.use("/playbooks", playbooksRouter);
app.use("/upload-sessions", uploadSessionsRouter);

// `commit` is the source this server runs (AGPL-3.0 §13), null in a dev build.
app.get("/health", (_req, res) =>
  res.json({ ok: true, commit: sourceCommit() }),
);

// The Ed25519 public key this deployment signs project export manifests with,
// or null when no key is configured. Deliberately open: whoever checks a
// manifest is usually outside the workspace, and they need to get the key from
// the server rather than trust the copy inside the file they were handed.
app.get("/manifest-signing-key", (_req, res) => {
  try {
    res.json(manifestPublicKey());
  } catch (err) {
    console.error("[manifest-signing-key] failed", err);
    res.status(500).json({
      detail: "Manifest signing key is misconfigured",
    });
  }
});

// Terminal error handler. Routers mount routerErrorHandler("[tag]") so a
// failure is attributed to its router in the log; the response is delegated
// back here, so every router answers with the same body. Anything that escapes
// a router lands here too, instead of Express's default handler, which would
// leak the stack trace in a non-production environment. Must stay last: Express
// only reaches an error handler registered after the middleware that failed.
app.use(handleUnhandledError);
