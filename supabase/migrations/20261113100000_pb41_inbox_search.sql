-- PB-41 (Eboiz/Documents#44): search and count the whole inbox on the server.
--
-- The inbox used to load 50 conversations and filter them in the browser, so an
-- older conversation could not be found and the tab counts only covered the 50.
--
-- private.inbox_rows: every conversation of the shop with what the inbox row
--   shows, matching a search term and a channel. The term matches, without
--   case or diacritics ("bui trang" finds "Bùi Trang"), the shopper's name, the
--   newest message and the shopper's own newest message. Not older messages.
-- public.search_inbox: one page of those rows, the queue (needs_human) first,
--   then newest first. Keyset paging: pass the last row's (mode = needs_human,
--   last_message_at, id) as the cursor to get the next page.
-- public.inbox_counts: how many rows each mode tab would show.
--
-- security invoker: Row Level Security still limits rows to the user's shop; the
-- explicit shop_id filter only lets the planner use the shop index.

create function private.inbox_rows(p_query text, p_channel public.channel)
returns table (
  id uuid,
  mode public.conversation_mode,
  channel public.channel,
  display_name text,
  last_message_at timestamptz,
  latest_message text,
  customer_message text,
  customer_message_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with term as (
    select nullif(btrim(lower(extensions.unaccent(coalesce(p_query, '')))), '') as folded
  ), pattern as (
    -- % and _ are LIKE wildcards and \ the escape: a typed "50%" means 50%.
    select folded, '%' || replace(replace(replace(folded, '\', '\\'), '%', '\%'), '_', '\_') || '%' as value
    from term
  )
  select c.id, c.mode, s.channel, s.display_name, c.last_message_at,
    latest.text, customer.text, customer.created_at
  from public.conversations c
  join public.shoppers s on s.id = c.shopper_id
  left join lateral (
    select m.text from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) latest on true
  left join lateral (
    select m.text, m.created_at from public.messages m
    where m.conversation_id = c.id and m.sender = 'shopper'
    order by m.created_at desc, m.id desc
    limit 1
  ) customer on true
  cross join pattern
  where c.shop_id = (select private.current_shop_id())
    and (p_channel is null or s.channel = p_channel)
    and (
      pattern.folded is null
      or lower(extensions.unaccent(coalesce(s.display_name, ''))) like pattern.value escape '\'
      or lower(extensions.unaccent(coalesce(latest.text, ''))) like pattern.value escape '\'
      or lower(extensions.unaccent(coalesce(customer.text, ''))) like pattern.value escape '\'
    )
$$;

revoke execute on function private.inbox_rows(text, public.channel) from public, anon;
grant execute on function private.inbox_rows(text, public.channel) to authenticated;

-- p_mode / p_channel null: every mode / channel. The cursor is all three
-- p_after_* values of the previous page's last row, or all null for page one.
-- p_limit is kept between 1 and 100.
create function public.search_inbox(
  p_query text default null,
  p_mode public.conversation_mode default null,
  p_channel public.channel default null,
  p_after_urgent boolean default null,
  p_after_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  mode public.conversation_mode,
  channel public.channel,
  display_name text,
  last_message_at timestamptz,
  latest_message text,
  customer_message text,
  customer_message_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.mode, r.channel, r.display_name, r.last_message_at,
    r.latest_message, r.customer_message, r.customer_message_at
  from private.inbox_rows(p_query, p_channel) r
  where (p_mode is null or r.mode = p_mode)
    -- Every sort key is descending, so "after the cursor" is one row comparison.
    and (
      p_after_urgent is null or p_after_at is null or p_after_id is null
      or (r.mode = 'needs_human', r.last_message_at, r.id) < (p_after_urgent, p_after_at, p_after_id)
    )
  order by r.mode = 'needs_human' desc, r.last_message_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

revoke execute on function public.search_inbox(text, public.conversation_mode, public.channel, boolean, timestamptz, uuid, integer) from public, anon;
grant execute on function public.search_inbox(text, public.conversation_mode, public.channel, boolean, timestamptz, uuid, integer) to authenticated;

-- One row: the "Tất cả" tab (total) and each mode tab, for the same search and channel.
create function public.inbox_counts(p_query text default null, p_channel public.channel default null)
returns table (total bigint, ai bigint, needs_human bigint, staff bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*),
    count(*) filter (where r.mode = 'ai'),
    count(*) filter (where r.mode = 'needs_human'),
    count(*) filter (where r.mode = 'staff')
  from private.inbox_rows(p_query, p_channel) r
$$;

revoke execute on function public.inbox_counts(text, public.channel) from public, anon;
grant execute on function public.inbox_counts(text, public.channel) to authenticated;
