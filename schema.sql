-- SatsKeeper schema. Run ONCE in the Supabase SQL Editor.
-- All tables have RLS enabled with NO policies: only the service_role key (used by the Vercel API) can touch them.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table if not exists devices (
  device_id        text primary key,
  handle           text,
  opted_in         boolean not null default false,
  consent_at       timestamptz,
  consent_version  text,
  points_balance   numeric not null default 0 check (points_balance >= 0),
  lifetime_points  numeric not null default 0 check (lifetime_points >= 0),
  streak           int     not null default 0 check (streak >= 0),
  multiplier       numeric not null default 1.0 check (multiplier >= 1.0),
  last_active_at   timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists revenue_events (
  id               uuid primary key default gen_random_uuid(),
  device_id        text not null references devices(device_id) on delete cascade,
  period           text not null,
  revenue_cents    int  not null check (revenue_cents >= 0),
  points_awarded   numeric not null default 0 check (points_awarded >= 0),
  created_at       timestamptz not null default now(),
  unique (device_id, period)
);

create table if not exists redemptions (
  id               uuid primary key default gen_random_uuid(),
  device_id        text not null references devices(device_id) on delete cascade,
  points_spent     numeric not null check (points_spent > 0),
  value_cents      int not null check (value_cents >= 0),
  status           text not null default 'pending'
                   check (status in ('pending','approved','rejected','paid')),
  code             text,
  note             text,
  created_at       timestamptz not null default now(),
  decided_at       timestamptz
);

create table if not exists config (
  key    text primary key,
  value  text not null
);

create table if not exists admin_audit (
  id          uuid primary key default gen_random_uuid(),
  action      text not null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists revenue_events_created_idx on revenue_events (created_at);
create index if not exists redemptions_status_idx on redemptions (status, created_at);
create index if not exists devices_last_active_idx on devices (last_active_at);

-- ---------------------------------------------------------------- row level security (no policies = service_role only)

alter table devices        enable row level security;
alter table revenue_events enable row level security;
alter table redemptions    enable row level security;
alter table config         enable row level security;
alter table admin_audit    enable row level security;

-- ---------------------------------------------------------------- seed config

insert into config (key, value) values
  ('payout_pct', '0.5'),
  ('points_per_cent', '1'),
  ('points_per_dollar', '100'),
  ('threshold_points', '1000')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- atomic point functions

-- Adds earned points (balance AND lifetime). Delta must be positive.
create or replace function add_points(p_device_id text, p_delta numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric;
begin
  if p_delta is null or p_delta <= 0 then
    raise exception 'delta must be positive';
  end if;

  update devices
     set points_balance  = points_balance + p_delta,
         lifetime_points = lifetime_points + p_delta
   where device_id = p_device_id
   returning points_balance into new_balance;

  if not found then
    raise exception 'device not found: %', p_device_id;
  end if;

  return new_balance;
end;
$$;

-- Atomically deducts points. Single UPDATE with a balance guard: two concurrent calls
-- can never spend the same points twice. Returns false when the balance is insufficient.
create or replace function spend_points(p_device_id text, p_points numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_points is null or p_points <= 0 then
    return false;
  end if;

  update devices
     set points_balance = points_balance - p_points
   where device_id = p_device_id
     and points_balance >= p_points;

  return found;
end;
$$;

-- Returns points to the balance (rejected redemption / failed insert). Does NOT touch lifetime_points.
create or replace function refund_points(p_device_id text, p_points numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric;
begin
  if p_points is null or p_points <= 0 then
    raise exception 'points must be positive';
  end if;

  update devices
     set points_balance = points_balance + p_points
   where device_id = p_device_id
   returning points_balance into new_balance;

  if not found then
    raise exception 'device not found: %', p_device_id;
  end if;

  return new_balance;
end;
$$;

-- ---------------------------------------------------------------- read helpers

-- Top earners over the last 30 days. Devices idle for 7+ days (or opted out) drop off: rank reset.
create or replace function leaderboard_30d(p_limit int default 20)
returns table (device_id text, handle text, points numeric)
language sql
security definer
set search_path = public
stable
as $$
  select d.device_id, d.handle, sum(r.points_awarded) as points
    from revenue_events r
    join devices d on d.device_id = r.device_id
   where r.created_at >= now() - interval '30 days'
     and d.opted_in
     and d.last_active_at >= now() - interval '7 days'
   group by d.device_id, d.handle
  having sum(r.points_awarded) > 0
   order by points desc, d.handle asc
   limit greatest(p_limit, 1);
$$;

create or replace function admin_totals()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'devices',            (select count(*) from devices),
    'opted_in',           (select count(*) from devices where opted_in),
    'revenue_cents',      (select coalesce(sum(revenue_cents), 0) from revenue_events),
    'points_issued',      (select coalesce(sum(points_awarded), 0) from revenue_events),
    'points_outstanding', (select coalesce(sum(points_balance), 0) from devices),
    'cards_paid_cents',   (select coalesce(sum(value_cents), 0) from redemptions where status = 'paid'),
    'pending_cents',      (select coalesce(sum(value_cents), 0) from redemptions where status in ('pending','approved')),
    'pending_count',      (select count(*) from redemptions where status in ('pending','approved'))
  );
$$;

create or replace function admin_users(p_limit int, p_offset int)
returns table (
  device_id text,
  handle text,
  opted_in boolean,
  consent_at timestamptz,
  points_balance numeric,
  lifetime_points numeric,
  streak int,
  multiplier numeric,
  last_active_at timestamptz,
  created_at timestamptz,
  revenue_cents bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select d.device_id, d.handle, d.opted_in, d.consent_at, d.points_balance, d.lifetime_points,
         d.streak, d.multiplier, d.last_active_at, d.created_at,
         coalesce((select sum(r.revenue_cents) from revenue_events r where r.device_id = d.device_id), 0)::bigint
    from devices d
   order by d.created_at desc
   limit greatest(p_limit, 1)
  offset greatest(p_offset, 0);
$$;

-- ---------------------------------------------------------------- lock functions to service_role

revoke all on function add_points(text, numeric)     from public, anon, authenticated;
revoke all on function spend_points(text, numeric)   from public, anon, authenticated;
revoke all on function refund_points(text, numeric)  from public, anon, authenticated;
revoke all on function leaderboard_30d(int)          from public, anon, authenticated;
revoke all on function admin_totals()                from public, anon, authenticated;
revoke all on function admin_users(int, int)         from public, anon, authenticated;

grant execute on function add_points(text, numeric)     to service_role;
grant execute on function spend_points(text, numeric)   to service_role;
grant execute on function refund_points(text, numeric)  to service_role;
grant execute on function leaderboard_30d(int)          to service_role;
grant execute on function admin_totals()                to service_role;
grant execute on function admin_users(int, int)         to service_role;
