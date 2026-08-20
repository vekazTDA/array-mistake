-- ---------------------------------------------------------------------------
-- Store Array's userId, not ours.
--
-- Run against a database that already has schema.sql, 002 and 003.
-- Safe to run more than once.
--
-- Why:
--
--   The design assumed Array would adopt the userId we supply, so the mapping
--   between their record and ours could just be the primary key. It doesn't.
--   Enrolling consumer 18692390-3d57-4cd3-9984-dc15b294be30 produced a signup
--   event carrying userId ef261043-ca11-4256-8499-30c6d3c0b970 — Array's own.
--
--   The value we pass to array-account-enroll behaves as an external reference
--   that Array requires to be unique (which is what produced 409 Conflict on
--   its create-user endpoint when one was reused). The id it returns is the
--   one its token endpoint expects.
--
--   So array_user_id has to hold what Array returns. It can no longer be
--   derived from the row.
--
-- Security note:
--
--   record_consumer_enrolment previously took no id at all, which made a wrong
--   mapping impossible by construction. That is no longer available — Array's
--   id is genuinely external. Three things carry the weight instead:
--
--     1. ownership: the consumer must belong to auth.uid()
--     2. write-once: a consumer already mapped cannot be re-pointed
--     3. unique: an Array user already claimed cannot be claimed again
--
--   Residual risk: a caller who knows an unclaimed Array userId could bind it
--   to their own consumer and mint a token for it. That means guessing a UUID.
--   Closing it properly needs a server-side check against Array that the user
--   exists and matches, which is blocked on the server token.
-- ---------------------------------------------------------------------------

drop function if exists public.record_consumer_enrolment(uuid);

create or replace function public.record_consumer_enrolment(
  p_consumer_id   uuid,
  p_array_user_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_array_user_id is null
     or length(btrim(p_array_user_id)) = 0
     or length(p_array_user_id) > 36
  then
    raise exception 'invalid array user id' using errcode = '22023';
  end if;

  -- RLS does not apply inside a SECURITY DEFINER function, so ownership is
  -- checked explicitly here.
  select array_user_id
    into v_existing
    from public.consumers
   where id = p_consumer_id
     and owner_id = auth.uid();

  if not found then
    -- Covers both "no such consumer" and "not yours" on purpose: the caller
    -- learns nothing about ids they don't own.
    raise exception 'consumer not found' using errcode = 'P0002';
  end if;

  -- Write once. Re-running enrolment with the same id is a no-op rather than
  -- an error, so a retried request is harmless; a *different* id is refused,
  -- so an existing mapping can never be re-pointed at another Array user.
  if v_existing is not null then
    if v_existing = btrim(p_array_user_id) then
      return;
    end if;
    raise exception 'consumer already mapped to a different Array user'
      using errcode = '23505';
  end if;

  update public.consumers
     set array_user_id = btrim(p_array_user_id),
         enrolled_at   = coalesce(enrolled_at, now())
   where id = p_consumer_id
     and owner_id = auth.uid();
end;
$$;

revoke all on function public.record_consumer_enrolment(uuid, text) from public, anon;
grant execute on function public.record_consumer_enrolment(uuid, text) to authenticated;
