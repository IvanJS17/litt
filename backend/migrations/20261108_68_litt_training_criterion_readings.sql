-- Migration date: 2026-11-08
--
-- LiTT training layer 3, periodic full reading (docs/training.md): a junior
-- reads one whole document without the assistant, writes what they found,
-- and only then sees what the machine found, each machine finding checked
-- against the document's own text, and how the two lists compare.
--
-- training_readings is learning data, like every training_* table: it hangs
-- from the person's membership (deleted with it), RLS is on and nothing is
-- granted to the browser roles; the backend (service_role) reads it for the
-- person and their CURRENT mentor only (training_can_read_learning).
--
--   - The document's title is not stored: only identifiers (project, document
--     and the version that was read). They go to null if the document goes.
--   - findings is the person's declaration. It is written once, with
--     submitted_at, and then it can no longer change, so the comparison can
--     never be written to look like what they wrote.
--   - machine_findings holds only findings whose quote was located in the
--     version's text; comparison matches them to the person's own lines.
--   - The route (provider, model, credential reference; identifiers only) is
--     the person's own, fixed on the row the first time the machine reads.
--   - One reading is open at a time per person and organization.

create table if not exists public.training_readings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  trainee_user_id uuid not null,
  project_id uuid references public.projects(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  version_id uuid references public.document_versions(id) on delete set null,
  -- The person may change the proposed document once.
  swapped boolean not null default false,
  status text not null default 'assigned',
  findings text,
  submitted_at timestamptz,
  -- [{ text, excerpt }]: a finding and the passage of the document it rests on.
  machine_findings jsonb,
  -- { person_items, both: [{ person, machine }], only_person, only_machine, discarded }
  comparison jsonb,
  model_provider text,
  model text,
  credential_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.training_readings drop constraint if exists training_readings_member_fkey;
alter table public.training_readings add constraint training_readings_member_fkey
  foreign key (org_id, trainee_user_id)
  references public.org_members(org_id, user_id) on delete cascade;

alter table public.training_readings drop constraint if exists training_readings_status_check;
alter table public.training_readings add constraint training_readings_status_check
  check (status in ('assigned', 'submitted', 'comparing', 'compared', 'failed'));

alter table public.training_readings drop constraint if exists training_readings_findings_check;
alter table public.training_readings add constraint training_readings_findings_check
  check (
    (status = 'assigned') = (findings is null)
    and (findings is null) = (submitted_at is null)
    and (findings is null or char_length(findings) between 1 and 4000)
  );

alter table public.training_readings drop constraint if exists training_readings_route_check;
alter table public.training_readings add constraint training_readings_route_check
  check (
    num_nonnulls(model_provider, model, credential_ref) in (0, 3)
    and (status not in ('comparing', 'compared') or model_provider is not null)
  );

alter table public.training_readings drop constraint if exists training_readings_result_check;
alter table public.training_readings add constraint training_readings_result_check
  check (
    (status = 'compared') = (machine_findings is not null)
    and (machine_findings is null) = (comparison is null)
    and (machine_findings is null or (
      jsonb_typeof(machine_findings) = 'array' and jsonb_array_length(machine_findings) <= 8
      and octet_length(machine_findings::text) <= 40000))
    and (comparison is null or (
      jsonb_typeof(comparison) = 'object' and octet_length(comparison::text) <= 40000))
  );

create index if not exists training_readings_trainee_idx
  on public.training_readings(org_id, trainee_user_id, created_at);
create index if not exists training_readings_document_idx
  on public.training_readings(document_id) where document_id is not null;
-- A person has one reading open at a time in each organization.
create unique index if not exists training_readings_open_key
  on public.training_readings(org_id, trainee_user_id) where status <> 'compared';

-- What the person wrote is written once: the machine's list and the
-- comparison come after it and cannot be matched to a rewritten version.
create or replace function public.training_readings_findings_once()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.findings is not null and new.findings is distinct from old.findings then
    raise exception 'A training reading''s findings are recorded once'
      using errcode = 'LT002';
  end if;
  return new;
end;
$$;
revoke all on function public.training_readings_findings_once() from public, anon, authenticated;

drop trigger if exists training_readings_findings_once on public.training_readings;
create trigger training_readings_findings_once
  before update on public.training_readings
  for each row execute function public.training_readings_findings_once();

alter table public.training_readings enable row level security;
revoke all on public.training_readings from anon, authenticated;
grant select, insert, update, delete on public.training_readings to service_role;
