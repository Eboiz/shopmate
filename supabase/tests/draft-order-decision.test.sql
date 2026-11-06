begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.shops (id, name, slug) values
  ('12000000-0000-4000-8000-000000000001', 'Orders A', 'orders-a'),
  ('12000000-0000-4000-8000-000000000002', 'Orders B', 'orders-b');
insert into auth.users (id) values
  ('12000000-0000-4000-8000-000000000011'),
  ('12000000-0000-4000-8000-000000000012');
insert into public.profiles (id, shop_id, role) values
  ('12000000-0000-4000-8000-000000000011', '12000000-0000-4000-8000-000000000001', 'staff'),
  ('12000000-0000-4000-8000-000000000012', '12000000-0000-4000-8000-000000000002', 'staff');
insert into public.shoppers (id, shop_id, channel, external_id) values
  ('12000000-0000-4000-8000-000000000021', '12000000-0000-4000-8000-000000000001', 'web', 'order-test');
insert into public.conversations (id, shop_id, shopper_id) values
  ('12000000-0000-4000-8000-000000000031', '12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000021');
insert into public.products (id, shop_id, code, name, price) values
  ('12000000-0000-4000-8000-000000000041', '12000000-0000-4000-8000-000000000001', 'TEST', 'Test', 100);
insert into public.variants (id, shop_id, product_id, size, color, stock) values
  ('12000000-0000-4000-8000-000000000051', '12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000041', 'M', 'Red', 3),
  ('12000000-0000-4000-8000-000000000052', '12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000041', 'S', 'Red', 0);
insert into public.orders (id, shop_id, conversation_id, customer_name, customer_phone, customer_address, total) values
  ('12000000-0000-4000-8000-000000000061', '12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000031', 'Test', '0900000000', 'Test', 200),
  ('12000000-0000-4000-8000-000000000062', '12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000031', 'Test', '0900000000', 'Test', 200);
insert into public.order_items (shop_id, order_id, variant_id, quantity, unit_price) values
  ('12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000061', '12000000-0000-4000-8000-000000000051', 2, 100),
  ('12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000062', '12000000-0000-4000-8000-000000000051', 1, 100),
  ('12000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000062', '12000000-0000-4000-8000-000000000052', 1, 100);

select ok(not has_function_privilege('authenticated', 'public.decide_draft_order(uuid,uuid,public.order_status)', 'EXECUTE'), 'RPC requires server credentials');
select throws_ok($$ select public.decide_draft_order('12000000-0000-4000-8000-000000000061', '12000000-0000-4000-8000-000000000012', 'confirmed') $$,
  'PT404', 'order_not_found', 'another shop cannot decide the order');
select is(public.decide_draft_order('12000000-0000-4000-8000-000000000061', '12000000-0000-4000-8000-000000000011', 'confirmed'),
  '12000000-0000-4000-8000-000000000031'::uuid, 'confirmation returns the conversation for notification');
select throws_ok($$ select public.decide_draft_order('12000000-0000-4000-8000-000000000061', '12000000-0000-4000-8000-000000000011', 'confirmed') $$,
  'PT409', 'not_draft', 'a retry cannot deduct stock again');
select is((select stock from public.variants where id = '12000000-0000-4000-8000-000000000051'), 1, 'stock deducted once');
select throws_ok($$ select public.decide_draft_order('12000000-0000-4000-8000-000000000062', '12000000-0000-4000-8000-000000000011', 'confirmed') $$,
  'PT409', 'insufficient_stock', 'shortage aborts the entire confirmation');
select is((select stock from public.variants where id = '12000000-0000-4000-8000-000000000051'), 1, 'stock change for the first variant rolled back');
select lives_ok($$ select public.decide_draft_order('12000000-0000-4000-8000-000000000062', '12000000-0000-4000-8000-000000000011', 'cancelled') $$,
  'the order with insufficient stock can still be cancelled');
select is((select stock from public.variants where id = '12000000-0000-4000-8000-000000000051'), 1, 'cancellation leaves stock alone');

select * from finish();
rollback;
