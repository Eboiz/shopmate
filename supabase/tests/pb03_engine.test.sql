-- PB-03 engine functions. Run with `pnpm db:test` against local Supabase.
begin;
-- Ids differ from the integration fixture (src/lib/engine/test/two-shops.ts), so
-- this file runs while that fixture is in the local database.
create extension if not exists pgtap with schema extensions;
select plan(6);

-- Fixture: two shops with the same product name.
insert into public.shops (id, name, slug) values
  ('aa000000-0000-4000-8000-000000000001', 'Shop A', 'shop-a-sql'),
  ('bb000000-0000-4000-8000-000000000001', 'Shop B', 'shop-b-sql');
insert into public.products (id, shop_id, code, name, category, price) values
  ('aa000000-0000-4000-8000-000000000011', 'aa000000-0000-4000-8000-000000000001', 'VAY01', 'Váy suông linen', 'váy', 350000),
  ('aa000000-0000-4000-8000-000000000012', 'aa000000-0000-4000-8000-000000000001', 'AO03', 'Áo sơ mi trắng', 'áo', 250000),
  ('bb000000-0000-4000-8000-000000000011', 'bb000000-0000-4000-8000-000000000001', 'VAY01', 'Váy suông linen', 'váy', 420000);

select has_function('public', 'engine_search_products', array['uuid', 'text', 'integer'], 'engine_search_products exists');
select function_privs_are('public', 'engine_search_products', array['uuid', 'text', 'integer'], 'anon', array[]::text[],
  'anon cannot run engine_search_products');
select function_privs_are('public', 'engine_search_products', array['uuid', 'text', 'integer'], 'authenticated', array[]::text[],
  'authenticated cannot run engine_search_products');
select results_eq(
  $$select id from public.engine_search_products('aa000000-0000-4000-8000-000000000001', 'vay suong linen', 5)$$,
  $$values ('aa000000-0000-4000-8000-000000000011'::uuid)$$,
  'a name typed without diacritics finds shop A''s product only'
);
select results_eq(
  $$select id from public.engine_search_products('aa000000-0000-4000-8000-000000000001', 'VÁY', 5)$$,
  $$values ('aa000000-0000-4000-8000-000000000011'::uuid)$$,
  'upper case with diacritics matches'
);
select is_empty(
  $$select id from public.engine_search_products('aa000000-0000-4000-8000-000000000001', 'a', 10)
    where shop_id <> 'aa000000-0000-4000-8000-000000000001'$$,
  'a search for shop A never returns another shop''s rows'
);

select * from finish();
rollback;
