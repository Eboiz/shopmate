-- PB-03 (Eboiz/Documents#3): search_products for the AI engine (PB-05).
-- "vay suong linen" finds "Váy suông linen": every word of the query, without
-- diacritics and in any order, must appear in the product name or category.

-- Already created by PB-02; repeated so this migration stands on its own.
create extension if not exists unaccent with schema extensions;

-- Called by the server with the secret key only; p_shop_id comes from the
-- engine's context, never from the model.
create function public.engine_search_products(p_shop_id uuid, p_query text, p_limit int)
returns setof public.products
language sql
stable
set search_path = ''
as $$
  select p.*
  from public.products p
  where p.shop_id = p_shop_id
    and not exists (
      select 1
      from unnest(regexp_split_to_array(lower(extensions.unaccent(btrim(p_query))), '\s+')) as w(word)
      where position(w.word in lower(extensions.unaccent(p.name || ' ' || coalesce(p.category, '')))) = 0
    )
  order by p.name
  limit least(greatest(p_limit, 1), 10)
$$;

revoke execute on function public.engine_search_products(uuid, text, int) from public, anon, authenticated;
grant execute on function public.engine_search_products(uuid, text, int) to service_role;
