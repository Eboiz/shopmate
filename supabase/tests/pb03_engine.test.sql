-- PB-03 engine functions. Run with `pnpm db:test` against local Supabase.
begin;
-- Ids differ from the integration fixture (src/lib/engine/test/two-shops.ts), so
-- this file runs while that fixture is in the local database.
create extension if not exists pgtap with schema extensions;
select plan(21);
-- Check deferrable foreign keys at each statement, as an autocommit write would.
set constraints all immediate;

-- Fixture: two shops with the same product name.
insert into public.shops (id, name, slug) values
  ('aa000000-0000-4000-8000-000000000001', 'Shop A', 'shop-a-sql'),
  ('bb000000-0000-4000-8000-000000000001', 'Shop B', 'shop-b-sql');
insert into public.products (id, shop_id, code, name, category, price) values
  ('aa000000-0000-4000-8000-000000000011', 'aa000000-0000-4000-8000-000000000001', 'VAY01', 'Váy suông linen', 'váy', 350000),
  ('aa000000-0000-4000-8000-000000000012', 'aa000000-0000-4000-8000-000000000001', 'AO03', 'Áo sơ mi trắng', 'áo', 250000),
  ('bb000000-0000-4000-8000-000000000011', 'bb000000-0000-4000-8000-000000000001', 'VAY01', 'Váy suông linen', 'váy', 420000);
insert into public.variants (id, shop_id, product_id, size, color, stock) values
  ('aa000000-0000-4000-8000-000000000021', 'aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000011', 'M', 'be', 2),
  ('bb000000-0000-4000-8000-000000000021', 'bb000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000011', 'M', 'be', 9);
insert into public.shoppers (id, shop_id, channel, external_id) values
  ('aa000000-0000-4000-8000-000000000041', 'aa000000-0000-4000-8000-000000000001', 'web', 'sql-shopper-a');
insert into public.conversations (id, shop_id, shopper_id) values
  ('aa000000-0000-4000-8000-000000000031', 'aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000041');

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

-- engine_create_draft_order
select function_privs_are('public', 'engine_create_draft_order',
  array['uuid', 'uuid', 'jsonb', 'text', 'text', 'text'], 'anon', array[]::text[],
  'anon cannot run engine_create_draft_order');
select function_privs_are('public', 'engine_create_draft_order',
  array['uuid', 'uuid', 'jsonb', 'text', 'text', 'text'], 'authenticated', array[]::text[],
  'authenticated cannot run engine_create_draft_order');
select throws_ok(
  $$select public.engine_create_draft_order('aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000031',
    '[{"variantId": "bb000000-0000-4000-8000-000000000021", "quantity": 1}]', 'Thảo', '0912345678', 'Q1')$$,
  'P0001', 'variant_not_found', 'another shop''s variant is refused'
);
select throws_ok(
  $$select public.engine_create_draft_order('aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000031',
    '[{"variantId": "aa000000-0000-4000-8000-000000000021", "quantity": 1},
      {"variantId": "bb000000-0000-4000-8000-000000000021", "quantity": 1}]', 'Thảo', '0912345678', 'Q1')$$,
  'P0001', 'variant_not_found', 'a list ending with another shop''s variant is refused'
);
select is((select count(*) from public.orders where shop_id in ('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001')), 0::bigint, 'a refused order writes no orders row');
select is((select count(*) from public.order_items where shop_id in ('aa000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001')), 0::bigint, 'a refused order writes no order_items row');
select is(
  public.engine_create_draft_order('aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000031',
    '[{"variantId": "aa000000-0000-4000-8000-000000000021", "quantity": 2}]', 'Thảo', '0912345678', 'Q1') ->> 'status',
  'created', 'a valid order is created'
);
select results_eq(
  $$select o.status::text, o.total, (select stock from public.variants where id = 'aa000000-0000-4000-8000-000000000021')
    from public.orders o where o.shop_id = 'aa000000-0000-4000-8000-000000000001'$$,
  $$values ('draft', 700000, 2)$$,
  'one draft order at the current price, and stock does not change'
);

-- ai_turns metrics columns (additive: old rows keep working)
insert into public.ai_turns (id, shop_id, mode, latency_ms)
  values ('aa000000-0000-4000-8000-000000000051', 'aa000000-0000-4000-8000-000000000001', 'staff_draft', 10);
select col_type_is('public', 'ai_turns', 'ttft_ms', 'integer', 'ai_turns.ttft_ms is an integer');
select col_type_is('public', 'ai_turns', 'model_calls', 'integer', 'ai_turns.model_calls is an integer');
select col_type_is('public', 'ai_turns', 'model', 'text', 'ai_turns.model is text');
select col_type_is('public', 'ai_turns', 'prompt_version', 'text', 'ai_turns.prompt_version is text');
select throws_ok(
  $$update public.ai_turns set ttft_ms = -1 where id = 'aa000000-0000-4000-8000-000000000051'$$,
  '23514', null, 'ttft_ms can never be negative'
);
select throws_ok(
  $$update public.ai_turns set model_calls = -1 where id = 'aa000000-0000-4000-8000-000000000051'$$,
  '23514', null, 'model_calls can never be negative'
);
select results_eq(
  $$select ttft_ms, model_calls, model, prompt_version from public.ai_turns
    where id = 'aa000000-0000-4000-8000-000000000051'$$,
  $$values (null::int, 0, null::text, null::text)$$,
  'a row written without the new columns reads with their defaults'
);

select * from finish();
rollback;
