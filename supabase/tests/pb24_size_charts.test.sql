-- PB-24 size chart editing with two shops: ranges may not overlap (in the
-- database), only the owner saves through save_size_chart, staff read, another
-- shop sees and changes nothing. Run with `pnpm db:test` against local Supabase.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Fixture (as postgres).
insert into auth.users (id, email) values
  ('a1111111-0000-0000-0000-000000000024', 'owner-a24@test.local'),
  ('a2222222-0000-0000-0000-000000000024', 'staff-a24@test.local'),
  ('b1111111-0000-0000-0000-000000000024', 'owner-b24@test.local');
insert into public.shops (id, name, slug) values
  ('a0000000-0000-0000-0000-000000000024', 'Shop A24', 'shop-a24'),
  ('b0000000-0000-0000-0000-000000000024', 'Shop B24', 'shop-b24');
insert into public.profiles (id, shop_id, role) values
  ('a1111111-0000-0000-0000-000000000024', 'a0000000-0000-0000-0000-000000000024', 'owner'),
  ('a2222222-0000-0000-0000-000000000024', 'a0000000-0000-0000-0000-000000000024', 'staff'),
  ('b1111111-0000-0000-0000-000000000024', 'b0000000-0000-0000-0000-000000000024', 'owner');
insert into public.products (id, shop_id, code, name, price) values
  ('a0000000-0000-0000-0000-0000000024a1', 'a0000000-0000-0000-0000-000000000024', 'SP01', 'Váy A', 350000),
  ('a0000000-0000-0000-0000-0000000024a2', 'a0000000-0000-0000-0000-000000000024', 'SP02', 'Áo A', 250000),
  ('b0000000-0000-0000-0000-0000000024b1', 'b0000000-0000-0000-0000-000000000024', 'SP01', 'Váy B', 350000);

-- ---------------------------------------------------------------- constraints (as postgres)
insert into public.size_charts (shop_id, product_id, size, height_min_cm, height_max_cm, weight_min_kg, weight_max_kg) values
  ('a0000000-0000-0000-0000-000000000024', 'a0000000-0000-0000-0000-0000000024a2', 'S', 150, 155, 40, 45);

select throws_ok(
  $$insert into public.size_charts (shop_id, product_id, size, height_min_cm, height_max_cm, weight_min_kg, weight_max_kg)
    values ('a0000000-0000-0000-0000-000000000024', 'a0000000-0000-0000-0000-0000000024a2', 'M', 154, 160, 46, 50)$$,
  '23P01', null, 'two sizes of a product cannot share a height'
);
select throws_ok(
  $$insert into public.size_charts (shop_id, product_id, size, height_min_cm, height_max_cm, weight_min_kg, weight_max_kg)
    values ('a0000000-0000-0000-0000-000000000024', 'a0000000-0000-0000-0000-0000000024a2', 'M', 156, 160, 45, 50)$$,
  '23P01', null, 'two sizes of a product cannot share a weight (bounds are inclusive)'
);
select lives_ok(
  $$insert into public.size_charts (shop_id, product_id, size, height_min_cm, height_max_cm, weight_min_kg, weight_max_kg)
    values ('a0000000-0000-0000-0000-000000000024', 'a0000000-0000-0000-0000-0000000024a2', 'M', 156, 160, 46, 50)$$,
  'the next size may start one above the previous one'
);
select lives_ok(
  $$insert into public.size_charts (shop_id, product_id, size, height_min_cm, height_max_cm, weight_min_kg, weight_max_kg)
    values ('a0000000-0000-0000-0000-000000000024', 'a0000000-0000-0000-0000-0000000024a1', 'S', 150, 155, 40, 45)$$,
  'another product may use the same ranges'
);

-- ---------------------------------------------------------------- owner A
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-0000-0000-0000-000000000024","role":"authenticated"}';

select is(
  public.save_size_chart('a0000000-0000-0000-0000-0000000024a1', $$[
    {"size": "S", "height_min_cm": 148, "height_max_cm": 154, "weight_min_kg": 38, "weight_max_kg": 44},
    {"size": "M", "height_min_cm": 155, "height_max_cm": 162, "weight_min_kg": 45, "weight_max_kg": 52}
  ]$$::jsonb),
  2, 'owner A saves a whole chart'
);
select results_eq(
  $$select size || ':' || height_min_cm || '-' || height_max_cm from public.size_charts
    where product_id = 'a0000000-0000-0000-0000-0000000024a1' order by height_min_cm$$,
  array['S:148-154', 'M:155-162'], 'the saved chart replaces the old one'
);
select is(
  public.save_size_chart('a0000000-0000-0000-0000-0000000024a1', $$[
    {"size": "S", "height_min_cm": 148, "height_max_cm": 156, "weight_min_kg": 38, "weight_max_kg": 44},
    {"size": "M", "height_min_cm": 157, "height_max_cm": 162, "weight_min_kg": 45, "weight_max_kg": 52}
  ]$$::jsonb),
  2, 'moving the boundary between two sizes saves in one go'
);
select throws_ok(
  $$select public.save_size_chart('a0000000-0000-0000-0000-0000000024a1', '[
    {"size": "S", "height_min_cm": 148, "height_max_cm": 158, "weight_min_kg": 38, "weight_max_kg": 44},
    {"size": "M", "height_min_cm": 157, "height_max_cm": 162, "weight_min_kg": 45, "weight_max_kg": 52}
  ]'::jsonb)$$,
  '23P01', null, 'an overlapping chart is refused'
);
select results_eq(
  $$select size || ':' || height_min_cm || '-' || height_max_cm from public.size_charts
    where product_id = 'a0000000-0000-0000-0000-0000000024a1' order by height_min_cm$$,
  array['S:148-156', 'M:157-162'], 'a refused save keeps the previous chart'
);
select throws_ok(
  $$select public.save_size_chart('a0000000-0000-0000-0000-0000000024a1', '[
    {"size": "M", "height_min_cm": 148, "height_max_cm": 154, "weight_min_kg": 38, "weight_max_kg": 44},
    {"size": "M", "height_min_cm": 155, "height_max_cm": 162, "weight_min_kg": 45, "weight_max_kg": 52}
  ]'::jsonb)$$,
  '23505', null, 'a size appears once per product'
);
select throws_ok(
  $$select public.save_size_chart('b0000000-0000-0000-0000-0000000024b1', '[]'::jsonb)$$,
  'P0002', null, 'owner A cannot save a chart for a product of shop B'
);

-- ---------------------------------------------------------------- staff A
set local request.jwt.claims = '{"sub":"a2222222-0000-0000-0000-000000000024","role":"authenticated"}';

select results_eq(
  $$select count(*)::int from public.size_charts where product_id = 'a0000000-0000-0000-0000-0000000024a1'$$,
  array[2], 'staff A sees the chart'
);
select throws_ok(
  $$select public.save_size_chart('a0000000-0000-0000-0000-0000000024a1', '[]'::jsonb)$$,
  '42501', null, 'staff A cannot save a chart'
);
select is_empty(
  $$update public.size_charts set height_max_cm = 156 where product_id = 'a0000000-0000-0000-0000-0000000024a1' returning id$$,
  'staff A cannot change a row directly'
);
select is_empty(
  $$delete from public.size_charts where product_id = 'a0000000-0000-0000-0000-0000000024a1' returning id$$,
  'staff A cannot delete a row directly'
);

-- ---------------------------------------------------------------- owner B
set local request.jwt.claims = '{"sub":"b1111111-0000-0000-0000-000000000024","role":"authenticated"}';

select is_empty($$select 1 from public.size_charts$$, 'owner B sees no chart of shop A');
select throws_ok(
  $$select public.save_size_chart('a0000000-0000-0000-0000-0000000024a1', '[]'::jsonb)$$,
  'P0002', null, 'owner B cannot clear a chart of shop A'
);

-- ---------------------------------------------------------------- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$select public.save_size_chart('a0000000-0000-0000-0000-0000000024a1', '[]'::jsonb)$$,
  '42501', null, 'anon cannot call save_size_chart'
);

-- ---------------------------------------------------------------- read back as postgres
reset role;
select results_eq(
  $$select size || ':' || height_min_cm || '-' || height_max_cm from public.size_charts
    where product_id = 'a0000000-0000-0000-0000-0000000024a1' order by height_min_cm$$,
  array['S:148-156', 'M:157-162'], 'read back: only owner A changed the chart'
);

select * from finish();
rollback;
