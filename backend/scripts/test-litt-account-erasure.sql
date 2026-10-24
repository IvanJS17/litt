-- LiTT account erasure over the converged schema (owner decision 2026-10-24,
-- TD-008 partial). Disposable local PostgreSQL only; run against a database
-- built from backend/schema.sql. Every check runs and is reported; the script
-- fails at the end if any check failed. All fixtures are rolled back.
--
--   * requesting deletion removes the account from its organizations,
--     advances their authorization epoch, flags the profile, opens a receipt
--     whose bearer token is stored only as a hash, audits the request without
--     the address, and queues a job whose payload carries no address;
--   * the last owner of an organization with other members is refused;
--   * the Auth user can then be deleted even though it has insert-only audit
--     history and AI evidence: those rows stay exactly as written, still
--     naming the deleted account by id;
--   * matter content the account created (project, document, version, chat,
--     message, review) stays with the organization, detached from its author;
--   * completing the receipt is idempotent: one completion, one audit event,
--     and a last-backup date 30 days after completion;
--   * a new audit row never stores the actor's address, and a permission
--     change names the affected admin by id, not by address.
\set ON_ERROR_STOP 1
begin;

create temporary table litt_check(name text primary key, ok boolean not null, detail text);

create function pg_temp.check(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into litt_check values (p_name, coalesce(p_ok, false), p_detail);
$$;

-- Fixtures. a1 owns the firm, a2 is the member who deletes their account,
-- a3 is the only owner of a second firm that still has a member (a4).
insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@example.test'),
  ('00000000-0000-4000-8000-0000000000a2', 'leaver@example.test'),
  ('00000000-0000-4000-8000-0000000000a3', 'sole@example.test'),
  ('00000000-0000-4000-8000-0000000000a4', 'colleague@example.test');
insert into public.organizations(id, name, created_by, kind) values
  ('00000000-0000-4000-8000-0000000000b1', 'Firm', '00000000-0000-4000-8000-0000000000a1', 'team'),
  ('00000000-0000-4000-8000-0000000000b2', 'Other firm', '00000000-0000-4000-8000-0000000000a3', 'team');
insert into public.org_members(org_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'owner'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a2', 'member'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a3', 'owner'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a4', 'member');

-- A matter the leaver opened and worked in, and a personal project.
insert into public.projects(id, user_id, name, org_id, visibility) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a2', 'Matter project',
   '00000000-0000-4000-8000-0000000000b1', 'organization'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a2', 'Personal project',
   null, 'private');
insert into public.workspaces(id, organization_id, name) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1', 'Litigation');
insert into public.matters(id, workspace_id, project_id, name, visibility) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1',
   '00000000-0000-4000-8000-0000000000c1', 'Matter 1', 'public');
insert into public.documents(id, user_id, project_id) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a2',
   '00000000-0000-4000-8000-0000000000c1');
do $$ begin
  perform public.create_document_version('00000000-0000-4000-8000-0000000000f1', jsonb_build_object(
    'id', '00000000-0000-4000-8000-0000000000f2', 'filename', 'contract.pdf', 'file_type', 'pdf',
    'source', 'upload', 'version_number', 1, 'storage_path', 'test/contract.pdf',
    'content_sha256', repeat('a', 64)));
end $$;
insert into public.chats(id, project_id, user_id, title) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-0000000000a2', 'Matter chat');
insert into public.chat_messages(id, chat_id, role, content, author_user_id) values
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101', 'user',
   '"Synthetic question"'::jsonb, '00000000-0000-4000-8000-0000000000a2');
insert into public.tabular_reviews(id, project_id, user_id, title) values
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-0000000000a2', 'Matter review');

-- The leaver's history: an audit row as upstream writers record it (with the
-- address) and an AI execution they authored in the matter.
insert into public.audit_events(id, user_id, org_id, action)
values ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-0000000000a2',
        '00000000-0000-4000-8000-0000000000b1', 'litt.erasure.test');
do $$ begin
  insert into public.ai_executions(
    id, idempotency_key, author_user_id, organization_id, matter_id, project_id,
    workflow_key, workflow_version, workflow_content_hash, workflow_source_commit,
    workflow_distribution, workflow_type, workflow_source, workflow_approval_provenance,
    output_hashes, citation_hashes, document_id, document_version_id,
    document_content_sha256, input_hashes, route_provider, route_model, credential_ref, status)
  values (
    '00000000-0000-4000-8000-000000000105', 'erasure-test', '00000000-0000-4000-8000-0000000000a2',
    '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1',
    '00000000-0000-4000-8000-0000000000c1', 'review', '1', repeat('b', 64), repeat('c', 40),
    'default', 'assistant', 'catalog', 'approved', array[]::text[], array[]::text[],
    '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2',
    repeat('a', 64), array[repeat('d', 64)], 'openai', 'gpt-test', 'cred-test', 'succeeded');
  perform pg_temp.check('fixtures: AI execution', true);
exception when others then
  perform pg_temp.check('fixtures: AI execution', false, sqlstate || ' ' || sqlerrm);
end $$;

create function pg_temp.epoch(p_org uuid) returns bigint language sql as $$
  select (to_jsonb(o) ->> 'authorization_epoch')::bigint from public.organizations o where o.id = p_org;
$$;
create temporary table erasure_state(job_id uuid, epoch_before bigint);
insert into erasure_state values (null, pg_temp.epoch('00000000-0000-4000-8000-0000000000b1'));

-- Request ---------------------------------------------------------------
do $$
declare job uuid;
begin
  job := public.request_account_deletion(
    p_user_id => '00000000-0000-4000-8000-0000000000a2',
    p_token_sha256 => encode(sha256('receipt-token'::bytea), 'hex'));
  update erasure_state set job_id = job;
  perform pg_temp.check('request: queues a job', job is not null);
  perform pg_temp.check('request: job payload names no address',
    not exists (select 1 from public.db_jobs where id = job and payload::text ilike '%example.test%'),
    (select payload::text from public.db_jobs where id = job));
  perform pg_temp.check('request: membership removed',
    not exists (select 1 from public.org_members where user_id = '00000000-0000-4000-8000-0000000000a2'
      and org_id = '00000000-0000-4000-8000-0000000000b1'));
  perform pg_temp.check('request: authorization epoch advanced',
    pg_temp.epoch('00000000-0000-4000-8000-0000000000b1') > (select epoch_before from erasure_state));
  perform pg_temp.check('request: profile flagged',
    (select account_deletion_requested_at is not null from public.user_profiles
      where user_id = '00000000-0000-4000-8000-0000000000a2'));
  perform pg_temp.check('request: receipt pending, token stored as hash only',
    exists (select 1 from public.account_deletion_receipts r where r.job_id = job and r.status = 'pending'
      and r.token_sha256 = encode(sha256('receipt-token'::bytea), 'hex')
      and to_jsonb(r)::text not ilike '%receipt-token%'));
  perform pg_temp.check('request: audited without the address',
    exists (select 1 from public.audit_events where action = 'account.deletion.requested'
      and user_id = '00000000-0000-4000-8000-0000000000a2' and user_email is null));
  -- A second request (double click) keeps the same job and receipt, and
  -- rotates the token so only the newest tab can read the receipt.
  -- Separate statement: a statement's own subqueries do not see the writes
  -- of a function it calls.
  perform pg_temp.check('request: repeat returns the same job',
    public.request_account_deletion(
      p_user_id => '00000000-0000-4000-8000-0000000000a2',
      p_token_sha256 => encode(sha256('second-token'::bytea), 'hex')) = job);
  perform pg_temp.check('request: repeat keeps one receipt and one audit row, rotates the token',
    (select count(*) from public.account_deletion_receipts
      where user_id = '00000000-0000-4000-8000-0000000000a2') = 1
    and (select count(*) from public.audit_events where action = 'account.deletion.requested'
      and user_id = '00000000-0000-4000-8000-0000000000a2') = 1
    and exists (select 1 from public.account_deletion_receipts
      where token_sha256 = encode(sha256('second-token'::bytea), 'hex')));
exception when others then
  perform pg_temp.check('request: succeeds', false, sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  begin
    perform public.request_account_deletion(
      p_user_id => '00000000-0000-4000-8000-0000000000a3',
      p_token_sha256 => encode(sha256('sole'::bytea), 'hex'));
    perform pg_temp.check('last owner with members is refused', false, 'request accepted');
  exception when others then
    perform pg_temp.check('last owner with members is refused', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;
  perform pg_temp.check('last owner keeps membership and gets no receipt',
    exists (select 1 from public.org_members where user_id = '00000000-0000-4000-8000-0000000000a3')
    and not exists (select 1 from public.account_deletion_receipts
      where user_id = '00000000-0000-4000-8000-0000000000a3'));
exception when others then
  perform pg_temp.check('last owner keeps membership and gets no receipt', false, sqlstate || ' ' || sqlerrm);
end $$;

-- Erasure: personal content first (the job does this), then the Auth user.
delete from public.projects where id = '00000000-0000-4000-8000-0000000000c2';
do $$ begin
  delete from auth.users where id = '00000000-0000-4000-8000-0000000000a2';
  perform pg_temp.check('auth user deletion succeeds despite audit and AI evidence', true);
exception when others then
  perform pg_temp.check('auth user deletion succeeds despite audit and AI evidence', false,
    sqlstate || ' ' || sqlerrm);
end $$;

do $$ begin
  perform pg_temp.check('profile is gone',
    not exists (select 1 from public.user_profiles where user_id = '00000000-0000-4000-8000-0000000000a2'));
  perform pg_temp.check('audit row intact and still names the deleted account',
    exists (select 1 from public.audit_events where id = '00000000-0000-4000-8000-000000000104'
      and user_id = '00000000-0000-4000-8000-0000000000a2' and action = 'litt.erasure.test'));
  perform pg_temp.check('AI evidence intact and still names its author',
    exists (select 1 from public.ai_executions where id = '00000000-0000-4000-8000-000000000105'
      and author_user_id = '00000000-0000-4000-8000-0000000000a2'));
  perform pg_temp.check('matter project kept, author detached',
    exists (select 1 from public.projects where id = '00000000-0000-4000-8000-0000000000c1' and user_id is null));
  perform pg_temp.check('matter document and version kept',
    exists (select 1 from public.documents where id = '00000000-0000-4000-8000-0000000000f1' and user_id is null)
    and exists (select 1 from public.document_versions where id = '00000000-0000-4000-8000-0000000000f2'));
  perform pg_temp.check('matter chat and message kept',
    exists (select 1 from public.chats where id = '00000000-0000-4000-8000-000000000101' and user_id is null)
    and exists (select 1 from public.chat_messages where id = '00000000-0000-4000-8000-000000000102'
      and author_user_id is null));
  perform pg_temp.check('matter review kept',
    exists (select 1 from public.tabular_reviews where id = '00000000-0000-4000-8000-000000000103'));
exception when others then
  perform pg_temp.check('post-erasure reads', false, sqlstate || ' ' || sqlerrm);
end $$;

-- Completion ------------------------------------------------------------
do $$
declare job uuid := (select job_id from erasure_state);
begin
  perform public.complete_account_deletion(
    p_user_id => '00000000-0000-4000-8000-0000000000a2',
    p_receipt => '{"deleted":["Personal documents"],"retained":[]}'::jsonb);
  perform public.complete_account_deletion(
    p_user_id => '00000000-0000-4000-8000-0000000000a2',
    p_receipt => '{"deleted":["Personal documents"],"retained":[]}'::jsonb);
  perform pg_temp.check('completion: receipt completed with the last-backup date',
    exists (select 1 from public.account_deletion_receipts where job_id = job and status = 'completed'
      and completed_at is not null
      and backups_expire_on = (completed_at at time zone 'utc')::date + 30
      and receipt -> 'deleted' ? 'Personal documents'),
    (select to_jsonb(r)::text from public.account_deletion_receipts r where job_id = job));
  perform pg_temp.check('completion: audited once, without the address',
    (select count(*) from public.audit_events where action = 'account.deleted'
      and user_id = '00000000-0000-4000-8000-0000000000a2' and user_email is null) = 1);
exception when others then
  perform pg_temp.check('completion: succeeds', false, sqlstate || ' ' || sqlerrm);
end $$;

-- Receipts are server-only.
do $$ begin
  perform pg_temp.check('receipts are not readable by clients',
    not has_table_privilege('authenticated', 'public.account_deletion_receipts', 'select')
    and not has_table_privilege('anon', 'public.account_deletion_receipts', 'select'));
exception when others then
  perform pg_temp.check('receipts are not readable by clients', false, sqlstate || ' ' || sqlerrm);
end $$;

-- New audit rows never store the actor's address.
insert into public.audit_events(id, user_id, user_email, org_id, action)
values ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-0000000000a1',
        'owner@example.test', '00000000-0000-4000-8000-0000000000b1', 'litt.erasure.email');
do $$ begin
  perform pg_temp.check('audit insert drops the actor address',
    (select user_email is null from public.audit_events where id = '00000000-0000-4000-8000-000000000106'));
end $$;

-- The organization audit still sorts by person, now by the live profile.
do $$
declare page jsonb;
begin
  page := public.organization_audit_events_page(
    '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'owner@example.test',
    '{}'::jsonb, 'user_email', 'asc', 0, 50);
  perform pg_temp.check('organization audit sorts by person with deleted actors last',
    (page -> 'events' -> 0 ->> 'user_id') = '00000000-0000-4000-8000-0000000000a1'
    and (page -> 'events' -> -1 ->> 'user_id') = '00000000-0000-4000-8000-0000000000a2',
    page::text);
exception when others then
  perform pg_temp.check('organization audit sorts by person with deleted actors last', false,
    sqlstate || ' ' || sqlerrm);
end $$;

-- A permission change names the admin by id only: the address would outlive
-- an erased account in an insert-only row. The name is read from the profile.
insert into auth.users(id, email) values ('00000000-0000-4000-8000-0000000000a5', 'admin@example.test');
insert into public.user_profiles(user_id, email) values ('00000000-0000-4000-8000-0000000000a5', 'admin@example.test')
  on conflict (user_id) do nothing;
insert into public.org_members(org_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a5', 'admin');
do $$ begin
  perform public.set_org_private_content_permission('00000000-0000-4000-8000-0000000000b1',
    '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a5', true);
  perform pg_temp.check('permission change audit stores no address',
    (select count(*) = 1 and bool_and(title is null and detail->>'target_user_id' = '00000000-0000-4000-8000-0000000000a5'
       and position('admin@example.test' in (to_jsonb(e))::text) = 0)
     from public.audit_events e where action = 'org.private_content.permission_changed'),
    (select string_agg(coalesce(title, '<null>'), ',') from public.audit_events
     where action = 'org.private_content.permission_changed'));
exception when others then
  perform pg_temp.check('permission change audit stores no address', false, sqlstate || ' ' || sqlerrm);
end $$;

select case when ok then 'PASS' else 'FAIL' end || '  ' || name ||
       coalesce('  [' || detail || ']', '') as result
from litt_check order by name;

do $$ begin
  if exists (select 1 from litt_check where not ok) then
    raise exception 'LiTT account erasure: % of % checks failed',
      (select count(*) from litt_check where not ok), (select count(*) from litt_check);
  end if;
end $$;
rollback;
