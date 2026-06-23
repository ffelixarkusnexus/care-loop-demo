-- Care Loop — demo seed (LOCAL ONLY).
--
-- 1 org, 1 clinician, 2 patients, 1 screener (6 items, one designated safety item),
-- and a week of check-ins. This is illustrative demo data, not real PHI.
--
-- Auth users are inserted directly for the local stack so foreign keys resolve and
-- you can sign in as the clinician. Passwords are demo-only.

create extension if not exists pgcrypto with schema extensions;

-- --- Auth users (local demo) ----------------------------------------------------
-- Empty-string token columns keep older GoTrue happy on direct inserts.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change, email_change_token_new)
values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'clinician@careloop.test',
   extensions.crypt('demo-password', extensions.gen_salt('bf')), now(),
   now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'patient.one@careloop.test',
   extensions.crypt('demo-password', extensions.gen_salt('bf')), now(),
   now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'patient.two@careloop.test',
   extensions.crypt('demo-password', extensions.gen_salt('bf')), now(),
   now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');

-- --- Org + memberships ----------------------------------------------------------
insert into orgs (id, name) values
  ('10000000-0000-0000-0000-000000000001', 'Care Loop Clinic');

insert into memberships (org_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'clinician'),
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'member'),
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'member');

-- --- Screener (6 items, 0–3; item 6 is the designated safety item) ---------------
insert into screeners (id, org_id, title) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Weekly Well-being Check');

-- The safety item is designated by the is_safety_item column, not by its prompt text.
insert into screener_items (id, screener_id, prompt, max_score, is_safety_item) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Low mood or loss of interest', 3, false),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Feeling anxious or on edge', 3, false),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'Trouble sleeping', 3, false),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 'Low energy or fatigue', 3, false),
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', 'Difficulty concentrating', 3, false),
  ('30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000001', 'Thoughts of being better off not here', 3, true);

-- --- A week of check-ins for patient one, with screener results ------------------
-- Declining mood over the week; safety item stays at 0 in the seed.
insert into checkins (org_id, member_user_id, mood, note, created_at) values
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 4, 'Felt okay today.', now() - interval '6 days'),
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 3, 'A bit tired.', now() - interval '5 days'),
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 3, 'Hard to focus at work.', now() - interval '4 days'),
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 2, 'Did not sleep well.', now() - interval '3 days'),
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 2, 'Low energy all day.', now() - interval '2 days'),
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 2, 'Feeling on edge.', now() - interval '1 days'),
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 1, 'Rough day.', now());

-- Latest screener results for patient one (rising symptom scores; safety item = 0).
insert into screener_results (org_id, member_user_id, item_id, score, created_at) values
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 2, now()),
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 3, now()),
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 2, now()),
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004', 2, now()),
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000005', 1, now()),
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000006', 0, now());
