-- Parrylicious — Neon Postgres Schema (Ersatz für supabase-schema.sql)
--
-- Zweck:
--   Vollständiges DB-Setup nach der Migration von Supabase (Auth + DB) zu
--   Neon Postgres mit selbstgebauter Auth. Anstelle von Supabase-Auth
--   (auth.users, auth.uid(), RLS-Policies) verwenden wir eigene Tabellen
--   (auth_users, auth_tokens). Autorisierung passiert NICHT mehr über RLS,
--   sondern im API-Layer bzw. über explizite Parameter (p_user_id/p_actor_id)
--   in den SQL-Funktionen.
--
-- Ausführung:
--   Dieses Skript im Neon SQL-Editor (oder via psql gegen DATABASE_URL) als
--   Ganzes ausführen. Es ist idempotent (create ... if not exists /
--   create or replace / drop trigger if exists), kann also gefahrlos
--   wiederholt werden.
--
-- Reihenfolge (so wie unten aufgebaut):
--   1) Extensions
--   2) Auth-Tabellen (auth_users, auth_tokens) + Indizes
--   3) Fachtabellen (profiles, role_email_rules, bookings, waitlist) + Indizes
--   4) set_updated_at() + Trigger auf allen Tabellen
--   5) Funktionen (Rollen, Slot-Verfügbarkeit, Booking-Lifecycle, Admin)
--   6) handle_new_user()-Trigger auf auth_users
--   7) API-Rolle parry_api + Grants (kein RLS, keine Policies)
--
-- Hinweis: DATABASE_URL (siehe ENV) MUSS die Rolle parry_api verwenden.
--          Diese Rolle hat nur die unten explizit gewährten Rechte.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 2) Auth-Tabellen
-- ---------------------------------------------------------------------------

create table if not exists public.auth_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text,
  google_id text unique,
  email_verified boolean not null default false,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists auth_users_email_lower_uidx
  on public.auth_users ((lower(email)));

create table if not exists public.auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.auth_users(id) on delete cascade,
  token_hash text not null,
  purpose text not null check (purpose in ('refresh', 'login_code', 'password_reset')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists auth_tokens_hash_purpose_idx
  on public.auth_tokens (token_hash, purpose);
create index if not exists auth_tokens_user_purpose_idx
  on public.auth_tokens (user_id, purpose);
create index if not exists auth_tokens_expires_at_idx
  on public.auth_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- 3) Fachtabellen (1:1 aus supabase-schema.sql, FKs auf auth_users umgestellt)
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references public.auth_users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'staff', 'admin')),
  full_name text,
  phone text,
  address text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.role_email_rules (
  email text primary key,
  role text not null default 'customer' check (role in ('customer', 'staff', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.auth_users(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  service_id text not null,
  service_name text not null,
  duration_min integer not null,
  price_from numeric not null default 0,
  deposit numeric not null default 0,
  stylist_id text not null default 'auto',
  stylist_name text not null default 'Egal (automatisch)',
  date_iso date not null,
  time text not null,
  customer jsonb not null default '{}'::jsonb,
  deposit_paid boolean not null default false,
  payment_status text not null default 'unpaid',
  payment_provider text,
  payment_reference text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  payment_receipt_url text,
  paid_at timestamptz
);

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.auth_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  service_id text not null,
  service_name text not null,
  email text not null,
  phone text not null,
  note text default ''
);

-- Additive Spalten-Migrationen (idempotent, für bestehende Installationen).
alter table public.bookings add column if not exists payment_status text not null default 'unpaid';
alter table public.bookings add column if not exists payment_provider text;
alter table public.bookings add column if not exists payment_reference text;
alter table public.bookings add column if not exists stripe_checkout_session_id text;
alter table public.bookings add column if not exists stripe_payment_intent_id text;
alter table public.bookings add column if not exists payment_receipt_url text;
alter table public.bookings add column if not exists paid_at timestamptz;
alter table public.profiles add column if not exists address text;
alter table public.profiles add column if not exists avatar_url text;

update public.bookings
set payment_status = case when deposit_paid then 'paid' else 'unpaid' end
where payment_status is null or payment_status = '';

-- Indizes (1:1 übernommen).
create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists role_email_rules_role_idx on public.role_email_rules(role);
create unique index if not exists role_email_rules_email_lower_uidx on public.role_email_rules ((lower(email)));
create index if not exists bookings_user_created_idx on public.bookings(user_id, created_at desc);
create index if not exists bookings_date_status_idx on public.bookings(date_iso, status);
create index if not exists bookings_stylist_date_idx on public.bookings(stylist_id, date_iso);
create index if not exists bookings_payment_status_idx on public.bookings(payment_status);
create index if not exists waitlist_user_created_idx on public.waitlist(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4) set_updated_at() + Trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_auth_users_updated_at on public.auth_users;
create trigger set_auth_users_updated_at
before update on public.auth_users
for each row execute procedure public.set_updated_at();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists set_role_email_rules_updated_at on public.role_email_rules;
create trigger set_role_email_rules_updated_at
before update on public.role_email_rules
for each row execute procedure public.set_updated_at();

drop trigger if exists set_bookings_updated_at on public.bookings;
create trigger set_bookings_updated_at
before update on public.bookings
for each row execute procedure public.set_updated_at();

drop trigger if exists set_waitlist_updated_at on public.waitlist;
create trigger set_waitlist_updated_at
before update on public.waitlist
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) Funktionen
-- ---------------------------------------------------------------------------

-- Rolle aus E-Mail-Regel ableiten (Fallback 'customer').
create or replace function public.role_for_email(p_email text)
returns text
language sql
stable
as $$
  select coalesce(
    (
      select r.role
      from public.role_email_rules r
      where lower(r.email) = lower(coalesce(p_email, ''))
      limit 1
    ),
    'customer'
  );
$$;

-- Rolle eines Users lesen (Fallback 'customer').
create or replace function public.user_role(p_user_id uuid)
returns text
language sql
stable
as $$
  select coalesce((select p.role from public.profiles p where p.id = p_user_id), 'customer');
$$;

-- Staff-Check (staff oder admin).
create or replace function public.is_staff_role(p_user_id uuid)
returns boolean
language sql
stable
as $$
  select public.user_role(p_user_id) in ('staff', 'admin');
$$;

-- Rolle aus E-Mail-Regel synchronisieren: liest email/full_name aus auth_users,
-- upsertet profiles und gibt die (neue) Rolle zurück.
create or replace function public.sync_role_from_email(p_user_id uuid)
returns text
language plpgsql
as $$
declare
  v_email text;
  v_full_name text;
  v_role text;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select
    u.email,
    coalesce(u.full_name, split_part(u.email, '@', 1))
  into v_email, v_full_name
  from public.auth_users u
  where u.id = p_user_id
  limit 1;

  v_role := public.role_for_email(v_email);

  insert into public.profiles (id, role, full_name)
  values (p_user_id, v_role, v_full_name)
  on conflict (id) do update
    set role = excluded.role;

  return v_role;
end;
$$;

-- Minuten seit Mitternacht aus 'HH:MM'-Zeitstring.
create or replace function public.minutes_from_time(p_time text)
returns integer
language sql
immutable
as $$
  select (extract(hour from p_time::time)::integer * 60) + extract(minute from p_time::time)::integer;
$$;

-- Slot-Verfügbarkeit: Stylist=max 1 gleichzeitig, 'auto'=max 4 gleichzeitig.
-- Logik UNVERÄNDERT aus supabase-schema.sql übernommen.
create or replace function public.slot_is_available(
  p_date_iso date,
  p_time text,
  p_duration_min integer,
  p_stylist_id text default 'auto',
  p_exclude_booking_id uuid default null
)
returns boolean
language sql
stable
as $$
  with desired as (
    select
      public.minutes_from_time(p_time) as start_min,
      public.minutes_from_time(p_time) + p_duration_min as end_min
  ),
  active as (
    select b.*
    from public.bookings b
    where b.date_iso = p_date_iso
      and b.status <> 'canceled'
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
  )
  select
    case
      when coalesce(p_stylist_id, 'auto') <> 'auto' then
        not exists (
          select 1
          from active b, desired d
          where b.stylist_id = p_stylist_id
            and public.minutes_from_time(b.time) < d.end_min
            and d.start_min < (public.minutes_from_time(b.time) + b.duration_min)
        )
      else
        (
          select count(*)
          from active b, desired d
          where public.minutes_from_time(b.time) < d.end_min
            and d.start_min < (public.minutes_from_time(b.time) + b.duration_min)
        ) < 4
    end;
$$;

-- Booking sicher anlegen: Advisory-Lock + Slot-Check UNVERÄNDERT erhalten.
create or replace function public.create_booking_secure(
  p_user_id uuid,
  p_service_id text,
  p_service_name text,
  p_duration_min integer,
  p_price_from numeric,
  p_deposit numeric,
  p_stylist_id text,
  p_stylist_name text,
  p_date_iso date,
  p_time text,
  p_customer jsonb,
  p_deposit_paid boolean default false
)
returns public.bookings
language plpgsql
as $$
declare
  v_booking public.bookings;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_duration_min is null or p_duration_min <= 0 then
    raise exception 'INVALID_DURATION';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_date_iso::text || '|' || coalesce(p_stylist_id, 'auto')));

  if not public.slot_is_available(
    p_date_iso,
    p_time,
    p_duration_min,
    coalesce(p_stylist_id, 'auto'),
    null
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  insert into public.bookings (
    user_id,
    status,
    service_id,
    service_name,
    duration_min,
    price_from,
    deposit,
    stylist_id,
    stylist_name,
    date_iso,
    time,
    customer,
    deposit_paid,
    payment_status
  )
  values (
    p_user_id,
    'requested',
    p_service_id,
    p_service_name,
    p_duration_min,
    coalesce(p_price_from, 0),
    coalesce(p_deposit, 0),
    coalesce(p_stylist_id, 'auto'),
    coalesce(p_stylist_name, 'Egal (automatisch)'),
    p_date_iso,
    p_time,
    coalesce(p_customer, '{}'::jsonb),
    coalesce(p_deposit_paid, false),
    case when coalesce(p_deposit_paid, false) then 'paid' else 'unpaid' end
  )
  returning * into v_booking;

  return v_booking;
end;
$$;

-- Eigene Buchung stornieren.
create or replace function public.cancel_my_booking(
  p_user_id uuid,
  p_booking_id uuid
)
returns public.bookings
language plpgsql
as $$
declare
  v_booking public.bookings;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.bookings
  set status = 'canceled'
  where id = p_booking_id
    and user_id = p_user_id
  returning * into v_booking;

  if v_booking.id is null then
    raise exception 'BOOKING_NOT_FOUND_OR_FORBIDDEN';
  end if;

  return v_booking;
end;
$$;

-- Buchungsstatus setzen (nur Staff/Admin). is_staff_role-Check bleibt in SQL.
create or replace function public.set_booking_status(
  p_actor_id uuid,
  p_booking_id uuid,
  p_status text
)
returns public.bookings
language plpgsql
as $$
declare
  v_booking public.bookings;
begin
  if p_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_staff_role(p_actor_id) then
    raise exception 'FORBIDDEN';
  end if;

  if p_status not in ('requested', 'confirmed', 'canceled') then
    raise exception 'INVALID_STATUS';
  end if;

  update public.bookings
  set status = p_status
  where id = p_booking_id
  returning * into v_booking;

  if v_booking.id is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  return v_booking;
end;
$$;

-- Rolle per E-Mail setzen (nur Admin). Schreibt role_email_rules + profiles
-- (falls User existiert). Admin-Check bleibt in SQL.
create or replace function public.admin_set_user_role_by_email(
  p_actor_id uuid,
  p_email text,
  p_role text
)
returns table(user_id uuid, email text, role text)
language plpgsql
as $$
declare
  v_target uuid;
  v_email text;
  v_role text := lower(trim(coalesce(p_role, 'customer')));
begin
  if p_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if public.user_role(p_actor_id) <> 'admin' then
    raise exception 'FORBIDDEN';
  end if;

  if v_role not in ('customer', 'staff', 'admin') then
    raise exception 'INVALID_ROLE';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'EMAIL_REQUIRED';
  end if;

  select u.id into v_target
  from public.auth_users u
  where lower(u.email) = v_email
  limit 1;

  insert into public.role_email_rules (email, role)
  values (v_email, v_role)
  on conflict (email) do update
    set role = excluded.role;

  if v_target is not null then
    insert into public.profiles (id, role)
    values (v_target, v_role)
    on conflict (id) do update
      set role = excluded.role;
  end if;

  return query
  select
    v_target as user_id,
    v_email as email,
    v_role as role;
end;
$$;

-- Userliste mit Rollen (nur Admin). Join auf auth_users statt auth.users.
create or replace function public.admin_list_users_with_roles(
  p_actor_id uuid,
  p_limit integer default 120
)
returns table(
  user_id uuid,
  email text,
  role text,
  full_name text,
  phone text,
  address text,
  avatar_url text,
  created_at timestamptz
)
language plpgsql
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 120), 500));
begin
  if p_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if public.user_role(p_actor_id) <> 'admin' then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select
    u.id as user_id,
    coalesce(u.email, '') as email,
    coalesce(p.role, 'customer') as role,
    coalesce(p.full_name, '') as full_name,
    coalesce(p.phone, '') as phone,
    coalesce(p.address, '') as address,
    coalesce(p.avatar_url, '') as avatar_url,
    u.created_at
  from public.auth_users u
  left join public.profiles p on p.id = u.id
  order by u.created_at desc
  limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) handle_new_user() — legt profiles-Zeile bei neuem auth_users an
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    public.role_for_email(new.email),
    coalesce(new.full_name, split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on public.auth_users;
create trigger on_auth_user_created
after insert on public.auth_users
for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 7) API-Rolle parry_api + Grants (kein RLS, keine Policies)
-- ---------------------------------------------------------------------------
--
-- DATABASE_URL MUSS diese Rolle verwenden. Autorisierung erfolgt im API-Layer
-- und über die p_user_id/p_actor_id-Parameter der Funktionen — NICHT über RLS.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'parry_api') then
    -- Passwort wird beim Anlegen in Neon gesetzt (z.B. per ALTER ROLE ... PASSWORD).
    create role parry_api with login;
  end if;
end
$$;

grant usage on schema public to parry_api;

grant select, insert, update, delete on
  public.auth_users,
  public.auth_tokens,
  public.profiles,
  public.role_email_rules,
  public.bookings,
  public.waitlist
to parry_api;

grant execute on all functions in schema public to parry_api;
