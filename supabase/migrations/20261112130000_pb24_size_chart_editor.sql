-- PB-24 (Eboiz/Documents#24): the owner edits each product's size chart.
--
-- 1. Ranges of one product may not overlap. recommend_size (PB-06) looks up the
--    size for a height and, separately, the size for a weight, so each value must
--    point to one row: two sizes of a product may not share any height, nor any
--    weight. Bounds are inclusive, the same rule the seed check applies
--    (src/lib/seed/sheet.ts). The server action checks this first to give a clear
--    message; these constraints hold even for a direct API write.
-- 2. public.save_size_chart replaces a product's whole chart in one transaction.
--    Shifting two neighbouring ranges row by row would overlap in between, so
--    the editor saves the chart as a whole.

create extension if not exists btree_gist with schema extensions;

alter table public.size_charts
  add constraint size_charts_height_no_overlap
    exclude using gist (product_id with =, int4range(height_min_cm, height_max_cm, '[]') with &&),
  add constraint size_charts_weight_no_overlap
    exclude using gist (product_id with =, int4range(weight_min_kg, weight_max_kg, '[]') with &&);

-- security invoker: Row Level Security still decides. Staff, another shop or a
-- user without a profile get 42501 from the "owner inserts/deletes" policies;
-- the explicit owner check only makes the error the same whether the product
-- has rows or not. The shop comes from auth.uid(), never from an argument.
--
-- p_rows: [{size, height_min_cm, height_max_cm, weight_min_kg, weight_max_kg}].
-- An empty array clears the chart (recommend_size then answers no_chart).
-- Result: the number of rows saved. Unknown product: P0002.
create function public.save_size_chart(p_product_id uuid, p_rows jsonb)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_shop uuid := (select private.current_shop_id());
  v_count integer;
begin
  if v_shop is null or not (select private.is_owner()) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'rows_not_array' using errcode = '22023';
  end if;

  perform 1 from public.products where id = p_product_id and shop_id = v_shop for update;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  delete from public.size_charts where product_id = p_product_id and shop_id = v_shop;

  insert into public.size_charts (shop_id, product_id, size, height_min_cm, height_max_cm, weight_min_kg, weight_max_kg)
  select v_shop, p_product_id, btrim(r.size), r.height_min_cm, r.height_max_cm, r.weight_min_kg, r.weight_max_kg
  from jsonb_to_recordset(p_rows)
    as r(size text, height_min_cm integer, height_max_cm integer, weight_min_kg integer, weight_max_kg integer);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.save_size_chart(uuid, jsonb) from public, anon;
grant execute on function public.save_size_chart(uuid, jsonb) to authenticated;
