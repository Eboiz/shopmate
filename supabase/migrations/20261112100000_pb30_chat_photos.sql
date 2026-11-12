-- PB-30 (Eboiz/Documents#31): shopper photos in chat.
--
-- Photos live in a private bucket at <shop_id>/<conversation_id>/<uuid>.<ext>.
-- The server writes them with the secret key; staff read their own shop's
-- folder (signed URLs from the inbox). The channel's own URL is never stored
-- (A10): Messenger URLs expire and Telegram file URLs carry the bot token.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-photos', 'chat-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "staff read their shop's chat photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-photos'
    and (storage.foldername(name))[1] = (select private.current_shop_id())::text
  );

-- Paths of the photos sent with a message, in order (at most 4 per message).
alter table public.messages
  add column photo_paths text[] not null default '{}',
  add constraint messages_photo_paths_max_4 check (cardinality(photo_paths) <= 4);
