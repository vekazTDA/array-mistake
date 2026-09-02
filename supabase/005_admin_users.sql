-- ---------------------------------------------------------------------------
-- Admin-created staff accounts.
--
-- Run against a database that already has schema.sql, 002, 003 and 004.
-- Safe to run more than once.
--
-- Why: self-service signup is gone. Staff accounts are now created by a
-- super admin from /admin/users, which sets the person's initial password
-- directly. That needs the Supabase Admin API — the one operation in this
-- project that genuinely requires the service role key — so this migration
-- also adds the role column that gates who is allowed to use it.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists role text not null default 'staff';

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check check (role in ('staff', 'super_admin'));

-- ---------------------------------------------------------------------------
-- Deliberately NOT added to the column grant below. "profiles: update own"
-- otherwise permits updating any granted column on your own row — if role
-- were grantable, any signed-in staff member could self-promote to
-- super_admin with a single client-side update. Only server code running
-- with the service role (i.e. only /api/admin/*, after a super_admin check)
-- may change this column.
-- ---------------------------------------------------------------------------
-- grant update (role) on public.profiles to authenticated;   -- NEVER


-- ---------------------------------------------------------------------------
-- Bootstrap: promote the first super admin.
--
-- There is a chicken-and-egg problem here on purpose — nobody can use
-- /admin/users to create the first super admin, because /admin/users
-- requires being a super admin. Sign up once the normal way (or use
-- seed_user.sql in development), then run this once with that email:
--
--   update public.profiles
--      set role = 'super_admin'
--    where id = (select id from auth.users where email = 'you@example.com');
--
-- Left commented out deliberately — this file runs unattended in some flows,
-- and silently minting a super admin from a hardcoded email is not something
-- a migration should ever do on its own.
-- ---------------------------------------------------------------------------
