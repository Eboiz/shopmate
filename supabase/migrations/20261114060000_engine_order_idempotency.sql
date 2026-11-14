-- PB-11 follow-up: idempotent draft-order creation and one atomic price read.
--
--   * orders.quote_key is the id of the confirmed quote turn. A replayed or
--     concurrent confirmation (same shop + quote_key) returns the existing
--     order instead of writing a second one: the caller first takes a
--     transaction-scoped advisory lock on shop:quote_key, so a replay waits,
--     then finds the order and returns its shape unchanged. A unique partial
--     index is the last line if this rule is wrong.
--   * Both are required: a call without a quote key or confirmed prices
--     raises 'quote_required' (no defaults, so no unprotected order path).
--   * The unit price the shopper confirmed (p_expected_prices) is checked
--     before anything is written: a staff price change between the summary
--     and the insert now returns 'price_changed' instead of silently writing
--     the new price.
--   * Products, then variants, are locked (FOR SHARE, each in id order,
--     matching product DELETE cascades and decide_draft_order) and read ONCE
--     into one snapshot used for every later check and write: under READ
--     COMMITTED two separate statements could disagree.
--
-- One function call is still one transaction, and it never writes part of an
-- order: everything is checked before the first INSERT, and errors leave only
-- through RAISE, which rolls back the whole call. There is deliberately no
-- EXCEPTION block: it would be a subtransaction, and rows written before it
-- would be committed. The composite foreign keys order_items(variant_id,
-- shop_id) and orders(conversation_id, shop_id) are the last line if this
-- function is wrong. Stock is still not taken here (PB-12).
alter table public.orders add column quote_key text;

create unique index orders_shop_quote_key
  on public.orders (shop_id, quote_key) where quote_key is not null;

-- A confirmed quote the engine replaced with a re-quote (engine_order_for_quote
-- with p_supersede). Written under the quote's advisory lock, so a create of
-- that quote that starts later sees it and writes nothing. Server-only: RLS on,
-- no policies.
create table public.superseded_quotes (
  shop_id uuid not null references public.shops (id) on delete cascade,
  quote_key text not null,
  created_at timestamptz not null default now(),
  primary key (shop_id, quote_key)
);
alter table public.superseded_quotes enable row level security;

drop function public.engine_create_draft_order(uuid, uuid, jsonb, text, text, text);

create function public.engine_create_draft_order(
  p_shop_id uuid,
  p_conversation_id uuid,
  p_items jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_quote_key text,
  p_expected_prices jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_items jsonb;
  v_rows jsonb;
  v_wanted int;
  v_short jsonb;
  v_total bigint;
  v_order_id uuid;
begin
  -- 0. Every order comes from a confirmed quote: no key or no confirmed prices
  --    is a caller bug, not an order without replay protection.
  if p_quote_key is null or p_expected_prices is null then
    raise exception 'quote_required';
  end if;

  --    Replay of the same confirmed quote: wait for a concurrent call with the
  --    same key, then return the order it already wrote, writing nothing.
  perform pg_advisory_xact_lock(hashtextextended(p_shop_id::text || ':' || p_quote_key, 0));
  select o.id, o.total into v_order_id, v_total
  from public.orders o
  where o.shop_id = p_shop_id and o.conversation_id = p_conversation_id and o.quote_key = p_quote_key;
  if found then
    return jsonb_build_object('status', 'created', 'orderId', v_order_id, 'total', v_total);
  end if;
  --    A quote the engine already replaced with a re-quote is never written:
  --    the shopper is confirming the new one.
  if exists (select 1 from public.superseded_quotes s where s.shop_id = p_shop_id and s.quote_key = p_quote_key) then
    return jsonb_build_object('status', 'price_changed');
  end if;

  -- 1. Merge repeated variants, keeping the order they first appear in.
  select coalesce(jsonb_agg(jsonb_build_object('variant_id', variant_id, 'quantity', quantity, 'ord', first_seen) order by first_seen), '[]')
    into v_items
  from (
    select (e ->> 'variantId')::uuid as variant_id, sum((e ->> 'quantity')::int) as quantity, min(ord) as first_seen
    from jsonb_array_elements(p_items) with ordinality as t(e, ord)
    group by 1
  ) merged;

  -- 2. Lock the rows whose values we will use (FOR SHARE holds off a
  --    concurrent staff price/stock update until we commit): products first,
  --    in id order, then variants in id order. Products before variants is
  --    the order a product DELETE takes (it cascades to its variants), and
  --    decide_draft_order locks only variants in id order, so neither can
  --    form a wait cycle with this call.
  perform 1
  from public.products p
  where p.shop_id = p_shop_id
    and p.id in (
      select v.product_id from public.variants v
      where v.shop_id = p_shop_id
        and v.id in (select (e ->> 'variantId')::uuid from jsonb_array_elements(p_items) as e)
    )
  order by p.id
  for share;

  perform 1
  from public.variants v
  where v.shop_id = p_shop_id
    and v.id in (select (e ->> 'variantId')::uuid from jsonb_array_elements(p_items) as e)
  order by v.id
  for share;

  -- 3. Read prices and stock ONCE into one snapshot (unit_price comes from the
  --    product), then use only that snapshot for every check and write.
  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', v.id, 'quantity', i.quantity, 'unit_price', p.price, 'stock', v.stock, 'ord', i.ord
         ) order by i.ord), '[]')
    into v_rows
  from jsonb_to_recordset(v_items) as i(variant_id uuid, quantity int, ord bigint)
  join public.variants v on v.id = i.variant_id and v.shop_id = p_shop_id
  join public.products p on p.id = v.product_id and p.shop_id = p_shop_id;

  select jsonb_array_length(v_items) into v_wanted;
  if v_wanted = 0 or jsonb_array_length(v_rows) <> v_wanted then
    raise exception 'variant_not_found';
  end if;

  -- 4. The price the shopper confirmed must still be the price on the product.
  --    Keys in p_expected_prices are camelCase, so the fields are read by hand
  --    (jsonb_to_recordset matches keys by exact name and would see nulls).
  if exists (
    select 1
    from jsonb_to_recordset(v_rows) as r(variant_id uuid, unit_price int)
    left join (
      select (e ->> 'variantId')::uuid as variant_id, (e ->> 'unitPrice')::int as unit_price
      from jsonb_array_elements(p_expected_prices) as e
    ) pe on pe.variant_id = r.variant_id
    where pe.variant_id is null or pe.unit_price <> r.unit_price
  ) then
    return jsonb_build_object('status', 'price_changed');
  end if;

  -- 5. Enough stock for the merged quantities.
  select jsonb_agg(r.variant_id order by r.ord) into v_short
  from jsonb_to_recordset(v_rows) as r(variant_id uuid, quantity int, stock int, ord bigint)
  where r.stock < r.quantity;
  if v_short is not null then
    return jsonb_build_object('status', 'out_of_stock', 'variantIds', v_short);
  end if;

  -- 6. Only now write: the order (with its quote key) and its lines.
  select sum(r.quantity::bigint * r.unit_price) into v_total
  from jsonb_to_recordset(v_rows) as r(variant_id uuid, quantity int, unit_price int);

  insert into public.orders (shop_id, conversation_id, status, customer_name, customer_phone, customer_address, total, quote_key)
  values (p_shop_id, p_conversation_id, 'draft', p_customer_name, p_customer_phone, p_customer_address, v_total::int, p_quote_key)
  returning id into v_order_id;

  insert into public.order_items (shop_id, order_id, variant_id, quantity, unit_price)
  select p_shop_id, v_order_id, r.variant_id, r.quantity, r.unit_price
  from jsonb_to_recordset(v_rows) as r(variant_id uuid, quantity int, unit_price int);

  return jsonb_build_object('status', 'created', 'orderId', v_order_id, 'total', v_total);
end;
$$;

revoke execute on function public.engine_create_draft_order(uuid, uuid, jsonb, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.engine_create_draft_order(uuid, uuid, jsonb, text, text, text, text, jsonb) to service_role;

-- The order already written from a confirmed quote, or null. Takes the same
-- advisory lock as engine_create_draft_order, so a write of that quote still
-- in flight is waited for. With p_supersede, a quote with no order is also
-- marked superseded in the same locked step, so a create of it that starts
-- afterwards writes nothing (engine_create_draft_order returns price_changed):
-- the engine calls it so before it shows a re-quote of that quote.
create function public.engine_order_for_quote(
  p_shop_id uuid,
  p_conversation_id uuid,
  p_quote_key text,
  p_supersede boolean
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_total bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_shop_id::text || ':' || p_quote_key, 0));
  select o.id, o.total into v_order_id, v_total
  from public.orders o
  where o.shop_id = p_shop_id and o.conversation_id = p_conversation_id and o.quote_key = p_quote_key;
  if found then
    return jsonb_build_object('status', 'created', 'orderId', v_order_id, 'total', v_total);
  end if;
  if p_supersede then
    insert into public.superseded_quotes (shop_id, quote_key) values (p_shop_id, p_quote_key)
    on conflict do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function public.engine_order_for_quote(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.engine_order_for_quote(uuid, uuid, text, boolean) to service_role;

-- #8: the conversation's newest shopper message, kept on the conversation row
-- itself by a trigger, so the resume below compares a column of the row it
-- locks (re-checked after any lock wait under READ COMMITTED) rather than a
-- subquery on messages that keeps its statement-start snapshot. Order: by
-- created_at, then id, the same as receive.ts newerShopperMessageExists.
alter table public.conversations
  add column latest_shopper_message_id uuid,
  add column latest_shopper_message_at timestamptz;

create function public.track_latest_shopper_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.conversations c
  set latest_shopper_message_id = new.id, latest_shopper_message_at = new.created_at
  where c.id = new.conversation_id
    and c.shop_id = new.shop_id
    and (c.latest_shopper_message_at is null
      or (c.latest_shopper_message_at, c.latest_shopper_message_id) < (new.created_at, new.id));
  return null;
end;
$$;

create trigger messages_track_latest_shopper_message
  after insert on public.messages
  for each row when (new.sender = 'shopper')
  execute function public.track_latest_shopper_message();

-- #8: a turn that started while the conversation waited for staff may hand it
-- back to the AI only if the message it answered is still the shopper's newest.
-- One UPDATE on the conversation row: a newer message's trigger update holds
-- or has changed that row, and the WHERE is re-checked on the latest version
-- after a lock wait, so a newer message always wins. Returns whether resumed.
create function public.engine_resume_ai(
  p_shop_id uuid,
  p_conversation_id uuid,
  p_message_id uuid
)
returns boolean
language sql
volatile
set search_path = ''
as $$
  with resumed as (
    update public.conversations c
    set mode = 'ai'
    where c.id = p_conversation_id
      and c.shop_id = p_shop_id
      and c.mode = 'needs_human'
      and c.latest_shopper_message_id = p_message_id
    returning 1
  )
  select exists (select 1 from resumed);
$$;

revoke execute on function public.engine_resume_ai(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.engine_resume_ai(uuid, uuid, uuid) to service_role;
