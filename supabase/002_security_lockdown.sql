-- ---------------------------------------------------------------------------
-- Security lockdown — run this against a database that already has schema.sql.
--
-- schema.sql has been updated to include everything here, so a fresh project
-- only needs that file. This migration exists for the database that was
-- already created from the original version.
--
-- Safe to run more than once.
--
-- What it changes, and why:
--
--   1. The browser can no longer write array_user_id or enrolled_at. The
--      original "profiles: update own" policy allowed updating any column on
--      your own row, including the Array mapping. Setting it to another
--      customer's UUID would have made /api/array/token mint an Array
--      userToken for their credit file. The unique index on array_user_id
--      happened to block that for already-enrolled victims — but that index
--      was there for data hygiene, not authorisation, and it does not cover
--      customers who have signed up without enrolling yet.
--
--   2. The browser can no longer insert audit rows. It could previously write
--      arbitrary JSON into array_events.metadata, bypassing redaction
--      entirely — which breaks the one guarantee this schema exists to make.
--
-- Both writes now go through SECURITY DEFINER functions that derive identity
-- from auth.uid() rather than accepting it from the caller. There is
-- deliberately no service-role key anywhere in this design.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Column-level privileges on profiles
--
-- RLS policies cannot restrict individual columns, so this uses grants
-- instead. The "update own" policy still applies on top: a customer may edit
-- their own full_name and nothing else.
-- ---------------------------------------------------------------------------

revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Enrolment is recorded by the database, not by the caller
--
-- array_user_id is always auth.uid(). It is not a parameter, so there is no
-- value a caller can supply that points the mapping at somebody else. This is
-- a stronger guarantee than validating an argument would give.
-- ---------------------------------------------------------------------------

create or replace function public.record_array_enrolment()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  update public.profiles
     set array_user_id = auth.uid()::text,
         -- Keep the first enrolment timestamp if this runs twice.
         enrolled_at   = coalesce(enrolled_at, now())
   where id = auth.uid();
end;
$$;

revoke all on function public.record_array_enrolment() from public, anon;
grant execute on function public.record_array_enrolment() to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Redaction, in the database
--
-- The TypeScript version in src/lib/redact.ts still runs first. This one is
-- the pass that cannot be skipped, because after this migration there is no
-- path into array_events that does not go through it.
-- ---------------------------------------------------------------------------

create or replace function public.is_sensitive_key(p_key text)
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

create or replace function public.redact_array_metadata(p_value jsonb, p_depth int default 0)
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

    -- Arrays are recursed too. The original TypeScript version passed them
    -- through untouched, so an array of objects could carry a token past the
    -- key check.
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
-- 4. Audit rows are written by the database, not by the caller
-- ---------------------------------------------------------------------------

create or replace function public.record_array_event(
  p_tag_name text,
  p_event    text,
  p_metadata jsonb default '{}'::jsonb
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

  insert into public.array_events (user_id, tag_name, event, metadata)
  values (auth.uid(), left(p_tag_name, 64), left(p_event, 64), v_metadata);
end;
$$;

revoke all on function public.record_array_event(text, text, jsonb) from public, anon;
grant execute on function public.record_array_event(text, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Close the direct insert path
--
-- Must come last: the function above is the replacement for it.
-- ---------------------------------------------------------------------------

drop policy if exists "array_events: insert own" on public.array_events;
revoke insert on public.array_events from authenticated, anon;
