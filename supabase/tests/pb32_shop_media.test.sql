-- PB-32 contact details, banner and product photos with two shops: the data
-- rules hold in the database, only the owner edits (rows and Storage uploads),
-- staff read, another shop and anon see and change nothing.
-- Run with `pnpm db:test` against local Supabase.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

-- Fixture (as postgres).
insert into auth.users (id, email) values
  ('a1111111-0000-0000-0000-000000000032', 'owner-a32@test.local'),
  ('a2222222-0000-0000-0000-000000000032', 'staff-a32@test.local'),
  ('b1111111-0000-0000-0000-000000000032', 'owner-b32@test.local');
insert into public.shops (id, name, slug, phone) values
  ('a0000000-0000-0000-0000-000000000032', 'Shop A32', 'shop-a32', '0901 234 567'),
  ('b0000000-0000-0000-0000-000000000032', 'Shop B32', 'shop-b32', null);
insert into public.profiles (id, shop_id, role) values
  ('a1111111-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-000000000032', 'owner'),
  ('a2222222-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-000000000032', 'staff'),
  ('b1111111-0000-0000-0000-000000000032', 'b0000000-0000-0000-0000-000000000032', 'owner');
insert into public.products (id, shop_id, code, name, price, image_url) values
  ('a0000000-0000-0000-0000-0000000032a1', 'a0000000-0000-0000-0000-000000000032', 'SP01', 'Váy A', 350000, 'https://x.supabase.co/seed/SP01.jpg'),
  ('a0000000-0000-0000-0000-0000000032a2', 'a0000000-0000-0000-0000-000000000032', 'SP02', 'Áo A', 250000, null),
  ('b0000000-0000-0000-0000-0000000032b1', 'b0000000-0000-0000-0000-000000000032', 'SP01', 'Váy B', 350000, null);
insert into public.product_images (shop_id, product_id, url, position) values
  ('b0000000-0000-0000-0000-000000000032', 'b0000000-0000-0000-0000-0000000032b1', 'https://x.supabase.co/b/1.webp', 0);

-- ---------------------------------------------------------------- constraints (as postgres)
select throws_ok(
  $$insert into public.product_images (shop_id, product_id, url, position)
    values ('a0000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-0000000032a2', 'https://x.supabase.co/a/9.webp', 8)$$,
  '23514', null, 'a product holds at most 8 photos (position 0–7)'
);
select throws_ok(
  $$insert into public.product_images (shop_id, product_id, url, position)
    values ('a0000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-0000000032a2', 'javascript:alert(1)', 0)$$,
  '23514', null, 'a photo URL must be http(s)'
);
select throws_ok(
  $$insert into public.product_images (shop_id, product_id, url, position)
    values ('a0000000-0000-0000-0000-000000000032', 'b0000000-0000-0000-0000-0000000032b1', 'https://x.supabase.co/a/1.webp', 5)$$,
  '23503', null, 'a photo cannot point at a product of another shop'
);
select lives_ok(
  $$insert into public.product_images (shop_id, product_id, url, position)
    values ('a0000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-0000000032a2', 'https://x.supabase.co/a/1.webp', 0)$$,
  'a photo of the shop''s own product is stored'
);
select throws_ok(
  $$insert into public.product_images (shop_id, product_id, url, position)
    values ('a0000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-0000000032a2', 'https://x.supabase.co/a/2.webp', 0)$$,
  '23505', null, 'two photos of a product cannot share a position'
);
select throws_ok(
  $$insert into public.product_images (shop_id, product_id, url, position)
    values ('a0000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-0000000032a2', 'https://x.supabase.co/a/1.webp', 1)$$,
  '23505', null, 'the same photo cannot be added twice'
);
select throws_ok(
  $$update public.shops set phone = '09abc' where id = 'a0000000-0000-0000-0000-000000000032'$$,
  '23514', null, 'a phone with letters is refused'
);
select throws_ok(
  $$update public.shops set fanpage_url = 'http://facebook.com/a' where id = 'a0000000-0000-0000-0000-000000000032'$$,
  '23514', null, 'the fanpage link must be https'
);
select throws_ok(
  $$update public.shops set address = '   ' where id = 'a0000000-0000-0000-0000-000000000032'$$,
  '23514', null, 'an empty address is stored as null, not as blanks'
);
select throws_ok(
  $$update public.shops set banner_url = 'ftp://x/banner.jpg' where id = 'a0000000-0000-0000-0000-000000000032'$$,
  '23514', null, 'the banner URL must be http(s)'
);

-- ---------------------------------------------------------------- owner A
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-0000-0000-0000-000000000032","role":"authenticated"}';

select is(
  public.save_product_images('a0000000-0000-0000-0000-0000000032a1',
    '["https://x.supabase.co/a/side.webp", "https://x.supabase.co/a/front.webp"]'::jsonb),
  2, 'owner A saves a list of photos'
);
select results_eq(
  $$select url from public.product_images where product_id = 'a0000000-0000-0000-0000-0000000032a1' order by position$$,
  array['https://x.supabase.co/a/side.webp', 'https://x.supabase.co/a/front.webp'],
  'the photos keep the order they were saved in'
);
select is(
  (select image_url from public.products where id = 'a0000000-0000-0000-0000-0000000032a1'),
  'https://x.supabase.co/a/side.webp', 'the first photo becomes the card photo (products.image_url)'
);
select is(
  public.save_product_images('a0000000-0000-0000-0000-0000000032a1',
    '["https://x.supabase.co/a/front.webp", "https://x.supabase.co/a/side.webp"]'::jsonb),
  2, 'reordering (swapping two positions) saves in one go'
);
select is(
  (select image_url from public.products where id = 'a0000000-0000-0000-0000-0000000032a1'),
  'https://x.supabase.co/a/front.webp', 'the new first photo is the card photo'
);
select throws_ok(
  $$select public.save_product_images('a0000000-0000-0000-0000-0000000032a1', '[1, 2]'::jsonb)$$,
  '22023', null, 'the list must hold URLs'
);
select throws_ok(
  $$select public.save_product_images('b0000000-0000-0000-0000-0000000032b1', '[]'::jsonb)$$,
  'P0002', null, 'owner A cannot save photos of a product of shop B'
);
select is(
  public.save_product_images('a0000000-0000-0000-0000-0000000032a2', '[]'::jsonb),
  0, 'an empty list removes every photo'
);
select is(
  (select image_url from public.products where id = 'a0000000-0000-0000-0000-0000000032a2'),
  null, 'with no photo left the product has no card photo'
);
select results_eq(
  $$update public.shops set address = '12 Lê Lợi, Q1', fanpage_url = 'https://facebook.com/a32',
      banner_url = 'https://x.supabase.co/storage/v1/object/public/shop-banners/a/b.webp'
    where id = 'a0000000-0000-0000-0000-000000000032' returning address$$,
  array['12 Lê Lợi, Q1'], 'owner A edits the contact details and banner of shop A'
);
select is_empty(
  $$update public.shops set phone = '0909 999 999' where id = 'b0000000-0000-0000-0000-000000000032' returning id$$,
  'owner A cannot edit shop B'
);
select throws_ok(
  $$update public.shops set name = 'Đổi tên' where id = 'a0000000-0000-0000-0000-000000000032'$$,
  '42501', null, 'the shop name and slug stay out of reach (column grants)'
);
select is_empty(
  $$select 1 from public.product_images where shop_id = 'b0000000-0000-0000-0000-000000000032'$$,
  'owner A sees no photos of shop B'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('shop-banners', 'a0000000-0000-0000-0000-000000000032/banner.webp')$$,
  'owner A uploads a banner into the shop A folder'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('product-images', 'a0000000-0000-0000-0000-000000000032/p/1.webp')$$,
  'owner A uploads a product photo into the shop A folder'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('product-images', 'b0000000-0000-0000-0000-000000000032/p/1.webp')$$,
  '42501', null, 'owner A cannot upload into the shop B folder'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('product-images', 'SP01.jpg')$$,
  '42501', null, 'owner A cannot write at the bucket root, where the seed keeps its photos'
);

-- ---------------------------------------------------------------- staff A
set local request.jwt.claims = '{"sub":"a2222222-0000-0000-0000-000000000032","role":"authenticated"}';

select results_eq(
  $$select count(*)::int from public.product_images where shop_id = 'a0000000-0000-0000-0000-000000000032'$$,
  array[2], 'staff A reads the photos of shop A'
);
select results_eq(
  $$select phone || ' / ' || address from public.shops where id = 'a0000000-0000-0000-0000-000000000032'$$,
  array['0901 234 567 / 12 Lê Lợi, Q1'], 'staff A reads the contact details of shop A'
);
select throws_ok(
  $$select public.save_product_images('a0000000-0000-0000-0000-0000000032a1', '[]'::jsonb)$$,
  '42501', null, 'staff A cannot save the photo list'
);
select is_empty(
  $$update public.shops set phone = '0909 999 999' where id = 'a0000000-0000-0000-0000-000000000032' returning id$$,
  'staff A cannot edit the contact details'
);
select throws_ok(
  $$insert into public.product_images (shop_id, product_id, url, position)
    values ('a0000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-0000000032a2', 'https://x.supabase.co/a/s.webp', 3)$$,
  '42501', null, 'staff A cannot add a photo'
);
select is_empty(
  $$delete from public.product_images where shop_id = 'a0000000-0000-0000-0000-000000000032' returning id$$,
  'staff A cannot remove a photo'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('shop-banners', 'a0000000-0000-0000-0000-000000000032/staff.webp')$$,
  '42501', null, 'staff A cannot upload a banner'
);

-- ---------------------------------------------------------------- owner B
set local request.jwt.claims = '{"sub":"b1111111-0000-0000-0000-000000000032","role":"authenticated"}';

select is_empty(
  $$select 1 from public.product_images where shop_id = 'a0000000-0000-0000-0000-000000000032'$$,
  'owner B sees no photos of shop A'
);
select is_empty(
  $$select 1 from public.shops where id = 'a0000000-0000-0000-0000-000000000032'$$,
  'owner B does not see shop A''s contact details'
);
select is_empty(
  $$delete from public.product_images where shop_id = 'a0000000-0000-0000-0000-000000000032' returning id$$,
  'owner B cannot remove photos of shop A'
);

-- ---------------------------------------------------------------- anon
reset role;
set local role anon;
select throws_ok(
  $$select 1 from public.product_images$$,
  '42501', null, 'anon cannot read photos through the API'
);
select throws_ok(
  $$update public.shops set phone = '0909 999 999'$$,
  '42501', null, 'anon cannot edit a shop'
);
reset role;

-- ---------------------------------------------------------------- cascade (as postgres)
delete from public.products where id = 'a0000000-0000-0000-0000-0000000032a1';
select is_empty(
  $$select 1 from public.product_images where product_id = 'a0000000-0000-0000-0000-0000000032a1'$$,
  'deleting a product deletes its photos'
);

select * from finish();
rollback;
