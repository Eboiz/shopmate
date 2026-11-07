-- Optional activity fixtures for the existing PO demo shop and existing accounts.
-- Run after the catalog seed. Historical orders precede the current inventory
-- snapshot supplied by PO. Their insertion does not represent new stock movement.
-- The reserved external-ID prefix makes the seed identifiable and repeatable.
-- A single DO statement runs atomically through the Supabase CLI query command.
do $$
declare
  target_shop uuid;
  owner_id uuid;
  staff_id uuid;
  namespace constant text := 'demo-activity-v1';
  new_customers integer;
  new_orders integer;
  new_messages integer;
  extra_messages integer;
  ai_needed integer;
  staff_needed integer;
  human_needed integer;
  draft_needed integer;
  confirmed_needed integer;
  cancelled_needed integer;
  modes public.conversation_mode[];
  statuses public.order_status[];
  available_count integer;
  product_ids uuid[];
  shopper_id uuid;
  conversation_id uuid;
  customer_name text;
  customer_phone text;
  customer_address text;
  product public.products%rowtype;
  variant public.variants%rowtype;
  chart public.size_charts%rowtype;
  pairing_name text;
  pairing_reason text;
  customer_text text;
  shop_text text;
  message_text text;
  sender public.message_sender;
  message_reply jsonb;
  product_card jsonb;
  message_count integer;
  topic integer;
  last_at timestamptz;
  first_at timestamptz;
  order_summary text;
  order_total integer;
  order_status public.order_status;
  stock_before text;
  stock_after text;
  first_names text[] := array['An','Bình','Chi','Dung','Giang','Hà','Linh','Mai','Ngọc','Trang'];
  family_names text[] := array['Nguyễn','Trần','Lê','Phạm','Hoàng','Vũ','Đặng','Bùi','Đỗ','Hồ'];
  cities text[] := array['TP.HCM','Hà Nội','Đà Nẵng','Cần Thơ','Hải Phòng'];
begin
  perform pg_advisory_xact_lock(hashtext(namespace || '/hanh-boutique'));
  select id into strict target_shop from public.shops where slug = 'hanh-boutique' for update;
  select u.id into strict owner_id from auth.users u join public.profiles p on p.id = u.id
    where lower(u.email) = 'owner@shopmate.test' and p.shop_id = target_shop and p.role = 'owner';
  select u.id into strict staff_id from auth.users u join public.profiles p on p.id = u.id
    where lower(u.email) = 'staff@shopmate.test' and p.shop_id = target_shop and p.role = 'staff';

  if exists (select 1 from public.shoppers where shop_id = target_shop and external_id like namespace || '-%') then
    raise notice 'Demo activity is already present; existing rows are retained';
    return;
  end if;
  if (select sum(pg_database_size(datname)) from pg_database) >= 400000000 then
    raise exception 'Database is at or above the 400 MB activity-seed guard';
  end if;
  if (select count(*) from public.shoppers where shop_id = target_shop)
    <> (select count(*) from public.conversations where shop_id = target_shop) then
    raise exception 'Existing customer/conversation counts differ; review the activity plan first';
  end if;

  select 100 - count(*) into new_customers from public.shoppers where shop_id = target_shop;
  select 500 - count(*) into new_messages from public.messages where shop_id = target_shop;
  select 50 - count(*) into new_orders from public.orders where shop_id = target_shop;
  select 60 - count(*) filter (where mode = 'ai'), 30 - count(*) filter (where mode = 'staff'),
    10 - count(*) filter (where mode = 'needs_human')
    into ai_needed, staff_needed, human_needed from public.conversations where shop_id = target_shop;
  select 20 - count(*) filter (where status = 'draft'), 25 - count(*) filter (where status = 'confirmed'),
    5 - count(*) filter (where status = 'cancelled')
    into draft_needed, confirmed_needed, cancelled_needed from public.orders where shop_id = target_shop;
  if new_customers < 2 or new_orders < 0 or new_orders > new_customers
    or least(ai_needed, staff_needed, human_needed, draft_needed, confirmed_needed, cancelled_needed) < 0 then
    raise exception 'Existing activity exceeds the planned counts; review before seeding';
  end if;
  if (select count(*) from public.order_items where shop_id = target_shop) + 3 * new_orders <> 150 then
    raise exception 'Existing order-line counts differ from the planned 150 lines';
  end if;
  extra_messages := new_messages - (120 + greatest(new_orders - 2, 0) * 4
    + (new_customers - greatest(new_orders, 2)) * 3);
  if extra_messages < 0 or extra_messages > new_customers - 2 then
    raise exception 'Existing messages leave insufficient room for the planned histories';
  end if;

  select array_agg(mode order by md5(mode::text || n::text)) into modes from (
    select 'ai'::public.conversation_mode as mode, n from generate_series(1, ai_needed) as g(n)
    union all select 'staff'::public.conversation_mode, n from generate_series(1, staff_needed) as g(n)
    union all select 'needs_human'::public.conversation_mode, n from generate_series(1, human_needed) as g(n)
  ) as planned;
  select array_agg(status order by position) into statuses from (
    select 'draft'::public.order_status as status, n as position from generate_series(1, draft_needed) as g(n)
    union all select 'confirmed'::public.order_status, draft_needed + n from generate_series(1, confirmed_needed) as g(n)
    union all select 'cancelled'::public.order_status, draft_needed + confirmed_needed + n from generate_series(1, cancelled_needed) as g(n)
  ) as planned;

  perform id from public.variants where shop_id = target_shop for share;
  select md5(coalesce(jsonb_agg(to_jsonb(v) order by v.id)::text, '')) into stock_before
    from public.variants v where v.shop_id = target_shop;
  select array_agg(id order by code) into product_ids from public.products
    where shop_id = target_shop and code ~ '^(VAY0[1-8]|CV0[1-5]|AO0[1-9]|QUAN0[1-5]|AK0[1-3])$';
  if coalesce(array_length(product_ids, 1), 0) <> 30 then raise exception 'Expected the 30 PO products'; end if;
  select count(*) into available_count from public.variants v
    where v.shop_id = target_shop and v.product_id = any(product_ids) and v.stock > 0;
  if available_count < greatest(3, draft_needed * 3) then raise exception 'Insufficient distinct stocked variants for demo drafts'; end if;

  create temporary table pb28_activity_lines on commit drop as
  with available as (
    select v.id as variant_id, p.id as product_id, p.name, v.size, v.color, p.price,
      row_number() over (order by p.code, v.size, v.color) as position
    from public.variants v join public.products p on p.id = v.product_id and p.shop_id = v.shop_id
    where v.shop_id = target_shop and p.id = any(product_ids) and v.stock > 0
  )
  select n as order_number, line_number, a.variant_id, a.product_id, a.name, a.size, a.color, a.price,
    case when statuses[n] = 'draft' then 1 else 1 + (n + line_number) % 3 end as quantity
  from generate_series(1, new_orders) as orders(n)
  cross join generate_series(1, 3) as lines(line_number)
  join available a on a.position = 1 + ((n - 1) * 3 + line_number - 1) % available_count;

  for n in 1..new_customers loop
    shopper_id := md5(namespace || target_shop::text || '/shopper/' || n)::uuid;
    conversation_id := md5(namespace || target_shop::text || '/conversation/' || n)::uuid;
    customer_name := family_names[1 + (n - 1) % 10] || ' ' || first_names[1 + ((n - 1) / 10) % 10]
      || ' (demo ' || lpad(n::text, 3, '0') || ')';
    customer_phone := '0000000' || lpad(n::text, 3, '0');
    customer_address := format('Địa chỉ demo %s, phường %s, %s', n, 1 + n % 12, cities[1 + (n - 1) % 5]);
    message_count := case when n <= 2 then 60 when n <= new_orders then 4 else 3 end
      + case when n > 2 and n <= extra_messages + 2 then 1 else 0 end;
    last_at := date_trunc('minute', now()) - interval '15 minutes'
      - (n - 1) * interval '89 days' / greatest(new_customers - 1, 1);
    first_at := last_at - (message_count - 1) * interval '4 minutes';

    if n <= new_orders then
      select p.* into strict product from public.products p join pb28_activity_lines l on l.product_id = p.id
        where l.order_number = n and l.line_number = 1;
      select string_agg(format('%s (%s, %s), SL %s', name, size, color, quantity), '; ' order by line_number),
        sum(price * quantity)::integer into order_summary, order_total from pb28_activity_lines where order_number = n;
      order_status := statuses[n];
    else
      select * into strict product from public.products where id = product_ids[1 + (n - 1) % array_length(product_ids, 1)];
      order_status := null;
    end if;
    select * into strict variant from public.variants where product_id = product.id and shop_id = target_shop and stock > 0
      order by stock desc, size, color limit 1;
    select * into strict chart from public.size_charts where product_id = product.id and shop_id = target_shop and size = variant.size;
    select other.name, pair.reason into pairing_name, pairing_reason
      from public.pairings pair join public.products other on other.id = case when pair.product_a_id = product.id then pair.product_b_id else pair.product_a_id end
      where pair.shop_id = target_shop and (pair.product_a_id = product.id or pair.product_b_id = product.id)
        and exists (select 1 from public.variants v where v.product_id = other.id and v.shop_id = target_shop and v.stock > 0)
      order by other.code limit 1;
    product_card := jsonb_build_object('productId', product.id, 'name', product.name, 'price', product.price,
      'imageUrl', product.image_url, 'sizesInStock', (select jsonb_agg(size order by size) from (
        select distinct size from public.variants where product_id = product.id and shop_id = target_shop and stock > 0
      ) as sizes));

    insert into public.shoppers(id, shop_id, channel, external_id, display_name, created_at)
      values(shopper_id, target_shop, 'web', namespace || '-' || lpad(n::text, 3, '0'), customer_name, first_at);
    insert into public.conversations(id, shop_id, shopper_id, mode, last_message_at, created_at)
      values(conversation_id, target_shop, shopper_id, modes[n], last_at, first_at);

    for m in 1..message_count loop
      topic := (n + (m - 1) / 2) % 8;
      case topic
        when 0 then customer_text := format('%s màu %s, size %s còn hàng không shop?', product.name, variant.color, variant.size);
          shop_text := format('Dạ %s màu %s, size %s hiện còn %s chiếc ạ.', product.name, variant.color, variant.size, variant.stock);
        when 1 then customer_text := format('%s giá bao nhiêu vậy shop?', product.name);
          shop_text := format('Dạ %s có giá %sđ, các size và màu cùng giá ạ.', product.name, replace(to_char(product.price, 'FM999,999,999'), ',', '.'));
        when 2 then customer_text := format('Mình cao %scm, nặng %skg, %s mặc size gì?', (chart.height_min_cm + chart.height_max_cm) / 2, (chart.weight_min_kg + chart.weight_max_kg) / 2, product.name);
          shop_text := format('Theo bảng size của %s, bạn có thể chọn size %s ạ.', product.name, chart.size);
        when 3 then customer_text := 'Shop giao về tỉnh mất mấy ngày, phí ship bao nhiêu?';
          shop_text := 'Shop giao toàn quốc trong 2–4 ngày, phí ship đồng giá 30.000đ. Nội thành TP.HCM khoảng 1–2 ngày ạ.';
        when 4 then customer_text := format('%s phối cùng món nào hợp?', product.name);
          shop_text := case when pairing_name is null then 'Mẫu này hiện chưa có món phối còn hàng được shop khai báo ạ.'
            else format('Shop có gợi ý %s. %s.', pairing_name, pairing_reason) end;
        when 5 then customer_text := 'Nếu mặc không vừa mình đổi size được không?';
          shop_text := 'Bạn được đổi size hoặc màu trong 7 ngày khi sản phẩm còn tem mác và chưa giặt. Shop hỗ trợ đổi sản phẩm ạ.';
        when 6 then customer_text := 'Mình thanh toán khi nhận hàng được chứ?';
          shop_text := 'Dạ được, shop hỗ trợ COD hoặc chuyển khoản trước ạ.';
        else customer_text := format('Cho mình xem ảnh và các size còn hàng của %s nhé.', product.name);
          shop_text := format('Mình gửi thông tin %s để bạn tham khảo nhé.', product.name);
      end case;
      sender := case when m % 2 = 1 then 'shopper' when modes[n] = 'staff' then 'staff' else 'ai' end;
      message_text := case when m % 2 = 1 then customer_text else shop_text end;
      if n <= new_orders and m = message_count - 1 then
        sender := 'shopper';
        message_text := case when order_status = 'cancelled' then 'Mình xin hủy phần đặt ' else 'Mình đặt ' end
          || order_summary || format('. Tên %s, số điện thoại %s, %s.', customer_name, customer_phone, customer_address);
      end if;
      if m = message_count then
        if modes[n] = 'needs_human' then
          sender := 'system';
          message_text := 'Mình đã chuyển cuộc trò chuyện cho nhân viên để hỗ trợ bạn tiếp ạ.';
        elsif n <= new_orders then
          sender := 'system';
          message_text := case order_status
            when 'confirmed' then format('Đơn hàng demo đã được nhân viên xác nhận, tổng tiền hàng %sđ.', replace(to_char(order_total, 'FM999,999,999'), ',', '.'))
            when 'cancelled' then 'Đơn hàng demo đã được hủy theo yêu cầu của bạn.'
            else format('Shop đã ghi nhận đơn nháp, tổng tiền hàng %sđ. Nhân viên sẽ kiểm tra và xác nhận giúp bạn.', replace(to_char(order_total, 'FM999,999,999'), ',', '.')) end;
        end if;
      end if;
      message_reply := case when sender = 'shopper' then null else jsonb_build_object('text', message_text,
        'products', case when sender in ('ai', 'staff') and topic in (0, 1, 7) then jsonb_build_array(product_card) else '[]'::jsonb end,
        'quickReplies', case when sender in ('ai', 'staff') then '["Tư vấn size","Xem màu còn hàng"]'::jsonb else '[]'::jsonb end) end;
      insert into public.messages(id, shop_id, conversation_id, sender, text, reply, staff_id, client_message_id, created_at)
        values(md5(namespace || conversation_id::text || '/message/' || m)::uuid, target_shop, conversation_id, sender,
          message_text, message_reply, case when sender = 'staff' then staff_id end,
          namespace || '-' || m, first_at + (m - 1) * interval '4 minutes');
    end loop;

    if n <= new_orders then
      insert into public.orders(id, shop_id, conversation_id, status, customer_name, customer_phone, customer_address,
        total, created_at, confirmed_at, confirmed_by, cancelled_at, cancelled_by)
      values(md5(namespace || target_shop::text || '/order/' || n)::uuid, target_shop, conversation_id, order_status,
        customer_name, customer_phone, customer_address, order_total,
        last_at - case when order_status = 'cancelled' then interval '7 minutes' else interval '3 minutes' end,
        case when order_status = 'confirmed' then last_at end, case when order_status = 'confirmed' then staff_id end,
        case when order_status = 'cancelled' then last_at end, case when order_status = 'cancelled' then staff_id end);
      insert into public.order_items(shop_id, order_id, variant_id, quantity, unit_price)
        select target_shop, md5(namespace || target_shop::text || '/order/' || n)::uuid, variant_id, quantity, price
        from pb28_activity_lines where order_number = n;
    end if;
  end loop;

  select md5(coalesce(jsonb_agg(to_jsonb(v) order by v.id)::text, '')) into stock_after
    from public.variants v where v.shop_id = target_shop;
  if stock_after <> stock_before then raise exception 'Inventory snapshot changed; activity seed cancelled'; end if;
  if (select count(*) from public.shoppers where shop_id = target_shop) <> 100
    or (select count(*) from public.conversations where shop_id = target_shop) <> 100
    or (select count(*) from public.messages where shop_id = target_shop) <> 500
    or (select count(*) from public.orders where shop_id = target_shop) <> 50
    or (select count(*) from public.order_items where shop_id = target_shop) <> 150 then
    raise exception 'Activity counts differ from the agreed targets';
  end if;
  raise notice 'Added % customers, % messages, % orders; agreed totals reached', new_customers, new_messages, new_orders;
end
$$;
