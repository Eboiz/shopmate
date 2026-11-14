-- PB-32 (Eboiz/Documents#33): the shop's contact details and banner, and
-- several photos per product.
--
-- 1. shops gets address, phone, fanpage_url and banner_url. Empty means "not
--    given" and is stored as null; the shop page hides a null field.
-- 2. product_images holds a product's photos in order (position 0 first). The
--    first photo is the card photo: save_product_images also writes it to
--    products.image_url, which the AI tools, chat cards and Messenger read. A
--    product with no rows here keeps its image_url (the seeded photo).
-- 3. Only the owner edits all of this; staff of the shop read it. Row Level
--    Security enforces it, like the rest of the catalog (PB-00).
-- 4. The owner's browser uploads the files straight to Storage, into a folder
--    named after the shop: product photos to product-images/<shop_id>/…, the
--    banner to the new shop-banners bucket. The seed keeps writing its own
--    photos with the secret key at the bucket root.

-- ---------------------------------------------------------------- shops
alter table public.shops
  add column address text
    constraint shops_address_check check (btrim(address) <> '' and char_length(address) <= 200),
  add column phone text
    -- Digits with optional +, spaces, dots, dashes or brackets: 0901 234 567, +84 90 123 4567.
    constraint shops_phone_check check (phone ~ '^\+?[0-9(][0-9 .()-]{6,18}[0-9]$'),
  add column fanpage_url text
    constraint shops_fanpage_url_check check (fanpage_url ~ '^https://[^\s]+$' and char_length(fanpage_url) <= 500),
  add column banner_url text
    constraint shops_banner_url_check check (banner_url ~ '^https?://[^\s]+$' and char_length(banner_url) <= 2048);

grant update (address, phone, fanpage_url, banner_url) on public.shops to authenticated;

create policy "owner updates" on public.shops
  for update to authenticated
  using (id = (select private.current_shop_id()) and (select private.is_owner()))
  with check (id = (select private.current_shop_id()) and (select private.is_owner()));

-- ---------------------------------------------------------------- product_images
create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid not null,
  url text not null check (url ~ '^https?://[^\s]+$' and char_length(url) <= 2048),
  -- At most 8 photos per product (MAX_PRODUCT_IMAGES in src/lib/shop/gallery.ts).
  position smallint not null check (position between 0 and 7),
  created_at timestamptz not null default now(),
  -- The product must belong to the same shop.
  foreign key (product_id, shop_id) references public.products (id, shop_id) on delete cascade,
  unique (product_id, position),
  unique (product_id, url)
);

create index product_images_shop_idx on public.product_images (shop_id);

alter table public.product_images enable row level security;

grant select, insert, delete on public.product_images to authenticated;
grant update (url, position) on public.product_images to authenticated;
grant all on public.product_images to service_role;

create policy "read own shop" on public.product_images
  for select to authenticated
  using (shop_id = (select private.current_shop_id()));
create policy "owner inserts" on public.product_images
  for insert to authenticated
  with check (shop_id = (select private.current_shop_id()) and (select private.is_owner()));
create policy "owner updates" on public.product_images
  for update to authenticated
  using (shop_id = (select private.current_shop_id()) and (select private.is_owner()))
  with check (shop_id = (select private.current_shop_id()) and (select private.is_owner()));
create policy "owner deletes" on public.product_images
  for delete to authenticated
  using (shop_id = (select private.current_shop_id()) and (select private.is_owner()));

-- Replaces a product's photo list in one transaction, in the given order, and
-- makes the first photo the product's card photo (products.image_url; null when
-- the list is empty). Moving a photo up or down would break unique (product_id,
-- position) half way if done row by row, so the editor saves the list as a whole.
--
-- security invoker: Row Level Security still decides, as in save_size_chart
-- (PB-24). The shop comes from auth.uid(), never from an argument.
-- p_urls: ["https://…", …]. Result: the number of photos saved. Unknown product: P0002.
create function public.save_product_images(p_product_id uuid, p_urls jsonb)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_shop uuid := (select private.current_shop_id());
  v_count integer;
begin
  if v_shop is null or not (select private.is_owner()) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_urls) is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(p_urls) as e(value) where jsonb_typeof(e.value) <> 'string') then
    raise exception 'urls_not_string_array' using errcode = '22023';
  end if;

  perform 1 from public.products where id = p_product_id and shop_id = v_shop for update;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  delete from public.product_images where product_id = p_product_id and shop_id = v_shop;

  insert into public.product_images (shop_id, product_id, url, position)
  select v_shop, p_product_id, u.url, (u.ord - 1)::smallint
  from jsonb_array_elements_text(p_urls) with ordinality as u(url, ord);
  get diagnostics v_count = row_count;

  update public.products
  set image_url = p_urls ->> 0
  where id = p_product_id and shop_id = v_shop;

  return v_count;
end;
$$;

revoke execute on function public.save_product_images(uuid, jsonb) from public, anon;
grant execute on function public.save_product_images(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- storage
-- Banners are wider than product photos; the browser shrinks both before upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-banners', 'shop-banners', true, 500000, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- The owner uploads into their own shop's folder only. No select, update or
-- delete policy: files are read through their public URL, never overwritten,
-- and a removed photo only leaves the list (its file stays in the bucket).
create policy "owner uploads shop photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('product-images', 'shop-banners')
    and (storage.foldername(name))[1] = (select private.current_shop_id())::text
    and (select private.is_owner())
  );
