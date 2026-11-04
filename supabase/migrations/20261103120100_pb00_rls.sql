-- PB-00 (Eboiz/Documents#25): Row Level Security and grants.
--
-- Who can do what through the Supabase API:
--   * anon (shoppers): nothing. Shoppers only go through the server API.
--   * authenticated (owner/staff): read rows of their own shop. Only the owner
--     edits the catalog (products, variants, size charts, pairings, policies; PB-16 A4).
--     Owner and staff may change conversations.mode (take over / hand back, PB-13).
--   * Everything else (AI replies, webhooks, draft orders, channel tokens, the AI
--     turn log) is written by the server with the secret key, which bypasses RLS.
--     That code must filter by shop_id itself.
--
-- Grants are written out instead of relying on Supabase's defaults, and RLS
-- filters rows on top of them. RLS cannot limit columns, so column grants do.

-- Helpers live outside the exposed `public` schema so the API never serves them as RPC.
create schema private;
grant usage on schema private to authenticated;

create function private.current_shop_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select shop_id from public.profiles where id = (select auth.uid())
$$;

create function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select role = 'owner' from public.profiles where id = (select auth.uid())),
    false
  )
$$;

revoke execute on function private.current_shop_id(), private.is_owner() from public, anon;
grant execute on function private.current_shop_id(), private.is_owner() to authenticated;

alter table public.shops enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.variants enable row level security;
alter table public.size_charts enable row level security;
alter table public.pairings enable row level security;
alter table public.policies enable row level security;
alter table public.channel_accounts enable row level security;
alter table public.shoppers enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.channel_events enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.ai_turns enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

-- Tables and functions that later migrations create get no rights for anon or
-- authenticated either. Each migration grants what it needs (see README).
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

grant select on
  public.shops, public.profiles,
  public.products, public.variants, public.size_charts, public.pairings, public.policies,
  public.conversations, public.messages,
  public.orders, public.order_items
to authenticated;

-- external_id of a web shopper is their cookie value: staff never read it.
grant select (id, shop_id, channel, channel_account_id, display_name, created_at)
  on public.shoppers to authenticated;

-- Catalog writes (policies below limit them to the owner). Updates are limited to
-- business columns, so nobody rewrites an id, a shop_id's history or created_at.
grant insert, delete on
  public.products, public.variants, public.size_charts, public.pairings, public.policies
to authenticated;
grant update (code, name, category, price, description, image_url) on public.products to authenticated;
grant update (size, color, stock) on public.variants to authenticated;
grant update (size, height_min_cm, height_max_cm, weight_min_kg, weight_max_kg) on public.size_charts to authenticated;
grant update (reason) on public.pairings to authenticated;
grant update (content) on public.policies to authenticated;

grant update (mode) on public.conversations to authenticated;

-- channel_accounts, channel_events, ai_turns: no grant, no policy -> server only.

create policy "read own shop" on public.shops
  for select to authenticated
  using (id = (select private.current_shop_id()));

create policy "read own shop" on public.profiles
  for select to authenticated
  using (shop_id = (select private.current_shop_id()));

-- Catalog: everyone in the shop reads, only the owner writes.
do $$
declare
  t text;
begin
  foreach t in array array['products', 'variants', 'size_charts', 'pairings', 'policies'] loop
    execute format(
      'create policy "read own shop" on public.%I for select to authenticated
         using (shop_id = (select private.current_shop_id()))', t);
    execute format(
      'create policy "owner inserts" on public.%I for insert to authenticated
         with check (shop_id = (select private.current_shop_id()) and (select private.is_owner()))', t);
    execute format(
      'create policy "owner updates" on public.%I for update to authenticated
         using (shop_id = (select private.current_shop_id()) and (select private.is_owner()))
         with check (shop_id = (select private.current_shop_id()) and (select private.is_owner()))', t);
    execute format(
      'create policy "owner deletes" on public.%I for delete to authenticated
         using (shop_id = (select private.current_shop_id()) and (select private.is_owner()))', t);
  end loop;

  foreach t in array array['shoppers', 'conversations', 'messages', 'orders', 'order_items'] loop
    execute format(
      'create policy "read own shop" on public.%I for select to authenticated
         using (shop_id = (select private.current_shop_id()))', t);
  end loop;
end
$$;

-- Owner and staff take over / hand back; the column grant limits this to `mode`.
create policy "staff set mode" on public.conversations
  for update to authenticated
  using (shop_id = (select private.current_shop_id()))
  with check (shop_id = (select private.current_shop_id()));
