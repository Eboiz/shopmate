-- PB-41 inbox search on the server, with two shops: search ignores case and
-- diacritics, % and _ are literal, pages never repeat or skip a row, counts
-- cover the whole shop, another shop's conversations never show. Run with
-- `pnpm db:test` against local Supabase.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Fixture (as postgres).
insert into auth.users (id, email) values
  ('a1111111-0000-0000-0000-000000000041', 'owner-a41@test.local'),
  ('a2222222-0000-0000-0000-000000000041', 'staff-a41@test.local'),
  ('b1111111-0000-0000-0000-000000000041', 'owner-b41@test.local');
insert into public.shops (id, name, slug) values
  ('a0000000-0000-0000-0000-000000000041', 'Shop A41', 'shop-a41'),
  ('b0000000-0000-0000-0000-000000000041', 'Shop B41', 'shop-b41');
insert into public.profiles (id, shop_id, role) values
  ('a1111111-0000-0000-0000-000000000041', 'a0000000-0000-0000-0000-000000000041', 'owner'),
  ('a2222222-0000-0000-0000-000000000041', 'a0000000-0000-0000-0000-000000000041', 'staff'),
  ('b1111111-0000-0000-0000-000000000041', 'b0000000-0000-0000-0000-000000000041', 'owner');

-- Shop A: three named conversations, one per mode, and 25 older AI ones that
-- all share one last_message_at, so paging must break ties by id.
insert into public.shoppers (id, shop_id, channel, external_id, display_name) values
  ('a0000000-0000-0000-0000-0000000041a1', 'a0000000-0000-0000-0000-000000000041', 'web', 'a41-1', 'Bùi Trang'),
  ('a0000000-0000-0000-0000-0000000041a2', 'a0000000-0000-0000-0000-000000000041', 'web', 'a41-2', null),
  ('a0000000-0000-0000-0000-0000000041a3', 'a0000000-0000-0000-0000-000000000041', 'web', 'a41-3', 'Đức Minh');
insert into public.shoppers (id, shop_id, channel, external_id, display_name)
select ('a0000000-0000-0000-0041-' || lpad(n::text, 12, '0'))::uuid, 'a0000000-0000-0000-0000-000000000041', 'web', 'a41-f' || n, 'Khách ' || n
from generate_series(1, 25) n;

insert into public.conversations (id, shop_id, shopper_id, mode, last_message_at) values
  ('a0000000-0000-0000-0000-0000000041c1', 'a0000000-0000-0000-0000-000000000041', 'a0000000-0000-0000-0000-0000000041a1', 'ai', '2026-11-10 09:00+07'),
  ('a0000000-0000-0000-0000-0000000041c2', 'a0000000-0000-0000-0000-000000000041', 'a0000000-0000-0000-0000-0000000041a2', 'needs_human', '2026-11-01 09:00+07'),
  ('a0000000-0000-0000-0000-0000000041c3', 'a0000000-0000-0000-0000-000000000041', 'a0000000-0000-0000-0000-0000000041a3', 'staff', '2026-11-11 09:00+07');
insert into public.conversations (id, shop_id, shopper_id, mode, last_message_at)
select ('a0000000-0000-0000-0041-c' || lpad(n::text, 11, '0'))::uuid, 'a0000000-0000-0000-0000-000000000041',
  ('a0000000-0000-0000-0041-' || lpad(n::text, 12, '0'))::uuid, 'ai', '2026-10-01 09:00+07'
from generate_series(1, 25) n;

insert into public.messages (shop_id, conversation_id, sender, text, created_at) values
  ('a0000000-0000-0000-0000-000000000041', 'a0000000-0000-0000-0000-0000000041c1', 'shopper', 'Váy hoa còn không ạ?', '2026-11-10 08:59+07'),
  ('a0000000-0000-0000-0000-000000000041', 'a0000000-0000-0000-0000-0000000041c1', 'ai', 'Dạ còn ạ', '2026-11-10 09:00+07'),
  ('a0000000-0000-0000-0000-000000000041', 'a0000000-0000-0000-0000-0000000041c2', 'shopper', 'Giảm 50% không shop?', '2026-11-01 08:58+07'),
  ('a0000000-0000-0000-0000-000000000041', 'a0000000-0000-0000-0000-0000000041c2', 'system', 'Đã chuyển cho nhân viên', '2026-11-01 09:00+07'),
  ('a0000000-0000-0000-0000-000000000041', 'a0000000-0000-0000-0000-0000000041c3', 'shopper', 'Mã đơn A1B2 ạ', '2026-11-11 09:00+07');

-- Shop B: a shopper with the same name.
insert into public.shoppers (id, shop_id, channel, external_id, display_name) values
  ('b0000000-0000-0000-0000-0000000041b1', 'b0000000-0000-0000-0000-000000000041', 'web', 'b41-1', 'Bùi Trang');
insert into public.conversations (id, shop_id, shopper_id, mode, last_message_at) values
  ('b0000000-0000-0000-0000-0000000041c1', 'b0000000-0000-0000-0000-000000000041', 'b0000000-0000-0000-0000-0000000041b1', 'needs_human', '2026-11-12 09:00+07');

-- Every id, walking all pages of `p_limit` with the keyset cursor.
create function pg_temp.walk(p_limit integer, p_mode public.conversation_mode default null)
returns setof uuid
language plpgsql
as $$
declare
  r record;
  v_urgent boolean;
  v_at timestamptz;
  v_id uuid;
  v_rows integer;
begin
  loop
    v_rows := 0;
    for r in select * from public.search_inbox(null, p_mode, null, v_urgent, v_at, v_id, p_limit) loop
      v_rows := v_rows + 1;
      v_urgent := r.mode = 'needs_human';
      v_at := r.last_message_at;
      v_id := r.id;
      return next r.id;
    end loop;
    exit when v_rows < p_limit;
  end loop;
end;
$$;

select has_function('public', 'search_inbox',
  array['text', 'conversation_mode', 'channel', 'boolean', 'timestamp with time zone', 'uuid', 'integer'], 'search_inbox exists');
select has_function('public', 'inbox_counts', array['text', 'channel'], 'inbox_counts exists');

-- ---------------------------------------------------------------- staff A
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2222222-0000-0000-0000-000000000041","role":"authenticated"}';

select results_eq(
  $$select id from public.search_inbox('bui trang')$$,
  array['a0000000-0000-0000-0000-0000000041c1'::uuid],
  '"bui trang" finds "Bùi Trang" of this shop only'
);
select results_eq(
  $$select id from public.search_inbox('  ĐỨC  ')$$,
  array['a0000000-0000-0000-0000-0000000041c3'::uuid],
  'case, diacritics, đ and spaces around the term are ignored'
);
select results_eq(
  $$select id from public.search_inbox('vay hoa')$$,
  array['a0000000-0000-0000-0000-0000000041c1'::uuid],
  'the shopper''s newest message matches'
);
select results_eq(
  $$select id from public.search_inbox('chuyen cho nhan vien')$$,
  array['a0000000-0000-0000-0000-0000000041c2'::uuid],
  'the newest message matches even when the shopper did not write it'
);
select results_eq(
  $$select id from public.search_inbox('50%')$$,
  array['a0000000-0000-0000-0000-0000000041c2'::uuid],
  'a typed % matches a literal %'
);
select is_empty($$select id from public.search_inbox('5%')$$, '% is not a wildcard');
select is_empty($$select id from public.search_inbox('a_b')$$, '_ is not a wildcard ("a_b" does not match "A1B2")');
select is_empty($$select id from public.search_inbox('dạ còn', 'staff')$$, 'the mode filter applies with the search');

select results_eq(
  $$select id from public.search_inbox(null, null, null, null, null, null, 3)$$,
  array['a0000000-0000-0000-0000-0000000041c2'::uuid, 'a0000000-0000-0000-0000-0000000041c3', 'a0000000-0000-0000-0000-0000000041c1'],
  'the queue comes first, then newest first'
);
select is(
  (select count(*) from public.search_inbox()),
  28::bigint, 'the default page holds 50: all 28 conversations of shop A'
);
select is(
  (select array_agg(id order by id) from pg_temp.walk(4) w(id)),
  (select array_agg(id order by id) from public.conversations),
  'pages of 4 visit every conversation exactly once, ties included'
);
select is(
  (select count(*) from pg_temp.walk(5, 'ai')),
  26::bigint, 'paging works inside a mode tab'
);

select results_eq(
  $$select total, ai, needs_human, staff from public.inbox_counts()$$,
  $$values (28::bigint, 26::bigint, 1::bigint, 1::bigint)$$,
  'counts cover every conversation, not one page'
);
select results_eq(
  $$select total, ai, needs_human, staff from public.inbox_counts('khach 1')$$,
  $$values (11::bigint, 11::bigint, 0::bigint, 0::bigint)$$,
  'counts follow the search (Khách 1, 10-19)'
);
select results_eq(
  $$select total from public.inbox_counts(null, 'telegram')$$,
  $$values (0::bigint)$$,
  'counts follow the channel'
);

-- ---------------------------------------------------------------- owner B
set local request.jwt.claims = '{"sub":"b1111111-0000-0000-0000-000000000041","role":"authenticated"}';
select results_eq(
  $$select id from public.search_inbox()$$,
  array['b0000000-0000-0000-0000-0000000041c1'::uuid],
  'owner B sees only shop B'
);

-- ---------------------------------------------------------------- anon
reset role;
set local role anon;
select throws_ok($$select * from public.search_inbox('bui')$$, '42501', null, 'anon cannot search the inbox');

select * from finish();
rollback;
