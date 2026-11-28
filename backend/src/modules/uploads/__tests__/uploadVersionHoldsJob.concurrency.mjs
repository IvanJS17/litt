// Disposable local PostgreSQL only. Requires psql and an applied schema.
// Upload job version writes: create_document_version_for_upload_job and
// replace_document_version_for_upload_job lock the job's row until the version
// commits, so whatever ends the job (a finish, a requeue, deleting its upload
// session) waits for the version; in the reverse order the write is refused
// with upload_job_not_held and writes nothing. The data this script creates is
// removed at the end.
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
const psql = () => spawn("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1"], { env });

// One statement batch in its own psql; resolves with stdout and the NOTICE text.
function capture(sql) {
  return new Promise((resolve, reject) => {
    const child = psql();
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve({ out: out.trim(), err }) : reject(new Error(err || `psql exited ${code}`)),
    );
    child.stdin.end(sql);
  });
}
const query = async (sql) => (await capture(sql)).out;
const outcome = ({ err }) => /RESULT (.*)/.exec(err)?.[1]?.trim();

const opened = new Set();
// A session that keeps its transaction open until `finish` is called.
function holdingSession(sql) {
  const child = psql();
  let out = "";
  let err = "";
  let ready;
  const readyPromise = new Promise((resolve) => (ready = resolve));
  child.stdout.on("data", (c) => {
    out += c;
    if (out.includes("SESSION_READY")) ready();
  });
  child.stderr.on("data", (c) => (err += c));
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve({ out, err }) : reject(new Error(err || `psql exited ${code}`)),
    );
  });
  child.stdin.write(`${sql}\n\\echo SESSION_READY\n`);
  const session = {
    ready: readyPromise,
    finish: (tail) => {
      opened.delete(session);
      child.stdin.end(tail);
      return done;
    },
  };
  opened.add(session);
  return session;
}

const user = randomUUID();
const WORKER = "worker-a";
const uuid = (ids) => ids.map((id) => `'${id}'`).join(",");
const created = { documents: [], sessions: [] };

// A running job held by WORKER, its upload session and file, and a document.
async function fixture() {
  const f = {
    document: randomUUID(),
    session: randomUUID(),
    file: randomUUID(),
    job: randomUUID(),
    version: randomUUID(),
  };
  created.documents.push(f.document);
  created.sessions.push(f.session);
  await query(`
    insert into public.documents(id, user_id) values ('${f.document}', '${user}');
    insert into public.upload_sessions(id, user_id, purpose, destination, expected_file_count, expected_total_bytes, expires_at)
      values ('${f.session}', '${user}', 'document_version_create',
        '{"document_id":"${f.document}"}'::jsonb, 1, 1, now() + interval '1 hour');
    insert into public.upload_session_files(id, session_id, resource_id, client_id, filename, file_type, content_type,
        expected_size_bytes, staging_storage_path, sealed_storage_path)
      values ('${f.file}', '${f.session}', gen_random_uuid(), 'c', 'held.pdf', 'pdf', 'application/pdf', 1, 'staging/${f.file}', 'sealed/${f.file}');
    insert into public.upload_processing_jobs(id, session_id, file_id, user_id, status, locked_by, locked_at)
      values ('${f.job}', '${f.session}', '${f.file}', '${user}', 'running', '${WORKER}', now());`);
  return f;
}

const versionJson = (f, path) =>
  JSON.stringify({ id: f.version, storage_path: path, pdf_storage_path: `${path}.pdf`, filename: "held.pdf" });
const writes = {
  create: {
    call: (f) => `select public.create_document_version_for_upload_job(
      '${f.job}', '${WORKER}', '${f.document}', '${versionJson(f, "versions/written")}'::jsonb);`,
    seed: () => "",
    written: "versions/written",
  },
  replace: {
    call: (f) => `select public.replace_document_version_for_upload_job(
      '${f.job}', '${WORKER}', '${f.document}', '${f.version}',
      '{"storage_path":"versions/written"}'::jsonb, '{"storage_path":"versions/original"}'::jsonb);`,
    seed: (f) => `insert into public.document_versions(id, document_id, storage_path, source, version_number, filename, file_type)
      values ('${f.version}', '${f.document}', 'versions/original', 'upload', 1, 'held.pdf', 'pdf');`,
    written: "versions/written",
  },
};

// Runs in a short transaction of its own and reports the outcome instead of failing the batch.
const withShortLockTimeout = (statement) => `
  do $$ declare n integer; begin
    perform set_config('lock_timeout', '300ms', true);
    ${statement}
    get diagnostics n = row_count;
    raise notice 'RESULT updated %', n;
  exception when lock_not_available then
    raise notice 'RESULT lock_not_available';
  end $$;`;
// The statement shape of the worker's finish: completed, lease released.
const endJob = (f) =>
  withShortLockTimeout(
    `update public.upload_processing_jobs set status = 'completed', locked_by = null where id = '${f.job}' and locked_by = '${WORKER}';`,
  );
const versionRow = (f) =>
  query(`select coalesce(storage_path, '') from public.document_versions where id = '${f.version}';`);
const currentVersion = (f) => query(`select coalesce(current_version_id::text, '') from public.documents where id = '${f.document}';`);

try {
  await query(`insert into auth.users(id, email) values ('${user}', '${user}@version-wait.invalid');`);

  for (const [name, write] of Object.entries(writes)) {
    // 1-3. The write is open; ending the job waits, then succeeds after the commit.
    const f = await fixture();
    await query(write.seed(f));
    const a = holdingSession(`begin;\n${write.call(f)}`);
    await a.ready;
    assert.equal(outcome(await capture(endJob(f))), "lock_not_available", `${name}: ending the job waits for the open version write`);
    assert.equal(
      await query(`select status || ',' || coalesce(locked_by, '') from public.upload_processing_jobs where id = '${f.job}';`),
      `running,${WORKER}`,
      `${name}: the job is untouched while the write is open`,
    );
    await a.finish("commit;\n");
    assert.equal(outcome(await capture(endJob(f))), "updated 1", `${name}: ending the job succeeds after the commit`);
    assert.equal(await versionRow(f), write.written, `${name}: the version is written and referenced`);

    // 4. Reverse order: the job ended first, the write is refused and writes nothing.
    const g = await fixture();
    await query(write.seed(g));
    const before = await currentVersion(g);
    assert.equal(outcome(await capture(endJob(g))), "updated 1");
    const refused = await capture(`
      do $$ begin
        perform (${write.call(g).replace(/;\s*$/, "")});
        raise notice 'RESULT written';
      exception when others then
        raise notice 'RESULT %', sqlerrm;
      end $$;`);
    assert.equal(outcome(refused), "upload_job_not_held", `${name}: a write after the job ended is refused`);
    assert.equal(await versionRow(g), name === "create" ? "" : "versions/original", `${name}: a refused write changes nothing`);
    assert.equal(await currentVersion(g), before, `${name}: the current version is unchanged`);
  }

  // Deleting the job's upload session waits in the same way.
  const s = await fixture();
  const a = holdingSession(`begin;\n${writes.create.call(s)}`);
  await a.ready;
  assert.equal(
    outcome(await capture(withShortLockTimeout(`delete from public.upload_sessions where id = '${s.session}';`))),
    "lock_not_available",
    "deleting the upload session waits for the open version write",
  );
  await a.finish("commit;\n");
  assert.equal(await versionRow(s), writes.create.written, "the version is committed");
  assert.equal(
    outcome(await capture(withShortLockTimeout(`delete from public.upload_sessions where id = '${s.session}';`))),
    "updated 1",
    "deleting the upload session succeeds after the commit",
  );
  console.log("upload version writes hold their job: ok");
} finally {
  // A failed check must not leave a transaction open over the rows to remove.
  await Promise.allSettled([...opened].map((session) => session.finish("rollback;\n")));
  // Disposable database: triggers are skipped for the cleanup alone.
  await query(`
    set session_replication_role = replica;
    delete from public.upload_processing_jobs where user_id = '${user}';
    delete from public.upload_session_files where session_id in (${uuid(created.sessions) || "null"});
    delete from public.upload_sessions where user_id = '${user}';
    delete from public.document_versions where document_id in (${uuid(created.documents) || "null"});
    delete from public.documents where user_id = '${user}';
    delete from auth.users where id = '${user}';`);
}
