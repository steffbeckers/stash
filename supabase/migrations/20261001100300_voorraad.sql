-- Het leespad van de voorraad, en de naam-terugvalketen op één plek.
-- Spec §5 van docs/superpowers/specs/2026-10-01-voorraad-design.md.

-- De terugvalketen: de voorkeurstaal, dan Engels, dan de eerste beschikbare.
-- Stond twee keer als inline lateral in search_products; een derde kopie in
-- voorraad() is de plek waar die drie uit elkaar gaan lopen.
--
-- Let op bij het testen: bij de talen en, fr en nl sorteert 'en' alfabetisch
-- toch al eerst, dus de 'en'-tak is vandaag niet waarneembaar. Hij wordt dat
-- pas zodra er een taal bijkomt die vóór 'en' sorteert (zoals 'de').
--
-- security invoker: lezen mag al via de select-policy op product_translation.
create function product_weergavenaam(target_product uuid, voorkeurstaal text)
returns table (weergavenaam text, weergavetaal text)
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select pt.name, pt.locale
    from product_translation pt
   where pt.product_id = target_product
   order by case pt.locale
              when voorkeurstaal then 0
              when 'en' then 1
              else 2
            end, pt.locale
   limit 1;
$$;

revoke all on function product_weergavenaam(uuid, text) from public, anon;
grant execute on function product_weergavenaam(uuid, text) to authenticated;

-- search_products, ongewijzigd in signatuur en gedrag, maar met de
-- terugvalketen uit product_weergavenaam. De volledige uitleg bij de drempel,
-- de schrijfrichting van %> en de stable-markering staat in
-- 20260927100200_search_products.sql en geldt hier onverkort. create or
-- replace met dezelfde signatuur laat de grants van die migratie staan.
create or replace function search_products(
  zoekterm text,
  voorkeurstaal text default 'en',
  maximum int default 20
) returns table (
  product_id    uuid,
  naam          text,
  getoonde_taal text,
  merk          text,
  net_content   numeric,
  unit          text,
  gtin          text,
  status        text,
  score         real
)
  language plpgsql
  stable
  security invoker
  set search_path = public, extensions
as $$
begin
  perform set_config('pg_trgm.word_similarity_threshold', '0.2', true);

  if zoekterm is null or btrim(zoekterm) = '' then
    return query
      select p.id, w.weergavenaam, w.weergavetaal, p.brand, p.net_content, p.unit, p.gtin, p.status, 0::real
        from product p
        cross join lateral product_weergavenaam(p.id, voorkeurstaal) w
       where p.status <> 'rejected'
       order by p.created_at desc, p.id
       limit maximum;
    return;
  end if;

  return query
    with kandidaat as (
      select pt.product_id as id,
             max(word_similarity(zoekterm, pt.name))::real as score
        from product_translation pt
        join product p on p.id = pt.product_id
       where p.status <> 'rejected'
         and pt.name %> zoekterm
       group by pt.product_id
    )
    select p.id, w.weergavenaam, w.weergavetaal, p.brand, p.net_content, p.unit, p.gtin, p.status, k.score
      from kandidaat k
      join product p on p.id = k.id
      cross join lateral product_weergavenaam(k.id, voorkeurstaal) w
     order by k.score desc, w.weergavenaam, p.id
     limit maximum;
end;
$$;

-- De in_stock-items van één huishouden, met de naam in de taal van de
-- gebruiker. security invoker: RLS op inventory_item beslist wat de aanroeper
-- ziet, en een niet-lid krijgt een lege lijst, geen fout. De bewaarplaatsen
-- komen hier bewust niet mee — ook lege plaatsen moeten getoond worden, en
-- die zitten per definitie niet in een itemquery.
create function voorraad(target_household uuid, voorkeurstaal text default 'en')
returns table (
  id               uuid,
  product_id       uuid,
  naam             text,
  getoonde_taal    text,
  merk             text,
  net_content      numeric,
  product_unit     text,
  storage_place_id uuid,
  amount           numeric,
  unit             text,
  acquired_at      date,
  expires_at       date,
  created_at       timestamptz
)
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select i.id, i.product_id, w.weergavenaam, w.weergavetaal, p.brand, p.net_content, p.unit,
         i.storage_place_id, i.amount, i.unit, i.acquired_at, i.expires_at, i.created_at
    from inventory_item i
    join product p on p.id = i.product_id
    cross join lateral product_weergavenaam(p.id, voorkeurstaal) w
   where i.household_id = target_household
     and i.status = 'in_stock'
   order by i.expires_at nulls last, i.created_at, i.id;
$$;

revoke all on function voorraad(uuid, text) from public, anon;
grant execute on function voorraad(uuid, text) to authenticated;
