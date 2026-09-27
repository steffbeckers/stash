-- De eerste steen van de gedeelde catalogus. Zie
-- docs/superpowers/specs/2026-09-27-catalogus-producten-design.md.
--
-- Drie kolommen uit het hoofdontwerp staan hier bewust niet: category_id
-- (de tabel bestaat niet), image_url (er is geen uploadpad) en off_synced_at
-- (er is geen import). net_content en unit staan er wél: dat zijn
-- eigenschappen van het ding zelf, en zonder die twee is elke
-- prijsvergelijking een illusie.
create table product (
  id          uuid primary key default gen_random_uuid(),
  gtin        text unique,
  brand       text,
  net_content numeric,
  unit        text,
  status      text not null default 'proposed',
  -- Verdwijnt de maker, dan blijft zijn bijdrage staan maar verliest ze haar
  -- toeschrijving. Gevolg: zo'n product is daarna alleen nog door een
  -- moderator te bewerken, en dat is de juiste afloop.
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),

  constraint product_gtin_vorm
    check (gtin is null or gtin ~ '^([0-9]{8}|[0-9]{12,14})$'),
  constraint product_inhoud_en_eenheid
    check ((net_content is null) = (unit is null)),
  constraint product_inhoud_positief
    check (net_content is null or net_content > 0),
  constraint product_eenheid
    check (unit is null or unit in ('ml', 'g', 'stuk')),
  constraint product_status
    check (status in ('proposed', 'confirmed', 'established', 'rejected'))
);

-- Productnamen staan apart, niet als kolom op product. Halfvolle melk en
-- semi-skimmed milk zijn hetzelfde product, en een name-kolom zou dwingen tot
-- één taal — achteraf uitsplitsen is een pijnlijke migratie precies op het
-- moment dat er al data in zit.
create table product_translation (
  product_id uuid not null references product on delete cascade,
  locale     text not null,
  name       text not null,
  source     text not null,
  primary key (product_id, locale),

  constraint product_translation_locale
    check (locale in ('en', 'nl', 'fr')),
  constraint product_translation_source
    check (source in ('user', 'off', 'machine')),
  constraint product_translation_naam
    check (length(btrim(name)) between 1 and 200)
);

alter table product enable row level security;
alter table product_translation enable row level security;

-- Alleen lezen, en alleen ingelogd. Er komt met opzet gén insert-, update-
-- of delete-policy: de RPC's uit de volgende migratie zijn de enige deur naar
-- binnen, en dat is wat de invariant "elk product heeft minstens één naam"
-- afdwingbaar maakt.
create policy "ingelogde gebruikers mogen de catalogus lezen"
  on product for select to authenticated using (true);

create policy "ingelogde gebruikers mogen productnamen lezen"
  on product_translation for select to authenticated using (true);

-- extensions.gin_trgm_ops voluit: pg_trgm staat in het schema extensions en
-- niet in public (zie 20260923063000_move_pg_trgm_to_extensions.sql), dus de
-- operatorklasse is niet vindbaar via de standaard search_path van een
-- migratie.
create index product_translation_naam_trgm
  on product_translation using gin (name extensions.gin_trgm_ops);

create index product_status_idx on product (status);
create index product_created_by_idx on product (created_by);

-- De invariant die geen check-constraint kan zijn: die ziet één rij, en dit
-- gaat over de vraag of er nog een andere overblijft. Zelfde vorm als
-- prevent_last_owner_removal() voor de laatste eigenaar van een huishouden.
--
-- security invoker, niet definer: deze functie bevraagt alleen tabellen die
-- de aanroeper sowieso mag lezen. Vergelijk protect_profile_privileges(), dat
-- om precies die reden van definer naar invoker is teruggezet.
create function prevent_last_translation_removal() returns trigger
  language plpgsql
  security invoker
  set search_path = public
as $$
begin
  -- Onderscheid tussen een losse verwijdering en een cascade. Gemeten: bij
  -- `delete from product_translation` bestaat het product nog, bij een
  -- cascade vanaf `delete from product` is het al weg. Zonder dit
  -- onderscheid zou de trigger elke productverwijdering blokkeren.
  if not exists (select 1 from product where id = old.product_id) then
    return old;
  end if;

  if not exists (
    select 1 from product_translation
     where product_id = old.product_id and locale is distinct from old.locale
  ) then
    raise exception 'een product houdt minstens één naam';
  end if;

  return old;
end;
$$;

create trigger prevent_last_translation_removal_trigger
  before delete on product_translation
  for each row execute function prevent_last_translation_removal();

-- Triggerfuncties bestaan alleen om door de trigger aangeroepen te worden;
-- rechtstreeks aanroepbaar zijn ze puur aanvalsoppervlak. Zelfde behandeling
-- als in 20260924180000_revoke_trigger_function_grants.sql.
revoke all on function prevent_last_translation_removal() from public, anon, authenticated;
