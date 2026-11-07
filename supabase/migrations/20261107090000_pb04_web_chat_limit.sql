-- PB-04: a web chat limit the browser cannot reset.
--
-- PB-17 counts messages per conversation, and a web shopper is just a cookie, so
-- a script that drops the cookie would get a new conversation (and a new AI
-- turn) on every request. The web chat route asks web_chat_take() before it
-- creates a shopper or calls the AI. It counts per client (an HMAC of the IP,
-- never the raw IP) and per shop. The limits are passed in from
-- src/lib/guard/web-chat-limit.ts so the numbers live in one place.

create table public.web_chat_hits (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops (id) on delete cascade,
  client_hash text not null check (length(client_hash) between 16 and 128),
  -- The request had no shopper cookie, so it may create a shopper.
  new_shopper boolean not null,
  created_at timestamptz not null default now()
);
create index web_chat_hits_client on public.web_chat_hits (client_hash, created_at);
create index web_chat_hits_shop on public.web_chat_hits (shop_id, created_at);

-- Server only (secret key). RLS on with no policy, and no grants for API roles.
alter table public.web_chat_hits enable row level security;
revoke all on public.web_chat_hits from anon, authenticated;

-- Returns 'ok' and records the request, or the name of the limit it is over
-- ('client', 'new_shopper', 'shop') and records nothing. One client's requests
-- are serialized by an advisory lock, so two parallel requests can't both pass
-- the last free slot.
create function public.web_chat_take(
  p_shop_id uuid,
  p_client_hash text,
  p_new_shopper boolean,
  p_client_per_minute integer,
  p_new_shoppers_per_hour integer,
  p_shop_per_minute integer
)
returns text
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('web_chat_take:' || p_client_hash, 0));

  if (select count(*) from public.web_chat_hits
      where client_hash = p_client_hash and created_at > now() - interval '1 minute') >= p_client_per_minute then
    return 'client';
  end if;

  if p_new_shopper and (select count(*) from public.web_chat_hits
      where client_hash = p_client_hash and new_shopper and created_at > now() - interval '1 hour') >= p_new_shoppers_per_hour then
    return 'new_shopper';
  end if;

  if (select count(*) from public.web_chat_hits
      where shop_id = p_shop_id and created_at > now() - interval '1 minute') >= p_shop_per_minute then
    return 'shop';
  end if;

  insert into public.web_chat_hits (shop_id, client_hash, new_shopper)
  values (p_shop_id, p_client_hash, p_new_shopper);

  -- Rows older than the longest window are never read again; trim them now and then.
  if random() < 0.01 then
    delete from public.web_chat_hits where created_at < now() - interval '1 day';
  end if;

  return 'ok';
end;
$$;

revoke execute on function public.web_chat_take(uuid, text, boolean, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.web_chat_take(uuid, text, boolean, integer, integer, integer) to service_role;
