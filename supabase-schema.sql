-- Run in Supabase SQL Editor.
-- This migration adds:
-- 1) profiles + role model (customer/staff/admin)
-- 2) bookings/waitlist with strict RLS
-- 3) secure RPC functions for slot checks + booking create/cancel/status updates
-- 4) payment tracking fields for Stripe checkout/webhook integration
-- 5) automatic role assignment by email rules

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  service_id text not null,
  service_name text not null,
  email text not null,
  phone text not null,
  note text default ''
);

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

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists role_email_rules_role_idx on public.role_email_rules(role);
create unique index if not exists role_email_rules_email_lower_uidx on public.role_email_rules ((lower(email)));
create index if not exists bookings_user_created_idx on public.bookings(user_id, created_at desc);
create index if not exists bookings_date_status_idx on public.bookings(date_iso, status);
create index if not exists bookings_stylist_date_idx on public.bookings(stylist_id, date_iso);
create index if not exists bookings_payment_status_idx on public.bookings(payment_status);
create index if not exists waitlist_user_created_idx on public.waitlist(user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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

create or replace function public.role_for_email(p_email text)
returns text
language sql
stable
security definer
set search_path = public
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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    public.role_for_email(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

insert into public.profiles (id, role, full_name)
select
  u.id,
  public.role_for_email(u.email),
  coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

insert into public.role_email_rules (email, role)
select
  lower(u.email),
  p.role
from auth.users u
join public.profiles p on p.id = u.id
where u.email is not null
  and p.role in ('staff', 'admin')
on conflict (email) do update
set role = excluded.role;

create or replace function public.user_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.role from public.profiles p where p.id = p_user_id), 'customer');
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.user_role(auth.uid());
$$;

create or replace function public.sync_my_role_from_email()
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_full_name text;
  v_role text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select
    u.email,
    coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))
  into v_email, v_full_name
  from auth.users u
  where u.id = v_user_id
  limit 1;

  v_role := public.role_for_email(v_email);

  insert into public.profiles (id, role, full_name)
  values (v_user_id, v_role, v_full_name)
  on conflict (id) do update
    set role = excluded.role;

  return v_role;
end;
$$;

create or replace function public.is_staff_role(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_role(p_user_id) in ('staff', 'admin');
$$;

create or replace function public.minutes_from_time(p_time text)
returns integer
language sql
immutable
as $$
  select (extract(hour from p_time::time)::integer * 60) + extract(minute from p_time::time)::integer;
$$;

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
security definer
set search_path = public
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

create or replace function public.create_booking_secure(
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
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_booking public.bookings;
begin
  if v_user_id is null then
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
    v_user_id,
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

create or replace function public.cancel_my_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_booking public.bookings;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.bookings
  set status = 'canceled'
  where id = p_booking_id
    and user_id = v_user_id
  returning * into v_booking;

  if v_booking.id is null then
    raise exception 'BOOKING_NOT_FOUND_OR_FORBIDDEN';
  end if;

  return v_booking;
end;
$$;

create or replace function public.set_booking_status(
  p_booking_id uuid,
  p_status text
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_booking public.bookings;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_staff_role(v_user_id) then
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

create or replace function public.admin_set_user_role_by_email(
  p_email text,
  p_role text
)
returns table(user_id uuid, email text, role text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_target uuid;
  v_email text;
  v_role text := lower(trim(coalesce(p_role, 'customer')));
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if public.user_role(v_actor) <> 'admin' then
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
  from auth.users u
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

create or replace function public.admin_list_users_with_roles(
  p_limit_rows integer default 120
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
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit_rows, 120), 500));
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if public.user_role(v_actor) <> 'admin' then
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
  from auth.users u
  left join public.profiles p on p.id = u.id
  order by u.created_at desc
  limit v_limit;
end;
$$;

alter table public.profiles enable row level security;
alter table public.role_email_rules enable row level security;
alter table public.bookings enable row level security;
alter table public.waitlist enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_staff_role(auth.uid()));

drop policy if exists "profiles_insert_self_or_staff" on public.profiles;
drop policy if exists "profiles_insert_self_or_admin" on public.profiles;
create policy "profiles_insert_self_or_admin"
on public.profiles
for insert
to authenticated
with check (id = auth.uid() or public.user_role(auth.uid()) = 'admin');

drop policy if exists "profiles_update_self_or_staff" on public.profiles;
drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin"
on public.profiles
for update
to authenticated
using (id = auth.uid() or public.user_role(auth.uid()) = 'admin')
with check (id = auth.uid() or public.user_role(auth.uid()) = 'admin');

drop policy if exists "role_email_rules_select_admin" on public.role_email_rules;
create policy "role_email_rules_select_admin"
on public.role_email_rules
for select
to authenticated
using (public.user_role(auth.uid()) = 'admin');

drop policy if exists "role_email_rules_insert_admin" on public.role_email_rules;
create policy "role_email_rules_insert_admin"
on public.role_email_rules
for insert
to authenticated
with check (public.user_role(auth.uid()) = 'admin');

drop policy if exists "role_email_rules_update_admin" on public.role_email_rules;
create policy "role_email_rules_update_admin"
on public.role_email_rules
for update
to authenticated
using (public.user_role(auth.uid()) = 'admin')
with check (public.user_role(auth.uid()) = 'admin');

drop policy if exists "role_email_rules_delete_admin" on public.role_email_rules;
create policy "role_email_rules_delete_admin"
on public.role_email_rules
for delete
to authenticated
using (public.user_role(auth.uid()) = 'admin');

drop policy if exists "bookings_select_own" on public.bookings;
drop policy if exists "bookings_select" on public.bookings;
create policy "bookings_select"
on public.bookings
for select
to authenticated
using (user_id = auth.uid() or public.is_staff_role(auth.uid()));

drop policy if exists "bookings_insert_own" on public.bookings;
create policy "bookings_insert_own"
on public.bookings
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "bookings_update_own" on public.bookings;
drop policy if exists "bookings_update_staff" on public.bookings;
create policy "bookings_update_staff"
on public.bookings
for update
to authenticated
using (public.is_staff_role(auth.uid()))
with check (public.is_staff_role(auth.uid()));

drop policy if exists "bookings_delete_own" on public.bookings;
drop policy if exists "bookings_delete_own_or_staff" on public.bookings;
create policy "bookings_delete_own_or_staff"
on public.bookings
for delete
to authenticated
using (user_id = auth.uid() or public.is_staff_role(auth.uid()));

drop policy if exists "waitlist_select_own" on public.waitlist;
drop policy if exists "waitlist_select" on public.waitlist;
create policy "waitlist_select"
on public.waitlist
for select
to authenticated
using (user_id = auth.uid() or public.is_staff_role(auth.uid()));

drop policy if exists "waitlist_insert_own" on public.waitlist;
create policy "waitlist_insert_own"
on public.waitlist
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "waitlist_update_own" on public.waitlist;
drop policy if exists "waitlist_update_staff" on public.waitlist;
create policy "waitlist_update_staff"
on public.waitlist
for update
to authenticated
using (public.is_staff_role(auth.uid()))
with check (public.is_staff_role(auth.uid()));

drop policy if exists "waitlist_delete_own" on public.waitlist;
drop policy if exists "waitlist_delete_own_or_staff" on public.waitlist;
create policy "waitlist_delete_own_or_staff"
on public.waitlist
for delete
to authenticated
using (user_id = auth.uid() or public.is_staff_role(auth.uid()));

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.sync_my_role_from_email() to authenticated;
grant execute on function public.slot_is_available(date, text, integer, text, uuid) to authenticated;
grant execute on function public.create_booking_secure(text, text, integer, numeric, numeric, text, text, date, text, jsonb, boolean) to authenticated;
grant execute on function public.cancel_my_booking(uuid) to authenticated;
grant execute on function public.set_booking_status(uuid, text) to authenticated;
grant execute on function public.admin_set_user_role_by_email(text, text) to authenticated;
grant execute on function public.admin_list_users_with_roles(integer) to authenticated;
