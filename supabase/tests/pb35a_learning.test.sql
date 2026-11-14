-- PB-35a learning tables: who reads and who decides. Two shops: owner A, staff A,
-- owner B. Run with `pnpm db:test` against local Supabase.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values
  ('a1111111-0000-0000-0000-000000000035', 'owner-a35@test.local'),
  ('a2222222-0000-0000-0000-000000000035', 'staff-a35@test.local'),
  ('b1111111-0000-0000-0000-000000000035', 'owner-b35@test.local');
insert into public.shops (id, name, slug) values
  ('a0000000-0000-0000-0000-000000000035', 'Shop A35', 'shop-a35'),
  ('b0000000-0000-0000-0000-000000000035', 'Shop B35', 'shop-b35');
insert into public.profiles (id, shop_id, role) values
  ('a1111111-0000-0000-0000-000000000035', 'a0000000-0000-0000-0000-000000000035', 'owner'),
  ('a2222222-0000-0000-0000-000000000035', 'a0000000-0000-0000-0000-000000000035', 'staff'),
  ('b1111111-0000-0000-0000-000000000035', 'b0000000-0000-0000-0000-000000000035', 'owner');
insert into public.products (id, shop_id, code, name, price) values
  ('a0000000-0000-0000-0000-0000000035a1', 'a0000000-0000-0000-0000-000000000035', 'SP01', 'Áo A', 250000),
  ('b0000000-0000-0000-0000-0000000035b1', 'b0000000-0000-0000-0000-000000000035', 'SP01', 'Áo B', 250000);
insert into public.shoppers (id, shop_id, channel, external_id) values
  ('a0000000-0000-0000-0000-0000000035e1', 'a0000000-0000-0000-0000-000000000035', 'web', 'cookie-35');
insert into public.conversations (id, shop_id, shopper_id) values
  ('a0000000-0000-0000-0000-0000000035f1', 'a0000000-0000-0000-0000-000000000035', 'a0000000-0000-0000-0000-0000000035e1');
insert into public.learned_facts (id, shop_id, policy_kind, text, status) values
  ('a0000000-0000-0000-0000-000000003501', 'a0000000-0000-0000-0000-000000000035', 'giao_hang', 'Shop có cho kiểm hàng trước khi nhận.', 'active');
insert into public.data_gaps (id, shop_id, conversation_id, reason, question, status, learned_fact_id) values
  ('a0000000-0000-0000-0000-000000003511', 'a0000000-0000-0000-0000-000000000035', 'a0000000-0000-0000-0000-0000000035f1',
   'policy_not_covered', 'Có cho kiểm hàng không?', 'learned', 'a0000000-0000-0000-0000-000000003501');

-- Shape checks (as postgres).
select throws_ok(
  $$insert into public.learned_facts (shop_id, policy_kind, product_id, text)
    values ('a0000000-0000-0000-0000-000000000035', 'doi_tra', 'a0000000-0000-0000-0000-0000000035a1', 'x')$$,
  '23514', null, 'a fact has one target, not a policy kind and a product');
select throws_ok(
  $$insert into public.learned_facts (shop_id, text) values ('a0000000-0000-0000-0000-000000000035', 'x')$$,
  '23514', null, 'a fact has a target');
select throws_ok(
  $$insert into public.learned_facts (shop_id, product_id, text)
    values ('a0000000-0000-0000-0000-000000000035', 'b0000000-0000-0000-0000-0000000035b1', 'x')$$,
  '23503', null, 'a fact cannot point at a product of another shop');
select lives_ok(
  $$insert into public.learned_facts (shop_id, product_id, text)
    values ('a0000000-0000-0000-0000-000000000035', 'a0000000-0000-0000-0000-0000000035a1', 'Vải cotton, không co giãn.')$$,
  'a product fact of the same shop is accepted');
select is(
  (select learning_mode::text from public.shops where id = 'a0000000-0000-0000-0000-000000000035'),
  'auto', 'learning_mode defaults to auto');

-- ---------------------------------------------------------------- owner B
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1111111-0000-0000-0000-000000000035","role":"authenticated"}';
select is_empty($$select 1 from public.learned_facts$$, 'owner B reads no learned facts of shop A');
select is_empty($$select 1 from public.data_gaps$$, 'owner B reads no questions of shop A');
select is_empty(
  $$update public.learned_facts set status = 'removed' where id = 'a0000000-0000-0000-0000-000000003501' returning id$$,
  'owner B cannot remove a fact of shop A');

-- ---------------------------------------------------------------- staff A
set local request.jwt.claims = '{"sub":"a2222222-0000-0000-0000-000000000035","role":"authenticated"}';
select isnt_empty($$select 1 from public.learned_facts$$, 'staff A reads the learned facts');
select isnt_empty($$select 1 from public.data_gaps$$, 'staff A reads the questions');
select is_empty(
  $$update public.learned_facts set status = 'removed' where id = 'a0000000-0000-0000-0000-000000003501' returning id$$,
  'staff A cannot remove a fact');
select is_empty(
  $$update public.data_gaps set status = 'dismissed' where id = 'a0000000-0000-0000-0000-000000003511' returning id$$,
  'staff A cannot dismiss a question');
select is_empty(
  $$update public.shops set learning_mode = 'review' where id = 'a0000000-0000-0000-0000-000000000035' returning id$$,
  'staff A cannot switch the learning mode');
select throws_ok(
  $$insert into public.data_gaps (shop_id, conversation_id, reason, question)
    values ('a0000000-0000-0000-0000-000000000035', 'a0000000-0000-0000-0000-0000000035f1', 'policy_not_covered', 'x')$$,
  '42501', null, 'staff A cannot insert a question (server only)');

-- ---------------------------------------------------------------- owner A
set local request.jwt.claims = '{"sub":"a1111111-0000-0000-0000-000000000035","role":"authenticated"}';
select isnt_empty(
  $$update public.shops set learning_mode = 'review' where id = 'a0000000-0000-0000-0000-000000000035' returning id$$,
  'owner A switches the learning mode');
select throws_ok(
  $$update public.shops set name = 'Đổi tên' where id = 'a0000000-0000-0000-0000-000000000035'$$,
  '42501', null, 'owner A still cannot change other shop columns');
select isnt_empty(
  $$update public.learned_facts set status = 'removed' where id = 'a0000000-0000-0000-0000-000000003501' returning id$$,
  'owner A removes a fact');

select * from finish();
rollback;
