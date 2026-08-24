-- ============================================================
-- Brina — database
--
-- ONE STEP: copy this whole file, paste it into the Supabase
-- SQL editor, press Run. That is the entire backend setup.
--
-- You do not create any user or account. The first time you
-- open admin.html you choose a passphrase, and that becomes
-- the console's lock. Do that straight away, before the site
-- is public — whoever claims it first owns it.
-- ============================================================

create extension if not exists pgcrypto;

-- ── Tables ──────────────────────────────────────────────────

create table if not exists public.conversations (
  id                uuid primary key default gen_random_uuid(),
  -- The visitor holds this. It is the only proof the conversation
  -- is theirs, it never reaches the listener, and it dies with
  -- their browser tab.
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
  created_at      timestamptz not null default now(),
  -- Set the moment the OTHER party polls and sees this message. Drives the
  -- sent/read tick in both UIs. Never set by the sender themselves.
  read_at         timestamptz
);

alter table public.messages add column if not exists read_at timestamptz;

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, id);

create index if not exists conversations_recent_idx
  on public.conversations (last_message_at desc);

-- One row. Holds the hash of the console passphrase — never the
-- passphrase itself, which is not stored anywhere at any point.
create table if not exists public.listener_auth (
  id              boolean primary key default true check (id),
  passphrase_hash text,
  claimed_at      timestamptz
);

insert into public.listener_auth (id) values (true) on conflict (id) do nothing;

-- Signed-in console sessions. They expire on their own.
create table if not exists public.listener_sessions (
  token      uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours')
);

-- Failed sign-ins, so the passphrase cannot be guessed at speed.
create table if not exists public.listener_attempts (
  at timestamptz not null default now(),
  ok boolean not null
);

create index if not exists listener_attempts_at_idx on public.listener_attempts (at desc);

-- Drives the "someone is here" pill on the landing page.
create table if not exists public.listener_presence (
  id           boolean primary key default true check (id),
  is_available boolean not null default false,
  note         text,
  updated_at   timestamptz not null default now()
);

insert into public.listener_presence (id, is_available)
values (true, false)
on conflict (id) do nothing;

-- ── Lock everything ─────────────────────────────────────────
-- RLS on, no policies at all: nobody reaches these tables
-- directly, ever. Every read and write goes through a function
-- below that checks a token first.

alter table public.conversations      enable row level security;
alter table public.messages           enable row level security;
alter table public.listener_auth      enable row level security;
alter table public.listener_sessions  enable row level security;
alter table public.listener_attempts  enable row level security;
alter table public.listener_presence  enable row level security;

revoke all on public.conversations     from anon, authenticated;
revoke all on public.messages          from anon, authenticated;
revoke all on public.listener_auth     from anon, authenticated;
revoke all on public.listener_sessions from anon, authenticated;
revoke all on public.listener_attempts from anon, authenticated;
revoke all on public.listener_presence from anon, authenticated;

-- ══ Visitor ═════════════════════════════════════════════════

create or replace function public.start_conversation()
returns table (conversation_id uuid, visitor_token uuid)
language plpgsql security definer set search_path = public
as $$
declare
  new_id uuid; new_token uuid;
begin
  insert into public.conversations default values
  returning id, conversations.visitor_token into new_id, new_token;

  conversation_id := new_id;
  visitor_token   := new_token;
  return next;
end;
$$;

create or replace function public.visitor_send(
  p_conversation uuid, p_token uuid, p_body text
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare recent int; new_id bigint;
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation and c.visitor_token = p_token
  ) then
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

-- Returns the whole conversation every time, not just what's new. Marking
-- the listener's messages read happens in the same call that reads them, so
-- there's no separate "mark as read" round trip. Conversation lists here
-- stay small (one-on-one, personal), so re-sending the full thread every
-- three seconds is cheap and keeps the client's reconciliation logic simple:
-- no separate "did this message's status change" query to write.
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

  -- Fully qualified: RETURNS TABLE declares output columns named sender and
  -- read_at, which shadow the table's own columns inside plpgsql.
  update public.messages
  set read_at = now()
  where public.messages.conversation_id = p_conversation
    and public.messages.sender = 'listener'
    and public.messages.read_at is null;

  return query
    select m.id, m.sender, m.body, m.created_at, m.read_at
    from public.messages m
    where m.conversation_id = p_conversation
    order by m.id;
end;
$$;

create or replace function public.visitor_close(p_conversation uuid, p_token uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.conversations c
  where c.id = p_conversation and c.visitor_token = p_token;
end;
$$;

create or replace function public.listener_status()
returns table (is_available boolean, note text)
language sql stable security definer set search_path = public
as $$
  select p.is_available, p.note from public.listener_presence p where p.id = true;
$$;

-- ══ Console ═════════════════════════════════════════════════

-- Has a passphrase been set yet? The console asks this on load.
create or replace function public.listener_claimed()
returns boolean
language sql stable security definer set search_path = public
as $$
  select passphrase_hash is not null from public.listener_auth where id = true;
$$;

-- First run only: choose the passphrase and get a session back.
create or replace function public.listener_claim(p_passphrase text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare new_token uuid;
begin
  if (select passphrase_hash from public.listener_auth where id = true) is not null then
    raise exception 'already claimed';
  end if;

  if char_length(p_passphrase) < 10 then
    raise exception 'passphrase too short';
  end if;

  update public.listener_auth
  set passphrase_hash = crypt(p_passphrase, gen_salt('bf', 10)),
      claimed_at = now()
  where id = true;

  insert into public.listener_sessions default values returning token into new_token;
  return new_token;
end;
$$;

create or replace function public.listener_login(p_passphrase text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare stored text; new_token uuid; failures int;
begin
  select count(*) into failures
  from public.listener_attempts a
  where a.ok = false and a.at > now() - interval '15 minutes';

  if failures >= 8 then
    raise exception 'too many attempts';
  end if;

  select passphrase_hash into stored from public.listener_auth where id = true;

  if stored is null or crypt(p_passphrase, stored) <> stored then
    insert into public.listener_attempts (ok) values (false);
    raise exception 'wrong passphrase';
  end if;

  insert into public.listener_attempts (ok) values (true);
  delete from public.listener_sessions where expires_at < now();
  delete from public.listener_attempts where at < now() - interval '1 day';

  insert into public.listener_sessions default values returning token into new_token;
  return new_token;
end;
$$;

create or replace function public.listener_ok(p_token uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.listener_sessions s
    where s.token = p_token and s.expires_at > now()
  );
$$;

create or replace function public.listener_signout(p_token uuid)
returns void
language sql security definer set search_path = public
as $$
  delete from public.listener_sessions where token = p_token;
$$;

-- The list, newest activity first. Also does the housekeeping:
-- anything untouched for a day is deleted here, automatically.
-- The list, newest activity first. Output columns are deliberately
-- named differently from the table's own columns: inside plpgsql the
-- RETURNS TABLE names are variables, and a name shared with a column
-- is ambiguous the moment anything references it unqualified.
-- Renaming the output columns needs a drop first: Postgres will not
-- let create-or-replace change a function's return type.
drop function if exists public.listener_conversations(uuid);

create function public.listener_conversations(p_token uuid)
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

-- Not called by anything automatically, on purpose: the only way a
-- conversation is deleted is the visitor or the listener choosing to delete
-- it (visitor_close / listener_delete). This exists only as a manual tool —
-- run it yourself from the SQL editor if you ever want to sweep out
-- conversations abandoned for a long time. Nothing in the app calls it.
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

  -- Fully qualified for the same reason as visitor_poll.
  update public.messages
  set read_at = now()
  where public.messages.conversation_id = p_conversation
    and public.messages.sender = 'visitor'
    and public.messages.read_at is null;

  return query
    select m.id, m.sender, m.body, m.created_at, m.read_at
    from public.messages m
    where m.conversation_id = p_conversation
    order by m.id;
end;
$$;

create or replace function public.listener_send(
  p_token uuid, p_conversation uuid, p_body text
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare new_id bigint;
begin
  if not public.listener_ok(p_token) then
    raise exception 'session expired';
  end if;

  insert into public.messages (conversation_id, sender, body)
  values (p_conversation, 'listener', p_body)
  returning id into new_id;

  update public.conversations set last_message_at = now() where id = p_conversation;
  return new_id;
end;
$$;

create or replace function public.listener_delete(p_token uuid, p_conversation uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.listener_ok(p_token) then
    raise exception 'session expired';
  end if;

  delete from public.conversations where id = p_conversation;
end;
$$;

create or replace function public.listener_get_presence(p_token uuid)
returns table (is_available boolean, note text)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.listener_ok(p_token) then
    raise exception 'session expired';
  end if;

  return query select p.is_available, p.note from public.listener_presence p where p.id = true;
end;
$$;

create or replace function public.listener_set_presence(
  p_token uuid, p_available boolean, p_note text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.listener_ok(p_token) then
    raise exception 'session expired';
  end if;

  update public.listener_presence
  set is_available = p_available,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = true;
end;
$$;

-- ── Who may call what ───────────────────────────────────────

grant execute on function public.start_conversation()                         to anon;
grant execute on function public.visitor_send(uuid, uuid, text)               to anon;
grant execute on function public.visitor_poll(uuid, uuid)                     to anon;
grant execute on function public.visitor_close(uuid, uuid)                    to anon;
grant execute on function public.listener_status()                            to anon;

grant execute on function public.listener_claimed()                           to anon;
grant execute on function public.listener_claim(text)                         to anon;
grant execute on function public.listener_login(text)                         to anon;
grant execute on function public.listener_signout(uuid)                       to anon;
grant execute on function public.listener_conversations(uuid)                 to anon;
grant execute on function public.purge_stale(uuid)                            to anon;
grant execute on function public.listener_messages(uuid, uuid)                to anon;
grant execute on function public.listener_send(uuid, uuid, text)              to anon;
grant execute on function public.listener_delete(uuid, uuid)                  to anon;
grant execute on function public.listener_get_presence(uuid)                  to anon;
grant execute on function public.listener_set_presence(uuid, boolean, text)   to anon;

revoke execute on function public.listener_ok(uuid) from anon, authenticated, public;
