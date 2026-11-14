-- Mây Boutique becomes a menswear / unisex shop (products NAM01-NAM30) so that it
-- no longer looks like Hạnh Boutique: Hạnh's catalog already holds 30 of the old
-- SP products under its own codes, and 52 of the 60 old photos were the same
-- pictures. The seed upserts and never deletes, so the old SP01-SP60 rows are
-- removed here from the two Mây Boutique shops, with their dependent catalog rows
-- (cascade) and the test orders that point at them (order_items has no cascade).
-- Both shops are demo data; Hạnh Boutique is not touched.
do $$
begin
  perform id from public.shops where slug in ('may-boutique', 'may-boutique-eval') for update;

  delete from public.orders o
  using public.shops s
  where o.shop_id = s.id and s.slug in ('may-boutique', 'may-boutique-eval')
    and exists (
      select 1 from public.order_items i
      join public.variants v on v.id = i.variant_id and v.shop_id = i.shop_id
      join public.products p on p.id = v.product_id and p.shop_id = v.shop_id
      where i.order_id = o.id and i.shop_id = o.shop_id and p.code ~ '^SP[0-9]{2}$'
    );
  delete from public.products p
  using public.shops s
  where p.shop_id = s.id and s.slug in ('may-boutique', 'may-boutique-eval')
    and p.code ~ '^SP[0-9]{2}$';
end
$$;
