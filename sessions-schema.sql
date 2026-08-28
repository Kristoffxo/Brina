-- ============================================================
-- Brina 2.0 — paid phone sessions
--
-- Run this in the Supabase SQL editor ON TOP of schema.sql.
-- It only adds; it changes nothing the text chat depends on.
--
-- Same shape as the rest of the system: anonymous callers get no
-- direct table access, only security-definer functions that check
-- a token before doing anything.
-- ============================================================

create extension if not exists pgcrypto;

-- ── Listeners who take calls ────────────────────────────────
-- Deliberately separate from the text-chat listener. Taking a call
-- is a different job with a different bar, and the qualification
-- text is stored per person rather than claimed globally, so the
-- site never has to make a blanket statement about credentials.
create table if not exists public.session_listeners (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,
  -- Free text, shown to the caller verbatim. e.g. "MA Psychology,
  -- Brina-trained" or just "Brina-trained listener". Never write
  -- "therapist" here unless the person actually is one.
  qualification text not null,
  languages     text not null default 'Hindi, English',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ── Bookable slots ──────────────────────────────────────────
create table if not exists public.session_slots (
  id           uuid primary key default gen_random_uuid(),
  listener_id  uuid not null references public.session_listeners(id) on delete cascade,
  starts_at    timestamptz not null,
  duration_min int not null default 30,
  price_inr    int not null default 0,
  -- open | held | booked
  status       text not null default 'open' check (status in ('open','held','booked')),
  created_at   timestamptz not null default now()
);

create index if not exists session_slots_time_idx
  on public.session_slots (starts_at) where status = 'open';

-- ── Bookings ────────────────────────────────────────────────
-- A phone session needs a number to call, so this is the one place
-- in Brina that holds contact details. It is stored against a
-- booking, never against a person, and it is deleted with the
-- booking. The text chat stays completely anonymous.
create table if not exists public.session_bookings (
  id             uuid primary key default gen_random_uuid(),
  slot_id        uuid not null references public.session_slots(id) on delete cascade,
  booking_token  uuid not null default gen_random_uuid(),
  caller_name    text,
  caller_phone   text not null,
  note           text,
  status         text not null default 'confirmed' check (status in ('confirmed','cancelled','done')),
  created_at     timestamptz not null default now()
);

create unique index if not exists session_bookings_one_per_slot
  on public.session_bookings (slot_id) where status = 'confirmed';

-- ── Lock the tables ─────────────────────────────────────────
alter table public.session_listeners enable row level security;
alter table public.session_slots     enable row level security;
alter table public.session_bookings  enable row level security;

revoke all on public.session_listeners from anon, authenticated;
revoke all on public.session_slots     from anon, authenticated;
revoke all on public.session_bookings  from anon, authenticated;

-- ── What a visitor may see ──────────────────────────────────
-- Open slots only, and never anyone's phone number.
create or replace function public.open_slots(p_days int default 14)
returns table (
  slot_id uuid,
  starts_at timestamptz,
  duration_min int,
  price_inr int,
  listener_name text,
  qualification text,
  languages text
)
language sql stable security definer set search_path = public
as $$
  select s.id, s.starts_at, s.duration_min, s.price_inr,
         l.display_name, l.qualification, l.languages
  from public.session_slots s
  join public.session_listeners l on l.id = s.listener_id
  where s.status = 'open'
    and l.is_active
    -- 30 minutes' notice minimum, as advertised on the page.
    and s.starts_at > now() + interval '30 minutes'
    and s.starts_at < now() + (p_days || ' days')::interval
  order by s.starts_at
  limit 200;
$$;

-- ── Booking ─────────────────────────────────────────────────
create or replace function public.book_slot(
  p_slot uuid,
  p_phone text,
  p_name text default null,
  p_note text default null
)
returns table (booking_id uuid, booking_token uuid, starts_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  s record;
  clean_phone text;
  new_id uuid;
  new_token uuid;
begin
  -- Keep digits and a leading +, nothing else.
  clean_phone := regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g');
  if length(regexp_replace(clean_phone, '[^0-9]', '', 'g')) < 10 then
    raise exception 'phone looks wrong';
  end if;

  -- Lock the row so two people cannot take the same slot.
  select * into s from public.session_slots
   where id = p_slot for update;

  if not found then
    raise exception 'slot not found';
  end if;
  if s.status <> 'open' then
    raise exception 'slot taken';
  end if;
  if s.starts_at <= now() + interval '30 minutes' then
    raise exception 'too late';
  end if;

  update public.session_slots set status = 'booked' where id = p_slot;

  insert into public.session_bookings (slot_id, caller_phone, caller_name, note)
  values (p_slot, clean_phone,
          nullif(btrim(coalesce(p_name,'')), ''),
          nullif(btrim(coalesce(p_note,'')), ''))
  returning id, session_bookings.booking_token into new_id, new_token;

  booking_id    := new_id;
  booking_token := new_token;
  starts_at     := s.starts_at;
  return next;
end;
$$;

-- The booking token is the only proof of ownership, same idea as
-- the chat's visitor token.
create or replace function public.cancel_booking(p_booking uuid, p_token uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare s uuid;
begin
  select slot_id into s from public.session_bookings
   where id = p_booking and booking_token = p_token and status = 'confirmed';

  if not found then
    raise exception 'booking not found';
  end if;

  update public.session_bookings set status = 'cancelled' where id = p_booking;
  update public.session_slots set status = 'open' where id = s;
end;
$$;

grant execute on function public.open_slots(int)                        to anon;
grant execute on function public.book_slot(uuid, text, text, text)      to anon;
grant execute on function public.cancel_booking(uuid, uuid)             to anon;

-- ── Seed, so the page has something to show ─────────────────
-- Replace these with real people before this goes anywhere near
-- the public. The qualification text is shown to callers verbatim.
insert into public.session_listeners (display_name, qualification, languages)
select 'Aryan', 'Brina-trained listener', 'Hindi, English'
where not exists (select 1 from public.session_listeners);

-- A fortnight of 30-minute evening slots, weekdays only.
insert into public.session_slots (listener_id, starts_at, duration_min, price_inr)
select l.id, slot_time, 30, 199
from public.session_listeners l
cross join lateral (
  select generate_series(
    date_trunc('day', now()) + interval '18 hours',
    date_trunc('day', now()) + interval '14 days' + interval '18 hours',
    interval '1 day'
  ) as slot_time
) g
where l.display_name = 'Aryan'
  and extract(dow from g.slot_time) between 1 and 5
  and not exists (
    select 1 from public.session_slots s
    where s.listener_id = l.id and s.starts_at = g.slot_time
  );
