-- Voorraad: één rij per aankoop-eenheid. Zie
-- docs/superpowers/specs/2026-10-01-voorraad-design.md §3.
--
-- Afwijkingen van de schets in het hoofdontwerp: geen receipt_line_id (die
-- tabel bestaat nog niet; de kolom komt met de scanner), storage_place_id is
-- nullable (alleen bij closed, zie inventory_item_samenhang), en created_at
-- erbij voor een stabiele volgorde binnen een dag.

-- Doel voor de samengestelde FK hieronder. id alleen is al uniek, dus dit
-- legt niets nieuws op — het geeft de FK alleen een adres over precies de
-- twee kolommen die ze vergelijkt.
alter table storage_place
  add constraint storage_place_huishouden_id unique (household_id, id);

create table inventory_item (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references household on delete cascade,
  -- Geen on delete: producten worden nooit verwijderd (spec catalogus §4),
  -- en mocht dat ooit toch gebeuren, dan hoort dat hier te stranden.
  product_id       uuid not null references product,
  storage_place_id uuid,
  amount           numeric not null default 1,
  unit             text not null default 'stuk',
  acquired_at      date not null default current_date,
  expires_at       date,
  status           text not null default 'in_stock',
  closed_at        timestamptz,
  -- Een verwijderd account wist zijn toeschrijving; het afstrepen zelf blijft
  -- gebeurd. Daarom eist de samenhangcheck closed_by niet.
  closed_by        uuid references auth.users on delete set null,
  closed_reason    text,
  created_at       timestamptz not null default now(),

  -- Samengesteld, niet op storage_place(id) alleen: RLS controleert alleen
  -- household_id, en met een gewone FK kan een item in huishouden A naar een
  -- bewaarplaats van huishouden B wijzen.
  --
  -- set null (storage_place_id), niet set null: zonder kolomlijst zou ook
  -- household_id op null gaan. Samen met de plaats-eis in
  -- inventory_item_samenhang maakt dit het verwijderen van een plaats
  -- onmogelijk zolang er voorraad in ligt, terwijl afgestreepte items het
  -- overleven met een lege plaats (spec §4).
  constraint inventory_item_plaats_van_huishouden
    foreign key (household_id, storage_place_id)
    references storage_place (household_id, id)
    on delete set null (storage_place_id),

  constraint inventory_item_hoeveelheid
    check (amount > 0),
  -- Niet dezelfde lijst als product.unit (ml | g | stuk): het product
  -- beschrijft de verpakking, het item de hoeveelheid die er ligt.
  constraint inventory_item_eenheid
    check (unit in ('stuk', 'kg', 'g', 'l', 'ml')),
  -- Overbodig naast inventory_item_samenhang: elke andere status faalt daar al,
  -- dus geen test kan het verdwijnen ervan zien. Blijft als leesbare domeinregel.
  constraint inventory_item_status
    check (status in ('in_stock', 'closed')),
  constraint inventory_item_reden
    check (closed_reason is null or closed_reason in ('consumed', 'discarded')),
  constraint inventory_item_samenhang
    check (
      (status = 'in_stock'
         and storage_place_id is not null
         and closed_at is null and closed_by is null and closed_reason is null)
      or
      (status = 'closed'
         and closed_at is not null and closed_reason is not null)
    )
);

-- RLS aan en alle rechten weg, in dezelfde migratie als de tabel: Supabase
-- geeft anon en authenticated standaard alles op een nieuwe tabel in public.
-- De volgende migratie geeft precies terug wat nodig is.
alter table inventory_item enable row level security;
revoke all on inventory_item from anon, authenticated;

create index inventory_item_voorraad_idx
  on inventory_item (household_id, expires_at) where status = 'in_stock';
create index inventory_item_plaats_idx on inventory_item (storage_place_id);
create index inventory_item_product_idx on inventory_item (product_id);
