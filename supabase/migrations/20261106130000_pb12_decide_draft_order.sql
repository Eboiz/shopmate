-- The server supplies the verified user id. The function is not callable by a browser.
create function public.decide_draft_order(p_order_id uuid, p_staff_id uuid, p_status public.order_status)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_shop_id uuid;
  v_order public.orders%rowtype;
  v_item record;
begin
  if p_status is null or p_status not in ('confirmed', 'cancelled') then
    raise sqlstate 'PT400' using message = 'invalid_status';
  end if;

  select shop_id into v_shop_id from public.profiles where id = p_staff_id;
  if not found then
    raise sqlstate 'PT403' using message = 'staff_required';
  end if;

  select * into v_order from public.orders
  where id = p_order_id and shop_id = v_shop_id
  for update;
  if not found then
    raise sqlstate 'PT404' using message = 'order_not_found';
  end if;
  if v_order.status <> 'draft' then
    raise sqlstate 'PT409' using message = 'not_draft';
  end if;

  if p_status = 'confirmed' then
    -- Lock variants in the same order even when different orders share stock.
    for v_item in
      select v.id, v.stock, i.quantity
      from public.order_items i
      join public.variants v on v.id = i.variant_id and v.shop_id = i.shop_id
      where i.order_id = v_order.id and i.shop_id = v_shop_id
      order by v.id
      for update of v
    loop
      if v_item.stock < v_item.quantity then
        raise sqlstate 'PT409' using message = 'insufficient_stock';
      end if;
      update public.variants set stock = stock - v_item.quantity
      where id = v_item.id and shop_id = v_shop_id;
    end loop;

    update public.orders set status = p_status, confirmed_by = p_staff_id, confirmed_at = now()
    where id = v_order.id and shop_id = v_shop_id;
  else
    update public.orders set status = p_status, cancelled_by = p_staff_id, cancelled_at = now()
    where id = v_order.id and shop_id = v_shop_id;
  end if;

  return v_order.conversation_id;
end;
$$;

revoke execute on function public.decide_draft_order(uuid, uuid, public.order_status) from public, anon, authenticated;
grant execute on function public.decide_draft_order(uuid, uuid, public.order_status) to service_role;
