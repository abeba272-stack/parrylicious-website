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
  purpose text not null check (purpose in ('refresh', 'login_code', 'password_reset', 'email_verify')),
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
  -- user_id ist nullable: Gast-Buchungen ohne Konto (Kontakt steht in customer jsonb).
  user_id uuid references public.auth_users(id) on delete set null,
  status text not null default 'requested' check (status in ('pending_payment', 'requested', 'confirmed', 'canceled', 'completed')),
  -- Für pending_payment-Holds: Ablauf der Slot-Reservierung während des Checkouts.
  hold_expires_at timestamptz,
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
  -- user_id nullable: Gast-Warteliste ohne Konto.
  user_id uuid references public.auth_users(id) on delete set null,
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
-- Termin-Erinnerung per E-Mail: Zeitstempel, wann die Erinnerung verschickt wurde (null = noch nicht).
alter table public.bookings add column if not exists reminded_at timestamptz;
alter table public.profiles add column if not exists address text;
alter table public.profiles add column if not exists avatar_url text;

-- Gast-Buchung / Pflicht-Anzahlung / Slot-Hold (idempotent für bestehende DB).
alter table public.bookings add column if not exists hold_expires_at timestamptz;
alter table public.bookings alter column user_id drop not null;
alter table public.waitlist alter column user_id drop not null;
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('pending_payment', 'requested', 'confirmed', 'canceled', 'completed'));

-- auth_tokens: Zweck 'email_verify' erlauben (Kunden-E-Mail-Verifizierung).
alter table public.auth_tokens drop constraint if exists auth_tokens_purpose_check;
alter table public.auth_tokens add constraint auth_tokens_purpose_check
  check (purpose in ('refresh', 'login_code', 'password_reset', 'email_verify'));

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
      -- Verfallene pending_payment-Holds blockieren den Slot nicht mehr.
      and (b.status <> 'pending_payment' or b.hold_expires_at is null or b.hold_expires_at > now())
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

-- Gast-Buchung als kurzlebigen Hold anlegen (Slot reservieren bis Zahlung).
-- user_id optional (null = Gast). Advisory-Lock + Slot-Check wie create_booking_secure.
create or replace function public.create_booking_hold(
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
  p_hold_minutes integer default 30,
  p_user_id uuid default null
)
returns public.bookings
language plpgsql
as $$
declare
  v_booking public.bookings;
begin
  if p_duration_min is null or p_duration_min <= 0 then
    raise exception 'INVALID_DURATION';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_date_iso::text || '|' || coalesce(p_stylist_id, 'auto')));

  if not public.slot_is_available(
    p_date_iso, p_time, p_duration_min, coalesce(p_stylist_id, 'auto'), null
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  insert into public.bookings (
    user_id, status, hold_expires_at, service_id, service_name, duration_min,
    price_from, deposit, stylist_id, stylist_name, date_iso, time, customer,
    deposit_paid, payment_status
  )
  values (
    p_user_id,
    'pending_payment',
    now() + make_interval(mins => greatest(1, coalesce(p_hold_minutes, 30))),
    p_service_id, p_service_name, p_duration_min,
    coalesce(p_price_from, 0), coalesce(p_deposit, 0), coalesce(p_stylist_id, 'auto'),
    coalesce(p_stylist_name, 'Egal (automatisch)'), p_date_iso, p_time,
    coalesce(p_customer, '{}'::jsonb), false, 'pending'
  )
  returning * into v_booking;

  return v_booking;
end;
$$;

-- Anzahlung bestätigen: Hold -> bestätigte, bezahlte Buchung (vom Webhook aufgerufen).
create or replace function public.confirm_booking_payment(
  p_booking_id uuid,
  p_payment_provider text default 'stripe',
  p_payment_reference text default null,
  p_stripe_checkout_session_id text default null,
  p_stripe_payment_intent_id text default null,
  p_payment_receipt_url text default null
)
returns public.bookings
language plpgsql
as $$
declare
  v_booking public.bookings;
begin
  update public.bookings
  set status = 'confirmed',
      deposit_paid = true,
      payment_status = 'paid',
      hold_expires_at = null,
      paid_at = coalesce(paid_at, now()),
      payment_provider = coalesce(p_payment_provider, payment_provider),
      payment_reference = coalesce(p_payment_reference, payment_reference),
      stripe_checkout_session_id = coalesce(p_stripe_checkout_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = coalesce(p_stripe_payment_intent_id, stripe_payment_intent_id),
      payment_receipt_url = coalesce(p_payment_receipt_url, payment_receipt_url)
  where id = p_booking_id
  returning * into v_booking;

  if v_booking.id is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  return v_booking;
end;
$$;

-- Kunde: eigene Buchung stornieren (nur >= 48 h vor dem Termin). Setzt status='canceled'
-- (Slot wird frei) und gibt die Buchung zurück (payment_intent für den Refund im API-Layer).
create or replace function public.cancel_booking_by_user(
  p_booking_id uuid,
  p_user_id uuid
)
returns public.bookings
language plpgsql
as $$
declare
  v_booking public.bookings;
  v_appt timestamptz;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.id is null or v_booking.user_id is distinct from p_user_id then
    raise exception 'BOOKING_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'NOT_CANCELABLE';
  end if;

  v_appt := ((v_booking.date_iso::text || ' ' || v_booking.time || ':00')::timestamp
             at time zone 'Europe/Berlin');
  if v_appt <= now() + interval '48 hours' then
    raise exception 'CANCEL_WINDOW_PASSED';
  end if;

  update public.bookings set status = 'canceled'
   where id = p_booking_id
   returning * into v_booking;
  return v_booking;
end;
$$;

-- Kunde: eigene Buchung verschieben (nur >= 48 h vor dem AKTUELLEN Termin). Prüft den
-- neuen Slot (Advisory-Lock + slot_is_available, sich selbst ausgenommen); Zahlung bleibt.
create or replace function public.reschedule_booking_by_user(
  p_booking_id uuid,
  p_user_id uuid,
  p_date_iso date,
  p_time text
)
returns public.bookings
language plpgsql
as $$
declare
  v_booking public.bookings;
  v_appt timestamptz;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.id is null or v_booking.user_id is distinct from p_user_id then
    raise exception 'BOOKING_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'NOT_RESCHEDULABLE';
  end if;

  v_appt := ((v_booking.date_iso::text || ' ' || v_booking.time || ':00')::timestamp
             at time zone 'Europe/Berlin');
  if v_appt <= now() + interval '48 hours' then
    raise exception 'CANCEL_WINDOW_PASSED';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_date_iso::text || '|' || coalesce(v_booking.stylist_id, 'auto')));
  if not public.slot_is_available(
    p_date_iso, p_time, v_booking.duration_min, coalesce(v_booking.stylist_id, 'auto'), p_booking_id
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  update public.bookings set date_iso = p_date_iso, time = p_time
   where id = p_booking_id
   returning * into v_booking;
  return v_booking;
end;
$$;

-- Staff-/Admin-Account anlegen (nur Admin). Passwort-Hash kommt aus dem API-Layer.
create or replace function public.admin_create_staff(
  p_actor_id uuid,
  p_email text,
  p_password_hash text,
  p_role text
)
returns table(user_id uuid, email text, role text)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_role text := lower(trim(coalesce(p_role, 'staff')));
  v_id uuid;
begin
  if p_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if public.user_role(p_actor_id) <> 'admin' then
    raise exception 'FORBIDDEN';
  end if;
  if v_email = '' then
    raise exception 'EMAIL_REQUIRED';
  end if;
  if v_role not in ('staff', 'admin') then
    raise exception 'INVALID_ROLE';
  end if;
  if p_password_hash is null or length(p_password_hash) < 20 then
    raise exception 'INVALID_PASSWORD';
  end if;
  if exists (select 1 from public.auth_users u where lower(u.email) = v_email) then
    raise exception 'EMAIL_EXISTS';
  end if;

  insert into public.auth_users (email, password_hash, email_verified)
  values (v_email, p_password_hash, true)
  returning id into v_id;

  insert into public.role_email_rules (email, role)
  values (v_email, v_role)
  on conflict (email) do update set role = excluded.role;

  update public.profiles set role = v_role where id = v_id;

  return query select v_id as user_id, v_email as email, v_role as role;
end;
$$;

-- Team-Account löschen (nur Admin). Löscht auth_users (Cascade: profiles;
-- bookings.user_id -> null) + die role_email_rule. Selbstlöschung verhindert.
create or replace function public.admin_delete_user(
  p_actor_id uuid,
  p_email text
)
returns table(deleted_email text)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_target uuid;
begin
  if p_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if public.user_role(p_actor_id) <> 'admin' then
    raise exception 'FORBIDDEN';
  end if;
  if v_email = '' then
    raise exception 'EMAIL_REQUIRED';
  end if;

  select u.id into v_target from public.auth_users u where lower(u.email) = v_email limit 1;
  if v_target is null then
    raise exception 'USER_NOT_FOUND';
  end if;
  if v_target = p_actor_id then
    raise exception 'CANNOT_DELETE_SELF';
  end if;

  delete from public.role_email_rules where lower(email) = v_email;
  delete from public.auth_users where id = v_target;

  return query select v_email as deleted_email;
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

  if p_status not in ('requested', 'confirmed', 'canceled', 'completed') then
    raise exception 'INVALID_STATUS';
  end if;

  update public.bookings
  set status = p_status
  where id = p_booking_id
  returning * into v_booking;

  if v_booking.id is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  -- Beim Abschließen Treuepunkte gutschreiben (idempotent).
  if p_status = 'completed' then
    perform public.grant_booking_points(v_booking.id);
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
-- Bei Mehrdeutigkeit (OUT-Spalten email/role vs. Tabellenspalten) die Spalte
-- bevorzugen — sonst 'column reference "email" is ambiguous' im INSERT/ON CONFLICT.
#variable_conflict use_column
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
-- Feature 4: Treuepunkte (loyalty_points) + Termin-Abschluss
-- ---------------------------------------------------------------------------

create table if not exists public.loyalty_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.auth_users(id) on delete cascade,
  delta integer not null,
  reason text not null check (reason in ('earn', 'redeem')),
  -- ON DELETE CASCADE: wird ein (unbezahlter) Hold storniert/gelöscht, verschwindet
  -- die zugehörige 'redeem'-Zeile -> eingelöste Punkte kommen automatisch zurück.
  booking_id uuid references public.bookings(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_points_user_idx on public.loyalty_points(user_id, created_at desc);
-- Pro Buchung nur EINE 'earn'-Gutschrift (Idempotenz gegen Doppelvergabe).
create unique index if not exists loyalty_points_earn_booking_uidx
  on public.loyalty_points(booking_id) where reason = 'earn';

-- Punkte für eine abgeschlossene Buchung gutschreiben (1 Punkt je 1 EUR price_from).
-- Idempotent: nur bei status='completed' + gesetztem user_id, pro Buchung einmal.
create or replace function public.grant_booking_points(p_booking_id uuid)
returns void
language plpgsql
as $$
declare
  v_b public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking_id;
  if v_b.id is null or v_b.user_id is null or v_b.status <> 'completed' then
    return;
  end if;
  if floor(coalesce(v_b.price_from, 0))::int <= 0 then
    return;
  end if;
  insert into public.loyalty_points (user_id, delta, reason, booking_id)
  values (v_b.user_id, floor(v_b.price_from)::int, 'earn', v_b.id)
  on conflict (booking_id) where reason = 'earn' do nothing;
end;
$$;

-- Fällige Termine (Termin in der Vergangenheit, Europe/Berlin) automatisch
-- abschließen und Punkte gutschreiben. Optional auf einen Nutzer beschränkt.
create or replace function public.complete_due_bookings(p_user_id uuid default null)
returns integer
language plpgsql
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    update public.bookings b
    set status = 'completed'
    where b.status = 'confirmed'
      and (p_user_id is null or b.user_id = p_user_id)
      and (((b.date_iso::text || ' ' || b.time || ':00')::timestamp at time zone 'Europe/Berlin') < now())
    returning b.id
  loop
    perform public.grant_booking_points(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Treuepunkte für eine (Hold-)Buchung einlösen. Atomar via Advisory-Lock gegen
-- gleichzeitige Doppel-Einlösung desselben Nutzers. Zieht p_points ab (negativer
-- delta, reason 'redeem'), an die Buchung gebunden. Wird der Hold später nicht
-- bezahlt und gelöscht, entfernt ON DELETE CASCADE die Zeile -> Punkte zurück.
-- Nur volle 100er-Schritte. Gibt die tatsächlich eingelösten Punkte zurück.
create or replace function public.redeem_points_for_booking(
  p_user_id uuid,
  p_booking_id uuid,
  p_points integer
)
returns integer
language plpgsql
as $$
declare
  v_balance integer;
begin
  if p_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_points is null or p_points <= 0 or (p_points % 100) <> 0 then
    raise exception 'INVALID_POINTS';
  end if;
  -- Serialisiert gleichzeitige Einlösungen desselben Nutzers (verhindert Doppel-Ausgabe).
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select coalesce(sum(delta), 0)::int into v_balance
  from public.loyalty_points where user_id = p_user_id;
  if v_balance < p_points then
    raise exception 'INSUFFICIENT_POINTS';
  end if;
  insert into public.loyalty_points (user_id, delta, reason, booking_id)
  values (p_user_id, -p_points, 'redeem', p_booking_id);
  return p_points;
end;
$$;

-- ---------------------------------------------------------------------------
-- Feature 2: Reviews (Bewertungen) mit Moderation
-- ---------------------------------------------------------------------------

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.auth_users(id) on delete set null,
  booking_id uuid unique references public.bookings(id) on delete set null,
  service_id text,
  service_name text,
  first_name text,
  rating integer not null check (rating between 1 and 5),
  text text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  created_at timestamptz not null default now()
);
create index if not exists reviews_status_service_idx on public.reviews(status, service_id, created_at desc);

-- Kunde legt eine Bewertung zu einer eigenen, ABGESCHLOSSENEN Buchung an (1 pro Buchung).
create or replace function public.create_review(
  p_user_id uuid,
  p_booking_id uuid,
  p_rating integer,
  p_text text
)
returns public.reviews
language plpgsql
as $$
declare
  v_b public.bookings;
  v_r public.reviews;
begin
  if p_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'INVALID_RATING'; end if;

  select * into v_b from public.bookings where id = p_booking_id;
  if v_b.id is null or v_b.user_id is distinct from p_user_id then
    raise exception 'BOOKING_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if v_b.status <> 'completed' then
    raise exception 'NOT_COMPLETED';
  end if;

  begin
    insert into public.reviews (user_id, booking_id, service_id, service_name, first_name, rating, text, status)
    values (
      p_user_id, p_booking_id, v_b.service_id, v_b.service_name,
      coalesce(nullif(trim(v_b.customer->>'firstName'), ''), 'Gast'),
      p_rating, nullif(trim(coalesce(p_text, '')), ''), 'pending'
    )
    returning * into v_r;
  exception when unique_violation then
    raise exception 'REVIEW_EXISTS';
  end;

  return v_r;
end;
$$;

-- Admin/Staff: Bewertung freischalten/ausblenden.
create or replace function public.admin_set_review_status(
  p_actor_id uuid,
  p_review_id uuid,
  p_status text
)
returns public.reviews
language plpgsql
as $$
declare
  v_r public.reviews;
begin
  if p_actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_staff_role(p_actor_id) then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('pending', 'approved', 'hidden') then raise exception 'INVALID_STATUS'; end if;

  update public.reviews set status = p_status where id = p_review_id returning * into v_r;
  if v_r.id is null then raise exception 'BOOKING_NOT_FOUND_OR_FORBIDDEN'; end if;
  return v_r;
end;
$$;

-- Admin/Staff: Bewertung löschen.
create or replace function public.admin_delete_review(
  p_actor_id uuid,
  p_review_id uuid
)
returns void
language plpgsql
as $$
begin
  if p_actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_staff_role(p_actor_id) then raise exception 'FORBIDDEN'; end if;
  delete from public.reviews where id = p_review_id;
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

-- Kalender-Sperrtage (Admin/Staff): einzelne Tage für Online-Buchungen sperren.
-- Wochenenden (Sa/So) werden zusätzlich in der API-Schicht (slots.js/checkout.js) geblockt.
create table if not exists public.blocked_days (
  day date primary key,
  created_by uuid references public.auth_users(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.blocked_days to parry_api;

-- Marketing-Einwilligung (Kundenkonto-Vorteil: Infos zu neuen Leistungen,
-- Produkten, Pop-ups/Events und Aktionen). DSGVO: Opt-in, Standard false.
alter table public.profiles add column if not exists marketing_opt_in boolean not null default false;

-- „Mein Bereich": gespeicherte Lieblingsleistungen (Service-IDs) für schnelles Buchen.
alter table public.profiles add column if not exists favorite_services jsonb not null default '[]'::jsonb;
