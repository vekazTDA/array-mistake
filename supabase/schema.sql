-- ---------------------------------------------------------------------------
-- Credit monitoring — schema
--
-- Deliberately small. Credit reports, scores and bureau data are rendered by
-- Array's components directly in the browser and never reach this database.
-- What's stored here is the account, the mapping to Array, and an audit trail.
--
-- No SSN. No date of birth. No report contents. If a column here would hold
-- any of those, something has gone wrong upstream.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text,
  -- Set to the same value as id. Array accepts a caller-supplied userId of up
  -- to 36 characters, which a UUID fits exactly, so the mapping between their
  -- record and ours is just the primary key.
  array_user_id text unique,
  enrolled_at   timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

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
-- Audit trail
--
-- Billing is transactional per pull, so there needs to be a local record of
-- what was ordered to reconcile against Array's invoice. Also the first place
-- to look when a customer says a section didn't load.
--
-- Insert-only from the app. Nothing here should ever be updated.
-- ---------------------------------------------------------------------------

create table public.array_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users (id) on delete set null,
  tag_name   text,
  event      text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index array_events_user_created_idx
  on public.array_events (user_id, created_at desc);

alter table public.array_events enable row level security;

create policy "array_events: insert own"
  on public.array_events for insert
  with check (auth.uid() = user_id);

create policy "array_events: read own"
  on public.array_events for select
  using (auth.uid() = user_id);
