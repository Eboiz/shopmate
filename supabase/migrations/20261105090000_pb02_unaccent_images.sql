-- PB-02 (Eboiz/Documents#2): search without diacritics, and the bucket for product photos.

-- PB-05 searches "vay suong linen" and finds "Váy suông linen". The schema is
-- named because the shared project's search_path includes public.
create extension if not exists unaccent with schema extensions;

-- Product photos, read by anyone through their public URL (web chat, Messenger,
-- Telegram). Only the seed writes them, with the secret key: storage.objects has
-- no policy for anon or authenticated, so their uploads are refused.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 200000, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;
