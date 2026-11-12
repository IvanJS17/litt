-- Migration date: 2026-11-12
--
-- Scan reading. A new reading of a version that already has one ("read again")
-- keeps the previous reading in force until the new one finishes, and a failed
-- one leaves it in place. So `pages` may be set while the status is
-- 'processing' or 'failed'; 'ready' still requires it.
alter table public.document_version_ocr drop constraint if exists document_version_ocr_ready;
alter table public.document_version_ocr add constraint document_version_ocr_ready
  check (status <> 'ready' or pages is not null);

-- Re-runnable: drop constraint if exists, then add it again.
