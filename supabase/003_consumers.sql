-- ---------------------------------------------------------------------------
-- One login, many consumers.
--
-- Run against a database that already has schema.sql and 002_security_lockdown.
-- schema.sql has been updated to include everything here, so a fresh project
-- only needs that file.
--
-- Safe to run more than once.
--
-- Why this exists:
--
--   The enrol page used to pass the staff member's own Supabase user id to
--   Array as its userId. That allows exactly one Array user per login, so the
--   second consumer always failed with 409 Conflict on Array's create-user
--   endpoint.
--
--   Each consumer now gets its own row, and that row's id is its Array userId.
--   A UUID fits Array's 36-character limit exactly, same as before — only the
--   source of the UUID changes.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Consumers
--
-- Still no SSN, no date of birth, no report contents. display_name is a label
-- so staff can tell one consumer from another; the identity data itself goes
-- from the browser to Array and never lands here.
-- ---------------------------------------------------------------------------

create table if not exists public.consumers (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users (id) on delete cascade,
  display_name   text not null,
  reference      text,
  -- Set to id::text by record_consumer_enrolment(). Never supplied by a caller.
  array_user_id  text unique,
  enrolled_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists consumers_owner_created_idx
  on public.consumers (owner_id, created_at desc);

alter table public.consumers enable row level security;

drop policy if exists "consumers: read own" on public.consumers;
create policy "consumers: read own"
  on public.consumers for select
  using (auth.uid() = owner_id);

drop policy if exists "consumers: insert own" on public.consumers;
create policy "consumers: insert own"
  on public.consumers for insert
  with check (auth.uid() = owner_id);

drop policy if exists "consumers: update own" on public.consumers;
create policy "consumers: update own"
  on public.consumers for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Mirrors the profiles lockdown in 002. RLS cannot restrict columns, so grants
-- do: staff may relabel a consumer, but array_user_id and enrolled_at are
-- written only by the SECURITY DEFINER function below.
revoke update on public.consumers from authenticated, anon;
grant update (display_name, reference) on public.consumers to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Enrolment
--
-- Takes a consumer id, but array_user_id is still derived from the row rather
-- than from an argument, and ownership is enforced here. There is no value a
-- caller can pass that maps a consumer to somebody else's Array account.
-- ---------------------------------------------------------------------------

create or replace function public.record_consumer_enrolment(p_consumer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  update public.consumers
     set array_user_id = id::text,
         enrolled_at   = coalesce(enrolled_at, now())
   where id = p_consumer_id
     and owner_id = auth.uid();

  if not found then
    -- Covers both "no such consumer" and "not yours" on purpose: the caller
    -- learns nothing about ids they don't own.
    raise exception 'consumer not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.record_consumer_enrolment(uuid) from public, anon;
grant execute on function public.record_consumer_enrolment(uuid) to authenticated;

-- Replaced by the above.
drop function if exists public.record_array_enrolment();


-- ---------------------------------------------------------------------------
-- 3. Audit trail gains the consumer
--
-- Billing is per pull, and a pull is now per consumer rather than per login.
-- ---------------------------------------------------------------------------

alter table public.array_events
  add column if not exists consumer_id uuid references public.consumers (id) on delete set null;

create index if not exists array_events_consumer_created_idx
  on public.array_events (consumer_id, created_at desc);

-- Old three-argument signature; replaced by the four-argument one below.
drop function if exists public.record_array_event(text, text, jsonb);

create or replace function public.record_array_event(
  p_consumer_id uuid,
  p_tag_name    text,
  p_event       text,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- An event can only ever be attributed to a consumer the caller owns.
  if p_consumer_id is not null
     and not exists (
       select 1 from public.consumers
        where id = p_consumer_id and owner_id = auth.uid()
     )
  then
    raise exception 'consumer not found' using errcode = 'P0002';
  end if;

  -- Anything that isn't an object is discarded rather than stored raw.
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    v_metadata := '{}'::jsonb;
  elsif length(p_metadata::text) > 8192 then
    -- Keep the row — a missing audit row is a billing reconciliation gap —
    -- but don't let an unbounded payload into the table.
    v_metadata := jsonb_build_object('_truncated', true);
  else
    v_metadata := public.redact_array_metadata(p_metadata);
  end if;

  insert into public.array_events (user_id, consumer_id, tag_name, event, metadata)
  values (auth.uid(), p_consumer_id, left(p_tag_name, 64), left(p_event, 64), v_metadata);
end;
$$;

revoke all on function public.record_array_event(uuid, text, text, jsonb) from public, anon;
grant execute on function public.record_array_event(uuid, text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Retire the single-consumer mapping
--
-- profiles now describes only the staff member. The mapping to Array lives on
-- consumers.
-- ---------------------------------------------------------------------------

alter table public.profiles drop column if exists array_user_id;
alter table public.profiles drop column if exists enrolled_at;
