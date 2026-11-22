import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultDistRoot = fileURLToPath(new URL("./dist/", import.meta.url));

// The pane runs inside Word, so Microsoft's own origins must be allowed to
// frame it. Microsoft publishes no fixed list of the pages that frame an
// add-in: `cloud.microsoft` is the unified domain Word on the web is served
// from (learn.microsoft.com/microsoft-365/enterprise/cloud-microsoft-domain);
// the rest are the hosts it has been served from and embedded in. Check the
// pane in Word on the web after changing this list.
export const OFFICE_FRAME_ANCESTORS = Object.freeze([
  "https://*.cloud.microsoft",
  "https://*.officeapps.live.com",
  "https://onedrive.live.com",
  "https://*.office.com",
  "https://*.office365.com",
  "https://*.microsoft365.com",
  "https://*.sharepoint.com",
]);

// Office.js is loaded from Microsoft's CDN by every page (see src/*/*.html).
export const OFFICE_SCRIPT_ORIGINS = Object.freeze([
  "https://appsforoffice.microsoft.com",
]);

// Browser protection headers. The web app sends the same values from
// frontend/src/app/lib/securityHeaders.ts (frontend/src/__tests__/
// wordAddinHeaders.test.ts pins the two lists together); this image ships only
// this file, so they cannot be imported.
const HSTS = "max-age=31536000; includeSubDomains";

function storageOrigin(env) {
  const raw = env.R2_PUBLIC_ENDPOINT_URL?.trim() || env.R2_ENDPOINT_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

// The policy of the pane's pages. No inline script (webpack emits external
// files and Office.js is a Microsoft script), so scripts need no nonce. Styles
// keep 'unsafe-inline': style-loader injects <style> elements. Office frames
// the pane, so there is no X-Frame-Options (it cannot name several origins).
export function protectionHeaders(env, secure) {
  const storage = storageOrigin(env);
  const directives = [
    ["default-src", "'self'"],
    ["script-src", "'self'", ...OFFICE_SCRIPT_ORIGINS],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:", ...(storage ? [storage] : [])],
    ["font-src", "'self'", "data:"],
    [
      "connect-src",
      "'self'",
      ...OFFICE_SCRIPT_ORIGINS,
      ...(storage ? [storage] : []),
    ],
    ["worker-src", "'self'", "blob:"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'self'", ...OFFICE_FRAME_ANCESTORS],
    ...(secure ? [["upgrade-insecure-requests"]] : []),
  ];
  const reportOnly = ["1", "true"].includes(
    env.LITT_CSP_REPORT_ONLY?.trim().toLowerCase() ?? "",
  );
  return {
    "strict-transport-security": HSTS,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    [reportOnly
      ? "content-security-policy-report-only"
      : "content-security-policy"]: directives
      .map((parts) => parts.join(" "))
      .join("; "),
  };
}

function configuredBackend(input) {
  if (!input?.trim()) {
    throw new Error("WORD_ADDIN_BACKEND_ORIGIN is required");
  }
  const backend = new URL(input);
  if (
    !["http:", "https:"].includes(backend.protocol) ||
    backend.username ||
    backend.password ||
    backend.pathname !== "/" ||
    backend.search ||
    backend.hash
  ) {
    throw new Error(
      "WORD_ADDIN_BACKEND_ORIGIN must be an http(s) origin without credentials, path, query, or fragment",
    );
  }
  return Object.freeze({
    protocol: backend.protocol,
    hostname: backend.hostname,
    port: backend.port || undefined,
    host: backend.host,
  });
}

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

// `[name].[contenthash].ext` as emitted by webpack.config.js.
const CONTENT_HASHED = /\.[0-9a-f]{8,}\.[a-z0-9]+$/;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function publicProtocol(req) {
  const forwarded = req.headers["x-forwarded-proto"];
  if (typeof forwarded === "string" && forwarded)
    return forwarded.split(",")[0].trim();
  return req.socket.encrypted ? "https" : "http";
}

// The edge proxy proves itself with a per-deployment secret in this header;
// only then is its X-Forwarded-For (the one client address it resolved) kept.
const EDGE_HEADER = "x-litt-edge";

function fromTrustedEdge(req, edgeSecret) {
  const presented = req.headers[EDGE_HEADER];
  if (!edgeSecret || typeof presented !== "string") return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(edgeSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function clientAddress(req, edgeSecret) {
  const claimed = req.headers["x-forwarded-for"];
  if (
    fromTrustedEdge(req, edgeSecret) &&
    typeof claimed === "string" &&
    claimed
  )
    return claimed;
  // Any other peer is the client itself: its own claim is never relayed.
  return (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

function proxyApi(req, res, backend, edgeSecret) {
  const incoming = new URL(req.url ?? "/", "http://word-addin.invalid");
  if (
    incoming.pathname !== "/api" &&
    !incoming.pathname.startsWith("/api/")
  ) {
    res.writeHead(400).end();
    return;
  }
  const upstreamPath = incoming.pathname.slice("/api".length) || "/";

  const headers = { ...req.headers };
  for (const name of HOP_BY_HOP) delete headers[name];
  headers["x-forwarded-for"] = clientAddress(req, edgeSecret);
  delete headers[EDGE_HEADER];
  headers.host = backend.host;
  headers["x-forwarded-host"] = req.headers.host ?? "";
  headers["x-forwarded-proto"] = publicProtocol(req);

  const transport = backend.protocol === "https:" ? https : http;
  const upstream = transport.request(
    {
      protocol: backend.protocol,
      hostname: backend.hostname,
      port: backend.port,
      path: `${upstreamPath}${incoming.search}`,
      method: req.method,
      headers,
    },
    (upstreamResponse) => {
      const responseHeaders = { ...upstreamResponse.headers };
      for (const name of HOP_BY_HOP) delete responseHeaders[name];
      res.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
      upstreamResponse.pipe(res);
    },
  );

  upstream.on("error", (error) => {
    console.error("[word-addin/proxy] upstream request failed", {
      path: upstreamPath,
      error: error instanceof Error ? error.message : String(error),
    });
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ detail: "The API is temporarily unavailable." }));
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
}

async function serveStatic(req, res, distRoot) {
  const requestUrl = new URL(req.url ?? "/", "http://word-addin.invalid");
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname === "/") pathname = "/taskpane.html";

  const relative = path.posix.normalize(pathname).replace(/^\/+/, "");
  const filename = path.resolve(distRoot, relative);
  if (filename !== distRoot && !filename.startsWith(`${distRoot}${path.sep}`)) {
    res.writeHead(404).end();
    return;
  }

  try {
    const info = await stat(filename);
    if (!info.isFile()) throw new Error("not a file");
    const isHtml = relative.endsWith(".html");
    res.writeHead(200, {
      // Only webpack's content-hashed files never change under the same name.
      // HTML, manifest.xml and the ribbon icons keep fixed names that the
      // Microsoft 365 admin center and Word re-read after each release.
      "cache-control": CONTENT_HASHED.test(path.basename(relative))
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "content-length": info.size,
      "content-type":
        MIME_TYPES.get(path.extname(filename).toLowerCase()) ??
        "application/octet-stream",
      "x-content-type-options": "nosniff",
      // The pages only work inside Word, so a search result or a link
      // preview of them leads nowhere (they were mostly
      // crawlers). Office ignores this header; it still needs the 200.
      ...(isHtml ? { "x-robots-tag": "noindex, nofollow" } : {}),
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filename).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

export function createWordAddinServer(options = {}) {
  const distRoot = path.resolve(options.distRoot ?? defaultDistRoot);
  const backend = configuredBackend(
    options.backendOrigin ?? process.env.WORD_ADDIN_BACKEND_ORIGIN,
  );
  const edgeSecret = options.edgeSecret ?? process.env.LITT_EDGE_SECRET ?? "";
  const env = options.env ?? process.env;
  return http.createServer((req, res) => {
    // Set before routing, so every answer below (pages, assets, errors, the
    // API proxy) has them; a header the backend sends itself replaces ours.
    for (const [name, value] of Object.entries(
      protectionHeaders(env, publicProtocol(req) === "https"),
    ))
      res.setHeader(name, value);
    if (req.url === "/health") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === "/api" || req.url?.startsWith("/api/")) {
      proxyApi(req, res, backend, edgeSecret);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      res.end();
      return;
    }
    void serveStatic(req, res, distRoot);
  });
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number.parseInt(process.env.PORT ?? "3200", 10);
  const server = createWordAddinServer();
  server.listen(port, () => {
    console.log(`Mike Word add-in host running on port ${port}`);
  });
}
