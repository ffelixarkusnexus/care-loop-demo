-- Care Loop — initial schema + Row-Level Security.
--
-- Data model: build-brief §5. Tenant isolation: build-brief §6 (ADR-0003).
-- Tenant isolation lives in the DATABASE (RLS), not the app — app-layer filtering
-- fails open the first time a clause is forgotten. tests/rls.test.ts proves a user
-- in org A reads zero of org B's rows.

-- ----------------------------------------------------------------------------
-- Tables (§5)
-- ----------------------------------------------------------------------------

create table orgs (
  id   uuid primary key default gen_random_uuid(),
  name text not null
);

create table memberships (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role    text not null check (role in ('clinician', 'member')),
  unique (org_id, user_id)
);

create table screeners (
  id     uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  title  text not null
);

create table screener_items (
  id          uuid primary key default gen_random_uuid(),
  screener_id uuid not null references screeners (id) on delete cascade,
  prompt      text not null,
  max_score   int  not null
);

create table checkins (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs (id) on delete cascade,
  member_user_id uuid not null references auth.users (id) on delete cascade,
  mood           int,
  note           text,
  created_at     timestamptz not null default now()
);

create table screener_results (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs (id) on delete cascade,
  member_user_id uuid not null references auth.users (id) on delete cascade,
  item_id        uuid not null references screener_items (id) on delete cascade,
  score          int  not null,
  created_at     timestamptz not null default now()
);

create table assessments (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs (id) on delete cascade,
  checkin_id          uuid not null references checkins (id) on delete cascade,
  signals             jsonb,
  model_risk          text,
  confidence          text,
  needs_manual_review boolean,
  prompt_version      text
);

create table summaries (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs (id) on delete cascade,
  checkin_id     uuid not null references checkins (id) on delete cascade,
  risk_tier      text,
  summary_md     text,
  cited_item_ids jsonb,
  status         text check (status in ('needs_manual_review', 'staged_for_review', 'final')),
  model          text,
  prompt_version text
);

create table alerts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs (id) on delete cascade,
  member_user_id uuid not null references auth.users (id) on delete cascade,
  reason         text,
  acknowledged   boolean not null default false,
  created_at     timestamptz not null default now()
);

create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs (id) on delete cascade,
  actor      text,
  action     text,
  entity     text,
  entity_id  uuid,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Row-Level Security (§6)
--
-- The caller's orgs are derived from their memberships. security invoker so the
-- function runs as the calling user and auth.uid() resolves to them.
-- ----------------------------------------------------------------------------

-- SECURITY DEFINER so the helper reads memberships as its owner, bypassing RLS
-- *inside the function only* — this breaks the otherwise-infinite recursion
-- (memberships' own RLS policy calls this function; see ADR-0003 / error 54001).
-- Hardened: SET search_path = '' (an unpinned search_path on a SECURITY DEFINER
-- function is a privilege-escalation vector), every reference schema-qualified,
-- and (select auth.uid()) for per-statement caching. The function is parameterless
-- and filtered to the caller's auth.uid(), so it leaks nothing across tenants.
create or replace function public.app_user_orgs()
  returns setof uuid
  language sql
  security definer
  set search_path = ''
  stable
as $$
  select org_id from public.memberships where user_id = (select auth.uid())
$$;

-- Enable RLS on every tenant-scoped table named in §6.
alter table orgs             enable row level security;
alter table memberships      enable row level security;
alter table checkins         enable row level security;
alter table screener_results enable row level security;
alter table assessments      enable row level security;
alter table summaries        enable row level security;
alter table alerts           enable row level security;
alter table audit_log        enable row level security;

-- orgs is keyed by `id` (it has no `org_id`), so it scopes on id.
create policy orgs_select on orgs
  for select using (id in (select app_user_orgs()));

-- Read isolation on the membership/reference/log tables.
create policy memberships_select on memberships
  for select using (org_id in (select app_user_orgs()));
create policy checkins_select on checkins
  for select using (org_id in (select app_user_orgs()));
create policy screener_results_select on screener_results
  for select using (org_id in (select app_user_orgs()));
create policy audit_log_select on audit_log
  for select using (org_id in (select app_user_orgs()));

-- Read+write isolation on the tables the workflow / clinician writes under a user JWT.
create policy assessments_rw on assessments
  for all using (org_id in (select app_user_orgs()))
          with check (org_id in (select app_user_orgs()));
create policy summaries_rw on summaries
  for all using (org_id in (select app_user_orgs()))
          with check (org_id in (select app_user_orgs()));
create policy alerts_rw on alerts
  for all using (org_id in (select app_user_orgs()))
          with check (org_id in (select app_user_orgs()));

-- ----------------------------------------------------------------------------
-- Grants — the API roles need table privileges or PostgREST gets "permission
-- denied" before RLS is ever consulted. (Supabase auto-grants these for tables
-- made via the dashboard; a hand-written migration must do it explicitly.)
-- Row visibility is still governed by RLS above; these are table-level grants.
-- ----------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

-- service_role is the trusted backend (and bypasses RLS): full access.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- authenticated / anon on the RLS-governed tables — RLS filters the rows.
grant select, insert, update, delete on
  orgs, memberships, checkins, screener_results, assessments, summaries, alerts, audit_log
  to authenticated;
grant select on
  orgs, memberships, checkins, screener_results, assessments, summaries, alerts, audit_log
  to anon;

-- screeners / screener_items have NO RLS per §6 (see NOTE). Grant read-only to
-- logged-in users (the catalog the dashboard renders) — NOT writable cross-tenant,
-- NOT exposed to anon — to keep the §6 gap as small as possible until it is decided.
grant select on screeners, screener_items to authenticated;

-- NOTE (raised for review — see PR): build-brief §6 does NOT list `screeners` or
-- `screener_items`, so RLS is intentionally left disabled on them here to match the
-- spec exactly. `screeners` has an org_id, so without RLS its rows are readable across
-- tenants by any authenticated user (the grant above). Flagged as an open decision
-- rather than diverging from §6 silently.
