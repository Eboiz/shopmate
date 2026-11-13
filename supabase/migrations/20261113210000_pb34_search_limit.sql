-- PB-34: a search bar limit the browser cannot reset.
--
-- A web shopper is only a cookie, so the search route counts per client (an
-- HMAC of the IP, never the raw IP) and per shop, in Postgres, because
-- serverless instances share no memory. The route asks search_take() before it
-- calls the embedder. The limits are passed in from
-- src/lib/guard/search-limit.ts so the numbers live in one place.

create table public.search_hits (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  client_hash text not null check (length(client_hash) between 16 and 128),
  created_at timestamptz not null default now()
);
create index search_hits_client_shop on public.search_hits (client_hash, shop_id, created_at);
create index search_hits_shop on public.search_hits (shop_id, created_at);

-- Server only (secret key). RLS on with no policy, and no grants for API roles.
alter table public.search_hits enable row level security;
revoke all on public.search_hits from anon, authenticated;

-- Returns 'ok' and records the search, or 'client_shop' / 'shop' and records
-- nothing. Advisory locks (client first, then shop: always the same order)
-- serialize the checks, so two parallel requests can't both pass the last free
-- slot. Text and photo searches share the same budget.
create function public.search_take(
  p_shop_id uuid,
  p_client_hash text,
  p_client_shop_per_minute integer,
  p_shop_per_minute integer
)
returns text
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('search_take:' || p_client_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('search_take:' || p_shop_id::text, 0));

  -- One client may use only a part of a shop's ceiling, so a few IPs can't
  -- block search for everyone else.
  if (select count(*) from public.search_hits
      where client_hash = p_client_hash and shop_id = p_shop_id
        and created_at > now() - interval '1 minute') >= p_client_shop_per_minute then
    return 'client_shop';
  end if;

  if (select count(*) from public.search_hits
      where shop_id = p_shop_id and created_at > now() - interval '1 minute') >= p_shop_per_minute then
    return 'shop';
  end if;

  insert into public.search_hits (shop_id, client_hash)
  values (p_shop_id, p_client_hash);

  -- Rows older than the longest window are never read again; trim them now and then.
  if random() < 0.01 then
    delete from public.search_hits where created_at < now() - interval '1 day';
  end if;

  return 'ok';
end;
$$;

revoke execute on function public.search_take(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.search_take(uuid, text, integer, integer) to service_role;
