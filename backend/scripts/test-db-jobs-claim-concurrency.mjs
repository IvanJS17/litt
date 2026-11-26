// Disposable local database only. Several sessions claim parser-bound
// background jobs in a loop over a prepared queue while another session
// finishes what was claimed. A job must never be handed to two claimers
// while it runs, and no job may be attempted more often than its limit.
// Only the rows this run inserted (they carry its tag) are counted and
// finished: rows that were already in the table, or that another test adds,
// can be claimed by these sessions but never change the result.
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = process.env.MIKE_TEST_POSTGRES_DATABASE;
const url = new URL(process.env.SUPABASE_TEST_DB_URL ?? "postgres://invalid");
if (container ? !database?.startsWith("mike_sql_") : !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
  throw new Error("Use a disposable loopback database or an explicitly named mike_sql_ test database");
}
const command = container ? "docker" : "psql";
const args = container ? ["exec", "-i", container, "psql", "-U", "postgres", "-d", database, "-XAtq", "-v", "ON_ERROR_STOP=1"] : ["-XAtq", "-v", "ON_ERROR_STOP=1"];
const env = container ? process.env : { ...process.env, PGHOST: url.hostname.replace(/[\[\]]/g, ""), PGPORT: url.port || "5432", PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: "10" };
const CLAIMERS = 4, OWNERS = 40, ROWS = 6000, RUN_MS = 6000, BATCH = 25;
const tag = `claim_race_${randomUUID()}`;

function session() {
  const child = spawn(command, args, { env });
  let output = "", error = "";
  const listeners = new Set();
  child.stdout.on("data", d => { output += d; for (const fn of listeners) fn(); });
  child.stderr.on("data", d => { error += d; });
  const done = new Promise((resolve, reject) => { child.on("error", reject); child.on("close", code => code === 0 ? resolve(output) : reject(new Error(error || `psql exited ${code}`))); });
  done.catch(() => {});
  const count = text => output.split("\n").filter(line => line === text).length;
  return { write: sql => child.stdin.write(sql + "\n"), end: sql => child.stdin.end((sql ?? "") + "\n"), done,
    /** Resolves once `text` has been printed `n` times as a whole line. */
    marker: (text, n = 1) => Promise.race([new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Missing marker ${text}`)), 60000);
      const check = () => { if (count(text) >= n) { clearTimeout(timeout); listeners.delete(check); resolve(); } };
      listeners.add(check); check();
    }), done.then(() => { throw new Error(`Session ended before ${text}`); })]) };
}
async function query(sql) { const s = session(); s.end(`set statement_timeout='60s';\n${sql}`); return (await s.done).trim(); }

const claimSql = `select 'C|'||id||'|'||attempts||'|'||max_attempts||'|'||coalesce(payload->>'tag','') from public.claim_db_jobs(8,600,null,8);`;
let stop = false;
async function claimer() {
  const s = session();
  let batches = 0;
  while (!stop) {
    s.write(`${claimSql.repeat(BATCH)}\n\\echo B`);
    batches += 1;
    await s.marker("B", batches);
  }
  s.end("");
  return (await s.done).split("\n").filter(line => line.startsWith("C|")).map(line => line.split("|"));
}
const ownClaims = claims => claims.filter(claim => claim[4] === tag);
async function finisher() {
  const s = session();
  let rounds = 0;
  while (!stop) {
    s.write(`update public.db_jobs set status='done', finished_at=now() where status='running' and payload->>'tag'='${tag}';\n\\echo F`);
    rounds += 1;
    await s.marker("F", rounds);
  }
  s.end("");
  await s.done;
}
try {
  await query(`insert into public.db_jobs(kind,payload,owner_key,run_at)
    select 'document.extract_text', jsonb_build_object('tag','${tag}','i',i), 'owner-'||(i%${OWNERS}), now()-make_interval(secs=>${ROWS}-i)
      from generate_series(1,${ROWS}) i;
    analyze public.db_jobs;`);
  const claimers = Array.from({ length: CLAIMERS }, claimer);
  const finishing = finisher();
  await new Promise(resolve => setTimeout(resolve, RUN_MS));
  stop = true;
  const allClaims = (await Promise.all(claimers)).flat();
  const claims = ownClaims(allClaims);
  await finishing;
  const ids = new Map();
  for (const [, id] of claims) ids.set(id, (ids.get(id) ?? 0) + 1);
  const twice = [...ids.values()].filter(n => n > 1).length;
  const over = await query(`select count(*) from public.db_jobs where payload->>'tag'='${tag}' and attempts > max_attempts;`);
  assert.ok(claims.length >= 50, `only ${claims.length} of this run's rows were claimed (${allClaims.length - claims.length} other rows were claimed meanwhile)`);
  assert.equal(twice, 0, `${twice} of ${ids.size} claimed jobs were claimed more than once (${claims.length} claims)`);
  assert.equal(over, "0", "no job is attempted more often than its limit");
  console.log(`Parser job claims: ${claims.length} claims by ${CLAIMERS} sessions, every job claimed once.`);
} finally {
  await query(`delete from public.db_jobs where payload->>'tag'='${tag}';`);
}
