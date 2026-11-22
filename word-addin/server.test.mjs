import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createWordAddinServer } from "./server.mjs";

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
