// Disposable local PostgreSQL only. Requires psql and an applied schema.
// Storage quota: sessions opened at the same moment cannot both pass when
// together they exceed the limit of their space, and the refusal of one space
// never blocks another. The data this script commits is removed at the end.
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const url = new URL(process.env.SUPABASE_TEST_DB_URL ?? "postgres://invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
  throw new Error("SUPABASE_TEST_DB_URL must name a disposable loopback database");
}
const env = {
  ...process.env,
  PGCONNECT_TIMEOUT: "10",
  PGOPTIONS: "-c statement_timeout=60000 -c lock_timeout=30000",
  PGHOST: url.hostname.replace(/[\[\]]/g, ""),
  PGPORT: url.port || "5432",
  PGDATABASE: url.pathname.slice(1),
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
};
function query(sql, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1"], { env });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      onOutput(out);
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err || `psql exited ${code}`)),
    );
    child.stdin.end(sql);
  });
}

const firm = randomUUID();
const users = Array.from({ length: 8 }, () => randomUUID());
// A firm of two members at 1000 bytes each: 2000 bytes of space.
const PER_MEMBER = 1000;
const PERSONAL = 500;
const open = (user, size, org, personal) => `
  do $$ begin
    perform public.create_upload_session(
      '${randomUUID()}', '${user}', 'document_create', '{"scope":"standalone"}'::jsonb,
      now() + interval '30 minutes',
      jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'resource_id', gen_random_uuid(),
        'client_id', 'c', 'filename', 'quota.pdf', 'target_folder_id', null, 'file_type', 'pdf',
        'content_type', 'application/pdf', 'expected_size_bytes', ${size},
        'staging_storage_path', 'staging/' || gen_random_uuid(), 'sealed_storage_path', 'sealed/' || gen_random_uuid())),
      50, ${org ? `'${org}'` : "null"}, ${personal ? `'${personal}'` : "null"}, ${PER_MEMBER}, ${PERSONAL});
    raise notice 'RESULT opened';
  exception when others then
    raise notice 'RESULT %', sqlerrm;
  end $$;`;
// NOTICEs arrive on stderr, where `capture` reads the outcome of each attempt.
const capture = (sql, onOutput) =>
  new Promise((resolve, reject) => {
    const child = spawn("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1"], { env });
    let err = "";
    let out = "";
    child.stdout.on("data", (c) => {
      out += c;
      onOutput?.(out);
    });
    child.stderr.on("data", (c) => {
      err += c;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve({ out, err }) : reject(new Error(err || `psql exited ${code}`)),
    );
    child.stdin.end(sql);
  });
const outcome = ({ err }) => /RESULT (.*)/.exec(err)?.[1]?.trim();
const sessionsOf = (...ids) => query(`select count(*) from public.upload_sessions where user_id in (${ids.map((id) => `'${id}'`).join(",")});`);

try {
  await query(`
    insert into auth.users(id, email) select u, u || '@quota.invalid' from unnest(array[${users.map((u) => `'${u}'::uuid`).join(",")}]) u;
    insert into public.organizations(id, name) values ('${firm}', 'Quota concurrency firm');
    delete from public.org_members where org_id = '${firm}';
    insert into public.org_members(org_id, user_id, role) values ('${firm}', '${users[0]}', 'owner'), ('${firm}', '${users[1]}', 'member');`);

  // 1. One session holds its transaction open after it passed the check; the
  //    second one, opened meanwhile, has to wait for it and then see it.
  let locked;
  const lockReady = new Promise((resolve) => {
    locked = resolve;
  });
  const first = capture(
    `begin;\n${open(users[0], 1500, firm, null)}\n\\echo QUOTA_OPENED\nselect pg_sleep(1.5);\ncommit;`,
    (out) => out.includes("QUOTA_OPENED") && locked(),
  );
  await lockReady;
  const second = await capture(`${open(users[1], 600, firm, null)}`);
  const firstOutcome = outcome(await first);
  assert.equal(firstOutcome, "opened", "the first session passes");
  assert.equal(outcome(second), "storage_quota_exceeded", "the second one sees the first and is refused");
  assert.equal(await sessionsOf(users[0], users[1]), "1", "only one session exists");

  // 2. The other space is not blocked or counted: the personal space of a
  //    member of that firm opens freely.
  const personal = await capture(open(users[1], 400, null, users[1]));
  assert.equal(outcome(personal), "opened", "the personal space is separate from the firm's");

  // 3. A burst: eight sessions of 300 at once against the 500 left; only one fits.
  const burst = await Promise.all(users.map((user) => capture(open(user, 300, firm, null))));
  const results = burst.map(outcome);
  assert.equal(results.filter((r) => r === "opened").length, 1, `exactly one of the burst fits: ${results}`);
  assert.equal(results.filter((r) => r === "storage_quota_exceeded").length, 7, `the rest are refused: ${results}`);
  console.log("storage quota concurrency: ok", JSON.stringify(results));
} finally {
  // A team organization cannot be deleted through the application; this is a
  // disposable database, so the guard is skipped for the cleanup alone.
  await query(`
    set session_replication_role = replica;
    delete from public.upload_sessions where user_id in (${users.map((u) => `'${u}'`).join(",")});
    delete from public.org_members where org_id = '${firm}';
    delete from public.organizations where id = '${firm}';
    delete from auth.users where id in (${users.map((u) => `'${u}'`).join(",")});`);
}
