-- PB-03 (Eboiz/Documents#3): create_draft_order for the AI engine (PB-11).
--
-- One function call is one transaction, and it never writes part of an order:
--   * everything is checked (shop of every variant, then stock) before the first INSERT;
--   * errors leave only through RAISE, which rolls back the whole call. There is
--     deliberately no EXCEPTION block: it would be a subtransaction, and rows
--     written before it would be committed;
--   * the composite foreign keys order_items(variant_id, shop_id) and
--     orders(conversation_id, shop_id) are the last line if this function is wrong.
-- Stock is not taken here: it changes only when staff confirm the order (PB-12).
create function public.engine_create_draft_order(
  p_shop_id uuid,
  p_conversation_id uuid,
  p_items jsonb,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_items jsonb;
  v_wanted int;
  v_found int;
  v_short jsonb;
  v_total bigint;
  v_order_id uuid;
begin
  -- 1. Merge repeated variants, keeping the order they first appear in.
  select coalesce(jsonb_agg(jsonb_build_object('variant_id', variant_id, 'quantity', quantity, 'ord', first_seen) order by first_seen), '[]')
    into v_items
  from (
    select (e ->> 'variantId')::uuid as variant_id, sum((e ->> 'quantity')::int) as quantity, min(ord) as first_seen
    from jsonb_array_elements(p_items) with ordinality as t(e, ord)
    group by 1
  ) merged;

  -- 2. Every variant belongs to this shop.
  select count(*) into v_wanted from jsonb_to_recordset(v_items) as i(variant_id uuid, quantity int);
  select count(*) into v_found
  from jsonb_to_recordset(v_items) as i(variant_id uuid, quantity int)
  join public.variants v on v.id = i.variant_id and v.shop_id = p_shop_id;
  if v_wanted = 0 or v_found <> v_wanted then
    raise exception 'variant_not_found';
  end if;

  -- 3. Enough stock for the merged quantities.
  select jsonb_agg(i.variant_id order by i.ord) into v_short
  from jsonb_to_recordset(v_items) as i(variant_id uuid, quantity int, ord bigint)
  join public.variants v on v.id = i.variant_id and v.shop_id = p_shop_id
  where v.stock < i.quantity;
  if v_short is not null then
    return jsonb_build_object('status', 'out_of_stock', 'variantIds', v_short);
  end if;

  -- 4. Only now write: the order, then its lines at today's price.
  select sum(i.quantity::bigint * p.price) into v_total
  from jsonb_to_recordset(v_items) as i(variant_id uuid, quantity int)
  join public.variants v on v.id = i.variant_id and v.shop_id = p_shop_id
  join public.products p on p.id = v.product_id and p.shop_id = p_shop_id;

  insert into public.orders (shop_id, conversation_id, status, customer_name, customer_phone, customer_address, total)
  values (p_shop_id, p_conversation_id, 'draft', p_customer_name, p_customer_phone, p_customer_address, v_total::int)
  returning id into v_order_id;

  insert into public.order_items (shop_id, order_id, variant_id, quantity, unit_price)
  select p_shop_id, v_order_id, i.variant_id, i.quantity, p.price
  from jsonb_to_recordset(v_items) as i(variant_id uuid, quantity int)
  join public.variants v on v.id = i.variant_id and v.shop_id = p_shop_id
  join public.products p on p.id = v.product_id and p.shop_id = p_shop_id;

  return jsonb_build_object('status', 'created', 'orderId', v_order_id, 'total', v_total);
end;
$$;

revoke execute on function public.engine_create_draft_order(uuid, uuid, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.engine_create_draft_order(uuid, uuid, jsonb, text, text, text) to service_role;
