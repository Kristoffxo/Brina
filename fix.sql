-- ============================================================
-- Brina — FINISH SETUP
--
-- The main schema is already applied. This is the last piece:
-- one corrected function, one new one, and a reset of the
-- temporary passphrase used while testing.
--
-- Supabase → SQL Editor → New query → paste all of this → Run.
-- (It will warn about "destructive operations". That is the
-- deletes below, which only clear the test rows. Confirm it.)
-- ============================================================

-- The list, newest activity first. Also does the housekeeping:
-- anything untouched for a day is deleted here, automatically.
-- The list, newest activity first. Output columns are deliberately
-- named differently from the table's own columns: inside plpgsql the
-- RETURNS TABLE names are variables, and a name shared with a column
-- is ambiguous the moment anything references it unqualified.
create or replace function public.listener_conversations(p_token uuid)
returns table (
  conv_id uuid, started_at timestamptz, last_at timestamptz,
  visitor_here boolean, message_count bigint, waiting boolean
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.listener_ok(p_token) then
    raise exception 'session expired';
  end if;

  return query
    select c.id,
           c.created_at,
           c.last_message_at,
           (c.visitor_last_seen > now() - interval '20 seconds'),
           (select count(*) from public.messages m where m.conversation_id = c.id),
           coalesce((select m2.sender = 'visitor'
                       from public.messages m2
                      where m2.conversation_id = c.id
                      order by m2.id desc limit 1), false)
    from public.conversations c
    order by c.last_message_at desc
    limit 100;
end;
$$;

-- Housekeeping, kept separate so the list above is a pure read.
create or replace function public.purge_stale(p_token uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.listener_ok(p_token) then
    raise exception 'session expired';
  end if;

  delete from public.conversations
  where public.conversations.last_message_at < now() - interval '24 hours';
end;
$$;

grant execute on function public.purge_stale(uuid) to anon;

-- Clear everything left over from setup testing, and hand the
-- passphrase back to you: after this, admin.html will ask you to
-- choose one.
delete from public.conversations;
delete from public.listener_sessions;
delete from public.listener_attempts;
update public.listener_auth set passphrase_hash = null, claimed_at = null where id = true;
update public.listener_presence set is_available = false, note = null where id = true;
