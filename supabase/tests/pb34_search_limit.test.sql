-- PB-34 search_take: 20 searches per client per shop, a shop ceiling passed in
-- from the route, and no rights for anon / authenticated.
-- Run with `pnpm db:test` against local Supabase.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- Fixture (as postgres): shop A for the per-client limit, shop B for the shop ceiling.
insert into public.shops (id, name, slug) values
  ('34a00000-0000-4000-8000-000000000001', 'Shop A', 'pb34-shop-a'),
  ('34b00000-0000-4000-8000-000000000001', 'Shop B', 'pb34-shop-b');

-- Twenty searches from one client to one shop pass.
create temp table pb34_results (result text);
do $$
begin
  for i in 1..20 loop
    insert into pb34_results (result)
      values (public.search_take('34a00000-0000-4000-8000-000000000001', 'client-hash-0000000001', 20, 120));
  end loop;
end
$$;
select is(
  (select count(*)::int from pb34_results where result = 'ok'),
  20,
  'the first 20 searches from one client to one shop are allowed'
);
select is(
  public.search_take('34a00000-0000-4000-8000-000000000001', 'client-hash-0000000001', 20, 120),
  'client_shop',
  'the 21st search from the same client is over the per-client limit'
);
select is(
  public.search_take('34a00000-0000-4000-8000-000000000001', 'client-hash-0000000002', 20, 120),
  'ok',
  'another client on the same shop is still allowed'
);

-- A fresh shop with a ceiling of 2: the third call is over the shop limit.
select is(
  public.search_take('34b00000-0000-4000-8000-000000000001', 'client-hash-0000000002', 20, 2),
  'ok',
  'the first search under the shop ceiling is allowed'
);
select is(
  public.search_take('34b00000-0000-4000-8000-000000000001', 'client-hash-0000000002', 20, 2),
  'ok',
  'the second search under the shop ceiling is allowed'
);
select is(
  public.search_take('34b00000-0000-4000-8000-000000000001', 'client-hash-0000000003', 20, 2),
  'shop',
  'a new client is stopped when the shop is at its ceiling'
);

-- ---------------------------------------------------------------- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok($$select 1 from public.search_hits$$, '42501', null, 'anon cannot read search hits');
select throws_ok(
  $$select public.search_take('34a00000-0000-4000-8000-000000000001', 'client-hash-0000000002', 20, 120)$$,
  '42501', null, 'anon cannot run search_take'
);

-- ---------------------------------------------------------------- authenticated
set local role authenticated;
set local request.jwt.claims = '{"sub":"34c00000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok($$select 1 from public.search_hits$$, '42501', null, 'signed-in users cannot read search hits');
select throws_ok(
  $$select public.search_take('34a00000-0000-4000-8000-000000000001', 'client-hash-0000000002', 20, 120)$$,
  '42501', null, 'signed-in users cannot run search_take'
);

reset role;
select * from finish();
rollback;
