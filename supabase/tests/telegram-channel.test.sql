-- PB-21: a Telegram channel account needs a webhook secret Telegram accepts
-- (1-256 characters of A-Z, a-z, 0-9, _ and -). Run with `pnpm db:test`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into public.shops (id, name, slug) values ('c0000000-0000-4000-8000-000000000001', 'Shop T', 'shop-t');

select lives_ok(
  $$ insert into public.channel_accounts (shop_id, channel, external_account_id, access_token, webhook_secret)
     values ('c0000000-0000-4000-8000-000000000001', 'telegram', 'bot-1', 'token', 'Ab_9-xyz') $$,
  'a Telegram account with a valid secret is stored'
);
select lives_ok(
  format($$ insert into public.channel_accounts (shop_id, channel, external_account_id, access_token, webhook_secret)
     values ('c0000000-0000-4000-8000-000000000001', 'telegram', 'bot-2', 'token', %L) $$, repeat('a', 256)),
  'a 256-character secret (the Telegram maximum) is accepted'
);
select throws_ok(
  format($$ insert into public.channel_accounts (shop_id, channel, external_account_id, access_token, webhook_secret)
     values ('c0000000-0000-4000-8000-000000000001', 'telegram', 'bot-3', 'token', %L) $$, repeat('a', 257)),
  '23514', null, 'a 257-character secret is refused'
);
select throws_ok(
  $$ insert into public.channel_accounts (shop_id, channel, external_account_id, access_token, webhook_secret)
     values ('c0000000-0000-4000-8000-000000000001', 'telegram', 'bot-4', 'token', 'has space') $$,
  '23514', null, 'a secret with characters Telegram refuses is refused'
);
select throws_ok(
  $$ insert into public.channel_accounts (shop_id, channel, external_account_id, access_token)
     values ('c0000000-0000-4000-8000-000000000001', 'telegram', 'bot-5', 'token') $$,
  '23514', null, 'a Telegram account without a secret is refused'
);

select * from finish();
rollback;
