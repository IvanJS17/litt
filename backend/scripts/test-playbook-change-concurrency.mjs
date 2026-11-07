// Disposable local database only. Two sessions prove the playbook guards of
// 20261107_54_litt_playbook_change_guards under real concurrency: an accept
// holds the playbook's row, so marking it ready (a write over the version it
// read) waits and then finds that version gone; a second proposal over one
// copy waits on the first and is refused; a failed proposal's documents stay
// when the copy is marked ready meanwhile.
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
function session() {
  const child = spawn(command, args, { env });
  let output = "", error = "";
  const listeners = new Set();
  child.stdout.on("data", d => { output += d; for (const fn of listeners) fn(); });
  child.stderr.on("data", d => { error += d; });
  const done = new Promise((resolve, reject) => { child.on("error", reject); child.on("close", code => code === 0 ? resolve(output.trim()) : reject(new Error(error || `psql exited ${code}`))); });
  done.catch(() => {});
  return { write: sql => child.stdin.write(sql + "\n"), end: sql => child.stdin.end((sql ?? "") + "\n"), done,
    marker: text => Promise.race([new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Missing marker ${text}`)), 15000);
      const check = () => { if (output.includes(text)) { clearTimeout(timeout); listeners.delete(check); resolve(); } };
      listeners.add(check); check();
    }), done.then(() => { throw new Error(`Session ended before ${text}`); })]) };
}
async function query(sql) { const s = session(); s.end(`set statement_timeout='15s';\n${sql}`); return s.done; }
/** Run `sql` in its own session; resolves, with its result, once it is blocked on a lock. */
async function blocked(sql) {
  const application = `litt_playbook_${randomUUID()}`;
  const running = query(`set application_name='${application}';\n${sql}`);
  running.catch(() => {}); // observed here; the caller still gets the rejection
  for (let attempt = 0; attempt < 150; attempt++) {
    // Wrapped: an async function returning the promise itself would wait for it.
    if (await query(`select exists(select 1 from pg_stat_activity where application_name='${application}' and wait_event_type='Lock');`) === "t") return { running };
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("the second session never waited for the first");
}
const owner = randomUUID(), copy = randomUUID(), change = randomUUID(), source = randomUUID();
let held;
try {
  await query(`insert into auth.users(id,email) values('${owner}','${owner}@example.test');
    insert into playbooks(id,user_id,name,content_json,status) values('${copy}','${owner}','Copy','{"name":"Copy"}','draft');
    insert into playbook_changes(id,playbook_id,op,rule_id) values('${change}','${copy}','add_rule','r1');`);

  // 1. Accept and ready interleave. Ready read the copy before the accept
  // commits; its write over that version waits for the accept and then finds
  // nothing to update. The copy stays a draft, the change accepted.
  const readVersion = await query(`select updated_at from playbooks where id='${copy}';`);
  held = session();
  held.write(`begin; select accept_playbook_change('${copy}','${change}','${owner}','${readVersion}','{"name":"Accepted"}');\n\\echo ACCEPTED`);
  await held.marker("ACCEPTED");
  const { running: ready } = await blocked(`update playbooks set status='ready', updated_at=now() where id='${copy}' and updated_at='${readVersion}' returning id;`);
  held.end("commit;"); assert.match(await held.done, /^accepted/); held = null;
  assert.equal(await ready, "", "ready finds the version it read gone");
  assert.equal(await query(`select status||','||(select status from playbook_changes where id='${change}') from playbooks where id='${copy}';`), "draft,accepted");

  // 2. An accept that waited for another write finds the version stale and
  // leaves its change pending.
  const second = randomUUID();
  await query(`insert into playbook_changes(id,playbook_id,op,rule_id) values('${second}','${copy}','add_rule','r2');`);
  const before = await query(`select updated_at from playbooks where id='${copy}';`);
  held = session();
  held.write(`begin; update playbooks set content_json='{"name":"Edited"}', updated_at=clock_timestamp() where id='${copy}';\n\\echo EDITED`);
  await held.marker("EDITED");
  const { running: accept } = await blocked(`select accept_playbook_change('${copy}','${second}','${owner}','${before}','{"name":"Late"}');`);
  held.end("commit;"); await held.done; held = null;
  assert.equal(await accept, "stale");
  assert.equal(await query(`select status from playbook_changes where id='${second}';`), "pending");
  await query(`delete from playbook_changes where id='${second}';`);

  // 3. Two proposals start over one copy: the second waits on the first's
  // index entry and is refused once it commits.
  const proposal = sql => `insert into playbook_imports(user_id,filename,model,status,stage,started_at,kind,playbook_id) values('${owner}','','model','running','checking_model',now(),'proposal','${copy}');${sql}`;
  held = session();
  held.write(`begin; ${proposal("")}\n\\echo STARTED`);
  await held.marker("STARTED");
  const { running: rival } = await blocked(proposal(""));
  held.end("commit;"); await held.done; held = null;
  await assert.rejects(rival, /idx_playbook_imports_one_running_proposal/);
  assert.equal(await query(`select count(*) from playbook_imports where playbook_id='${copy}' and kind='proposal' and status='running';`), "1");
  await query(`update playbook_imports set status='failed' where playbook_id='${copy}';`);

  // 4. The copy is marked ready while a failed proposal's documents are
  // being removed: the removal waits, then finds a ready copy and keeps them.
  await query(`insert into playbook_sources(id,playbook_id,filename,file_type,storage_key,size_bytes) values('${source}','${copy}','Caso.docx','docx','copy-key',10);`);
  held = session();
  held.write(`begin; update playbooks set status='ready' where id='${copy}';\n\\echo READY`);
  await held.marker("READY");
  const { running: discard } = await blocked(`select count(*) from discard_playbook_proposal_sources('${copy}',array['${source}']::uuid[]);`);
  held.end("commit;"); await held.done; held = null;
  assert.equal(await discard, "0");
  assert.equal(await query(`select count(*) from playbook_sources where id='${source}';`), "1");
  console.log("Playbook guards: accept and ready serialize on the playbook row; one running proposal per copy; a ready copy keeps its documents.");
} finally {
  if (held) { held.end("rollback;"); await held.done.catch(() => {}); }
  await query(`delete from playbook_imports where user_id='${owner}'; delete from playbooks where user_id='${owner}'; delete from auth.users where id='${owner}';`);
}
