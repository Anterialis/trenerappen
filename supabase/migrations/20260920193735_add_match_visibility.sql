-- Lets the admin (see the existing "admins" table/policies on this table)
-- flag individual matches as visible to any other signed-in "Mitt lag"
-- account, for a limited time - null/expired means only the admin sees it,
-- same as every match's default today.
alter table public.match_history
  add column if not exists visible_until timestamptz null;

-- Admin already has full access via the existing "Admin select access"
-- policy (checks the admins table) - this is an ADDITIONAL, separate
-- policy just for everyone else: any authenticated (but non-admin) user,
-- and only the rows the admin has actively flagged as still-visible.
-- Multiple permissive select policies are OR'd together, so this only ever
-- adds access, never narrows the admin's own.
create policy "Signed-in users can view visibility-flagged matches"
  on public.match_history for select
  to authenticated
  using (visible_until is not null and visible_until > now());
