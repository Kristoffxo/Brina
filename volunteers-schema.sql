-- ============================================================
-- Brina — multiple listener accounts
--
-- Run this in the Supabase SQL editor, on top of schema.sql.
--
-- Replaces the single shared passphrase with one account per
-- person. Your existing passphrase is preserved and promoted to
-- super admin — you will not be locked out and nothing you
-- already know stops working.
--
-- Three volunteer accounts are created with the passcodes below.
-- Each volunteer sets their own display name the first time they
-- sign in; you see who they are and when they were last active.
-- ============================================================

create extension if not exists pgcrypto;

-- ── Accounts ────────────────────────────────────────────────
create table if not exists public.listener_accounts (
  id              uuid primary key default gen_random_uuid(),
  -- The slot label you assign ("Volunteer 1"). Fixed.
  label           text not null,
  -- What the volunteer calls themselves. They set this; it can be
  -- changed by them at any time, and is what appears in the console.
  display_name    text,
  passphrase_hash text not null,
  is_admin        boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz
);

-- Sessions now belong to an account rather than floating free.
alter table public.listener_sessions
  add column if not exists account_id uuid references public.listener_accounts(id) on delete cascade;

alter table public.listener_accounts enable row level security;
revoke all on public.listener_accounts from anon, authenticated;

-- ── Carry the existing passphrase across ────────────────────
-- The hash is copied, not regenerated, so the passphrase you
-- already use keeps working and becomes the admin account.
insert into public.listener_accounts (label, display_name, passphrase_hash, is_admin)
select 'Super admin', 'Admin', a.passphrase_hash, true
from public.listener_auth a
where a.passphrase_hash is not null
  and not exists (select 1 from public.listener_accounts where is_admin);

-- ── The three volunteer accounts ────────────────────────────
-- Passcodes are hashed here, exactly as the console does it, so
-- the plaintext never lands in the database.
insert into public.listener_accounts (label, passphrase_hash, is_admin)
select v.label, extensions.crypt(v.pass, extensions.gen_salt('bf', 10)), false
from (values
  ('Volunteer 1', 'velvetlantern56'),
  ('Volunteer 2', 'monsoontamarind38'),
  ('Volunteer 3', 'pebblecedar25')
) as v(label, pass)
where not exists (
  select 1 from public.listener_accounts a where a.label = v.label
);

-- ── Sign in ─────────────────────────────────────────────────
-- Checks the passphrase against every active account. With four
-- accounts the loop is trivial; revisit only if this grows large.
create or replace function public.listener_login(p_passphrase text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  acct     record;
  failures int;
  new_token uuid;
begin
  select count(*) into failures
  from public.listener_attempts a
  where a.ok = false and a.at > now() - interval '15 minutes';

  if failures >= 8 then
    raise exception 'too many attempts';
  end if;

  select * into acct
  from public.listener_accounts a
  where a.is_active
    and crypt(p_passphrase, a.passphrase_hash) = a.passphrase_hash
  limit 1;

  if not found then
    insert into public.listener_attempts (ok) values (false);
    raise exception 'wrong passphrase';
  end if;

  insert into public.listener_attempts (ok) values (true);
  delete from public.listener_sessions where expires_at < now();
  delete from public.listener_attempts where at < now() - interval '1 day';

  update public.listener_accounts
  set last_seen_at = now()
  where id = acct.id;

  insert into public.listener_sessions (account_id)
  values (acct.id)
  returning token into new_token;

  return new_token;
end;
$$;

-- ── Who am I ────────────────────────────────────────────────
-- The console calls this on load to decide whether to show the
-- admin panel and whether to ask for a name.
create or replace function public.listener_me(p_token uuid)
returns table (label text, display_name text, is_admin boolean)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.listener_ok(p_token) then
    raise exception 'session expired';
  end if;

  -- Touching this on every load is what makes "last seen" useful.
  update public.listener_accounts a
  set last_seen_at = now()
  from public.listener_sessions s
  where s.token = p_token and a.id = s.account_id;

  return query
    select a.label, a.display_name, a.is_admin
    from public.listener_sessions s
    join public.listener_accounts a on a.id = s.account_id
    where s.token = p_token;
end;
$$;

-- Volunteers name themselves.
create or replace function public.listener_set_name(p_token uuid, p_name text)
returns void
language plpgsql security definer set search_path = public
as $$
declare clean text;
begin
  if not public.listener_ok(p_token) then
    raise exception 'session expired';
  end if;

  clean := nullif(btrim(coalesce(p_name, '')), '');
  if clean is null then
    raise exception 'name required';
  end if;

  update public.listener_accounts a
  set display_name = left(clean, 24)
  from public.listener_sessions s
  where s.token = p_token and a.id = s.account_id;
end;
$$;

-- ── Admin view ──────────────────────────────────────────────
-- Who exists, who is signed in right now, when each was last seen.
-- Admin only — a volunteer calling this gets nothing.
create or replace function public.admin_listeners(p_token uuid)
returns table (
  account_id uuid,
  label text,
  display_name text,
  is_admin boolean,
  is_active boolean,
  last_seen_at timestamptz,
  live_sessions bigint,
  signed_in_now boolean
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.listener_ok(p_token) then
    raise exception 'session expired';
  end if;

  if not exists (
    select 1 from public.listener_sessions s
    join public.listener_accounts a on a.id = s.account_id
    where s.token = p_token and a.is_admin
  ) then
    raise exception 'not an admin';
  end if;

  return query
    select a.id, a.label, a.display_name, a.is_admin, a.is_active, a.last_seen_at,
           (select count(*) from public.listener_sessions s2
             where s2.account_id = a.id and s2.expires_at > now()),
           (a.last_seen_at is not null and a.last_seen_at > now() - interval '5 minutes')
    from public.listener_accounts a
    order by a.is_admin desc, a.label;
end;
$$;

-- Turn a volunteer's access on or off without deleting anything.
-- Switching someone off also ends their live sessions immediately.
create or replace function public.admin_set_active(
  p_token uuid, p_account uuid, p_active boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.listener_ok(p_token) then
    raise exception 'session expired';
  end if;

  if not exists (
    select 1 from public.listener_sessions s
    join public.listener_accounts a on a.id = s.account_id
    where s.token = p_token and a.is_admin
  ) then
    raise exception 'not an admin';
  end if;

  -- An admin cannot switch themselves off and lock everyone out.
  if exists (select 1 from public.listener_accounts where id = p_account and is_admin) then
    raise exception 'cannot change an admin';
  end if;

  update public.listener_accounts set is_active = p_active where id = p_account;

  if not p_active then
    delete from public.listener_sessions where account_id = p_account;
  end if;
end;
$$;

grant execute on function public.listener_login(text)                    to anon;
grant execute on function public.listener_me(uuid)                       to anon;
grant execute on function public.listener_set_name(uuid, text)           to anon;
grant execute on function public.admin_listeners(uuid)                   to anon;
grant execute on function public.admin_set_active(uuid, uuid, boolean)   to anon;

-- listener_claimed still answers "has anyone set a passphrase yet",
-- which is now "does any account exist".
create or replace function public.listener_claimed()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.listener_accounts);
$$;
