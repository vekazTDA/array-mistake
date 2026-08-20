-- ---------------------------------------------------------------------------
-- Credit monitoring — schema
--
-- This is the canonical schema. A fresh project needs only this file; the
-- numbered migrations exist for databases created from an earlier version.
--
-- Deliberately small. Credit reports, scores and bureau data are rendered by
-- Array's components directly in the browser and never reach this database.
-- What's stored here is the staff account, the mapping to Array, and an audit
-- trail.
--
-- No SSN. No date of birth. No report contents. If a column here would hold
-- any of those, something has gone wrong upstream.
--
-- Shape: one Supabase login belongs to a staff member, who pulls reports for
-- many consumers. Each consumer is its own row and its own Array user.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- Staff accounts
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- RLS policies cannot restrict individual columns, so column grants do.
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

-- Create the profile row automatically on signup, so the app never has to
-- handle a signed-in user with no profile.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- Consumers
--
-- One row per person whose credit is checked. The row's id is that person's
-- Array userId — a UUID fits Array's 36-character limit exactly.
--
-- display_name is a label so staff can tell one consumer from another. The
-- identity data itself (SSN, date of birth) goes from the browser to Array and
-- never lands here.
-- ---------------------------------------------------------------------------

create table public.consumers (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  display_name  text not null,
  reference     text,
  -- Set to id::text by record_consumer_enrolment(). Never supplied by a caller.
  array_user_id text unique,
  enrolled_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index consumers_owner_created_idx
  on public.consumers (owner_id, created_at desc);

alter table public.consumers enable row level security;

create policy "consumers: read own"
  on public.consumers for select
  using (auth.uid() = owner_id);

create policy "consumers: insert own"
  on public.consumers for insert
  with check (auth.uid() = owner_id);

create policy "consumers: update own"
  on public.consumers for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Staff may relabel a consumer. array_user_id and enrolled_at are written only
-- by the SECURITY DEFINER function below.
revoke update on public.consumers from authenticated, anon;
grant update (display_name, reference) on public.consumers to authenticated;


-- ---------------------------------------------------------------------------
-- Enrolment
--
-- Takes a consumer id, but array_user_id is derived from the row rather than
-- from an argument, and ownership is enforced here. There is no value a caller
-- can pass that maps a consumer to somebody else's Array account.
-- ---------------------------------------------------------------------------

create function public.record_consumer_enrolment(p_consumer_id uuid)
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


-- ---------------------------------------------------------------------------
-- Redaction
--
-- src/lib/redact.ts runs the same rules in the browser first. This is the pass
-- that cannot be skipped, because it runs inside the only function permitted
-- to insert into array_events.
-- ---------------------------------------------------------------------------

create function public.is_sensitive_key(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(coalesce(p_key, '')), '[^a-z_-]', '', 'g') in (
    'usertoken', 'user-token', 'user_token',
    'authtoken', 'auth-token', 'auth_token',
    'accesstoken', 'access-token', 'access_token',
    'refreshtoken', 'idtoken', 'token',
    'apikey', 'api_key', 'appkey', 'secret', 'password', 'passwd',
    'ssn', 'socialsecuritynumber', 'social_security_number',
    'dob', 'dateofbirth', 'date_of_birth', 'birthdate', 'birthday'
  );
$$;

create function public.redact_array_metadata(p_value jsonb, p_depth int default 0)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out  jsonb;
  v_key  text;
  v_item jsonb;
begin
  if p_value is null then
    return 'null'::jsonb;
  end if;

  -- Array's metadata is shallow today. The depth cap stops a deeply nested
  -- payload from being used to burn CPU on the database.
  if p_depth > 4 then
    return 'null'::jsonb;
  end if;

  case jsonb_typeof(p_value)
    when 'object' then
      v_out := '{}'::jsonb;
      for v_key in select jsonb_object_keys(p_value) loop
        if not public.is_sensitive_key(v_key) then
          v_out := v_out || jsonb_build_object(
            v_key,
            public.redact_array_metadata(p_value -> v_key, p_depth + 1)
          );
        end if;
      end loop;
      return v_out;

    -- Arrays are recursed too, so an array of objects cannot carry a token
    -- past the key check.
    when 'array' then
      v_out := '[]'::jsonb;
      for v_item in select jsonb_array_elements(p_value) loop
        v_out := v_out || jsonb_build_array(
          public.redact_array_metadata(v_item, p_depth + 1)
        );
      end loop;
      return v_out;

    else
      return p_value;
  end case;
end;
$$;


-- ---------------------------------------------------------------------------
-- Audit trail
--
-- Billing is transactional per pull, so there needs to be a local record of
-- what was ordered to reconcile against Array's invoice. Also the first place
-- to look when a customer says a section didn't load.
--
-- Insert-only, and only through record_array_event(). No role is granted
-- INSERT on the table itself.
-- ---------------------------------------------------------------------------

create table public.array_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete set null,
  consumer_id uuid references public.consumers (id) on delete set null,
  tag_name    text,
  event       text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index array_events_user_created_idx
  on public.array_events (user_id, created_at desc);

create index array_events_consumer_created_idx
  on public.array_events (consumer_id, created_at desc);

alter table public.array_events enable row level security;

create policy "array_events: read own"
  on public.array_events for select
  using (auth.uid() = user_id);

-- No insert policy on purpose. The only way in is the function below.
revoke insert on public.array_events from authenticated, anon;

create function public.record_array_event(
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
