-- PB-30: the chat-photos bucket is private and each shop's staff only read their own folder.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('a2222222-0000-0000-0000-000000000030', 'staff-a-pb30@test.local'),
  ('b2222222-0000-0000-0000-000000000030', 'staff-b-pb30@test.local');
insert into public.shops (id, name, slug) values
  ('a0000000-0000-0000-0000-000000000030', 'Shop A30', 'shop-a30'),
  ('b0000000-0000-0000-0000-000000000030', 'Shop B30', 'shop-b30');
insert into public.profiles (id, shop_id, role) values
  ('a2222222-0000-0000-0000-000000000030', 'a0000000-0000-0000-0000-000000000030', 'staff'),
  ('b2222222-0000-0000-0000-000000000030', 'b0000000-0000-0000-0000-000000000030', 'staff');
insert into public.shoppers (id, shop_id, channel, external_id) values
  ('a0000000-0000-0000-0000-0000000030e1', 'a0000000-0000-0000-0000-000000000030', 'web', 'cookie-pb30');
insert into public.conversations (id, shop_id, shopper_id) values
  ('a0000000-0000-0000-0000-0000000030f1', 'a0000000-0000-0000-0000-000000000030', 'a0000000-0000-0000-0000-0000000030e1');
insert into storage.objects (bucket_id, name) values
  ('chat-photos', 'a0000000-0000-0000-0000-000000000030/a0000000-0000-0000-0000-0000000030f1/p1.jpg'),
  ('chat-photos', 'b0000000-0000-0000-0000-000000000030/x/p2.jpg');

select is((select public from storage.buckets where id = 'chat-photos'), false, 'chat-photos is a private bucket');
select throws_ok(
  $$insert into public.messages (shop_id, conversation_id, sender, text, photo_paths)
    values ('a0000000-0000-0000-0000-000000000030', 'a0000000-0000-0000-0000-0000000030f1', 'shopper', '',
            array['a','b','c','d','e'])$$,
  '23514', null, 'a message holds at most 4 photos'
);
select lives_ok(
  $$insert into public.messages (shop_id, conversation_id, sender, text, photo_paths)
    values ('a0000000-0000-0000-0000-000000000030', 'a0000000-0000-0000-0000-0000000030f1', 'shopper', '', array['a'])$$,
  'a photo-only message with empty text is stored'
);

set local role anon;
select is_empty($$select 1 from storage.objects where bucket_id = 'chat-photos'$$, 'anon reads no chat photo');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a2222222-0000-0000-0000-000000000030","role":"authenticated"}';
select results_eq(
  $$select name from storage.objects where bucket_id = 'chat-photos'$$,
  array['a0000000-0000-0000-0000-000000000030/a0000000-0000-0000-0000-0000000030f1/p1.jpg'],
  'staff A read only the photos of shop A'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('chat-photos', 'a0000000-0000-0000-0000-000000000030/x/planted.jpg')$$,
  '42501', null, 'staff cannot upload chat photos'
);

set local request.jwt.claims = '{"sub":"b2222222-0000-0000-0000-000000000030","role":"authenticated"}';
select results_eq(
  $$select name from storage.objects where bucket_id = 'chat-photos'$$,
  array['b0000000-0000-0000-0000-000000000030/x/p2.jpg'],
  'staff B read only the photos of shop B'
);

select * from finish();
rollback;
