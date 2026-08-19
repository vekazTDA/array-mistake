-- ---------------------------------------------------------------------------
-- Seed a ready-to-use login.
--
-- Run in the Supabase dashboard → SQL Editor. It needs privileges on the auth
-- schema, so it will not work through PostgREST or the anon key. That is the
-- intended way in: this app deliberately ships no service-role key, so there
-- is no application path that can create a pre-confirmed user.
--
-- The project has "Confirm email" on (mailer_autoconfirm = false), so a normal
-- signup lands unconfirmed and cannot sign in. This sets email_confirmed_at
-- directly, so no mail is sent and the address need not be real.
--
-- Safe to run more than once — it deletes the previous seed first.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

do $seed$
declare
  -- Change these two lines and nothing else.
  v_email    text := 'vekaz@itsda.com';
  v_password text := 'vekaz123';

  v_name     text := 'Vekaz Hadzic';
  v_user_id  uuid := gen_random_uuid();
  v_schema   text;
  v_hash     text;
begin
  -- pgcrypto lives in "extensions" on Supabase but in "public" elsewhere.
  -- Resolve it rather than guessing, so this runs on either.
  select n.nspname
    into v_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';

  if v_schema is null then
    raise exception 'pgcrypto is not installed; cannot hash the password';
  end if;

  execute format('select %I.crypt($1, %I.gen_salt(''bf''))', v_schema, v_schema)
    into v_hash
    using v_password;

  -- Cascades to public.profiles and auth.identities.
  delete from auth.users where email = v_email;

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    -- GoTrue reads these as strings, not nulls.
    confirmation_token,
    recovery_token,
    email_change,
    email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    v_hash,
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', v_name),
    '', '', '', ''
  );

  -- Without a matching identity row, password sign-in fails even though the
  -- user exists.
  insert into auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    gen_random_uuid(),
    v_user_id,
    v_user_id::text,
    jsonb_build_object(
      'sub', v_user_id::text,
      'email', v_email,
      'email_verified', true
    ),
    'email',
    now(),
    now(),
    now()
  );

  -- schema.sql's on_auth_user_created trigger normally does this. Repeated
  -- here so the seed still works if that trigger is missing.
  insert into public.profiles (id, full_name)
  values (v_user_id, v_name)
  on conflict (id) do nothing;

  raise notice 'Seeded % / % (id %)', v_email, v_password, v_user_id;
end
$seed$;
