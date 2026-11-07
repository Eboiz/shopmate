-- PB-12 decide_draft_order: confirm takes stock once, cancel leaves it, another
-- shop can't touch the order. Run with `pnpm db:test` against local Supabase.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);
set constraints all immediate;

-- Fixture (as postgres): shop A with an owner and a staff member, shop B with an owner.
insert into auth.users (id, email) values
  ('12a10000-0000-4000-8000-000000000001', 'pb12-owner-a@test.local'),
  ('12a20000-0000-4000-8000-000000000001', 'pb12-staff-a@test.local'),
  ('12b10000-0000-4000-8000-000000000001', 'pb12-owner-b@test.local');
insert into public.shops (id, name, slug) values
  ('12a00000-0000-4000-8000-000000000001', 'Shop A', 'pb12-shop-a'),
  ('12b00000-0000-4000-8000-000000000001', 'Shop B', 'pb12-shop-b');
insert into public.profiles (id, shop_id, role) values
  ('12a10000-0000-4000-8000-000000000001', '12a00000-0000-4000-8000-000000000001', 'owner'),
  ('12a20000-0000-4000-8000-000000000001', '12a00000-0000-4000-8000-000000000001', 'staff'),
  ('12b10000-0000-4000-8000-000000000001', '12b00000-0000-4000-8000-000000000001', 'owner');
insert into public.products (id, shop_id, code, name, price) values
  ('12a00000-0000-4000-8000-0000000000a1', '12a00000-0000-4000-8000-000000000001', 'VAY01', 'Váy suông linen', 350000),
  ('12a00000-0000-4000-8000-0000000000a2', '12a00000-0000-4000-8000-000000000001', 'AO01', 'Áo sơ mi', 250000);
-- c1: 5 in stock, c2: 1 in stock.
insert into public.variants (id, shop_id, product_id, size, color, stock) values
  ('12a00000-0000-4000-8000-0000000000c1', '12a00000-0000-4000-8000-000000000001', '12a00000-0000-4000-8000-0000000000a1', 'M', 'be', 5),
  ('12a00000-0000-4000-8000-0000000000c2', '12a00000-0000-4000-8000-000000000001', '12a00000-0000-4000-8000-0000000000a2', 'S', 'trắng', 1);
insert into public.shoppers (id, shop_id, channel, external_id) values
  ('12a00000-0000-4000-8000-0000000000e1', '12a00000-0000-4000-8000-000000000001', 'web', 'pb12-cookie');
insert into public.conversations (id, shop_id, shopper_id) values
  ('12a00000-0000-4000-8000-0000000000f1', '12a00000-0000-4000-8000-000000000001', '12a00000-0000-4000-8000-0000000000e1');
-- o1: 2 x c1 + 1 x c2 (enough). o2: 2 x c2 (not enough). o3: 1 x c1 (to cancel).
insert into public.orders (id, shop_id, conversation_id, customer_name, customer_phone, customer_address, total) values
  ('12a00000-0000-4000-8000-000000000011', '12a00000-0000-4000-8000-000000000001', '12a00000-0000-4000-8000-0000000000f1', 'Thảo', '0912345678', 'Q1', 950000),
  ('12a00000-0000-4000-8000-000000000012', '12a00000-0000-4000-8000-000000000001', '12a00000-0000-4000-8000-0000000000f1', 'Lan', '0912345679', 'Q3', 500000),
  ('12a00000-0000-4000-8000-000000000013', '12a00000-0000-4000-8000-000000000001', '12a00000-0000-4000-8000-0000000000f1', 'Mai', '0912345670', 'Q5', 350000);
insert into public.order_items (shop_id, order_id, variant_id, quantity, unit_price) values
  ('12a00000-0000-4000-8000-000000000001', '12a00000-0000-4000-8000-000000000011', '12a00000-0000-4000-8000-0000000000c1', 2, 350000),
  ('12a00000-0000-4000-8000-000000000001', '12a00000-0000-4000-8000-000000000011', '12a00000-0000-4000-8000-0000000000c2', 1, 250000),
  ('12a00000-0000-4000-8000-000000000001', '12a00000-0000-4000-8000-000000000012', '12a00000-0000-4000-8000-0000000000c2', 2, 250000),
  ('12a00000-0000-4000-8000-000000000001', '12a00000-0000-4000-8000-000000000013', '12a00000-0000-4000-8000-0000000000c1', 1, 350000);

select has_function('public', 'decide_draft_order', array['uuid', 'order_status'], 'decide_draft_order exists');
select function_privs_are('public', 'decide_draft_order', array['uuid', 'order_status'], 'anon', array[]::text[],
  'anon cannot run decide_draft_order');
select function_privs_are('public', 'decide_draft_order', array['uuid', 'order_status'], 'authenticated', array['EXECUTE'],
  'signed-in staff can run decide_draft_order');

-- ---------------------------------------------------------------- owner B
set local role authenticated;
set local request.jwt.claims = '{"sub":"12b10000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(public.decide_draft_order('12a00000-0000-4000-8000-000000000011', 'confirmed') ->> 'status', 'not_found',
  'owner B cannot confirm an order of shop A');
select is(public.decide_draft_order('12a00000-0000-4000-8000-000000000013', 'cancelled') ->> 'status', 'not_found',
  'owner B cannot cancel an order of shop A');

-- ---------------------------------------------------------------- no profile
set local request.jwt.claims = '{"sub":"12c00000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.decide_draft_order('12a00000-0000-4000-8000-000000000011', 'confirmed')$$,
  '42501', 'not_staff', 'a user without a staff profile is refused'
);

-- ---------------------------------------------------------------- staff A
set local request.jwt.claims = '{"sub":"12a20000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.decide_draft_order('12a00000-0000-4000-8000-000000000011', 'draft')$$,
  '22023', 'invalid_decision', 'draft is not a decision'
);

-- Not enough stock: nothing is written.
select is(public.decide_draft_order('12a00000-0000-4000-8000-000000000012', 'confirmed'),
  '{"status": "insufficient_stock", "variantIds": ["12a00000-0000-4000-8000-0000000000c2"]}'::jsonb,
  'confirming 2 when 1 is left is blocked and names the variant');
select is((select status::text from public.orders where id = '12a00000-0000-4000-8000-000000000012'), 'draft',
  'the blocked order stays a draft');

-- Confirm: status and stock in one call.
select is(public.decide_draft_order('12a00000-0000-4000-8000-000000000011', 'confirmed'),
  '{"status": "confirmed", "conversationId": "12a00000-0000-4000-8000-0000000000f1", "total": 950000}'::jsonb,
  'staff A confirms the order');
select results_eq(
  $$select status::text, confirmed_by, confirmed_at is not null from public.orders where id = '12a00000-0000-4000-8000-000000000011'$$,
  $$values ('confirmed', '12a20000-0000-4000-8000-000000000001'::uuid, true)$$,
  'the order is confirmed by staff A'
);
select results_eq(
  $$select id, stock from public.variants where shop_id = '12a00000-0000-4000-8000-000000000001' order by id$$,
  $$values ('12a00000-0000-4000-8000-0000000000c1'::uuid, 3), ('12a00000-0000-4000-8000-0000000000c2'::uuid, 0)$$,
  'every line takes its quantity from stock'
);

-- Confirming again (the second of two staff) changes nothing.
select is(public.decide_draft_order('12a00000-0000-4000-8000-000000000011', 'confirmed') ->> 'status', 'not_draft',
  'a second confirm is refused');
select is(public.decide_draft_order('12a00000-0000-4000-8000-000000000011', 'cancelled') ->> 'status', 'not_draft',
  'a confirmed order cannot be cancelled');
select results_eq(
  $$select stock from public.variants where shop_id = '12a00000-0000-4000-8000-000000000001' order by id$$,
  $$values (3), (0)$$,
  'stock is taken only once'
);

-- Cancel: status only, stock unchanged.
select is(public.decide_draft_order('12a00000-0000-4000-8000-000000000013', 'cancelled') ->> 'status', 'cancelled',
  'staff A cancels an order');
select results_eq(
  $$select status::text, cancelled_by, cancelled_at is not null from public.orders where id = '12a00000-0000-4000-8000-000000000013'$$,
  $$values ('cancelled', '12a20000-0000-4000-8000-000000000001'::uuid, true)$$,
  'the order is cancelled by staff A'
);
select results_eq(
  $$select stock from public.variants where shop_id = '12a00000-0000-4000-8000-000000000001' order by id$$,
  $$values (3), (0)$$,
  'cancelling leaves stock unchanged'
);
select is(public.decide_draft_order('12a00000-0000-4000-8000-000000000013', 'confirmed') ->> 'status', 'not_draft',
  'a cancelled order cannot be confirmed');
select is(public.decide_draft_order('12a00000-0000-4000-8000-000000000099', 'confirmed') ->> 'status', 'not_found',
  'an unknown order is not found');

-- Staff still cannot change status or stock directly: only through the function.
select throws_ok(
  $$update public.orders set status = 'draft' where id = '12a00000-0000-4000-8000-000000000011'$$,
  '42501', null, 'staff cannot update orders directly'
);
select is_empty(
  $$update public.variants set stock = 99 where id = '12a00000-0000-4000-8000-0000000000c1' returning id$$,
  'staff cannot set stock directly'
);

-- ---------------------------------------------------------------- owner A
set local request.jwt.claims = '{"sub":"12a10000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.decide_draft_order('12a00000-0000-4000-8000-000000000012', 'cancelled') ->> 'status', 'cancelled',
  'the owner can decide orders too');

reset role;
select results_eq(
  $$select status::text from public.orders where shop_id = '12a00000-0000-4000-8000-000000000001' order by id$$,
  $$values ('confirmed'), ('cancelled'), ('cancelled')$$,
  'final statuses'
);

select * from finish();
rollback;
