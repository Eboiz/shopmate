-- PB-35a (Eboiz/Documents#38): the AI learns from staff replies.
--
-- data_gaps: a shopper question the AI couldn't answer from the shop's data
-- (it offered staff instead). Written by the server (secret key) after the turn.
-- learned_facts: what the AI learned from a staff reply, or what the owner
-- approved from a drafted answer. An active fact reaches the AI on the next turn:
-- a policy fact through get_policy (appended to that kind), a product fact through
-- the product's description (search_products). Size is never learned: sizes come
-- only from the size chart.
--
-- Everyone in the shop reads both tables; only the owner decides (approve, edit,
-- remove, dismiss) and switches shops.learning_mode. Inserts come from the server.

create type public.gap_reason as enum ('policy_not_covered', 'not_covered_by_data', 'product_not_found');
create type public.gap_status as enum ('open', 'learned', 'dismissed');
create type public.fact_status as enum ('active', 'pending', 'removed');
create type public.learning_mode as enum ('auto', 'review');

-- auto: a fact that needs no review is used at once. review: every fact waits.
alter table public.shops
  add column learning_mode public.learning_mode not null default 'auto';

create table public.learned_facts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  -- Exactly one target: a policy kind, or one product of the same shop.
  policy_kind public.policy_kind,
  product_id uuid,
  text text not null check (btrim(text) <> '' and char_length(text) <= 500),
  -- The staff message it was learned from; null when the owner wrote it from a draft.
  source_message_id uuid references public.messages (id) on delete set null,
  status public.fact_status not null default 'pending',
  -- Why it waits for the owner (PB-35b reviewReasons), shown on the page.
  review_reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  foreign key (product_id, shop_id) references public.products (id, shop_id) on delete cascade,
  foreign key (decided_by, shop_id) references public.profiles (id, shop_id),
  check ((policy_kind is null) <> (product_id is null)),
  unique (id, shop_id)
);

create table public.data_gaps (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  conversation_id uuid not null,
  reason public.gap_reason not null,
  question text not null check (btrim(question) <> '' and char_length(question) <= 500),
  -- The product the shopper was asking about, when the turn had one (for product facts).
  product_id uuid,
  -- The shopper answered "Không cần" to the offer of staff (PB-31).
  soft_declined boolean not null default false,
  status public.gap_status not null default 'open',
  -- Set while status = learned. Removing the fact reopens every gap pointing at it.
  learned_fact_id uuid,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, shop_id) references public.conversations (id, shop_id) on delete cascade,
  foreign key (product_id, shop_id) references public.products (id, shop_id) on delete set null (product_id),
  foreign key (learned_fact_id, shop_id) references public.learned_facts (id, shop_id) on delete set null (learned_fact_id)
);

create index data_gaps_shop_status_created on public.data_gaps (shop_id, status, created_at desc);
create index data_gaps_conversation_status on public.data_gaps (conversation_id, status, created_at desc);
create index data_gaps_learned_fact on public.data_gaps (learned_fact_id) where learned_fact_id is not null;
create index learned_facts_shop_status on public.learned_facts (shop_id, status);

alter table public.learned_facts enable row level security;
alter table public.data_gaps enable row level security;

grant select on public.learned_facts, public.data_gaps to authenticated;
grant update (text, policy_kind, status, decided_by, decided_at) on public.learned_facts to authenticated;
grant update (status, learned_fact_id) on public.data_gaps to authenticated;
grant update (learning_mode) on public.shops to authenticated;
grant all on public.learned_facts, public.data_gaps to service_role;

create policy "read own shop" on public.learned_facts
  for select to authenticated
  using (shop_id = (select private.current_shop_id()));
create policy "owner updates" on public.learned_facts
  for update to authenticated
  using (shop_id = (select private.current_shop_id()) and (select private.is_owner()))
  with check (shop_id = (select private.current_shop_id()) and (select private.is_owner()));

create policy "read own shop" on public.data_gaps
  for select to authenticated
  using (shop_id = (select private.current_shop_id()));
create policy "owner updates" on public.data_gaps
  for update to authenticated
  using (shop_id = (select private.current_shop_id()) and (select private.is_owner()))
  with check (shop_id = (select private.current_shop_id()) and (select private.is_owner()));

-- The column grant above limits this to learning_mode.
create policy "owner sets learning mode" on public.shops
  for update to authenticated
  using (id = (select private.current_shop_id()) and (select private.is_owner()))
  with check (id = (select private.current_shop_id()) and (select private.is_owner()));
