-- PB-00 Row Level Security with two shops: owner A, staff A, owner B, a user with
-- no profile, and anon. Run with `pnpm db:test` against local Supabase.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

-- Fixture (as postgres).
insert into auth.users (id, email) values
  ('a1111111-0000-0000-0000-000000000001', 'owner-a@test.local'),
  ('a2222222-0000-0000-0000-000000000001', 'staff-a@test.local'),
  ('b1111111-0000-0000-0000-000000000001', 'owner-b@test.local'),
  ('c0000000-0000-0000-0000-000000000001', 'nobody@test.local');
insert into public.shops (id, name, slug) values
  ('a0000000-0000-0000-0000-000000000001', 'Shop A', 'shop-a'),
  ('b0000000-0000-0000-0000-000000000001', 'Shop B', 'shop-b');
insert into public.profiles (id, shop_id, role) values
  ('a1111111-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'owner'),
  ('a2222222-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'staff'),
  ('b1111111-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'owner');
insert into public.products (id, shop_id, code, name, price) values
  ('a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'SP01', 'Váy A', 350000),
  ('a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'SP02', 'Áo A', 250000),
  ('b0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'SP01', 'Váy B', 350000);
insert into public.variants (id, shop_id, product_id, size, color, stock) values
  ('a0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', 'M', 'be', 2);
insert into public.policies (shop_id, kind, content) values
  ('a0000000-0000-0000-0000-000000000001', 'doi_tra', 'Đổi trong 7 ngày');
insert into public.channel_accounts (id, shop_id, channel, external_account_id, access_token) values
  ('a0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001', 'messenger', 'page-a', 'secret-token');
insert into public.shoppers (id, shop_id, channel, external_id, display_name) values
  ('a0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', 'web', 'cookie-1', 'Thảo');
insert into public.conversations (id, shop_id, shopper_id) values
  ('a0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000e1');
insert into public.messages (shop_id, conversation_id, sender, text) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f1', 'shopper', 'váy này còn size M không?');
insert into public.orders (id, shop_id, conversation_id, customer_name, customer_phone, customer_address, total) values
  ('a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f1', 'Thảo', '0912345678', 'Q1', 350000);
insert into public.order_items (shop_id, order_id, variant_id, quantity, unit_price) values
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-0000000000c1', 1, 350000);

-- ---------------------------------------------------------------- owner B
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1111111-0000-0000-0000-000000000001","role":"authenticated"}';

select is_empty($$select 1 from public.products where shop_id = 'a0000000-0000-0000-0000-000000000001'$$, 'owner B sees no products of shop A');
select is_empty($$select 1 from public.orders$$, 'owner B sees no orders of shop A');
select is_empty($$select 1 from public.order_items$$, 'owner B sees no order items of shop A');
select is_empty($$select 1 from public.conversations$$, 'owner B sees no conversations of shop A');
select is_empty($$select 1 from public.messages$$, 'owner B sees no messages of shop A');
select is_empty($$select 1 from public.shoppers$$, 'owner B sees no shoppers of shop A');
select is_empty($$select 1 from public.policies$$, 'owner B sees no policies of shop A');
select results_eq($$select name from public.products$$, array['Váy B'], 'owner B sees its own products');
select is_empty(
  $$update public.products set price = 1 where id = 'a0000000-0000-0000-0000-0000000000a1' returning id$$,
  'owner B cannot change a price of shop A'
);
select throws_ok(
  $$insert into public.products (shop_id, code, name, price)
    values ('a0000000-0000-0000-0000-000000000001', 'X', 'Planted', 1000)$$,
  '42501', null, 'owner B cannot add a product to shop A'
);
select is_empty(
  $$delete from public.products where id = 'a0000000-0000-0000-0000-0000000000a2' returning id$$,
  'owner B cannot delete a product of shop A'
);
select is_empty(
  $$update public.conversations set mode = 'staff' where id = 'a0000000-0000-0000-0000-0000000000f1' returning id$$,
  'owner B cannot take over a conversation of shop A'
);

-- ---------------------------------------------------------------- staff A
set local request.jwt.claims = '{"sub":"a2222222-0000-0000-0000-000000000001","role":"authenticated"}';

select results_eq($$select name from public.products order by code$$, array['Váy A', 'Áo A'], 'staff A sees products of shop A');
select isnt_empty($$select 1 from public.orders$$, 'staff A sees orders of shop A');
select is_empty(
  $$update public.products set price = 1 where id = 'a0000000-0000-0000-0000-0000000000a1' returning id$$,
  'staff A cannot change a price (owner only, in the database)'
);
select is_empty(
  $$update public.variants set stock = 99 where id = 'a0000000-0000-0000-0000-0000000000c1' returning id$$,
  'staff A cannot change stock'
);
select is_empty(
  $$update public.policies set content = 'Miễn phí ship' where kind = 'doi_tra' returning kind$$,
  'staff A cannot change a policy'
);
select throws_ok(
  $$insert into public.pairings (shop_id, product_a_id, product_b_id, reason)
    values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a2', 'hợp nhau')$$,
  '42501', null, 'staff A cannot add a pairing'
);
select is_empty(
  $$delete from public.products where id = 'a0000000-0000-0000-0000-0000000000a2' returning id$$,
  'staff A cannot delete a product'
);
select results_eq($$select display_name from public.shoppers$$, array['Thảo'], 'staff A sees the shopper name');
select throws_ok($$select external_id from public.shoppers$$, '42501', null, 'staff A cannot read a web shopper''s cookie id');
select results_eq(
  $$update public.conversations set mode = 'staff' where id = 'a0000000-0000-0000-0000-0000000000f1' returning mode::text$$,
  array['staff'], 'staff A can take over a conversation'
);
select throws_ok(
  $$update public.conversations set last_message_at = now() where id = 'a0000000-0000-0000-0000-0000000000f1'$$,
  '42501', null, 'staff A can change only the mode column'
);
select throws_ok(
  $$insert into public.messages (shop_id, conversation_id, sender, text, staff_id)
    values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f1', 'staff', 'hi', 'a2222222-0000-0000-0000-000000000001')$$,
  '42501', null, 'staff A cannot write messages directly (server sends them)'
);
select throws_ok(
  $$update public.orders set status = 'cancelled' where id = 'a0000000-0000-0000-0000-000000000011'$$,
  '42501', null, 'staff A cannot change orders directly (PB-12 goes through the server)'
);
select throws_ok(
  $$update public.profiles set role = 'owner' where id = 'a2222222-0000-0000-0000-000000000001'$$,
  '42501', null, 'staff A cannot promote itself to owner'
);
select throws_ok($$select access_token from public.channel_accounts$$, '42501', null, 'channel tokens are not readable by signed-in users');
select throws_ok($$select 1 from public.channel_events$$, '42501', null, 'processed message IDs are server only');
select throws_ok($$select 1 from public.ai_turns$$, '42501', null, 'the AI turn log is server only');

-- ---------------------------------------------------------------- owner A
set local request.jwt.claims = '{"sub":"a1111111-0000-0000-0000-000000000001","role":"authenticated"}';

select results_eq(
  $$update public.products set price = 390000 where id = 'a0000000-0000-0000-0000-0000000000a1' returning price$$,
  array[390000], 'owner A can change a price'
);
select throws_ok(
  $$update public.products set shop_id = 'b0000000-0000-0000-0000-000000000001' where id = 'a0000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'owner A cannot move a product to another shop'
);

-- ---------------------------------------------------------------- user without a profile
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is_empty($$select 1 from public.products$$, 'a signed-in user without a profile sees no products');
select is_empty($$select 1 from public.orders$$, 'a signed-in user without a profile sees no orders');
select is_empty($$select 1 from public.conversations$$, 'a signed-in user without a profile sees no conversations');
select is_empty($$select 1 from public.messages$$, 'a signed-in user without a profile sees no messages');

-- ---------------------------------------------------------------- anon (shoppers)
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok($$select 1 from public.products$$, '42501', null, 'anon cannot read products');
select throws_ok($$select 1 from public.messages$$, '42501', null, 'anon cannot read messages');
select throws_ok($$select private.current_shop_id()$$, '42501', null, 'anon cannot call the RLS helpers');

-- ---------------------------------------------------------------- read back as postgres
reset role;
select is(
  (select mode::text || ':' || (select price from public.products where id = 'a0000000-0000-0000-0000-0000000000a1')::text
     || ':' || (select count(*) from public.products where shop_id = 'a0000000-0000-0000-0000-000000000001')::text
   from public.conversations where id = 'a0000000-0000-0000-0000-0000000000f1'),
  'staff:390000:2',
  'read back: only the allowed writes happened (mode by staff A, price by owner A, nothing deleted)'
);

select * from finish();
rollback;
