-- Migration date: 2026-11-25
--
-- Address changes and what is addressed to an address.
--
-- When an account's address changes (old -> new):
--   * pending firm and platform invitations addressed to the old address are
--     withdrawn, as account erasure withdraws them: nobody who later registers
--     the old address inherits an offer made to its previous holder;
--   * pending firm and platform invitations addressed to the new address are
--     withdrawn too: an invitation is an offer to whoever held the address
--     when it was made, and an existing account taking the address does not
--     answer it (the firm can invite again);
--   * shares of personal playbooks (playbook_shares) move to the new address,
--     keeping the stronger role when the new address already has one, and are
--     deleted when the address is cleared, like the other email-keyed shares.
-- Every pending invitation is withdrawn, one past its date included (sending
-- it again would give it a new date). Answered invitations are left as they
-- are. Rows already stranded on an address no account holds are not touched.
--
-- Safe to re-run: create or replace. The trigger is unchanged.

create or replace function public.handle_user_email_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_email text := lower(btrim(coalesce(old.email, '')));
  new_email text := lower(btrim(coalesce(new.email, '')));
begin
  update public.user_profiles
  set email = lower(new.email),
      updated_at = now()
  where user_id = new.id;

  if old_email = new_email then
    return new;
  end if;

  -- An invitation is an offer to whoever held the address when it was made.
  -- An existing account that takes an address does not answer the invitations
  -- still pending for it: they are withdrawn (the firm can invite again).
  -- Every pending invitation goes, one past its date included: sending it
  -- again gives it a new date. Answered invitations are left as they are.
  if new_email <> '' then
    update public.org_invitations
       set status = 'cancelled', cancelled_at = now()
     where email = new_email
       and status = 'pending';
    delete from public.platform_invitations
     where email = new_email
       and status = 'pending';
  end if;

  if old_email = '' then
    return new;
  end if;

  -- Pending invitations addressed to the address this account gives up are
  -- withdrawn the way account erasure withdraws them, so whoever later
  -- registers that address inherits no offer made to its previous holder.
  update public.org_invitations
     set status = 'cancelled', cancelled_at = now()
   where email = old_email
     and status = 'pending';
  delete from public.platform_invitations
   where email = old_email
     and status = 'pending';

  -- Direct grants are keyed by normalized email, so they belong to whoever
  -- holds that address. When this account's address changes, its grants
  -- follow it: left behind, the person silently loses their shares and
  -- whoever later registers the old address (a reassigned mailbox) inherits
  -- them, Owner grants included. A grant already held by the new address is
  -- kept at the stronger of the two roles.
  if new_email = '' then
    delete from public.project_access_grants where email = old_email;
    delete from public.chat_access_grants where email = old_email;
    delete from public.tabular_review_access_grants where email = old_email;
    delete from public.workflow_shares where shared_with_email = old_email;
    delete from public.playbook_shares where shared_with_email = old_email;
    return new;
  end if;

  update public.project_access_grants as kept
     set role = moved.role, updated_at = now()
    from public.project_access_grants as moved
   where moved.email = old_email
     and kept.email = new_email
     and kept.project_id = moved.project_id
     and (case moved.role when 'owner' then 2 when 'editor' then 1 else 0 end)
       > (case kept.role when 'owner' then 2 when 'editor' then 1 else 0 end);
  delete from public.project_access_grants as moved
   where moved.email = old_email
     and exists (
       select 1 from public.project_access_grants as kept
        where kept.project_id = moved.project_id
          and kept.email = new_email
     );
  update public.project_access_grants
     set email = new_email, updated_at = now()
   where email = old_email;

  update public.chat_access_grants as kept
     set role = moved.role, updated_at = now()
    from public.chat_access_grants as moved
   where moved.email = old_email
     and kept.email = new_email
     and kept.chat_id = moved.chat_id
     and (case moved.role when 'owner' then 2 when 'editor' then 1 else 0 end)
       > (case kept.role when 'owner' then 2 when 'editor' then 1 else 0 end);
  delete from public.chat_access_grants as moved
   where moved.email = old_email
     and exists (
       select 1 from public.chat_access_grants as kept
        where kept.chat_id = moved.chat_id
          and kept.email = new_email
     );
  update public.chat_access_grants
     set email = new_email, updated_at = now()
   where email = old_email;

  update public.tabular_review_access_grants as kept
     set role = moved.role, updated_at = now()
    from public.tabular_review_access_grants as moved
   where moved.email = old_email
     and kept.email = new_email
     and kept.tabular_review_id = moved.tabular_review_id
     and (case moved.role when 'owner' then 2 when 'editor' then 1 else 0 end)
       > (case kept.role when 'owner' then 2 when 'editor' then 1 else 0 end);
  delete from public.tabular_review_access_grants as moved
   where moved.email = old_email
     and exists (
       select 1 from public.tabular_review_access_grants as kept
        where kept.tabular_review_id = moved.tabular_review_id
          and kept.email = new_email
     );
  update public.tabular_review_access_grants
     set email = new_email, updated_at = now()
   where email = old_email;

  update public.workflow_shares as kept
     set role = moved.role
    from public.workflow_shares as moved
   where moved.shared_with_email = old_email
     and kept.shared_with_email = new_email
     and kept.workflow_id = moved.workflow_id
     and (case moved.role when 'owner' then 2 when 'editor' then 1 else 0 end)
       > (case kept.role when 'owner' then 2 when 'editor' then 1 else 0 end);
  delete from public.workflow_shares as moved
   where moved.shared_with_email = old_email
     and exists (
       select 1 from public.workflow_shares as kept
        where kept.workflow_id = moved.workflow_id
          and kept.shared_with_email = new_email
     );
  update public.workflow_shares
     set shared_with_email = new_email
   where shared_with_email = old_email;

  update public.playbook_shares as kept
     set role = moved.role
    from public.playbook_shares as moved
   where moved.shared_with_email = old_email
     and kept.shared_with_email = new_email
     and kept.playbook_id = moved.playbook_id
     and (case moved.role when 'owner' then 2 when 'editor' then 1 else 0 end)
       > (case kept.role when 'owner' then 2 when 'editor' then 1 else 0 end);
  delete from public.playbook_shares as moved
   where moved.shared_with_email = old_email
     and exists (
       select 1 from public.playbook_shares as kept
        where kept.playbook_id = moved.playbook_id
          and kept.shared_with_email = new_email
     );
  update public.playbook_shares
     set shared_with_email = new_email
   where shared_with_email = old_email;

  return new;
end;
$$;
