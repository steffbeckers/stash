-- Geen dubbele toevoeging na een afgebroken verzoek. Spec
-- docs/superpowers/specs/2026-10-10-geen-dubbele-toevoeging-design.md.

-- De client kiest het id van een nieuw item, zodat een nieuwe poging met
-- dezelfde id's op de primaire sleutel botst in plaats van een dubbel te
-- maken. RLS op insert blijft: alleen in een huishouden waar je lid van bent.
grant insert (id) on inventory_item to authenticated;

-- Eén versie van create_product, geen overload naast de oude: de oude
-- handtekening verdwijnt. Blijft security definer, zoals in
-- 20260927100100_product_rpc.sql; dit is geen nieuwe definer-functie.
drop function create_product(text, text, numeric, text, text, text);

create function create_product(
  gtin text,
  brand text,
  net_content numeric,
  unit text,
  locale text,
  name text,
  nieuw_id uuid default null
) returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  new_id uuid;
  actor  uuid := auth.uid();
  niveau int;
  maker  uuid;
begin
  if actor is null then
    raise exception 'niet ingelogd';
  end if;

  if name is null or length(btrim(name)) = 0 then
    raise exception 'naam mag niet leeg zijn';
  end if;

  select trust_level into niveau from user_profile where user_id = actor;

  insert into product (id, gtin, brand, net_content, unit, status, created_by)
  values (
    coalesce(nieuw_id, gen_random_uuid()),
    nullif(btrim(gtin), ''),
    nullif(btrim(brand), ''),
    net_content,
    unit,
    case when coalesce(niveau, 0) >= 1 then 'confirmed' else 'proposed' end,
    actor
  )
  on conflict (id) do nothing
  returning id into new_id;

  if new_id is null then
    -- Alleen mogelijk met nieuw_id: het product bestaat al. Een nieuwe poging
    -- van dezelfde maker krijgt het terug, zonder tweede vertaling;
    -- andermans product nooit.
    select created_by into maker from product where id = nieuw_id;
    if maker is distinct from actor then
      raise exception 'product bestaat al';
    end if;
    return nieuw_id;
  end if;

  insert into product_translation (product_id, locale, name, source)
  values (new_id, locale, btrim(name), 'user');

  return new_id;
end;
$$;

revoke all on function create_product(text, text, numeric, text, text, text, uuid) from public, anon;
grant execute on function create_product(text, text, numeric, text, text, text, uuid) to authenticated;
