-- PB-00 shared contract (Eboiz/Documents#25): every table, with its constraints.
-- Row Level Security and grants are in the next migration.
--
-- Conventions:
--   * Money is a whole number of đồng (integer), never a float.
--   * Every table that belongs to a shop has shop_id. Children reference their
--     parent by (id, shop_id), so a row can never point at another shop's row,
--     even when the server writes with the secret key (which bypasses RLS).

create type public.channel as enum ('web', 'messenger', 'instagram', 'telegram', 'whatsapp');
create type public.conversation_mode as enum ('ai', 'needs_human', 'staff');
create type public.profile_role as enum ('owner', 'staff');
create type public.message_sender as enum ('shopper', 'ai', 'staff', 'system');
create type public.order_status as enum ('draft', 'confirmed', 'cancelled');
create type public.policy_kind as enum ('doi_tra', 'giao_hang', 'khuyen_mai');
create type public.engine_mode as enum ('customer', 'staff_draft');
-- PB-14 handoff triggers. The last two are raised by the server, not the model.
create type public.handoff_reason as enum (
  'complaint', 'asked_for_human', 'not_covered_by_data', 'product_not_found',
  'misunderstood_twice', 'size_out_of_range', 'policy_not_covered',
  'postcheck_failed', 'too_many_tool_calls'
);

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);

-- One row per signed-in user (owner or staff of exactly one shop).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  role public.profile_role not null,
  full_name text,
  created_at timestamptz not null default now(),
  unique (id, shop_id)
);

-- Price lives on the product: all sizes and colors share it (PB-02).
create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  category text,
  -- Capped so quantity * price stays inside integer range.
  price integer not null check (price > 0 and price < 100000000),
  description text,
  image_url text,
  created_at timestamptz not null default now(),
  unique (shop_id, code),
  unique (id, shop_id)
);

create table public.variants (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  product_id uuid not null,
  size text not null check (btrim(size) <> ''),
  color text not null check (btrim(color) <> ''),
  stock integer not null check (stock >= 0),
  foreign key (product_id, shop_id) references public.products (id, shop_id) on delete cascade,
  unique (product_id, size, color),
  unique (id, shop_id)
);

create table public.size_charts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  product_id uuid not null,
  size text not null,
  height_min_cm integer not null check (height_min_cm > 0),
  height_max_cm integer not null,
  weight_min_kg integer not null check (weight_min_kg > 0),
  weight_max_kg integer not null,
  foreign key (product_id, shop_id) references public.products (id, shop_id) on delete cascade,
  unique (product_id, size),
  check (height_min_cm <= height_max_cm),
  check (weight_min_kg <= weight_max_kg)
);

-- One row per pair, whichever order the two products were picked in; a pairing
-- works both ways (PB-08, A8).
create table public.pairings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  product_a_id uuid not null,
  product_b_id uuid not null,
  reason text not null check (btrim(reason) <> ''),
  foreign key (product_a_id, shop_id) references public.products (id, shop_id) on delete cascade,
  foreign key (product_b_id, shop_id) references public.products (id, shop_id) on delete cascade,
  check (product_a_id <> product_b_id)
);
create unique index pairings_one_row_per_pair
  on public.pairings (least(product_a_id, product_b_id), greatest(product_a_id, product_b_id));

-- Empty content means the shop has no such policy, so the AI hands the question to staff.
create table public.policies (
  shop_id uuid not null references public.shops (id) on delete cascade,
  kind public.policy_kind not null,
  content text not null default '',
  primary key (shop_id, kind)
);

-- Maps a channel account (Facebook Page ID, Instagram account ID, Telegram bot ID,
-- WhatsApp phone number ID) to one shop. Server-only: tokens never go through RLS.
create table public.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  channel public.channel not null check (channel <> 'web'),
  external_account_id text not null,
  access_token text not null,
  -- Telegram updates carry no bot ID: the webhook URL carries this row's id, and
  -- this secret is compared with X-Telegram-Bot-Api-Secret-Token.
  webhook_secret text,
  created_at timestamptz not null default now(),
  unique (channel, external_account_id),
  unique (id, shop_id),
  unique (id, channel, shop_id),
  -- `is not null` matters: a CHECK that evaluates to null passes.
  check (channel <> 'telegram' or (webhook_secret is not null and webhook_secret ~ '^[A-Za-z0-9_-]{1,256}$'))
);

-- The same person writing to two shops is two shoppers (PB-17 counts per shop).
create table public.shoppers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  channel public.channel not null,
  -- web: random id from an httpOnly cookie; other channels: the channel's user id.
  external_id text not null,
  channel_account_id uuid,
  display_name text,
  created_at timestamptz not null default now(),
  foreign key (channel_account_id, channel, shop_id)
    references public.channel_accounts (id, channel, shop_id) on delete cascade,
  unique (shop_id, channel, external_id),
  unique (id, shop_id),
  check ((channel = 'web') = (channel_account_id is null))
);

-- One conversation per shopper, so two messages arriving together can't create two.
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  shopper_id uuid not null unique,
  mode public.conversation_mode not null default 'ai',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (shopper_id, shop_id) references public.shoppers (id, shop_id) on delete cascade,
  unique (id, shop_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  conversation_id uuid not null,
  sender public.message_sender not null,
  text text not null default '',
  -- The full reply shape { text, products[], quickReplies[] } when the AI or staff sent it.
  reply jsonb,
  staff_id uuid,
  -- Web chat has no channel account, so it dedupes here: the browser sends a
  -- random id per message, and a retried POST hits the unique key.
  client_message_id text,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, shop_id) references public.conversations (id, shop_id) on delete cascade,
  foreign key (staff_id, shop_id) references public.profiles (id, shop_id),
  unique (conversation_id, client_message_id),
  check ((sender = 'staff') = (staff_id is not null))
);
create index messages_conversation_created_at on public.messages (conversation_id, created_at);

-- Channel message IDs already processed. Webhooks insert ... on conflict do nothing
-- and skip the message when nothing was inserted. Telegram update_id is only
-- unique within one bot, hence the key includes the channel account.
create table public.channel_events (
  channel_account_id uuid not null,
  external_message_id text not null,
  shop_id uuid not null,
  received_at timestamptz not null default now(),
  primary key (channel_account_id, external_message_id),
  foreign key (channel_account_id, shop_id) references public.channel_accounts (id, shop_id) on delete cascade
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  conversation_id uuid not null,
  status public.order_status not null default 'draft',
  customer_name text not null check (btrim(customer_name) <> ''),
  customer_phone text not null check (customer_phone ~ '^0[0-9]{9}$'),
  customer_address text not null check (btrim(customer_address) <> ''),
  -- Goods total from quote_order; the shipping fee is not added (PB-11, A6).
  total integer not null check (total >= 0),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  -- Cascade so deleting a shop (e.g. resetting the eval shop) removes its orders.
  -- A product that was ever ordered can't be deleted: order_items keeps it.
  foreign key (conversation_id, shop_id) references public.conversations (id, shop_id) on delete cascade,
  foreign key (confirmed_by, shop_id) references public.profiles (id, shop_id),
  foreign key (cancelled_by, shop_id) references public.profiles (id, shop_id),
  unique (id, shop_id),
  check (
    (status = 'draft' and confirmed_at is null and confirmed_by is null
      and cancelled_at is null and cancelled_by is null)
    or (status = 'confirmed' and confirmed_at is not null and confirmed_by is not null
      and cancelled_at is null and cancelled_by is null)
    or (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null
      and confirmed_at is null and confirmed_by is null)
  )
);

-- Size and color come from the variant. The unit price is copied at order time,
-- so a later price change (PB-16) doesn't change an existing order.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  order_id uuid not null,
  variant_id uuid not null,
  quantity integer not null check (quantity > 0),
  unit_price integer not null check (unit_price > 0),
  line_total integer generated always as (quantity * unit_price) stored not null,
  foreign key (order_id, shop_id) references public.orders (id, shop_id) on delete cascade,
  -- Checked at commit, so deleting a whole shop (which removes its orders too)
  -- passes; deleting only a product that was ordered still fails.
  foreign key (variant_id, shop_id) references public.variants (id, shop_id)
    deferrable initially deferred,
  -- One line per variant: create_draft_order merges repeats into one quantity.
  unique (order_id, variant_id)
);

-- One row per engine turn: response time, tools called, tokens (PB-03, PB-07, PB-10).
create table public.ai_turns (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  -- Null in staff_draft mode: the reply assistant (PB-20) has no conversation.
  conversation_id uuid,
  mode public.engine_mode not null,
  latency_ms integer not null check (latency_ms >= 0),
  tool_calls jsonb not null default '[]',
  postcheck jsonb,
  handoff_reason public.handoff_reason,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, shop_id) references public.conversations (id, shop_id) on delete cascade,
  check (mode = 'staff_draft' or conversation_id is not null)
);

-- Inbox list (PB-13), orders page (PB-12).
create index conversations_shop_last_message on public.conversations (shop_id, last_message_at desc);
create index orders_shop_created_at on public.orders (shop_id, created_at desc);
