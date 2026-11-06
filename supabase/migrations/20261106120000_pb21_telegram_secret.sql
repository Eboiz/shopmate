-- PB-21: the PB-00 check on Telegram webhook secrets used `{1,256}`, but Postgres
-- regular expressions allow at most 255 repetitions, so every Telegram row failed
-- with "invalid repetition count(s)". Same rule, written so Postgres accepts it.
alter table public.channel_accounts drop constraint channel_accounts_check;
alter table public.channel_accounts add constraint channel_accounts_telegram_secret check (
  channel <> 'telegram'
  or (webhook_secret is not null and webhook_secret ~ '^[A-Za-z0-9_-]+$' and length(webhook_secret) <= 256)
);
