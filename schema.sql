-- ============================================================
-- Brina — database schema
-- Paste this whole file into the Supabase SQL editor and run it.
-- Safe to re-run: everything is create-if-not-exists / or replace.
-- ============================================================

create extension if not exists pgcrypto;

-- ── Tables ──────────────────────────────────────────────────

create table if not exists public.conversations (
  id                uuid primary key default gen_random_uuid(),
  -- The visitor holds this token. It is the only proof of ownership.
  -- It is never shown to the listener and never leaves the visitor's tab.
  visitor_token     uuid not null default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  last_message_at   timestamptz not null default now(),
  visitor_last_seen timestamptz not null default now()
);

create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender          text not null check (sender in ('visitor', 'listener')),
  body            text not null check (char_length(body) between 1 and 4000),
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, id);

create index if not exists conversations_recent_idx
  on public.conversations (last_message_at desc);

-- Who is allowed into the admin console. Add your own user id here
-- after you create your account (see README).
create table if not exists public.listeners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  label   text
);

-- One row, ever. Drives the "someone is here" pill on the landing page.
create table if not exists public.listener_presence (
  id           boolean primary key default true check (id),
  is_available boolean not null default false,
  note         text,
  updated_at   timestamptz not null default now()
);

insert into public.listener_presence (id, is_available)
values (true, false)
on conflict (id) do nothing;

-- ── Row level security ──────────────────────────────────────
-- Anonymous visitors get NO direct table access at all. Every
-- thing they do goes through the security-definer functions
-- below, which check their token. The listener gets full access
-- but only if their user id is in public.listeners.

alter table public.conversations     enable row level security;
alter table public.messages          enable row level security;
alter table public.listeners         enable row level security;
alter table public.listener_presence enable row level security;

create or replace function public.is_listener()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.listeners l where l.user_id = auth.uid());
$$;

drop policy if exists listener_all_conversations on public.conversations;
create policy listener_all_conversations on public.conversations
  for all to authenticated
  using (public.is_listener()) with check (public.is_listener());

drop policy if exists listener_all_messages on public.messages;
create policy listener_all_messages on public.messages
  for all to authenticated
  using (public.is_listener()) with check (public.is_listener());

drop policy if exists listener_reads_listeners on public.listeners;
create policy listener_reads_listeners on public.listeners
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists listener_presence_rw on public.listener_presence;
create policy listener_presence_rw on public.listener_presence
  for all to authenticated
  using (public.is_listener()) with check (public.is_listener());

-- ── Visitor functions ───────────────────────────────────────

-- Starts a conversation and hands back the pair the visitor needs.
create or replace function public.start_conversation()
returns table (conversation_id uuid, visitor_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id    uuid;
  new_token uuid;
begin
  insert into public.conversations default values
  returning id, conversations.visitor_token into new_id, new_token;

  conversation_id := new_id;
  visitor_token   := new_token;
  return next;
end;
$$;

-- Posts one message from the visitor. Rate limited to 20 messages
-- a minute per conversation, which is far above normal typing and
-- far below anything worth calling a flood.
create or replace function public.visitor_send(
  p_conversation uuid,
  p_token        uuid,
  p_body         text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  ok       boolean;
  recent   int;
  new_id   bigint;
begin
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation and c.visitor_token = p_token
  ) into ok;

  if not ok then
    raise exception 'conversation not found';
  end if;

  select count(*) into recent
  from public.messages m
  where m.conversation_id = p_conversation
    and m.sender = 'visitor'
    and m.created_at > now() - interval '1 minute';

  if recent >= 20 then
    raise exception 'slow down';
  end if;

  insert into public.messages (conversation_id, sender, body)
  values (p_conversation, 'visitor', p_body)
  returning id into new_id;

  update public.conversations
  set last_message_at = now(), visitor_last_seen = now()
  where id = p_conversation;

  return new_id;
end;
$$;

-- Returns anything newer than p_after. Also marks the visitor as
-- still present, so the listener can see who is actually there.
create or replace function public.visitor_poll(
  p_conversation uuid,
  p_token        uuid,
  p_after        bigint default 0
)
returns table (id bigint, sender text, body text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
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

  return query
    select m.id, m.sender, m.body, m.created_at
    from public.messages m
    where m.conversation_id = p_conversation
      and m.id > p_after
    order by m.id;
end;
$$;

-- The visitor closing the chat deletes it. Not archives. Deletes.
create or replace function public.visitor_close(
  p_conversation uuid,
  p_token        uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.conversations c
  where c.id = p_conversation and c.visitor_token = p_token;
end;
$$;

-- Public, unauthenticated: is anyone around right now?
create or replace function public.listener_status()
returns table (is_available boolean, note text)
language sql
stable
security definer
set search_path = public
as $$
  select p.is_available, p.note from public.listener_presence p where p.id = true;
$$;

-- Anything idle for a day goes. Called by the admin console on
-- load; see the README for scheduling it properly with pg_cron.
create or replace function public.purge_stale_conversations()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  removed int;
begin
  with gone as (
    delete from public.conversations
    where last_message_at < now() - interval '24 hours'
    returning 1
  )
  select count(*) into removed from gone;
  return removed;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────

revoke all on public.conversations     from anon;
revoke all on public.messages          from anon;
revoke all on public.listeners         from anon;
revoke all on public.listener_presence from anon;

grant execute on function public.start_conversation()                    to anon, authenticated;
grant execute on function public.visitor_send(uuid, uuid, text)          to anon, authenticated;
grant execute on function public.visitor_poll(uuid, uuid, bigint)        to anon, authenticated;
grant execute on function public.visitor_close(uuid, uuid)               to anon, authenticated;
grant execute on function public.listener_status()                       to anon, authenticated;
grant execute on function public.purge_stale_conversations()             to authenticated;
