-- Zoeken over alle talen tegelijk, één rij per product.
--
-- security invoker, niet definer: lezen is al toegestaan door de
-- select-policy op product en product_translation, dus definer-rechten zouden
-- hier puur extra aanvalsoppervlak zijn. Dezelfde afweging als bij
-- protect_profile_privileges(), dat om die reden van definer naar invoker is
-- teruggezet.
--
-- search_path bevat extensions omdat pg_trgm daar staat en niet in public;
-- zonder die toevoeging is word_similarity() niet vindbaar.
--
-- De drempel gaat van de standaard 0,6 naar 0,2, functie-lokaal. Gemeten:
-- word_similarity('mlek', 'Bio halfvolle melk 1 L') is 0,200 — bij de
-- standaard vindt een typefout dus niets. 'Sojadrink natuur' scoort 0,000 op
-- 'melk', dus 0,2 haalt geen ruis binnen.
create function search_products(
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
  -- Niet als functie-attribuut (`set pg_trgm.word_similarity_threshold = 0.2`):
  -- dat vereist superuser-rechten, en de productie-deploy draait
  -- `supabase db push` als de rol `postgres`, die dat op Supabase niet is.
  -- Nagemeten met die rol: "permission denied to set parameter". Lokaal viel
  -- het niet op omdat `supabase db reset` wél als superuser draait.
  --
  -- set_config(..., true) zet de drempel voor de duur van de transactie en
  -- lekt dus niet naar de rest van de sessie.
  perform set_config('pg_trgm.word_similarity_threshold', '0.2', true);

  if zoekterm is null or btrim(zoekterm) = '' then
    -- Een lege zoekterm geeft de recentste producten, zodat de pagina niet
    -- leeg opent. Een aparte tak, want `where ... or leeg` zou de
    -- trigramindex bij een gevulde zoekterm onbruikbaar maken.
    return query
      select p.id, w.name, w.locale, p.brand, p.net_content, p.unit, p.gtin, p.status, 0::real
        from product p
        cross join lateral (
          select pt.name, pt.locale
            from product_translation pt
           where pt.product_id = p.id
           order by case pt.locale
                      when voorkeurstaal then 0
                      when 'en' then 1
                      else 2
                    end, pt.locale
           limit 1
        ) w
       where p.status <> 'rejected'
       order by p.created_at desc, p.id
       limit maximum;
    return;
  end if;

  return query
    with kandidaat as (
      -- Let op de twee schrijfrichtingen; ze zijn allebei nodig, en niet om
      -- dezelfde reden.
      --
      -- `pt.name %> zoekterm` is de filterkant. gin_trgm_ops registreert %>
      -- en %>> (naast %); de geïndexeerde kolom links schrijven laat de
      -- expressie rechtstreeks op de operatorklasse aansluiten en is de
      -- gangbare vorm. Hier stond eerder dat omgedraaid schrijven
      -- (`zoekterm <% pt.name`) Postgres stilletjes op een sequentiële scan
      -- laat vallen — dat is nagemeten en bleek niet te kloppen: de planner
      -- herschrijft `<%` via zijn geregistreerde commutator naar `%>` en kan
      -- de index dus ook dan gebruiken (nagemeten op Postgres 17.6, met
      -- `enable_seqscan` uit om het kostenmodel niet te laten meespelen). Bij
      -- 2000 rijen koos de planner sowieso een sequentiële scan, ongeacht
      -- richting — de tabel is er gewoon te klein voor. De geïndexeerde
      -- kolom links blijft dus de juiste keuze, maar als conventie en
      -- robuustheid, niet omdat de query er functioneel van afhangt.
      --
      -- `word_similarity(zoekterm, pt.name)` is de scorekant, en die wil de
      -- zoekterm juist als eerste argument: de functie meet hoe goed het
      -- eerste argument past binnen een aaneengesloten stuk van het tweede.
      select pt.product_id as id,
             max(word_similarity(zoekterm, pt.name))::real as score
        from product_translation pt
        join product p on p.id = pt.product_id
       where p.status <> 'rejected'
         and pt.name %> zoekterm
       group by pt.product_id
    )
    select p.id, w.name, w.locale, p.brand, p.net_content, p.unit, p.gtin, p.status, k.score
      from kandidaat k
      join product p on p.id = k.id
      -- Gevonden worden en getoond worden zijn twee dingen. Matchen gebeurt
      -- over alle talen; de naam die je ziet volgt de terugvalketen — jouw
      -- taal, dan Engels, dan de eerste beschikbare — en de functie geeft
      -- terug uit welke taal die naam kwam, zodat de UI kan melden dat je
      -- iets in een andere taal leest.
      cross join lateral (
        select pt.name, pt.locale
          from product_translation pt
         where pt.product_id = k.id
         order by case pt.locale
                    when voorkeurstaal then 0
                    when 'en' then 1
                    else 2
                  end, pt.locale
         limit 1
      ) w
     order by k.score desc, w.name, p.id
     limit maximum;
end;
$$;

revoke all on function search_products(text, text, int) from public, anon;
grant execute on function search_products(text, text, int) to authenticated;
