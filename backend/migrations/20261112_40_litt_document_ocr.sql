-- Migration date: 2026-11-12
--
-- Scan reading (layer 6, docs/document-ocr.md). What an owner's own LandingAI
-- key read from a scanned PDF version, keyed to that exact version and byte
-- revision. The reading is merged into document_version_texts (the index the
-- assistant, the search and the Markdown conversion read), so this table is the
-- source and the provenance: who asked, with which model, at what credit cost.
-- It is not AI evidence. Server-only, like document_version_texts.
create table if not exists public.document_version_ocr (
  version_id uuid primary key references public.document_versions(id) on delete cascade,
  source_revision uuid not null,
  provider text not null default 'landingai' check (provider in ('landingai')),
  status text not null default 'processing' check (status in ('processing','ready','failed')),
  markdown text,
  model text,
  credits numeric,
  page_count integer,
  failed_pages integer[] not null default '{}',
  error_code text,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_version_ocr_ready check ((status = 'ready') = (markdown is not null))
);
alter table public.document_version_ocr enable row level security;
revoke all on public.document_version_ocr from public, anon, authenticated;
grant select,insert,update,delete on public.document_version_ocr to service_role;

-- Re-runnable: if not exists; the grants and revokes repeat harmlessly.
