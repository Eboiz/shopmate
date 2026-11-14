-- PB-00 schema constraints. Run with `pnpm db:test` against local Supabase.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);
-- Check deferrable foreign keys at each statement, as an autocommit write would.
set constraints all immediate;

select set_eq(
  $$select table_name::text from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'$$,
  array['shops', 'profiles', 'products', 'variants', 'size_charts', 'pairings', 'policies',
        'channel_accounts', 'shoppers', 'conversations', 'messages', 'channel_events',
        'orders', 'order_items', 'ai_turns',
        -- PB-04: web chat limit per client IP and shop (server only).
        'web_chat_hits',
        -- PB-35a: questions the AI couldn't answer, and what it learned.
        'data_gaps', 'learned_facts',
        -- PB-11 follow-up: confirmed quotes replaced by a re-quote (server only).
        'superseded_quotes'],
  'the contract has exactly these tables'
);

select is_empty(
  $$select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity$$,
  'RLS is on for every table in public'
);

select is_empty(
  $$select t.table_name from information_schema.tables t
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE' and t.table_name <> 'shops'
      and not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = t.table_name
                        and c.column_name = 'shop_id' and c.is_nullable = 'NO')$$,
  'every table that belongs to a shop has a non-null shop_id'
);

select enum_has_labels('public', 'conversation_mode', array['ai', 'needs_human', 'staff'], 'conversations.mode values');
select col_default_is('public', 'conversations', 'mode', 'ai'::public.conversation_mode, 'new conversations start in ai mode');

-- Fixture: two shops.
insert into public.shops (id, name, slug) values
  ('a0000000-0000-0000-0000-000000000001', 'Shop A', 'shop-a'),
  ('b0000000-0000-0000-0000-000000000001', 'Shop B', 'shop-b');
insert into public.products (id, shop_id, code, name, price) values
  ('a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-000000000001', 'SP01', 'Váy suông linen', 350000),
  ('a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-000000000001', 'SP02', 'Áo sơ mi', 250000),
  ('b0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-000000000001', 'SP01', 'Váy suông linen', 350000);
insert into public.variants (id, shop_id, product_id, size, color, stock) values
  ('a0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', 'M', 'be', 2),
  ('b0000000-0000-0000-0000-0000000000c1', 'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000b1', 'M', 'be', 2);
insert into public.channel_accounts (id, shop_id, channel, external_account_id, access_token) values
  ('a0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000001', 'messenger', 'page-a', 'token-a');
insert into public.shoppers (id, shop_id, channel, external_id) values
  ('a0000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', 'web', 'cookie-1');
insert into public.conversations (id, shop_id, shopper_id) values
  ('a0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000e1');

select throws_ok(
  $$update public.variants set stock = -1 where id = 'a0000000-0000-0000-0000-0000000000c1'$$,
  '23514', null, 'stock can never go below 0'
);
select throws_ok(
  $$insert into public.products (shop_id, code, name, price)
    values ('a0000000-0000-0000-0000-000000000001', 'SP09', 'Free', 0)$$,
  '23514', null, 'price must be greater than 0'
);
select throws_ok(
  $$insert into public.variants (shop_id, product_id, size, color, stock)
    values ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000b1', 'L', 'đen', 1)$$,
  '23503', null, 'a variant of shop A cannot point at a product of shop B'
);
select throws_ok(
  $$insert into public.conversations (mode, shop_id, shopper_id)
    values ('other', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000e1')$$,
  '22P02', null, 'mode only accepts ai, needs_human, staff'
);

-- Shopper identity.
select throws_ok(
  $$insert into public.shoppers (shop_id, channel, external_id)
    values ('a0000000-0000-0000-0000-000000000001', 'web', 'cookie-1')$$,
  '23505', null, 'shopper identity is unique per (shop_id, channel, external_id)'
);
select lives_ok(
  $$insert into public.shoppers (shop_id, channel, external_id)
    values ('b0000000-0000-0000-0000-000000000001', 'web', 'cookie-1')$$,
  'the same person writing to another shop is another shopper'
);
select throws_ok(
  $$insert into public.shoppers (shop_id, channel, external_id)
    values ('a0000000-0000-0000-0000-000000000001', 'messenger', 'psid-1')$$,
  '23514', null, 'a Messenger shopper needs a channel account'
);
select throws_ok(
  $$insert into public.shoppers (shop_id, channel, external_id, channel_account_id)
    values ('a0000000-0000-0000-0000-000000000001', 'telegram', 'tg-1', 'a0000000-0000-0000-0000-0000000000d1')$$,
  '23503', null, 'shopper channel must match its channel account'
);
select throws_ok(
  $$insert into public.conversations (shop_id, shopper_id)
    values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000e1')$$,
  '23505', null, 'one conversation per shopper'
);

-- Channels.
select throws_ok(
  $$insert into public.channel_accounts (shop_id, channel, external_account_id, access_token)
    values ('a0000000-0000-0000-0000-000000000001', 'telegram', 'bot-1', 'token')$$,
  '23514', null, 'a Telegram account needs a webhook secret'
);
insert into public.channel_events (channel_account_id, external_message_id, shop_id)
  values ('a0000000-0000-0000-0000-0000000000d1', 'mid.1', 'a0000000-0000-0000-0000-000000000001');
select throws_ok(
  $$insert into public.channel_events (channel_account_id, external_message_id, shop_id)
    values ('a0000000-0000-0000-0000-0000000000d1', 'mid.1', 'a0000000-0000-0000-0000-000000000001')$$,
  '23505', null, 'a channel message ID is processed once'
);

-- Pairings work both ways, one row per pair.
insert into public.pairings (shop_id, product_a_id, product_b_id, reason)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a2', 'hợp nhau');
select throws_ok(
  $$insert into public.pairings (shop_id, product_a_id, product_b_id, reason)
    values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a1', 'lặp')$$,
  '23505', null, 'the reversed pair is the same pairing'
);
select throws_ok(
  $$insert into public.pairings (shop_id, product_a_id, product_b_id, reason)
    values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', 'tự ghép')$$,
  '23514', null, 'a product cannot pair with itself'
);

-- Orders.
select throws_ok(
  $$insert into public.orders (shop_id, conversation_id, customer_name, customer_phone, customer_address, total)
    values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f1', 'Thảo', '091234567', 'Q1', 350000)$$,
  '23514', null, 'phone must be 10 digits starting with 0'
);
insert into public.orders (id, shop_id, conversation_id, customer_name, customer_phone, customer_address, total)
  values ('a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f1', 'Thảo', '0912345678', 'Q1', 700000);
select throws_ok(
  $$update public.orders set status = 'confirmed' where id = 'a0000000-0000-0000-0000-000000000011'$$,
  '23514', null, 'a confirmed order must say when and by whom'
);
select throws_ok(
  $$insert into public.order_items (shop_id, order_id, variant_id, quantity, unit_price)
    values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-0000000000c1', 1, 350000)$$,
  '23503', null, 'an order of shop A cannot contain a variant of shop B'
);
insert into public.order_items (shop_id, order_id, variant_id, quantity, unit_price)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-0000000000c1', 2, 350000);
select is(
  (select line_total from public.order_items where order_id = 'a0000000-0000-0000-0000-000000000011'),
  700000, 'line total is quantity times unit price'
);
select throws_ok(
  $$insert into public.order_items (shop_id, order_id, variant_id, quantity, unit_price)
    values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-0000000000c1', 0, 350000)$$,
  '23514', null, 'quantity must be greater than 0'
);

-- AI turn log.
select throws_ok(
  $$insert into public.ai_turns (shop_id, mode, latency_ms) values ('a0000000-0000-0000-0000-000000000001', 'customer', 10)$$,
  '23514', null, 'a customer turn belongs to a conversation'
);
select lives_ok(
  $$insert into public.ai_turns (shop_id, mode, latency_ms) values ('a0000000-0000-0000-0000-000000000001', 'staff_draft', 10)$$,
  'a staff_draft turn has no conversation'
);

-- Web chat dedupe (no channel account): the browser's message id is unique per conversation.
insert into public.messages (shop_id, conversation_id, sender, text, client_message_id)
  values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f1', 'shopper', 'hi', 'web-1');
select throws_ok(
  $$insert into public.messages (shop_id, conversation_id, sender, text, client_message_id)
    values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f1', 'shopper', 'hi', 'web-1')$$,
  '23505', null, 'a retried web message is stored once'
);
select throws_ok(
  $$insert into public.order_items (shop_id, order_id, variant_id, quantity, unit_price)
    values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-0000000000c1', 1, 350000)$$,
  '23505', null, 'one order line per variant'
);
select throws_ok(
  $$insert into public.variants (shop_id, product_id, size, color, stock)
    values ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', ' ', 'đen', 1)$$,
  '23514', null, 'size cannot be blank'
);

-- Later migrations: new tables get no rights for anon / authenticated by default.
create table public.zz_probe (id int);
select ok(not has_table_privilege('anon', 'public.zz_probe', 'select'), 'a new table is not readable by anon');
select ok(not has_table_privilege('authenticated', 'public.zz_probe', 'select'), 'a new table is not readable by signed-in users until granted');

-- Deleting: an ordered product stays (order history), a whole shop can go.
select throws_ok(
  $$delete from public.products where id = 'a0000000-0000-0000-0000-0000000000a1'$$,
  '23503', null, 'a product that was ordered cannot be deleted'
);
set constraints all deferred;
select lives_ok(
  $$delete from public.shops where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'a shop with orders can be deleted (eval shop reset)'
);
set constraints all immediate;  -- run the deferred check now, inside the test
select is_empty($$select 1 from public.order_items where shop_id = 'a0000000-0000-0000-0000-000000000001'$$, 'its orders went with it');

select * from finish();
rollback;
