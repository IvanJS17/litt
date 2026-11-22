import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import {
  OFFICE_FRAME_ANCESTORS,
  OFFICE_SCRIPT_ORIGINS,
  createWordAddinServer,
} from "./server.mjs";

let backend;
let addin;
let backendOrigin;
let addinOrigin;
let staticRoot;
let observedRequest;
let observedHeaders;
let trustingAddin;
let trustingAddinOrigin;
const EDGE_SECRET = "edge-secret-for-tests";

// The pages webpack.config.js emits, read from its HtmlWebpackPlugin entries so
// a new page is covered the day it is added.
function webpackHtmlPages() {
  const config = readFileSync(new URL("./webpack.config.js", import.meta.url), "utf8");
  return [...config.matchAll(/filename:\s*"([^"]+\.html)"/g)].map((m) => m[1]);
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

before(async () => {
  staticRoot = await mkdtemp(path.join(os.tmpdir(), "mike-word-host-"));
  await writeFile(
    path.join(staticRoot, "taskpane.html"),
    "<!doctype html><title>Mike Word</title>",
  );
  await writeFile(path.join(staticRoot, "manifest.xml"), "<OfficeApp />");
  await writeFile(path.join(staticRoot, "taskpane.0123abcd.js"), "");
  for (const page of webpackHtmlPages().filter((name) => name !== "taskpane.html"))
    await writeFile(path.join(staticRoot, page), "<!doctype html><title>page</title>");

  backend = http.createServer((req, res) => {
    observedHeaders = req.headers;
    observedRequest = {
      url: req.url,
      cookie: req.headers.cookie,
      origin: req.headers.origin,
      forwardedHost: req.headers["x-forwarded-host"],
    };
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "set-cookie": [
        "__Host-mike-session=one; Path=/; Secure; HttpOnly",
        "__Host-mike-session.1=two; Path=/; Secure; HttpOnly",
      ],
    });
    res.write("data: first\n\n");
    setImmediate(() => res.end("data: second\n\n"));
  });
  backendOrigin = await listen(backend);
  addin = createWordAddinServer({
    distRoot: staticRoot,
    backendOrigin,
    edgeSecret: "",
  });
  addinOrigin = await listen(addin);
  trustingAddin = createWordAddinServer({
    distRoot: staticRoot,
    backendOrigin,
    edgeSecret: EDGE_SECRET,
  });
  trustingAddinOrigin = await listen(trustingAddin);
});

after(async () => {
  await Promise.all([close(addin), close(trustingAddin), close(backend)]);
  await rm(staticRoot, { recursive: true, force: true });
});

test("serves health and the task pane", async () => {
  const health = await fetch(`${addinOrigin}/health`);
  assert.deepEqual(await health.json(), { ok: true });

  const taskpane = await fetch(`${addinOrigin}/`);
  assert.equal(taskpane.status, 200);
  assert.match(await taskpane.text(), /Mike Word/);
});

test("caches only content-hashed files as immutable", async () => {
  const cacheControl = async (file) =>
    (await fetch(`${addinOrigin}/${file}`)).headers.get("cache-control");
  assert.equal(await cacheControl("manifest.xml"), "no-cache");
  assert.equal(await cacheControl("taskpane.html"), "no-cache");
  assert.equal(
    await cacheControl("taskpane.0123abcd.js"),
    "public, max-age=31536000, immutable",
  );
});

test("asks crawlers not to index the add-in pages", async () => {
  for (const pathname of ["/", "/taskpane.html"]) {
    const page = await fetch(`${addinOrigin}${pathname}`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("x-robots-tag"), "noindex, nofollow");
  }
  const asset = await fetch(`${addinOrigin}/taskpane.0123abcd.js`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("x-robots-tag"), null);
});

test("streams the API while preserving auth headers and cookies", async () => {
  const response = await fetch(`${addinOrigin}/api/chat?mode=word`, {
    headers: {
      cookie: "__Host-mike-session=incoming",
      origin: "https://word.example.test",
    },
  });

  assert.equal(await response.text(), "data: first\n\ndata: second\n\n");
  assert.deepEqual(observedRequest, {
    url: "/chat?mode=word",
    cookie: "__Host-mike-session=incoming",
    origin: "https://word.example.test",
    forwardedHost: new URL(addinOrigin).host,
  });
  assert.deepEqual(response.headers.getSetCookie(), [
    "__Host-mike-session=one; Path=/; Secure; HttpOnly",
    "__Host-mike-session.1=two; Path=/; Secure; HttpOnly",
  ]);
});

test("rejects backend configuration that is not an origin", () => {
  for (const backendOrigin of [
    "https://backend.example.test/path",
    "https://backend.example.test?target=other",
    "https://user:password@backend.example.test",
  ]) {
    assert.throws(
      () => createWordAddinServer({ distRoot: staticRoot, backendOrigin }),
      /must be an http\(s\) origin/,
    );
  }
});

async function forwardedFor(origin, headers) {
  const response = await fetch(`${origin}/api/health`, { headers });
  await response.text();
  return observedHeaders;
}

test("replaces a caller-supplied client address with the socket peer", async () => {
  // Every case below is untrusted: no edge secret is configured, or the
  // request does not prove it came from the edge proxy.
  const cases = [
    [addinOrigin, {}],
    [addinOrigin, { "x-litt-edge": "" }],
    [addinOrigin, { "x-litt-edge": EDGE_SECRET }],
    [trustingAddinOrigin, {}],
    [trustingAddinOrigin, { "x-litt-edge": "wrong" }],
    [trustingAddinOrigin, { "x-litt-edge": "x".repeat(EDGE_SECRET.length) }],
    [trustingAddinOrigin, { "x-litt-edge": "" }],
  ];
  for (const [origin, extra] of cases) {
    const seen = await forwardedFor(origin, {
      "x-forwarded-for": "203.0.113.77",
      ...extra,
    });
    assert.equal(seen["x-forwarded-for"], "127.0.0.1");
    assert.equal(seen["x-litt-edge"], undefined);
  }
});

test("keeps the edge-provided client address when the edge secret matches", async () => {
  const seen = await forwardedFor(trustingAddinOrigin, {
    "x-forwarded-for": "203.0.113.77",
    "x-litt-edge": EDGE_SECRET,
  });
  assert.equal(seen["x-forwarded-for"], "203.0.113.77");
  assert.equal(seen["x-litt-edge"], undefined);
});

test("falls back to the socket peer when the trusted edge sends no address", async () => {
  const seen = await forwardedFor(trustingAddinOrigin, {
    "x-litt-edge": EDGE_SECRET,
  });
  assert.equal(seen["x-forwarded-for"], "127.0.0.1");
  assert.equal(seen["x-litt-edge"], undefined);
});

// Browser protection headers: one place in the server wraps every response.
const PROTECTION = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

function directives(policy) {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...sources] = part.split(/\s+/);
        return [name, sources];
      }),
  );
}

function assertProtected(response, label) {
  for (const [name, value] of Object.entries(PROTECTION))
    assert.equal(response.headers.get(name), value, `${label}: ${name}`);
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/, label);
  assert.doesNotMatch(response.headers.get("strict-transport-security"), /preload/i);
  const policy = directives(response.headers.get("content-security-policy") ?? "");
  assert.deepEqual(policy.get("frame-ancestors"), ["'self'", ...OFFICE_FRAME_ANCESTORS], label);
  assert.equal(response.headers.get("x-frame-options"), null, `${label}: Office frames the pane`);
  return policy;
}

test("every page, asset, error and API response carries the protection headers", async () => {
  const pages = webpackHtmlPages();
  assert.ok(pages.includes("taskpane.html") && pages.includes("oauth-dialog.html") && pages.includes("commands.html"));
  const paths = [
    "/",
    ...pages.map((page) => `/${page}`),
    "/manifest.xml",
    "/taskpane.0123abcd.js",
    "/does-not-exist",
    "/..%2f..%2fetc/passwd",
    "/%zz",
    "/health",
    "/api/chat?mode=word",
  ];
  for (const pathname of paths) {
    assertProtected(await fetch(`${addinOrigin}${pathname}`), pathname);
  }
  assertProtected(await fetch(`${addinOrigin}/taskpane.html`, { method: "HEAD" }), "HEAD");
  const posted = await fetch(`${addinOrigin}/taskpane.html`, { method: "POST" });
  assert.equal(posted.status, 405);
  assertProtected(posted, "405");
});

test("the gateway's own failure answer carries them too", async () => {
  const deadBackend = http.createServer();
  const deadOrigin = await listen(deadBackend);
  await close(deadBackend);
  const server = createWordAddinServer({ distRoot: staticRoot, backendOrigin: deadOrigin, edgeSecret: "" });
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/api/anything`);
    assert.equal(response.status, 502);
    assertProtected(response, "502");
  } finally {
    await close(server);
  }
});

test("the pane's policy: own scripts and Office.js only, no inline script, Office may frame it", async () => {
  const policy = assertProtected(await fetch(`${addinOrigin}/taskpane.html`), "taskpane");
  assert.deepEqual(policy.get("script-src"), ["'self'", ...OFFICE_SCRIPT_ORIGINS]);
  for (const name of ["script-src", "default-src"])
    assert.ok(!policy.get(name).includes("'unsafe-inline'") && !policy.get(name).includes("'unsafe-eval'"), name);
  assert.deepEqual(policy.get("object-src"), ["'none'"]);
  assert.deepEqual(policy.get("base-uri"), ["'self'"]);
  assert.deepEqual(policy.get("form-action"), ["'self'"]);
  assert.ok(policy.get("style-src").includes("'unsafe-inline'"));
  assert.ok(OFFICE_FRAME_ANCESTORS.length > 0);
  for (const origin of OFFICE_FRAME_ANCESTORS) assert.match(origin, /^https:\/\/(\*\.)?[a-z0-9.-]+$/);
});

test("the Office framing origins are one list and none is a bare wildcard", () => {
  // Written out, so adding an origin that may frame the pane is a visible change.
  assert.deepEqual([...OFFICE_FRAME_ANCESTORS], [
    "https://*.cloud.microsoft",
    "https://*.officeapps.live.com",
    "https://onedrive.live.com",
    "https://*.office.com",
    "https://*.office365.com",
    "https://*.microsoft365.com",
    "https://*.sharepoint.com",
  ]);
  assert.ok(!OFFICE_FRAME_ANCESTORS.some((origin) => origin === "*" || origin === "https:" || origin === "https://*"));
});

test("storage and the report-only switch come from the environment", async () => {
  const server = createWordAddinServer({
    distRoot: staticRoot,
    backendOrigin,
    edgeSecret: "",
    env: { R2_PUBLIC_ENDPOINT_URL: "https://storage.example.test/bucket", LITT_CSP_REPORT_ONLY: "true" },
  });
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/taskpane.html`);
    assert.equal(response.headers.get("content-security-policy"), null);
    const policy = directives(response.headers.get("content-security-policy-report-only") ?? "");
    assert.ok(new Set(policy.get("connect-src")).has("https://storage.example.test"));
    assert.deepEqual(policy.get("frame-ancestors"), ["'self'", ...OFFICE_FRAME_ANCESTORS]);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  } finally {
    await close(server);
  }
  const plain = directives((await fetch(`${addinOrigin}/taskpane.html`)).headers.get("content-security-policy"));
  assert.ok(!plain.get("connect-src").some((source) => source.includes("storage.example.test")));
});

test("a backend's own header wins over the server's default", async () => {
  const answering = http.createServer((_req, res) => {
    res.writeHead(200, { "referrer-policy": "no-referrer", "strict-transport-security": "max-age=15552000; includeSubDomains" });
    res.end("{}");
  });
  const upstream = await listen(answering);
  const server = createWordAddinServer({ distRoot: staticRoot, backendOrigin: upstream, edgeSecret: "" });
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/api/x`);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("strict-transport-security"), "max-age=15552000; includeSubDomains");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  } finally {
    await close(server);
    await close(answering);
  }
});
