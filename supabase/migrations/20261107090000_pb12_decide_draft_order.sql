-- PB-12 (Eboiz/Documents#12): staff confirm or cancel a draft order.
--
-- Called by the signed-in owner or staff member through the API (rpc). The shop
-- and the staff id come from auth.uid(), never from an argument, so a member of
-- shop B cannot touch an order of shop A even by guessing its id.
--
-- One call is one transaction:
--   * the order row is locked (`for update`) and must still be `draft`. A second
--     staff member confirming at the same moment waits on that lock, then sees
--     `confirmed` and gets `not_draft`, so stock is never taken twice;
--   * confirm locks every variant of the order (in id order, so two orders
--     sharing variants can't deadlock), checks the stock of all of them, and only
--     then decrements them and sets the status. Not enough stock writes nothing;
--   * cancel only sets the status: stock changes only when an order is confirmed.
-- The variants.stock >= 0 check is the last line if this function is wrong.
--
-- Result: {status: 'confirmed' | 'cancelled', conversationId, total}
--      or {status: 'insufficient_stock', variantIds} | {status: 'not_draft'} | {status: 'not_found'}.
create function public.decide_draft_order(p_order_id uuid, p_decision public.order_status)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_shop uuid;
  v_order public.orders%rowtype;
  v_short jsonb;
begin
  if p_decision is null or p_decision = 'draft' then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select shop_id into v_shop from public.profiles where id = v_user;
  if v_shop is null then
    raise exception 'not_staff' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and shop_id = v_shop
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_order.status <> 'draft' then
    return jsonb_build_object('status', 'not_draft');
  end if;

  if p_decision = 'confirmed' then
    perform 1
    from public.variants v
    where v.shop_id = v_shop
      and v.id in (select oi.variant_id from public.order_items oi where oi.order_id = p_order_id and oi.shop_id = v_shop)
    order by v.id
    for update;

    select jsonb_agg(oi.variant_id order by oi.variant_id) into v_short
    from public.order_items oi
    join public.variants v on v.id = oi.variant_id and v.shop_id = v_shop
    where oi.order_id = p_order_id and oi.shop_id = v_shop and v.stock < oi.quantity;
    if v_short is not null then
      return jsonb_build_object('status', 'insufficient_stock', 'variantIds', v_short);
    end if;

    update public.variants v
    set stock = v.stock - oi.quantity
    from public.order_items oi
    where oi.order_id = p_order_id and oi.shop_id = v_shop
      and v.id = oi.variant_id and v.shop_id = v_shop;

    update public.orders
    set status = 'confirmed', confirmed_at = now(), confirmed_by = v_user
    where id = p_order_id and shop_id = v_shop;
  else
    update public.orders
    set status = 'cancelled', cancelled_at = now(), cancelled_by = v_user
    where id = p_order_id and shop_id = v_shop;
  end if;

  return jsonb_build_object(
    'status', p_decision,
    'conversationId', v_order.conversation_id,
    'total', v_order.total
  );
end;
$$;

revoke execute on function public.decide_draft_order(uuid, public.order_status) from public, anon;
grant execute on function public.decide_draft_order(uuid, public.order_status) to authenticated, service_role;
