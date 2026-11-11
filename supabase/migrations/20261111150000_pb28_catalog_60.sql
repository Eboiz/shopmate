-- PB-28 stage 2. The Hạnh Boutique export now has 60 products: the PO's 30 plus
-- 30 taken from the Mây Boutique catalog under new codes (VAY09..., AO10...,
-- photos are stored by code). The legacy SP31-SP60 rows kept by stage 1 would
-- now show up twice in a search (SP32 and VAY09 are the same dress), so they
-- are removed from the two Hạnh Boutique shops with their dependent catalog rows
-- and test draft orders. Mây Boutique keeps its own SP01-SP60 and their photos.
do $$
begin
  perform id from public.shops where slug in ('hanh-boutique', 'hanh-boutique-eval') for update;
  if exists (
    select 1 from public.orders o
    join public.order_items i on i.order_id = o.id and i.shop_id = o.shop_id
    join public.variants v on v.id = i.variant_id and v.shop_id = i.shop_id
    join public.products p on p.id = v.product_id and p.shop_id = v.shop_id
    join public.shops s on s.id = p.shop_id
    where s.slug in ('hanh-boutique', 'hanh-boutique-eval')
      and p.code ~ '^SP(3[1-9]|[45][0-9]|60)$' and o.status <> 'draft'
  ) then
    raise exception 'Legacy products SP31-SP60 are referenced by decided orders; PB-28 stage 2 cancelled';
  end if;

  delete from public.orders o
  using public.shops s
  where o.shop_id = s.id and s.slug in ('hanh-boutique', 'hanh-boutique-eval')
    and o.status = 'draft' and exists (
      select 1 from public.order_items i
      join public.variants v on v.id = i.variant_id and v.shop_id = i.shop_id
      join public.products p on p.id = v.product_id and p.shop_id = v.shop_id
      where i.order_id = o.id and i.shop_id = o.shop_id and p.code ~ '^SP(3[1-9]|[45][0-9]|60)$'
    );
  delete from public.products p
  using public.shops s
  where p.shop_id = s.id and s.slug in ('hanh-boutique', 'hanh-boutique-eval')
    and p.code ~ '^SP(3[1-9]|[45][0-9]|60)$';
end
$$;
