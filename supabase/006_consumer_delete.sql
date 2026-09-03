-- ---------------------------------------------------------------------------
-- Permanent client delete.
--
-- Run against a database that already has schema.sql through 005.
-- Safe to run more than once.
--
-- Plain RLS, not a SECURITY DEFINER function — unlike enrolment, there is no
-- external-reference trust problem here. A caller can only ever delete a row
-- where owner_id = auth.uid(), which is exactly what every other policy on
-- this table already checks.
--
-- array_events.consumer_id is on delete set null (see schema.sql), so a
-- deleted client's audit rows survive for billing reconciliation — only the
-- name attached to them is gone.
--
-- This does not touch anything at Array. A bureau-side lock (four failed
-- TransUnion attempts, 30 days, no override) is tied to the person's real
-- identity there, not to this row. Deleting and re-adding the same person
-- does not reset it — see the confirmation copy in consumers/page.tsx.
-- ---------------------------------------------------------------------------

drop policy if exists "consumers: delete own" on public.consumers;
create policy "consumers: delete own"
  on public.consumers for delete
  using (auth.uid() = owner_id);
