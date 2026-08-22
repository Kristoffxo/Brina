alter table public.messages add column if not exists read_at timestamptz;

drop function if exists public.visitor_poll(uuid, uuid, bigint);

create function public.visitor_poll(p_conversation uuid, p_token uuid)
returns table (id bigint, sender text, body text, created_at timestamptz, read_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation and c.visitor_token = p_token
  ) then
    raise exception 'conversation not found';
  end if;

  update public.conversations
  set visitor_last_seen = now()
  where public.conversations.id = p_conversation;

  update public.messages
  set read_at = now()
  where conversation_id = p_conversation and sender = 'listener' and read_at is null;

  return query
    select m.id, m.sender, m.body, m.created_at, m.read_at
    from public.messages m
    where m.conversation_id = p_conversation
    order by m.id;
end;
$$;

create or replace function public.purge_stale(p_token uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.listener_ok(p_token) then
    raise exception 'session expired';
  end if;

  delete from public.conversations
  where public.conversations.last_message_at < now() - interval '90 days';
end;
$$;

-- Same full-sync shape as visitor_poll, and the same reason: return the
-- whole thread every time so read-receipt changes on already-seen messages
-- reach the client without a second kind of request.
drop function if exists public.listener_messages(uuid, uuid, bigint);

create function public.listener_messages(p_token uuid, p_conversation uuid)
returns table (id bigint, sender text, body text, created_at timestamptz, read_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.listener_ok(p_token) then
    raise exception 'session expired';
  end if;

  update public.messages
  set read_at = now()
  where conversation_id = p_conversation and sender = 'visitor' and read_at is null;

  return query
    select m.id, m.sender, m.body, m.created_at, m.read_at
    from public.messages m
    where m.conversation_id = p_conversation
    order by m.id;
end;
$$;

grant execute on function public.visitor_poll(uuid, uuid)                     to anon;
grant execute on function public.listener_messages(uuid, uuid)                to anon;
