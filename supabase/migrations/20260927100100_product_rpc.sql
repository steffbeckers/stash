-- Schrijven gaat uitsluitend hierlangs. Op product en product_translation
-- staat geen insert-, update- of delete-policy, dus deze functies zijn de
-- enige deur — en dat is wat de invariant "elk product heeft minstens één
-- naam" afdwingbaar maakt. Een policy kan dat niet: die beoordeelt één rij,
-- en de invariant gaat over een paar.
--
-- security definer is daarom hier nodig, en alleen hier. De zoekfunctie uit
-- de volgende migratie is invoker, want lezen mag al via de select-policy.

-- Wie mag er aan dit product komen? De maker, of iemand met een
-- moderatiebevoegdheid. Die twee assen zijn bewust gescheiden (spec §2):
-- trust_level is verdiend en bepaalt de status van wat je aanmaakt, role is
-- toegekend en bepaalt of je aan andermans gegevens mag.
create function mag_product_bewerken(target_product uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from product
     where id = target_product and created_by = auth.uid()
  ) or exists (
    select 1 from user_profile
     where user_id = auth.uid() and role in ('moderator', 'admin')
  );
$$;

create function create_product(
  gtin text,
  brand text,
  net_content numeric,
  unit text,
  locale text,
  name text
) returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  new_id uuid;
  actor  uuid := auth.uid();
  niveau int;
begin
  if actor is null then
    raise exception 'niet ingelogd';
  end if;

  if name is null or length(btrim(name)) = 0 then
    raise exception 'naam mag niet leeg zijn';
  end if;

  select trust_level into niveau from user_profile where user_id = actor;

  insert into product (gtin, brand, net_content, unit, status, created_by)
  values (
    nullif(btrim(gtin), ''),
    nullif(btrim(brand), ''),
    net_content,
    unit,
    case when coalesce(niveau, 0) >= 1 then 'confirmed' else 'proposed' end,
    actor
  )
  returning id into new_id;

  insert into product_translation (product_id, locale, name, source)
  values (new_id, locale, btrim(name), 'user');

  return new_id;
end;
$$;

create function update_product(
  target_product uuid,
  gtin text,
  brand text,
  net_content numeric,
  unit text
) returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'niet ingelogd';
  end if;

  if not mag_product_bewerken(target_product) then
    raise exception 'alleen de maker of een moderator mag dit product bewerken';
  end if;

  update product
     set gtin        = nullif(btrim(update_product.gtin), ''),
         brand       = nullif(btrim(update_product.brand), ''),
         net_content = update_product.net_content,
         unit        = update_product.unit
   where id = target_product;

  -- Zonder deze controle slaagt een oproep op een onbekend product stil.
  if not found then
    raise exception 'dat product bestaat niet';
  end if;
end;
$$;

-- Upsert: bestaat er al een naam in die taal, dan wordt hij vervangen. In
-- beide gevallen source = 'user', want in beide gevallen heeft een mens hem
-- ingetikt.
--
-- #variable_conflict use_column: de conflict-doellijst hieronder (product_id,
-- locale) staat geen kwalificatie toe — ON CONFLICT accepteert alleen kale
-- kolomnamen van de doeltabel, nooit function.parameter. Zonder deze regel
-- botst de kolom product_translation.locale daar met de gelijknamige
-- parameter en meldt Postgres "column reference is ambiguous". De parameter
-- moet locale heten (niet hernoemen): Taak 4's composable roept de RPC aan
-- met named parameters die letterlijk met deze namen moeten overeenkomen.
create function set_product_translation(target_product uuid, locale text, name text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'niet ingelogd';
  end if;

  if not mag_product_bewerken(target_product) then
    raise exception 'alleen de maker of een moderator mag dit product bewerken';
  end if;

  if name is null or length(btrim(name)) = 0 then
    raise exception 'naam mag niet leeg zijn';
  end if;

  insert into product_translation (product_id, locale, name, source)
  values (target_product, set_product_translation.locale, btrim(name), 'user')
  on conflict (product_id, locale)
  do update set name = excluded.name, source = excluded.source;
end;
$$;

create function remove_product_translation(target_product uuid, locale text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'niet ingelogd';
  end if;

  if not mag_product_bewerken(target_product) then
    raise exception 'alleen de maker of een moderator mag dit product bewerken';
  end if;

  -- De trigger prevent_last_translation_removal weigert de laatste naam. Dat
  -- is de echte bewaking; hier wordt alleen de verwijdering uitgevoerd.
  delete from product_translation
   where product_id = target_product
     and product_translation.locale = remove_product_translation.locale;

  if not found then
    raise exception 'dat product heeft geen naam in die taal';
  end if;
end;
$$;

-- Bewust los van update_product: bewerken mag de maker, herbeoordelen alleen
-- een moderator. Samenvoegen zou die twee rechtencontroles in één functie
-- persen die dan allebei moeten kloppen.
create function set_product_status(target_product uuid, new_status text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'niet ingelogd';
  end if;

  if not exists (
    select 1 from user_profile
     where user_id = auth.uid() and role in ('moderator', 'admin')
  ) then
    raise exception 'alleen een moderator mag de status wijzigen';
  end if;

  if new_status not in ('proposed', 'confirmed', 'established', 'rejected') then
    raise exception 'onbekende status';
  end if;

  update product set status = new_status where id = target_product;

  if not found then
    raise exception 'dat product bestaat niet';
  end if;
end;
$$;

-- Supabase geeft nieuwe functies zowel via de PUBLIC-pseudorol als
-- rechtstreeks een execute-grant aan anon. `revoke ... from public` alleen
-- laat die directe grant intact, dus anon moet expliciet genoemd worden.
revoke all on function mag_product_bewerken(uuid) from public, anon, authenticated;

revoke all on function create_product(text, text, numeric, text, text, text) from public, anon;
grant execute on function create_product(text, text, numeric, text, text, text) to authenticated;

revoke all on function update_product(uuid, text, text, numeric, text) from public, anon;
grant execute on function update_product(uuid, text, text, numeric, text) to authenticated;

revoke all on function set_product_translation(uuid, text, text) from public, anon;
grant execute on function set_product_translation(uuid, text, text) to authenticated;

revoke all on function remove_product_translation(uuid, text) from public, anon;
grant execute on function remove_product_translation(uuid, text) to authenticated;

revoke all on function set_product_status(uuid, text) from public, anon;
grant execute on function set_product_status(uuid, text) to authenticated;
