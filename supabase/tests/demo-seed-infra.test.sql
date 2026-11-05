-- PB-02: the unaccent extension (PB-05 search) and the product image bucket.
-- Run with `pnpm db:test` against local Supabase.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select is(
  (select extnamespace::regnamespace::text from pg_extension where extname = 'unaccent'),
  'extensions',
  'unaccent is installed in the extensions schema'
);
select is(extensions.unaccent('Váy suông linen'), 'Vay suong linen', 'unaccent strips Vietnamese diacritics');
select is(extensions.unaccent('Đầm đỏ'), 'Dam do', 'unaccent turns đ into d');

select is(
  (select public from storage.buckets where id = 'product-images'),
  true,
  'product-images is a public bucket'
);
select is(
  (select file_size_limit from storage.buckets where id = 'product-images'),
  200000::bigint,
  'product images are capped at 200 KB'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'product-images'),
  array['image/jpeg', 'image/webp'],
  'only JPEG and WebP images are accepted'
);

-- Only the seed (secret key) writes images: no policy lets anon or a signed-in
-- user add a file.
set local role anon;
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('product-images', 'anon.jpg') $$,
  '42501',
  null,
  'anon cannot upload a product image'
);
reset role;

set local role authenticated;
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('product-images', 'user.jpg') $$,
  '42501',
  null,
  'a signed-in user cannot upload a product image'
);
reset role;

select * from finish();
rollback;
