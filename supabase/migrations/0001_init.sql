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

create or replace function app_user_orgs()
  returns setof uuid
  language sql
  security invoker
  stable
as $$
  select org_id from memberships where user_id = auth.uid()
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

-- NOTE (raised for review — see PR): build-brief §6 does NOT list `screeners` or
-- `screener_items`, so RLS is intentionally left disabled on them here to match the
-- spec exactly. `screeners` has an org_id, so without RLS its rows are readable across
-- tenants. Flagged as an open decision rather than diverging from §6 silently.
