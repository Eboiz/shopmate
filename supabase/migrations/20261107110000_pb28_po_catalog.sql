-- PB-28 stage 1. Preserve shop IDs, existing users and channel bindings while
-- replacing the legacy SP01-SP30 catalog with the PO's sheet.
-- SP31-SP60 are retained pending PO review.
do $$
declare
  target record;
  legacy_shop uuid;
begin
  for target in select * from (values
    ('may-boutique', 'hanh-boutique', 'Hạnh Boutique'),
    ('may-boutique-eval', 'hanh-boutique-eval', 'Hạnh Boutique (eval)')
  ) as shops(old_slug, new_slug, new_name)
  loop
    select id into legacy_shop from public.shops where slug = target.old_slug for update;
    if found then
      if exists (select 1 from public.shops where slug = target.new_slug and id <> legacy_shop) then
        raise exception 'Both % and % exist; resolve shop ownership before PB-28', target.old_slug, target.new_slug;
      end if;
      update public.shops set slug = target.new_slug, name = target.new_name where id = legacy_shop;
    end if;
  end loop;

  perform id from public.shops where slug in ('hanh-boutique', 'hanh-boutique-eval') for update;
  if exists (
    select 1 from public.orders o
    join public.order_items i on i.order_id = o.id and i.shop_id = o.shop_id
    join public.variants v on v.id = i.variant_id and v.shop_id = i.shop_id
    join public.products p on p.id = v.product_id and p.shop_id = v.shop_id
    join public.shops s on s.id = p.shop_id
    where s.slug in ('hanh-boutique', 'hanh-boutique-eval')
      and p.code ~ '^SP(0[1-9]|[12][0-9]|30)$' and o.status <> 'draft'
  ) then
    raise exception 'Legacy products are referenced by decided orders; PB-28 cleanup cancelled';
  end if;

  delete from public.orders o
  using public.shops s
  where o.shop_id = s.id and s.slug in ('hanh-boutique', 'hanh-boutique-eval')
    and o.status = 'draft' and exists (
      select 1 from public.order_items i
      join public.variants v on v.id = i.variant_id and v.shop_id = i.shop_id
      join public.products p on p.id = v.product_id and p.shop_id = v.shop_id
      where i.order_id = o.id and i.shop_id = o.shop_id and p.code ~ '^SP(0[1-9]|[12][0-9]|30)$'
    );
  delete from public.products p
  using public.shops s
  where p.shop_id = s.id and s.slug in ('hanh-boutique', 'hanh-boutique-eval')
    and p.code ~ '^SP(0[1-9]|[12][0-9]|30)$';
end
$$;
