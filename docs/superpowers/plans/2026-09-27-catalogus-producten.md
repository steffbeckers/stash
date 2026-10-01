# Productcatalogus — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een gedeelde productcatalogus die een ingelogde gebruiker kan doorzoeken over drie talen heen, waar hij producten aan toevoegt met een naam in zijn eigen taal, en waar hij namen in de andere talen bij kan zetten.

**Architecture:** Twee tabellen (`product`, `product_translation`) met RLS die alleen lezen toestaat. Schrijven gaat uitsluitend via vijf `SECURITY DEFINER`-RPC's, want de invariant "elk product heeft minstens één naam" gaat over een paar rijen en kan geen policy zijn. Zoeken gaat via één `SECURITY INVOKER`-functie op trigram-woordgelijkenis. De client is dun: een composable om de RPC's heen en drie pagina's.

**Tech Stack:** Nuxt 4, @nuxt/ui 4, @nuxtjs/i18n 10, @nuxtjs/supabase 2, Postgres met `pg_trgm`, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-27-catalogus-producten-design.md`

## Global Constraints

- **Routepaden komen altijd uit `routes.config.ts`**, via `routePath(route, locale)` — in productiecode én in tests. Nooit een pad met de hand typen.
- **`localePath()` wil een routenaam, geen pad.** De bestandssleutel `products/new` wordt de routenaam `products-new`, `products/[id]` wordt `products-id`. Let op het koppelteken.
- **Elke nieuwe i18n-sleutel gaat in alle drie de bestanden** (`i18n/locales/en.json`, `nl.json`, `fr.json`). `test/i18n/locales.test.ts` dwingt identieke sleutels af én weigert lege waarden.
- **Commentaar, testnamen en foutmeldingen in het Nederlands**, zoals de rest van het project.
- **Mobiele testviewport is 360×740.**
- **`useSupabaseUser()` geeft het JWT-payload**: het gebruikers-id staat op `.sub`, niet op `.id`.
- **Fouten worden nooit stil ingeslikt.**
- **`pg_trgm` staat in het schema `extensions`, niet in `public`.** Elke functie die `word_similarity()` gebruikt heeft `set search_path = public, extensions` nodig, en elke index-declaratie schrijft `extensions.gin_trgm_ops` voluit.
- **De geïndexeerde kolom staat links van `%>`.** `gin_trgm_ops` ondersteunt alleen `%`, `%>` en `%>>` — de commutatoren. `name %> zoekterm` gebruikt de index; `zoekterm <% name` doet stilletjes een sequentiële scan.
- **Nieuwe functies krijgen `revoke all ... from public, anon` en daarna `grant execute ... to authenticated`.** Supabase geeft nieuwe functies zowel via de PUBLIC-pseudorol als rechtstreeks een grant aan `anon`; `revoke from public` alleen laat die directe grant staan.

## Bestandsstructuur

**Nieuw:**

| Bestand | Verantwoordelijkheid |
|---|---|
| `supabase/migrations/20260927100000_product.sql` | Tabellen, constraints, RLS, indexen, de laatste-naam-trigger |
| `supabase/migrations/20260927100100_product_rpc.sql` | De vijf schrijffuncties en hun rechten |
| `supabase/migrations/20260927100200_search_products.sql` | De zoekfunctie |
| `app/composables/useProducts.ts` | Client-zijde om de RPC's en de zoekfunctie heen |
| `app/pages/products/index.vue` | Zoeken en de resultatenlijst |
| `app/pages/products/new.vue` | Een product aanmaken |
| `app/pages/products/[id].vue` | Productpagina: gegevens, vertalingen, bewerken |
| `test/db/product.test.ts` | Schema, RLS en de vijf RPC's |
| `test/db/product-search.test.ts` | Het zoekgedrag |
| `e2e/products.spec.ts` | De hele weg door de browser |

**Gewijzigd:** `routes.config.ts`, `i18n/locales/{en,nl,fr}.json`, `app/components/AppHeader.vue`, `app/types/database.types.ts`, `e2e/mobile.spec.ts`, `docs/superpowers/open-bevindingen.md`.

---

### Task 1: Tabellen, RLS en de laatste-naam-trigger

**Files:**
- Create: `supabase/migrations/20260927100000_product.sql`
- Create: `test/db/product.test.ts`

**Interfaces:**
- Consumes: niets uit eerdere taken.
- Produces: de tabellen `product` en `product_translation` met de constraints uit de spec, een select-policy voor `authenticated` op beide, een GIN-trigramindex op `product_translation.name`, en de trigger `prevent_last_translation_removal_trigger`. Taak 2 bouwt zijn RPC's hierop.

- [ ] **Step 1: Schrijf de falende tests**

`test/db/product.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('product', () => {
  beforeEach(resetDb)

  it('weigert een barcode die geen geldige lengte heeft', async () => {
    await withDb(async (sql) => {
      await expect(
        sql`insert into product (gtin) values ('12345')`,
      ).rejects.toThrow(/product_gtin_vorm/)
    })
  })

  it('laat een barcode van dertien cijfers toe', async () => {
    await withDb(async (sql) => {
      await sql`insert into product (gtin) values ('5400101234567')`
      const [row] = await sql<{ gtin: string }[]>`select gtin from product`
      expect(row!.gtin).toBe('5400101234567')
    })
  })

  // Een inhoud zonder eenheid is geen gegeven maar ruis: 1000 wát?
  it('weigert een inhoud zonder eenheid', async () => {
    await withDb(async (sql) => {
      await expect(
        sql`insert into product (net_content) values (1000)`,
      ).rejects.toThrow(/product_inhoud_en_eenheid/)
    })
  })

  it('weigert een eenheid zonder inhoud', async () => {
    await withDb(async (sql) => {
      await expect(
        sql`insert into product (unit) values ('ml')`,
      ).rejects.toThrow(/product_inhoud_en_eenheid/)
    })
  })

  it('laat inhoud en eenheid samen toe', async () => {
    await withDb(async (sql) => {
      await sql`insert into product (net_content, unit) values (1000, 'ml')`
      const [row] = await sql<{ net_content: string }[]>`select net_content from product`
      expect(Number(row!.net_content)).toBe(1000)
    })
  })

  // Zonder deze grens fragmenteert 'EN' of 'nl-BE' de catalogus stilzwijgend:
  // twee rijen die voor Postgres verschillen en voor een mens hetzelfde zijn.
  it('weigert een taalcode die we niet voeren', async () => {
    await withDb(async (sql) => {
      const [p] = await sql<{ id: string }[]>`insert into product default values returning id`
      await expect(
        sql`insert into product_translation (product_id, locale, name, source)
            values (${p!.id}, 'de', 'Milch', 'user')`,
      ).rejects.toThrow(/product_translation_locale/)
    })
  })

  it('weigert een lege naam', async () => {
    await withDb(async (sql) => {
      const [p] = await sql<{ id: string }[]>`insert into product default values returning id`
      await expect(
        sql`insert into product_translation (product_id, locale, name, source)
            values (${p!.id}, 'nl', '   ', 'user')`,
      ).rejects.toThrow(/product_translation_naam/)
    })
  })

  // De invariant uit spec §3. Een check-constraint kan dit niet: die ziet één
  // rij, en dit gaat over de vraag of er nog een andere rij overblijft.
  it('weigert het verwijderen van de laatste naam', async () => {
    await withDb(async (sql) => {
      const [p] = await sql<{ id: string }[]>`insert into product default values returning id`
      await sql`insert into product_translation (product_id, locale, name, source)
                values (${p!.id}, 'nl', 'Melk', 'user')`
      await expect(
        sql`delete from product_translation where product_id = ${p!.id}`,
      ).rejects.toThrow(/minstens één naam/)
    })
  })

  // De falsificatie van de test hierboven: zonder dit geval zou een trigger
  // die élke verwijdering weigert er net zo groen uitzien.
  it('laat het verwijderen van een naam toe zolang er een andere blijft', async () => {
    await withDb(async (sql) => {
      const [p] = await sql<{ id: string }[]>`insert into product default values returning id`
      await sql`insert into product_translation (product_id, locale, name, source)
                values (${p!.id}, 'nl', 'Melk', 'user'), (${p!.id}, 'en', 'Milk', 'user')`
      await sql`delete from product_translation where product_id = ${p!.id} and locale = 'en'`
      const rows = await sql`select 1 from product_translation where product_id = ${p!.id}`
      expect(rows.length).toBe(1)
    })
  })

  // De trigger mag een cascade niet blokkeren. Gemeten gedrag: bij een losse
  // verwijdering bestaat het product nog, bij een cascade is het al weg —
  // daarop onderscheidt de trigger de twee gevallen.
  it('laat het verwijderen van een product zijn namen meenemen', async () => {
    await withDb(async (sql) => {
      const [p] = await sql<{ id: string }[]>`insert into product default values returning id`
      await sql`insert into product_translation (product_id, locale, name, source)
                values (${p!.id}, 'nl', 'Melk', 'user')`
      await sql`delete from product where id = ${p!.id}`
      const rows = await sql`select 1 from product_translation where product_id = ${p!.id}`
      expect(rows.length).toBe(0)
    })
  })

  it('laat een ingelogde gebruiker de catalogus lezen', async () => {
    const userId = await createUser('lezer@example.com')
    await withDb(async (sql) => {
      const [p] = await sql<{ id: string }[]>`insert into product default values returning id`
      await sql`insert into product_translation (product_id, locale, name, source)
                values (${p!.id}, 'nl', 'Melk', 'user')`
    })
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const rows = await tx`select id from product`
      expect(rows.length).toBe(1)
    })
  })

  // Spec §2: het hoofdontwerp zegt "open voor iedereen", maar er is geen
  // pagina die een uitgelogde bezoeker kan bereiken. anon-leesrecht zou dus
  // aanvalsoppervlak zijn zonder gebruiker.
  it('laat anon de catalogus niet lezen', async () => {
    await withDb(async (sql) => {
      await sql`insert into product default values`
    })
    await withTx(async (tx) => {
      await enableRls(tx, 'anon')
      const rows = await tx`select id from product`
      expect(rows.length).toBe(0)
    })
  })

  // Er is geen insert-policy. Zonder deze test zou iemand er later een
  // toevoegen "omdat het handiger is", en dan staat de invariant uit §3 open.
  it('weigert een rechtstreekse insert buiten de RPC om', async () => {
    const userId = await createUser('insteker@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await expect(tx`insert into product default values`).rejects.toThrow(/row-level security/)
    })
  })
})
```

- [ ] **Step 2: Draai de tests en controleer dat ze falen**

Run: `npm run test:db -- product`
Expected: alle gevallen FALEN met een melding dat de relatie `product` niet bestaat.

- [ ] **Step 3: Schrijf de migratie**

`supabase/migrations/20260927100000_product.sql`:

```sql
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

-- Alleen lezen, en alleen ingelogd. Er komt met opzet géén insert-, update-
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
```

- [ ] **Step 4: Pas de migratie toe**

Run: `npx supabase migration up`
Expected: toegepast zonder fout. Loopt de lokale stack uit de pas, gebruik dan `npx supabase db reset`.

- [ ] **Step 5: Draai de tests opnieuw**

Run: `npm run test:db -- product`
Expected: alle gevallen SLAGEN.

- [ ] **Step 6: Falsificeer de cascade-uitzondering**

Haal de drie regels met `if not exists (select 1 from product ...) then return old; end if;` tijdelijk uit de functie, pas de wijziging toe met `npx supabase db reset`, en draai de tests.

Run: `npm run test:db -- product`
Expected: `laat het verwijderen van een product zijn namen meenemen` wordt ROOD. Blijft hij groen, dan doet die uitzondering niets en klopt de redenering erachter niet. Zet daarna terug.

- [ ] **Step 7: Werk de gegenereerde types bij**

Run: `npx supabase gen types typescript --local > app/types/database.types.ts`
Expected: `product` en `product_translation` staan in het bestand. Dit bestand staat in de `ignores` van `eslint.config.mjs`, dus opmaak is geen punt.

- [ ] **Step 8: Draai lint, types en de unittests**

Run: `npm run lint && npm run typecheck && npm run test`
Expected: alles schoon.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260927100000_product.sql test/db/product.test.ts app/types/database.types.ts
git commit -m "feat: tabellen en RLS voor de productcatalogus"
```

---

### Task 2: De vijf schrijffuncties

**Files:**
- Create: `supabase/migrations/20260927100100_product_rpc.sql`
- Modify: `test/db/product.test.ts` (een tweede `describe` erbij)

**Interfaces:**
- Consumes: de tabellen uit Taak 1.
- Produces:
  - `create_product(gtin text, brand text, net_content numeric, unit text, locale text, name text) returns uuid`
  - `update_product(target_product uuid, gtin text, brand text, net_content numeric, unit text) returns void`
  - `set_product_translation(target_product uuid, locale text, name text) returns void`
  - `remove_product_translation(target_product uuid, locale text) returns void`
  - `set_product_status(target_product uuid, new_status text) returns void`

  Taak 4's composable roept deze namen en argumentvolgorde letterlijk aan.

- [ ] **Step 1: Schrijf de falende tests**

Voeg toe aan `test/db/product.test.ts`, als tweede `describe` naast de bestaande:

```ts
describe('product-RPCs', () => {
  beforeEach(resetDb)

  // `Sql` wordt al geëxporteerd door test/db/helpers.ts. Breid de bestaande
  // import bovenaan dit bestand uit tot:
  //   import { withDb, withTx, actAs, enableRls, createUser, resetDb, type Sql } from './helpers'
  async function maakProduct(tx: Sql, naam = 'Melk') {
    const [r] = await tx<{ create_product: string }[]>`
      select create_product(null, null, null, null, 'nl', ${naam}) as create_product
    `
    return r!.create_product
  }

  it('maakt het product en de eerste naam samen aan', async () => {
    const userId = await createUser('maker@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      const [naam] = await tx<{ name: string; source: string }[]>`
        select name, source from product_translation where product_id = ${id}
      `
      expect(naam!.name).toBe('Melk')
      expect(naam!.source).toBe('user')
    })
  })

  it('zet een nieuw product van een onbekende gebruiker op proposed', async () => {
    const userId = await createUser('nieuw@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      const [p] = await tx<{ status: string }[]>`select status from product where id = ${id}`
      expect(p!.status).toBe('proposed')
    })
  })

  // De falsificatie van de test hierboven: zonder dit geval zou een
  // implementatie die álles op proposed zet er net zo groen uitzien.
  it('zet een nieuw product van een vertrouwde gebruiker op confirmed', async () => {
    const userId = await createUser('vertrouwd@example.com')
    await withDb(async (sql) => {
      await sql`update user_profile set trust_level = 1 where user_id = ${userId}`
    })
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      const [p] = await tx<{ status: string }[]>`select status from product where id = ${id}`
      expect(p!.status).toBe('confirmed')
    })
  })

  it('laat de maker zijn eigen product bewerken', async () => {
    const userId = await createUser('eigenaar@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      await tx`select update_product(${id}::uuid, null, 'Boni', 1000, 'ml')`
      const [p] = await tx<{ brand: string }[]>`select brand from product where id = ${id}`
      expect(p!.brand).toBe('Boni')
    })
  })

  it('laat een vreemde het product van iemand anders niet bewerken', async () => {
    const mijn = await createUser('mijn-product@example.com')
    const vreemde = await createUser('vreemde@example.com')
    let id = ''
    await withTx(async (tx) => {
      await actAs(tx, mijn)
      await enableRls(tx)
      id = await maakProduct(tx)
    })
    await withTx(async (tx) => {
      await actAs(tx, vreemde)
      await enableRls(tx)
      await expect(
        tx`select update_product(${id}::uuid, null, 'Gekaapt', null, null)`,
      ).rejects.toThrow(/alleen de maker of een moderator/)
    })
  })

  // De andere helft van het paar. Zonder dit geval zou een implementatie die
  // iedereen weigert — inclusief moderators — er groen uitzien.
  it('laat een moderator het product van iemand anders wel bewerken', async () => {
    const mijn = await createUser('mijn-product-2@example.com')
    const mod = await createUser('moderator@example.com')
    await withDb(async (sql) => {
      await sql`update user_profile set role = 'moderator' where user_id = ${mod}`
    })
    let id = ''
    await withTx(async (tx) => {
      await actAs(tx, mijn)
      await enableRls(tx)
      id = await maakProduct(tx)
    })
    await withTx(async (tx) => {
      await actAs(tx, mod)
      await enableRls(tx)
      await tx`select update_product(${id}::uuid, null, 'Gecorrigeerd', null, null)`
      const [p] = await tx<{ brand: string }[]>`select brand from product where id = ${id}`
      expect(p!.brand).toBe('Gecorrigeerd')
    })
  })

  it('voegt een naam in een andere taal toe en vervangt een bestaande', async () => {
    const userId = await createUser('vertaler@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      await tx`select set_product_translation(${id}::uuid, 'en', 'Milk')`
      await tx`select set_product_translation(${id}::uuid, 'en', 'Semi-skimmed milk')`
      const rows = await tx<{ locale: string; name: string }[]>`
        select locale, name from product_translation where product_id = ${id} order by locale
      `
      expect(rows.map((r) => r.locale)).toEqual(['en', 'nl'])
      expect(rows[0]!.name).toBe('Semi-skimmed milk')
    })
  })

  it('weigert het verwijderen van de laatste naam via de RPC', async () => {
    const userId = await createUser('laatste@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      await expect(
        tx`select remove_product_translation(${id}::uuid, 'nl')`,
      ).rejects.toThrow(/minstens één naam/)
    })
  })

  it('laat alleen een moderator de status wijzigen', async () => {
    const userId = await createUser('statuszoeker@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      await expect(
        tx`select set_product_status(${id}::uuid, 'rejected')`,
      ).rejects.toThrow(/alleen een moderator/)
    })
  })

  // Spiegelt `anon mag geen enkele huishoudfunctie aanroepen`. Elke aanroep
  // gaat in een eigen savepoint: een geweigerde aanroep breekt de transactie
  // af, en zonder savepoint zou de tweede aanroep falen op "current
  // transaction is aborted" in plaats van op de rechten. De query wordt
  // binnen de callback opgebouwd — geef je een al gemaakte query mee, dan
  // draait hij buiten het savepoint.
  it('laat anon geen enkele productfunctie aanroepen', async () => {
    await withTx(async (tx) => {
      await enableRls(tx, 'anon')
      const aanroepen = [
        (sp: Sql) => sp`select create_product(null, null, null, null, 'nl', 'Melk')`,
        (sp: Sql) => sp`select update_product(gen_random_uuid(), null, null, null, null)`,
        (sp: Sql) => sp`select set_product_translation(gen_random_uuid(), 'nl', 'Melk')`,
        (sp: Sql) => sp`select remove_product_translation(gen_random_uuid(), 'nl')`,
        (sp: Sql) => sp`select set_product_status(gen_random_uuid(), 'rejected')`,
      ]
      for (const aanroep of aanroepen) {
        await expect(tx.savepoint((sp) => aanroep(sp as unknown as Sql))).rejects.toThrow(
          /permission denied/,
        )
      }
    })
  })
})
```

- [ ] **Step 2: Draai de tests en controleer dat ze falen**

Run: `npm run test:db -- product`
Expected: de nieuwe `product-RPCs`-gevallen FALEN met "function create_product does not exist". De gevallen uit Taak 1 blijven groen.

- [ ] **Step 3: Schrijf de migratie**

`supabase/migrations/20260927100100_product_rpc.sql`:

```sql
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
     set gtin        = nullif(btrim(gtin), ''),
         brand       = nullif(btrim(brand), ''),
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
create function set_product_translation(target_product uuid, locale text, name text)
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
```

- [ ] **Step 4: Pas de migratie toe en draai de tests**

Run: `npx supabase migration up && npm run test:db -- product`
Expected: alle gevallen SLAGEN, ook die uit Taak 1.

- [ ] **Step 5: Falsificeer de statusregel**

Vervang in `create_product` de `case`-expressie tijdelijk door het letterlijke `'proposed'`, pas toe met `npx supabase db reset`, en draai de tests.

Run: `npm run test:db -- product`
Expected: `zet een nieuw product van een vertrouwde gebruiker op confirmed` wordt ROOD, de `proposed`-variant blijft groen. Zet daarna terug.

- [ ] **Step 6: Werk de types bij en draai alles**

Run: `npx supabase gen types typescript --local > app/types/database.types.ts && npm run lint && npm run typecheck && npm run test`
Expected: alles schoon; de vijf functies staan onder `Functions` in het typebestand.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260927100100_product_rpc.sql test/db/product.test.ts app/types/database.types.ts
git commit -m "feat: schrijffuncties voor de productcatalogus"
```

---

### Task 3: De zoekfunctie

**Files:**
- Create: `supabase/migrations/20260927100200_search_products.sql`
- Create: `test/db/product-search.test.ts`

**Interfaces:**
- Consumes: de tabellen uit Taak 1 en `create_product` uit Taak 2 (om testdata te maken).
- Produces: `search_products(zoekterm text, voorkeurstaal text, maximum int) returns table (product_id uuid, naam text, getoonde_taal text, merk text, net_content numeric, unit text, gtin text, status text, score real)`. Taak 4's composable roept deze naam en kolomnamen letterlijk aan.

- [ ] **Step 1: Schrijf de falende tests**

`test/db/product-search.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb, type Sql } from './helpers'

// Zoeken draait op trigrammen. De getallen in de commentaren hieronder zijn
// gemeten op deze stack, niet geschat — zie spec §5.
describe('search_products', () => {
  beforeEach(resetDb)

  async function zaai(tx: Sql, namen: Record<string, string>, extra = '') {
    const eerste = Object.entries(namen)[0]!
    const [r] = await tx<{ id: string }[]>`
      select create_product(null, ${extra || null}, null, null, ${eerste[0]}, ${eerste[1]}) as id
    `
    for (const [taal, naam] of Object.entries(namen).slice(1)) {
      await tx`select set_product_translation(${r!.id}::uuid, ${taal}, ${naam})`
    }
    return r!.id
  }

  // DE test van deze taak. similarity('melk', 'Bio halfvolle melk 1 L') is
  // 0,217 en ligt daarmee onder de standaarddrempel van 0,3 — een
  // implementatie op similarity() vindt dit product dus NIET. word_similarity
  // geeft er 1,000 voor. Dit geval gaat rood zodra iemand dat terugdraait.
  it('vindt een lange productnaam op een kort woord', async () => {
    const userId = await createUser('zoeker@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Bio halfvolle melk 1 L' })
      const rijen = await tx<{ naam: string }[]>`select naam from search_products('melk', 'nl', 20)`
      expect(rijen.map((r) => r.naam)).toEqual(['Bio halfvolle melk 1 L'])
    })
  })

  // Bewaakt de verlaagde drempel. word_similarity('mlek', ...) is 0,200; de
  // standaard voor word_similarity is 0,6, dus bij die standaard vindt deze
  // zoekterm niets.
  it('vindt een product ondanks een typefout', async () => {
    const userId = await createUser('typer@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Bio halfvolle melk 1 L' })
      const rijen = await tx`select naam from search_products('mlek', 'nl', 20)`
      expect(rijen.length).toBe(1)
    })
  })

  it('laat een product dat niets met de zoekterm te maken heeft buiten beschouwing', async () => {
    const userId = await createUser('ruis@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Sojadrink natuur' })
      const rijen = await tx`select naam from search_products('melk', 'nl', 20)`
      expect(rijen.length).toBe(0)
    })
  })

  // Zonder ontdubbeling komt een product dat in twee talen matcht er twee
  // keer uit, en toont de UI hetzelfde ding dubbel.
  it('geeft één rij per product, ook als meerdere talen matchen', async () => {
    const userId = await createUser('dubbel@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Melk', en: 'Melk drink' })
      const rijen = await tx`select product_id from search_products('melk', 'nl', 20)`
      expect(rijen.length).toBe(1)
    })
  })

  it('matcht over talen heen', async () => {
    const userId = await createUser('polyglot@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Halfvolle melk', en: 'Semi-skimmed milk' })
      const rijen = await tx`select product_id from search_products('milk', 'nl', 20)`
      expect(rijen.length).toBe(1)
    })
  })

  it('toont de naam in de voorkeurstaal als die bestaat', async () => {
    const userId = await createUser('voorkeur@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Halfvolle melk', en: 'Semi-skimmed milk' })
      const [r] = await tx<{ naam: string; getoonde_taal: string }[]>`
        select naam, getoonde_taal from search_products('milk', 'nl', 20)
      `
      expect(r!.naam).toBe('Halfvolle melk')
      expect(r!.getoonde_taal).toBe('nl')
    })
  })

  // De terugvalketen, plus de melding welke taal je ziet. Zonder de tweede
  // assertie slaagt een implementatie die getoonde_taal nooit invult.
  it('valt terug op een andere taal en meldt welke', async () => {
    const userId = await createUser('terugval@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { en: 'Semi-skimmed milk' })
      const [r] = await tx<{ naam: string; getoonde_taal: string }[]>`
        select naam, getoonde_taal from search_products('milk', 'nl', 20)
      `
      expect(r!.naam).toBe('Semi-skimmed milk')
      expect(r!.getoonde_taal).toBe('en')
    })
  })

  it('laat een afgewezen product uit het resultaat', async () => {
    const userId = await createUser('afgewezen@example.com')
    const mod = await createUser('mod-zoek@example.com')
    await withDb(async (sql) => {
      await sql`update user_profile set role = 'moderator' where user_id = ${mod}`
    })
    let id = ''
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      id = await zaai(tx, { nl: 'Melk' })
    })
    await withTx(async (tx) => {
      await actAs(tx, mod)
      await enableRls(tx)
      await tx`select set_product_status(${id}::uuid, 'rejected')`
      const rijen = await tx`select product_id from search_products('melk', 'nl', 20)`
      expect(rijen.length).toBe(0)
    })
  })

  // De andere helft: een voorgesteld product moet juist wél zichtbaar zijn,
  // anders lijkt je zojuist aangemaakte product verdwenen.
  it('laat een voorgesteld product wel in het resultaat', async () => {
    const userId = await createUser('voorgesteld@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Melk' })
      const [r] = await tx<{ status: string }[]>`select status from search_products('melk', 'nl', 20)`
      expect(r!.status).toBe('proposed')
    })
  })

  it('geeft bij een lege zoekterm de recentste producten', async () => {
    const userId = await createUser('leeg@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Eerste' })
      await zaai(tx, { nl: 'Tweede' })
      const rijen = await tx<{ naam: string }[]>`select naam from search_products('', 'nl', 20)`
      expect(rijen.map((r) => r.naam)).toEqual(['Tweede', 'Eerste'])
    })
  })

  it('eerbiedigt het maximum', async () => {
    const userId = await createUser('maximum@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Melk een' })
      await zaai(tx, { nl: 'Melk twee' })
      const rijen = await tx`select product_id from search_products('melk', 'nl', 1)`
      expect(rijen.length).toBe(1)
    })
  })
})
```

- [ ] **Step 2: Draai de tests en controleer dat ze falen**

Run: `npm run test:db -- product-search`
Expected: alle gevallen FALEN met "function search_products does not exist".

- [ ] **Step 3: Schrijf de migratie**

`supabase/migrations/20260927100200_search_products.sql`:

```sql
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
  set pg_trgm.word_similarity_threshold = 0.2
as $$
begin
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
       order by p.created_at desc
       limit maximum;
    return;
  end if;

  return query
    with kandidaat as (
      -- Let op de twee schrijfrichtingen; ze zijn allebei nodig en ze
      -- verschillen met opzet.
      --
      -- `pt.name %> zoekterm` is de filterkant. gin_trgm_ops ondersteunt
      -- alleen %, %> en %>> — de commutatoren — dus de index wordt alleen
      -- gebruikt met de geïndexeerde kolom links. Andersom geschreven doet
      -- Postgres stilletjes een sequentiële scan.
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
     order by k.score desc, w.name
     limit maximum;
end;
$$;

revoke all on function search_products(text, text, int) from public, anon;
grant execute on function search_products(text, text, int) to authenticated;
```

- [ ] **Step 4: Pas de migratie toe en draai de tests**

Run: `npx supabase migration up && npm run test:db -- product-search`
Expected: alle gevallen SLAGEN.

- [ ] **Step 5: Falsificeer de keuze voor `word_similarity`**

Dit is de belangrijkste stap van deze taak. Vervang in de `kandidaat`-CTE tijdelijk `pt.name %> zoekterm` door `pt.name % zoekterm` (de gewone gelijkenisoperator) en `word_similarity(zoekterm, pt.name)` door `similarity(zoekterm, pt.name)`, pas toe met `npx supabase db reset`, en draai de tests.

Run: `npm run test:db -- product-search`
Expected: `vindt een lange productnaam op een kort woord` wordt ROOD — `similarity('melk', 'Bio halfvolle melk 1 L')` is 0,217 en ligt onder de standaarddrempel van 0,3. Blijft die test groen, dan meet hij niet wat hij beweert. Zet daarna terug.

- [ ] **Step 6: Falsificeer de indexrichting**

Draai `pt.name %> zoekterm` om naar `zoekterm <% pt.name` (semantisch hetzelfde, maar met de geïndexeerde kolom rechts), pas toe, en lees het queryplan:

Run:
```bash
npx supabase db reset >/dev/null 2>&1
node -e "
const postgres = require('postgres'); process.loadEnvFile();
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
(async () => {
  for (let i = 0; i < 2000; i++) {
    const [p] = await sql\`insert into product (status) values ('confirmed') returning id\`;
    await sql\`insert into product_translation (product_id, locale, name, source)
              values (\${p.id}, 'nl', \${'Product nummer ' + i + ' melk'}, 'user')\`;
  }
  await sql\`analyze product_translation\`;
  const plan = await sql\`explain (format text) select * from search_products('melk','nl',20)\`;
  console.log(plan.map(r => r['QUERY PLAN']).join('\n'));
  await sql.end();
})();
"
```
Expected: mét `pt.name %> zoekterm` noemt het plan `product_translation_naam_trgm`; met `zoekterm <% pt.name` staat er `Seq Scan`. Noteer beide plannen in je rapport. Zet daarna terug en draai `npx supabase db reset`.

**Blijkt het plan in beide gevallen hetzelfde**, meld dat dan als bevinding in plaats van het weg te schrijven: dan klopt de aanname over de operatorrichting niet, en moet de constraint erover uit het plan.

- [ ] **Step 7: Werk de types bij en draai alles**

Run: `npx supabase gen types typescript --local > app/types/database.types.ts && npm run lint && npm run typecheck && npm run test && npm run test:db`
Expected: alles schoon en groen.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260927100200_search_products.sql test/db/product-search.test.ts app/types/database.types.ts
git commit -m "feat: zoeken in de catalogus op trigram-woordgelijkenis"
```

---

### Task 4: Routes, vertaalsleutels en de composable

**Files:**
- Modify: `routes.config.ts`
- Modify: `i18n/locales/en.json`, `nl.json`, `fr.json`
- Create: `app/composables/useProducts.ts`

**Interfaces:**
- Consumes: `search_products` uit Taak 3 en de vijf RPC's uit Taak 2.
- Produces:
  - Routesleutels `products`, `products/new`, `products/[id]` → routenamen `products`, `products-new`, `products-id`.
  - `useProducts()` met `search(zoekterm): Promise<Zoekresultaat[]>`, `load(id): Promise<ProductDetail | null>`, `create(invoer): Promise<string>`, `update(id, invoer): Promise<void>`, `setTranslation(id, locale, name): Promise<void>`, `removeTranslation(id, locale): Promise<void>`.

**Let op de volgorde:** de routes worden hier toegevoegd maar de pagina's komen pas in Taak 5 en 6. `e2e/mobile.spec.ts`' veegtest leidt zijn routelijst af uit `routePaths` en zou dus een route bezoeken die nog geen pagina heeft. Daarom voegt **deze taak de routes nog niet toe aan `routePaths`** — alleen de vertaalsleutels en de composable. Taak 5 voegt `products` en `products/new` toe samen met hun pagina's, Taak 6 voegt `products/[id]` toe samen met de zijne.

- [ ] **Step 1: Voeg de vertaalsleutels toe**

In `i18n/locales/en.json`, als nieuw blok op het hoogste niveau na `"profile"`:

```json
  "products": {
    "title": "Products",
    "search": "Search products",
    "searchHelp": "Search in every language at once.",
    "empty": "Nothing found.",
    "createNamed": "Create \"{name}\"",
    "create": "Add a product",
    "name": "Name",
    "brand": "Brand",
    "netContent": "Content",
    "unit": "Unit",
    "gtin": "Barcode",
    "gtinHelp": "8, 12, 13 or 14 digits. Leave it empty if you are unsure.",
    "gtinCheckDigit": "That barcode's check digit does not add up. Saving it anyway is fine.",
    "contentHelp": "Without content and unit this product drops out of price comparison.",
    "save": "Save",
    "saved": "Saved.",
    "names": "Names",
    "addName": "Add a name",
    "removeName": "Remove",
    "shownIn": "Shown in {language}",
    "sourceUser": "Entered by someone",
    "sourceOff": "From Open Food Facts",
    "sourceMachine": "Machine translated",
    "statusProposed": "Proposed",
    "statusConfirmed": "Confirmed",
    "statusEstablished": "Established",
    "statusRejected": "Rejected",
    "notFound": "That product does not exist."
  },
```

In `nl.json`, op dezelfde plek:

```json
  "products": {
    "title": "Producten",
    "search": "Producten zoeken",
    "searchHelp": "Zoekt in alle talen tegelijk.",
    "empty": "Niets gevonden.",
    "createNamed": "\"{name}\" aanmaken",
    "create": "Product toevoegen",
    "name": "Naam",
    "brand": "Merk",
    "netContent": "Inhoud",
    "unit": "Eenheid",
    "gtin": "Barcode",
    "gtinHelp": "8, 12, 13 of 14 cijfers. Laat leeg als je het niet zeker weet.",
    "gtinCheckDigit": "Het controlecijfer van die barcode klopt niet. Toch bewaren mag.",
    "contentHelp": "Zonder inhoud en eenheid valt dit product uit de prijsvergelijking.",
    "save": "Opslaan",
    "saved": "Opgeslagen.",
    "names": "Namen",
    "addName": "Naam toevoegen",
    "removeName": "Verwijderen",
    "shownIn": "Getoond in het {language}",
    "sourceUser": "Door iemand ingetikt",
    "sourceOff": "Uit Open Food Facts",
    "sourceMachine": "Machinaal vertaald",
    "statusProposed": "Voorgesteld",
    "statusConfirmed": "Bevestigd",
    "statusEstablished": "Gevestigd",
    "statusRejected": "Afgewezen",
    "notFound": "Dat product bestaat niet."
  },
```

In `fr.json`:

```json
  "products": {
    "title": "Produits",
    "search": "Rechercher des produits",
    "searchHelp": "Recherche dans toutes les langues à la fois.",
    "empty": "Aucun résultat.",
    "createNamed": "Créer « {name} »",
    "create": "Ajouter un produit",
    "name": "Nom",
    "brand": "Marque",
    "netContent": "Contenu",
    "unit": "Unité",
    "gtin": "Code-barres",
    "gtinHelp": "8, 12, 13 ou 14 chiffres. Laissez vide en cas de doute.",
    "gtinCheckDigit": "La clé de contrôle de ce code-barres ne correspond pas. Vous pouvez quand même l'enregistrer.",
    "contentHelp": "Sans contenu ni unité, ce produit sort de la comparaison des prix.",
    "save": "Enregistrer",
    "saved": "Enregistré.",
    "names": "Noms",
    "addName": "Ajouter un nom",
    "removeName": "Supprimer",
    "shownIn": "Affiché en {language}",
    "sourceUser": "Saisi par quelqu'un",
    "sourceOff": "D'Open Food Facts",
    "sourceMachine": "Traduction automatique",
    "statusProposed": "Proposé",
    "statusConfirmed": "Confirmé",
    "statusEstablished": "Établi",
    "statusRejected": "Rejeté",
    "notFound": "Ce produit n'existe pas."
  },
```

- [ ] **Step 2: Controleer de sleuteltest**

Run: `npm run test -- locales`
Expected: PASS. Faalt hij, vergelijk dan de sleutelpaden in de foutmelding — de drie bestanden moeten exact dezelfde structuur hebben.

- [ ] **Step 3: Breid `useProfile()` uit met `role`**

De productpagina uit Taak 6 moet weten of de kijker moderator is, en
`useProfile()` haalt dat veld vandaag niet op — het selecteert alleen
`user_id` en `display_name`. Zonder deze uitbreiding kan de UI het
bewerkrecht niet bepalen en zou ze knoppen tonen die de database daarna
weigert.

In `app/composables/useProfile.ts`: voeg `role` toe aan de interface, aan de
`select`, en aan de toewijzing.

```ts
export interface Profile {
  userId: string
  displayName: string | null
  // Toegekend, niet verdiend: `role` bepaalt of je aan andermans gegevens
  // mag komen. Dat staat los van `trust_level`, dat verdiend wordt en
  // bepaalt met welke status je eigen bijdragen starten. Zie §2 van
  // docs/superpowers/specs/2026-09-27-catalogus-producten-design.md.
  role: string
}
```

```ts
    const { data, error } = await supabase
      .from('user_profile')
      .select('user_id, display_name, role')
      .eq('user_id', user.value.sub)
      .single()

    if (error) throw error
    profile.value = { userId: data.user_id, displayName: data.display_name, role: data.role }
```

`role` is `not null default 'user'` in het schema, dus er is geen
null-geval om af te handelen.

- [ ] **Step 4: Schrijf de composable**

`app/composables/useProducts.ts`:

```ts
export interface Zoekresultaat {
  productId: string
  naam: string
  getoondeTaal: string
  merk: string | null
  netContent: number | null
  unit: string | null
  gtin: string | null
  status: string
}

export interface ProductVertaling {
  locale: string
  name: string
  source: string
}

export interface ProductDetail {
  id: string
  gtin: string | null
  brand: string | null
  netContent: number | null
  unit: string | null
  status: string
  createdBy: string | null
  vertalingen: ProductVertaling[]
}

export interface ProductInvoer {
  gtin: string | null
  brand: string | null
  netContent: number | null
  unit: string | null
}

/**
 * De catalogus, clientzijdig.
 *
 * Bewust geen useState: anders dan het profiel of het actieve huishouden is
 * een zoekresultaat niets om vast te houden — het verandert bij elke
 * toetsaanslag en hoort bij de pagina, niet bij de sessie.
 *
 * Elke schrijfactie gaat door een RPC. Er is geen insert- of update-policy op
 * product, dus een rechtstreekse tabelbewerking zou hier stil nul rijen raken.
 */
export function useProducts() {
  const supabase = useSupabaseClient()
  const { locale } = useI18n()

  async function search(zoekterm: string, maximum = 20): Promise<Zoekresultaat[]> {
    const { data, error } = await supabase.rpc('search_products', {
      zoekterm,
      voorkeurstaal: locale.value,
      maximum,
    })
    if (error) throw error
    return (data ?? []).map((r) => ({
      productId: r.product_id,
      naam: r.naam,
      getoondeTaal: r.getoonde_taal,
      merk: r.merk,
      netContent: r.net_content === null ? null : Number(r.net_content),
      unit: r.unit,
      gtin: r.gtin,
      status: r.status,
    }))
  }

  async function load(id: string): Promise<ProductDetail | null> {
    const { data, error } = await supabase
      .from('product')
      .select('id, gtin, brand, net_content, unit, status, created_by')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return null

    const { data: namen, error: naamError } = await supabase
      .from('product_translation')
      .select('locale, name, source')
      .eq('product_id', id)
      .order('locale')
    if (naamError) throw naamError

    return {
      id: data.id,
      gtin: data.gtin,
      brand: data.brand,
      netContent: data.net_content === null ? null : Number(data.net_content),
      unit: data.unit,
      status: data.status,
      createdBy: data.created_by,
      vertalingen: namen ?? [],
    }
  }

  async function create(invoer: ProductInvoer & { locale: string, name: string }): Promise<string> {
    const { data, error } = await supabase.rpc('create_product', {
      gtin: invoer.gtin,
      brand: invoer.brand,
      net_content: invoer.netContent,
      unit: invoer.unit,
      locale: invoer.locale,
      name: invoer.name,
    })
    if (error) throw error
    return data as string
  }

  async function update(id: string, invoer: ProductInvoer): Promise<void> {
    const { error } = await supabase.rpc('update_product', {
      target_product: id,
      gtin: invoer.gtin,
      brand: invoer.brand,
      net_content: invoer.netContent,
      unit: invoer.unit,
    })
    if (error) throw error
  }

  async function setTranslation(id: string, taal: string, naam: string): Promise<void> {
    const { error } = await supabase.rpc('set_product_translation', {
      target_product: id,
      locale: taal,
      name: naam,
    })
    if (error) throw error
  }

  async function removeTranslation(id: string, taal: string): Promise<void> {
    const { error } = await supabase.rpc('remove_product_translation', {
      target_product: id,
      locale: taal,
    })
    if (error) throw error
  }

  return { search, load, create, update, setTranslation, removeTranslation }
}
```

- [ ] **Step 5: Draai lint, types en unittests**

Run: `npm run lint && npm run typecheck && npm run test`
Expected: alles schoon. Klaagt de typecontrole over de RPC-namen, dan is `app/types/database.types.ts` niet bijgewerkt na Taak 3 — draai `npx supabase gen types typescript --local > app/types/database.types.ts` opnieuw.

- [ ] **Step 6: Draai de e2e-suite**

Run: `npm run test:e2e`
Expected: groen. `useProfile()` wordt gelezen door `AppHeader.vue` en door de profielpagina, dus een fout in Step 3 raakt élke ingelogde pagina — niet alleen de catalogus. Deze stap staat er om dat meteen te zien in plaats van pas in Taak 6.

- [ ] **Step 7: Commit**

```bash
git add i18n/locales app/composables/useProducts.ts app/composables/useProfile.ts
git commit -m "feat: vertaalsleutels en composable voor de catalogus"
```

---

### Task 5: Zoeken en aanmaken

**Files:**
- Modify: `routes.config.ts`
- Create: `app/pages/products/index.vue`
- Create: `app/pages/products/new.vue`
- Modify: `app/components/AppHeader.vue`

**Interfaces:**
- Consumes: `useProducts()` uit Taak 4.
- Produces: de routesleutels `products` en `products/new`, het navigatie-item, en een resultatenlijst waarvan de rijen in Taak 6 links worden.

- [ ] **Step 1: Voeg de twee routes toe**

In `routes.config.ts`, in `routePaths`, na `'inventory'`:

```ts
  'products': { en: '/products', nl: '/producten', fr: '/produits' },
  'products/new': { en: '/products/new', nl: '/producten/nieuw', fr: '/produits/nouveau' },
```

Niet toevoegen aan `publicRoutes`: de catalogus is alleen voor ingelogde gebruikers (spec §2).

- [ ] **Step 2: Schrijf de zoekpagina**

`app/pages/products/index.vue`:

```vue
<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const { search } = useProducts()

const zoekterm = ref('')
const resultaten = ref<Zoekresultaat[]>([])
const bezig = ref(false)
const error = ref('')

// Zoeken en aanmaken zijn één beweging: de affordance om aan te maken staat
// altijd onder de resultaten en neemt je zoekterm mee. Aanmaken kan dus
// alleen nadat je hebt gezien wat er al staat — de tegenmaatregel tegen
// dubbele producten uit spec §4.
const aanmaakpad = computed(() => ({
  path: localePath('products-new'),
  query: zoekterm.value.trim() ? { naam: zoekterm.value.trim() } : undefined,
}))

let laatste = 0
async function zoek() {
  const beurt = ++laatste
  bezig.value = true
  error.value = ''
  try {
    const rijen = await search(zoekterm.value)
    // Een trager antwoord op een oudere toetsaanslag mag een nieuwer
    // antwoord niet overschrijven.
    if (beurt === laatste) resultaten.value = rijen
  } catch {
    if (beurt === laatste) error.value = t('householdSettings.error')
  } finally {
    if (beurt === laatste) bezig.value = false
  }
}

watchDebounced(zoekterm, zoek, { debounce: 250 })
onMounted(zoek)
</script>

<template>
  <UContainer class="max-w-2xl py-12">
    <h1 class="text-2xl font-bold">{{ t('products.title') }}</h1>

    <UFormField class="mt-6" :label="t('products.search')" :help="t('products.searchHelp')" name="zoek">
      <UInput v-model="zoekterm" icon="i-lucide-search" class="w-full" />
    </UFormField>

    <UAlert v-if="error" class="mt-4" color="error" :description="error" />
    <UProgress v-else-if="bezig" class="mt-4" animation="carousel" />

    <ul v-else-if="resultaten.length" class="mt-6 divide-y divide-default">
      <li v-for="r in resultaten" :key="r.productId" class="py-3">
        <p class="font-medium">{{ r.naam }}</p>
        <p class="text-sm text-muted">
          <span v-if="r.merk">{{ r.merk }}</span>
          <span v-if="r.netContent"> · {{ r.netContent }} {{ r.unit }}</span>
          <span v-if="r.status === 'proposed'"> · {{ t('products.statusProposed') }}</span>
        </p>
      </li>
    </ul>

    <p v-else class="mt-6 text-muted">{{ t('products.empty') }}</p>

    <UButton class="mt-6" :to="aanmaakpad" icon="i-lucide-plus" block>
      {{ zoekterm.trim() ? t('products.createNamed', { name: zoekterm.trim() }) : t('products.create') }}
    </UButton>
  </UContainer>
</template>
```

**Twee dingen om te controleren in plaats van aan te nemen, allebei met `npm run typecheck`:**

*De typen uit de composable.* `Zoekresultaat` wordt hier gebruikt zonder import. Nuxt auto-importeert typen uit `app/composables/`, maar geen enkele bestaande pagina in dit project leunt daarop, dus het is onbewezen terrein. Klaagt de typecontrole, voeg dan bovenaan toe:

```ts
import type { Zoekresultaat } from '~/composables/useProducts'
```

Hetzelfde geldt voor `ProductDetail` in Taak 6.

*`watchDebounced`.* Dat komt uit VueUse, dat via `@nuxt/ui` in het project zit — maar of `@nuxt/ui` de VueUse-auto-imports registreert is niet nagegaan. Is hij er niet, vervang dan door een eigen ontdubbelaar in plaats van een pakket toe te voegen:

```ts
let timer: ReturnType<typeof setTimeout> | undefined
watch(zoekterm, () => {
  clearTimeout(timer)
  timer = setTimeout(zoek, 250)
})
```

- [ ] **Step 3: Schrijf de aanmaakpagina**

`app/pages/products/new.vue`:

```vue
<script setup lang="ts">
const { t, locale } = useI18n()
const route = useRoute()
const localePath = useLocalePath()
const { create } = useProducts()

const naam = ref(typeof route.query.naam === 'string' ? route.query.naam : '')
const merk = ref('')
const inhoud = ref<number | null>(null)
const eenheid = ref<string | null>(null)
const gtin = ref('')
const bezig = ref(false)
const error = ref('')

const eenheden = computed(() =>
  ['ml', 'g', 'stuk'].map((value) => ({ value, label: value })),
)

/**
 * Een GTIN heeft een controlecijfer: de som van de cijfers, afwisselend maal
 * 1 en maal 3 vanaf rechts, moet een veelvoud van tien zijn.
 *
 * Dit waarschuwt maar blokkeert niet, en dat is bewust (spec §4). Een
 * verkeerd getypte barcode wijst voorgoed naar het verkeerde product, dus
 * erop wijzen is waardevol — maar een validatie die één keer verkeerd staat,
 * weigert geldige producten en dat merk je pas als iemand klaagt.
 */
function controlecijferKlopt(code: string): boolean {
  const cijfers = [...code].map(Number)
  const controle = cijfers.pop()!
  const som = cijfers
    .reverse()
    .reduce((t, c, i) => t + c * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (som % 10)) % 10 === controle
}

const gtinWaarschuwing = computed(() => {
  const code = gtin.value.trim()
  if (!/^([0-9]{8}|[0-9]{12,14})$/.test(code)) return ''
  return controlecijferKlopt(code) ? '' : t('products.gtinCheckDigit')
})

async function bewaar() {
  bezig.value = true
  error.value = ''
  try {
    const id = await create({
      gtin: gtin.value.trim() || null,
      brand: merk.value.trim() || null,
      netContent: inhoud.value,
      unit: eenheid.value,
      locale: locale.value,
      name: naam.value.trim(),
    })
    await navigateTo(localePath({ name: 'products-id', params: { id } }))
  } catch {
    error.value = t('householdSettings.error')
  } finally {
    bezig.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-lg py-12">
    <h1 class="text-2xl font-bold">{{ t('products.create') }}</h1>

    <form class="mt-6 space-y-4" @submit.prevent="bewaar">
      <UFormField :label="t('products.name')" name="naam">
        <UInput v-model="naam" required :maxlength="200" class="w-full" />
      </UFormField>

      <UFormField :label="t('products.brand')" name="merk">
        <UInput v-model="merk" class="w-full" />
      </UFormField>

      <!-- Inhoud en eenheid staan naast elkaar op desktop en gestapeld onder
           sm. De stapeltest in e2e/mobile.spec.ts toetst dat. -->
      <UFormField :label="t('products.netContent')" :help="t('products.contentHelp')" name="inhoud">
        <div class="flex flex-col gap-2 sm:flex-row">
          <UInput v-model.number="inhoud" type="number" min="0" class="w-full sm:flex-1" />
          <USelect
            v-model="eenheid"
            :items="eenheden"
            value-key="value"
            :aria-label="t('products.unit')"
            class="w-full sm:w-auto"
          />
        </div>
      </UFormField>

      <UFormField :label="t('products.gtin')" :help="gtinWaarschuwing || t('products.gtinHelp')" name="gtin">
        <UInput v-model="gtin" :maxlength="14" class="w-full" />
      </UFormField>

      <UAlert v-if="error" color="error" :description="error" />

      <UButton type="submit" :loading="bezig" block>{{ t('products.save') }}</UButton>
    </form>
  </UContainer>
</template>
```

- [ ] **Step 4: Voeg het navigatie-item toe**

In `app/components/AppHeader.vue`, in `navItems`:

```ts
const navItems = computed(() => [
  { label: t('nav.inventory'), to: localePath('inventory') },
  { label: t('products.title'), to: localePath('products') },
])
```

- [ ] **Step 5: Draai de mobiele tests — dit is het moment waarop de veegtest zich uitbetaalt**

Run: `npm run test:e2e -- mobile`
Expected: de veegtest neemt `/products` en `/products/new` **vanzelf** mee, want hij leidt zijn lijst af uit `routePaths`.

**Gaat hij rood op overflow in het Frans, dan is dat geen storing maar het antwoord op een vraag die het ontwerp openliet** (spec §6): "Produits" past niet naast "Stock" in de Franse header. Meld het met het gemeten aantal pixels, en los het op door het navigatie-item in te korten tot een icoon met `aria-label`, niet door de test te verzachten.

- [ ] **Step 6: Draai de volledige suites**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:e2e`
Expected: alles groen.

- [ ] **Step 7: Commit**

```bash
git add routes.config.ts app/pages/products app/components/AppHeader.vue
git commit -m "feat: producten zoeken en aanmaken"
```

---

### Task 6: De productpagina

**Files:**
- Modify: `routes.config.ts`
- Create: `app/pages/products/[id].vue`
- Modify: `app/pages/products/index.vue` (de rijen worden links)
- Modify: `e2e/mobile.spec.ts` (de nieuwe route uitzonderen)

**Interfaces:**
- Consumes: `useProducts()` uit Taak 4, de pagina's uit Taak 5.
- Produces: routesleutel `products/[id]` → routenaam `products-id`.

- [ ] **Step 1: Voeg de route toe en zonder hem uit in de veegtest**

In `routes.config.ts`, na `'products/new'`:

```ts
  'products/[id]': { en: '/products/[id]', nl: '/producten/[id]', fr: '/produits/[id]' },
```

In `e2e/mobile.spec.ts`, in `uitzonderingen`:

```ts
  'products/[id]': 'heeft een echt product-id nodig; wordt gedekt door e2e/products.spec.ts',
```

Zonder die uitzondering bezoekt de veegtest letterlijk `/products/[id]` en meet hij een foutpagina.

- [ ] **Step 2: Schrijf de productpagina**

`app/pages/products/[id].vue`:

```vue
<script setup lang="ts">
import { localeCodes } from '~~/routes.config'

const { t, locale } = useI18n()
const route = useRoute()
const user = useSupabaseUser()
const { profile } = useProfile()
const { load, update, setTranslation, removeTranslation } = useProducts()

const product = ref<ProductDetail | null>(null)
const bezig = ref(false)
const saved = ref(false)
const error = ref('')
const nietGevonden = ref(false)

const merk = ref('')
const inhoud = ref<number | null>(null)
const eenheid = ref<string | null>(null)
const gtin = ref('')
const namen = ref<Record<string, string>>({})

const eenheden = computed(() => ['ml', 'g', 'stuk'].map((value) => ({ value, label: value })))

// Bewerken mag de maker en een moderator. product_revision en het terugdraaien
// zijn uitgesteld, dus zonder ongedaan maken is "iedereen mag alles" schade
// die niemand herstelt (spec §2). De database bewaakt dit ook; dit is alleen
// de UI die geen knoppen toont die toch zouden weigeren.
// `profile.role` bestaat sinds Taak 4, Step 3. `profile` wordt gevuld door
// AppHeader.vue tijdens SSR, dus op een ingelogde pagina staat hij er al.
const magBewerken = computed(() =>
  product.value?.createdBy === user.value?.sub
  || ['moderator', 'admin'].includes(profile.value?.role ?? ''),
)

function vul(p: ProductDetail) {
  merk.value = p.brand ?? ''
  inhoud.value = p.netContent
  eenheid.value = p.unit
  gtin.value = p.gtin ?? ''
  namen.value = Object.fromEntries(p.vertalingen.map((v) => [v.locale, v.name]))
}

async function haal() {
  try {
    const p = await load(route.params.id as string)
    if (!p) {
      nietGevonden.value = true
      return
    }
    product.value = p
    vul(p)
  } catch {
    error.value = t('householdSettings.error')
  }
}

await haal()

function bronLabel(source: string): string {
  if (source === 'off') return t('products.sourceOff')
  if (source === 'machine') return t('products.sourceMachine')
  return t('products.sourceUser')
}

async function bewaarGegevens() {
  if (!product.value) return
  bezig.value = true
  error.value = ''
  saved.value = false
  try {
    await update(product.value.id, {
      gtin: gtin.value.trim() || null,
      brand: merk.value.trim() || null,
      netContent: inhoud.value,
      unit: eenheid.value,
    })
    saved.value = true
    await haal()
  } catch {
    error.value = t('householdSettings.error')
  } finally {
    bezig.value = false
  }
}

async function bewaarNaam(taal: string) {
  if (!product.value) return
  bezig.value = true
  error.value = ''
  try {
    const waarde = (namen.value[taal] ?? '').trim()
    if (waarde) await setTranslation(product.value.id, taal, waarde)
    else await removeTranslation(product.value.id, taal)
    await haal()
  } catch {
    error.value = t('householdSettings.error')
  } finally {
    bezig.value = false
  }
}

const getoondeNaam = computed(() => {
  const v = product.value?.vertalingen ?? []
  return v.find((x) => x.locale === locale.value)
    ?? v.find((x) => x.locale === 'en')
    ?? v[0]
})
</script>

<template>
  <UContainer class="max-w-lg py-12">
    <UAlert v-if="nietGevonden" color="error" :description="t('products.notFound')" />

    <template v-else-if="product">
      <h1 class="text-2xl font-bold">{{ getoondeNaam?.name }}</h1>
      <p v-if="getoondeNaam && getoondeNaam.locale !== locale" class="mt-1 text-sm text-muted">
        {{ t('products.shownIn', { language: getoondeNaam.locale.toUpperCase() }) }}
      </p>
      <UBadge class="mt-2" variant="subtle">
        {{ t(`products.status${product.status.charAt(0).toUpperCase()}${product.status.slice(1)}`) }}
      </UBadge>

      <section class="mt-8">
        <h2 class="mb-3 font-semibold">{{ t('products.names') }}</h2>
        <!-- Alle drie de taalvakjes, ook de lege. Dat is hoe de catalogus
             meertalig wordt en de natuurlijkste plek om bij te dragen. -->
        <div class="space-y-3">
          <UFormField
            v-for="taal in localeCodes"
            :key="taal"
            :label="taal.toUpperCase()"
            :help="product.vertalingen.find((v) => v.locale === taal)
              ? bronLabel(product.vertalingen.find((v) => v.locale === taal)!.source)
              : undefined"
            :name="`naam-${taal}`"
          >
            <div class="flex flex-col gap-2 sm:flex-row">
              <UInput
                v-model="namen[taal]"
                :disabled="!magBewerken"
                :maxlength="200"
                class="w-full sm:flex-1"
              />
              <UButton
                v-if="magBewerken"
                size="sm"
                variant="subtle"
                :loading="bezig"
                @click="bewaarNaam(taal)"
              >
                {{ t('products.save') }}
              </UButton>
            </div>
          </UFormField>
        </div>
      </section>

      <section v-if="magBewerken" class="mt-8">
        <form class="space-y-4" @submit.prevent="bewaarGegevens">
          <UFormField :label="t('products.brand')" name="merk">
            <UInput v-model="merk" class="w-full" />
          </UFormField>

          <UFormField :label="t('products.netContent')" :help="t('products.contentHelp')" name="inhoud">
            <div class="flex flex-col gap-2 sm:flex-row">
              <UInput v-model.number="inhoud" type="number" min="0" class="w-full sm:flex-1" />
              <USelect
                v-model="eenheid"
                :items="eenheden"
                value-key="value"
                :aria-label="t('products.unit')"
                class="w-full sm:w-auto"
              />
            </div>
          </UFormField>

          <UFormField :label="t('products.gtin')" :help="t('products.gtinHelp')" name="gtin">
            <UInput v-model="gtin" :maxlength="14" class="w-full" />
          </UFormField>

          <UAlert v-if="error" color="error" :description="error" />
          <UAlert v-else-if="saved" color="success" :description="t('products.saved')" />

          <UButton type="submit" :loading="bezig">{{ t('products.save') }}</UButton>
        </form>
      </section>

      <UAlert v-else-if="error" class="mt-8" color="error" :description="error" />
    </template>
  </UContainer>
</template>
```

- [ ] **Step 3: Maak de resultaatrijen klikbaar**

In `app/pages/products/index.vue`, vervang de inhoud van de `<li>` door een `NuxtLink`:

```vue
      <li v-for="r in resultaten" :key="r.productId" class="py-3">
        <NuxtLink :to="localePath({ name: 'products-id', params: { id: r.productId } })" class="block">
          <p class="font-medium">{{ r.naam }}</p>
          <p class="text-sm text-muted">
            <span v-if="r.merk">{{ r.merk }}</span>
            <span v-if="r.netContent"> · {{ r.netContent }} {{ r.unit }}</span>
            <span v-if="r.getoondeTaal !== $i18n.locale"> · {{ t('products.shownIn', { language: r.getoondeTaal.toUpperCase() }) }}</span>
            <span v-if="r.status === 'proposed'"> · {{ t('products.statusProposed') }}</span>
          </p>
        </NuxtLink>
      </li>
```

- [ ] **Step 4: Draai de suites**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:e2e`
Expected: alles groen, inclusief de veegtest — die slaat `products/[id]` nu over met de opgeschreven reden.

- [ ] **Step 5: Commit**

```bash
git add routes.config.ts app/pages/products e2e/mobile.spec.ts
git commit -m "feat: productpagina met vertalingen en bewerken"
```

---

### Task 7: End-to-end en de vierde stapeltest

**Files:**
- Create: `e2e/products.spec.ts`
- Modify: `e2e/mobile.spec.ts` (vierde stapelgeval)

**Interfaces:**
- Consumes: alle voorgaande taken.
- Produces: niets voor latere taken.

- [ ] **Step 1: Schrijf de end-to-endtest**

`e2e/products.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { routePath } from '../routes.config'
import { signIn, createHousehold, bundles, waitForHydration } from './helpers'

const en = bundles.en

// De hele weg in één test: aanmaken, terugvinden via zoeken, en een naam in
// een tweede taal erbij. Dat laatste bewijst het vertaalpad, dat geen enkele
// databasetest end-to-end raakt.
test('een gebruiker maakt een product aan en vindt het terug', async ({ page }) => {
  const merk = `Merk${Date.now()}`
  await signIn(page, `catalogus-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Cato', huishouden: 'Cataloghuis' })

  await page.goto(routePath('products/new', 'en'))
  await waitForHydration(page)
  await page.getByLabel(en.products.name).fill('Bio halfvolle melk 1 L')
  await page.getByLabel(en.products.brand).fill(merk)
  await page.getByRole('button', { name: en.products.save }).click()

  // De aanmaakpagina stuurt door naar de productpagina.
  await expect(page.getByRole('heading', { name: 'Bio halfvolle melk 1 L' })).toBeVisible()

  // Een tweede taal erbij, via het NL-vakje.
  await page.getByLabel('NL').fill('Bio halfvolle melk')
  await page.getByRole('button', { name: en.products.save }).first().click()
  await expect(page.getByLabel('NL')).toHaveValue('Bio halfvolle melk')

  // Terugvinden op een kort woord in een lange naam — precies het geval
  // waar similarity() op stukloopt en word_similarity() niet.
  await page.goto(routePath('products', 'en'))
  await waitForHydration(page, 'input')
  await page.getByLabel(en.products.search).fill('melk')
  await expect(page.getByText(merk)).toBeVisible()
})

// De andere helft van het bewerkrecht. Zonder dit geval zou een UI die de
// knoppen altijd toont er net zo groen uitzien.
test('een vreemde ziet geen bewerkknoppen op andermans product', async ({ page, browser }) => {
  const naam = `Vreemdproduct${Date.now()}`
  await signIn(page, `maker-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Maki', huishouden: 'Makershuis' })

  await page.goto(routePath('products/new', 'en'))
  await waitForHydration(page)
  await page.getByLabel(en.products.name).fill(naam)
  await page.getByRole('button', { name: en.products.save }).click()
  await expect(page.getByRole('heading', { name: naam })).toBeVisible()
  const productUrl = page.url()

  const context = await browser.newContext()
  const vreemde = await context.newPage()
  await signIn(vreemde, `vreemde-${Date.now()}@example.com`)
  await createHousehold(vreemde, { voornaam: 'Vera', huishouden: 'Vreemdhuis' })

  await vreemde.goto(productUrl)
  await expect(vreemde.getByRole('heading', { name: naam })).toBeVisible()
  await expect(vreemde.getByRole('button', { name: en.products.save })).toHaveCount(0)

  await context.close()
})
```

- [ ] **Step 2: Voeg het vierde stapelgeval toe**

In `e2e/mobile.spec.ts`, in de test `bediening staat gestapeld op 360px in plaats van samengedrukt`, na het bestaande uitnodigingskaart-geval:

```ts
  await page.goto(routePath('products/new', 'en'))
  await verwachtGestapeld(
    page.getByLabel(bundles.en.products.netContent),
    page.getByLabel(bundles.en.products.unit),
    'inhoud-en-eenheid',
  )
```

- [ ] **Step 3: Draai de tests**

Run: `npm run test:e2e`
Expected: alles groen, inclusief de twee nieuwe gevallen en het vierde stapelgeval.

- [ ] **Step 4: Falsificeer het bewerkrecht in de UI**

Vervang `magBewerken` in `app/pages/products/[id].vue` tijdelijk door `computed(() => true)`.

Run: `npm run test:e2e -- products`
Expected: `een vreemde ziet geen bewerkknoppen op andermans product` wordt ROOD. Blijft hij groen, dan toetst hij het recht niet. Zet daarna terug.

- [ ] **Step 5: Draai alle suites**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:db && npm run test:e2e && npm run test:e2e:pwa`
Expected: alles groen.

- [ ] **Step 6: Commit**

```bash
git add e2e/products.spec.ts e2e/mobile.spec.ts
git commit -m "test: de catalogus end-to-end"
```

---

### Task 8: Documentatie

**Files:**
- Modify: `docs/superpowers/open-bevindingen.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: de uitkomsten van alle voorgaande taken.
- Produces: niets.

- [ ] **Step 1: Noteer de openstaande punten**

`docs/superpowers/open-bevindingen.md` gebruikt tabellen met twee kolommen onder sectiekoppen, geen opsommingen. Voeg toe onder **"Functionaliteit die de spec vraagt"**:

```markdown
| **Aliassen, winkels en de OFF-import ontbreken nog.** | De catalogus heeft producten maar geen `product_alias`, dus er is geen brug van bontekst naar product. Dat is bewust uitgesteld: een alias vertaalt bontekst, en er is geen bontekst zolang er geen scanner is. De OFF-import is om een andere reden uitgesteld — hij brengt een ODbL-beslissing mee (share-alike) die in de gebruiksvoorwaarden hoort te staan als bewuste keuze. Zie §1 van `docs/superpowers/specs/2026-09-27-catalogus-producten-design.md`. |
| **Producten zijn te dupliceren.** | Twee mensen kunnen hetzelfde product twee keer aanmaken; `gtin` is meestal leeg en er is geen consensusmotor. De tegenmaatregel is de UI — zoeken gaat altijd vooraf aan aanmaken — en dat is een verzachting, geen oplossing. Wordt opgelost zodra bevestigingen geteld worden. |
| **`product_revision` en terugdraaien ontbreken.** | Daarom mogen alleen de maker en moderators een product bewerken, terwijl het hoofdontwerp zegt dat de catalogus van de gebruikers is. Dat slot gaat eraf zodra er een revisiehistorie is om op terug te vallen. |
```

Voeg toe onder **"Kleine punten"**:

```markdown
| De zoekdrempel van 0,2 is op vier productnamen gekozen. | `search_products` zet `pg_trgm.word_similarity_threshold` functie-lokaal op 0,2, omdat de standaard van 0,6 een typefout als "mlek" (gemeten: 0,200) niets laat vinden. Dat getal is afgesteld op een handvol namen, niet op een gevulde catalogus. Bij tienduizend producten kan het te laag blijken en ruis binnenhalen. Een afstelling, geen ontwerpfout — maar het hoort opnieuw bekeken te worden zodra de OFF-import er is. |
| Een verwijderde gebruiker laat onbewerkbare producten achter. | `product.created_by` is `on delete set null`, dus een bijdrage blijft staan maar verliest haar toeschrijving. Daarna kan alleen nog een moderator dat product bewerken. Dat is de bedoelde afloop, maar het betekent wel dat er na een accountverwijdering producten kunnen ontstaan die niemand meer kan corrigeren zonder moderatierechten. |
```

Werk daarnaast de bestaande bevinding over de beveiligingsadviseur van Supabase bij: die noemt zes `SECURITY DEFINER`-functies. Het zijn er nu meer — tel ze na met de lijst in de migraties en noem het juiste getal, plus dat `search_products` er bewust **niet** bij zit omdat lezen al via de select-policy mag.

- [ ] **Step 2: Werk de README bij**

De README documenteert opzet, tests, de PWA en het deployen, en bevat **geen** overzicht van routes of navigatie — dat is gecontroleerd tijdens de vorige ronde. Er hoeft dus niets toegevoegd te worden over de nieuwe pagina's.

Lees wél de sectie "Tests" na: die beschrijft wat elke suite draait en wat hij nodig heeft. `npm run test:db` heeft er tabellen bij gekregen maar geen nieuwe randvoorwaarde, dus waarschijnlijk klopt hij nog. **Klopt alles, verander dan niets.**

- [ ] **Step 3: Draai alles nog één keer**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:db && npm run test:e2e && npm run test:e2e:pwa`
Expected: alles groen. Laat geen `nuxt dev` op poort 3000 of `workerd` op 3001 achter — allebei gedocumenteerde valkuilen in dit project.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/open-bevindingen.md README.md
git commit -m "docs: bevindingen na de productcatalogus"
```
