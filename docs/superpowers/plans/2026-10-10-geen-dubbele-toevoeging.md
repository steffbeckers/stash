# Geen dubbele toevoeging na een afgebroken verzoek — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Items toevoegen en een product aanmaken maken geen dubbel meer, ook niet als een afgebroken verzoek toch aankwam en de gebruiker opnieuw opslaat.

**Architecture:**
- De client kiest de id's van een nieuwe toevoeging en hergebruikt ze bij een nieuwe poging met dezelfde gegevens (`idsVoorPoging`).
- Voor items geeft een migratie `insert (id)` vrij. Een botsing op `inventory_item_pkey` telt als gelukt (`isAlToegevoegd`).
- Voor producten krijgt `create_product` een optioneel `nieuw_id`, dat bij een herhaalde poging van dezelfde maker het bestaande product teruggeeft.

**Tech Stack:** Nuxt 4, @nuxtjs/supabase 2, Supabase Postgres 17, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-geen-dubbele-toevoeging-design.md`

## Global Constraints

- **Elke "Falsificeer"-stap is verplicht.** Breng de wijziging aan, zie de genoemde test ROOD worden, draai terug door opnieuw te bewerken (nooit `git checkout`) en zie hem GROEN worden. Blijft een test groen, dan herschrijf je de test, nooit de falsificatie. Een commit bevat nooit een gefalsificeerde toestand.
- **De migratie heet `supabase/migrations/20261010100000_geen_dubbele_toevoeging.sql`.** Je past ze lokaal toe met `npx supabase migration up --local`. Een falsificatie in de migratie draai je met `npx supabase db reset --local`. Dat wist de lokale database, wat `npm run test:db` toch al doet.
- **`create_product` blijft `security definer`.** De oude handtekening (zes `text`/`numeric`-parameters) verdwijnt; de nieuwe is `create_product(text, text, numeric, text, text, text, uuid)`, met `nieuw_id uuid default null`.
- **`isAlToegevoegd`** herkent alleen `code === '23505'` met `inventory_item_pkey` in de melding.
- **De termijn blijft 10 s, ook in e2e.** Geen vaste pauzes als vervanging voor volgorde.
- **Commentaar, testnamen en meldingen in het Nederlands.**
- **Stop een eigen `nuxt dev` op poort 3000 vóór e2e.** Bij `Another Nuxt dev is already running`: verwijder `.nuxt/nuxt.lock` en kill nooit het genoemde PID. Draai de volledige e2e-suite met `--workers=2`.
- **Elke commit eindigt met de Co-Authored-By-regel van je eigen harness.** Commits worden via 1Password gesigneerd. Faalt dat onduidelijk, meld dan BLOCKED; omzeil het signeren nooit.

## Review Focus

- **Een nieuwe poging na middernacht.** `acquiredAt` is vandaag, en verandert dan. Dezelfde ingevulde gegevens moeten toch dezelfde id's geven, dus de sleutel laat `acquiredAt` weg. Dat pint `toevoegsleutel` in Task 1.
- **Een nieuwe poging met een ander aantal** is een andere toevoeging en krijgt nieuwe id's. Dat pint de test "een ander aantal" van `idsVoorPoging` in Task 1.
- **`create_product` twee keer met hetzelfde id, maar een andere naam** (alleen bereikbaar buiten de app) geeft het bestaande product terug en wijzigt de naam niet. Dat pint een databasetest in Task 2.

## Wat al gemeten is

- **De handtekening van `create_product` staat letterlijk in `test/db/permissions.test.ts`.** In `productFunctions` staat ze als `'create_product(text, text, numeric, text, text, text)'`.
- **Bestaande tests roepen `create_product` met zes argumenten aan.** Dat zijn `test/db/product.test.ts:161, 454` en `test/db/product-search.test.ts:12`. Met `nieuw_id uuid default null` blijven die werken.
- **De gegenereerde types** maak je met `npx supabase gen types typescript --local > app/types/database.types.ts`. Een parameter met een default wordt daar optioneel (`nieuw_id?: string`).
- **De e2e kan bij de database.** `e2e/offline.spec.ts` importeert al `withDb` en verwante functies uit `test/db/helpers.ts`. Die laden `.env` zelf en eisen een lokale host.
- **De foutmelding van de drie formulieren** is `t('householdSettings.error')`: in `inventory/new.vue`, in `InventoryProductPicker.vue` en in `products/new.vue`.

## Bestandsstructuur

| Bestand | Verantwoordelijkheid |
|---|---|
| `app/utils/voorraad.ts` | `Poging`, `idsVoorPoging`, `toevoegsleutel`, `isAlToegevoegd` |
| `test/utils/voorraad.test.ts` | Unittests daarvoor |
| `supabase/migrations/20261010100000_geen_dubbele_toevoeging.sql` (nieuw) | `insert (id)` en `create_product` met `nieuw_id` |
| `test/db/inventory.test.ts`, `test/db/product.test.ts`, `test/db/permissions.test.ts` | Databasetests |
| `app/types/database.types.ts` | Opnieuw gegenereerd |
| `app/composables/useInventory.ts`, `app/pages/inventory/new.vue` | Items met id's |
| `app/composables/useProducts.ts`, `app/components/InventoryProductPicker.vue`, `app/pages/products/new.vue` | Producten met een id |
| `e2e/dubbel.spec.ts` (nieuw) | Drie e2e-tests |
| `docs/superpowers/open-bevindingen.md` | Bijgewerkt |

---

### Task 1: De pure functies

**Files:**
- Modify: `app/utils/voorraad.ts`
- Modify: `test/utils/voorraad.test.ts`

**Interfaces:**
- Produces, in `app/utils/voorraad.ts`:
  - `export interface Poging { sleutel: string; ids: string[] }`
  - `export function idsVoorPoging(vorige: Poging | null, sleutel: string, aantal: number, nieuwId: () => string): Poging`
  - `export function toevoegsleutel(g: { productId: string; storagePlaceId: string; aantal: number; amount: number; unit: string; expiresAt: string | null }): string`
  - `export function isAlToegevoegd(oorzaak: unknown): boolean`

- [ ] **Step 1: Schrijf de tests**

Voeg in `test/utils/voorraad.test.ts` aan de import uit `'../../app/utils/voorraad'` toe: `idsVoorPoging`, `isAlToegevoegd`, `toevoegsleutel`. Voeg aan het einde toe:

```ts
describe('isAlToegevoegd', () => {
  // Spec geen-dubbele-toevoeging §4: een eerdere poging met dezelfde id's kwam
  // al aan, en deze insert botst op de primaire sleutel.
  it('herkent een botsing op de primaire sleutel van inventory_item', () => {
    expect(isAlToegevoegd({
      code: '23505',
      message: 'duplicate key value violates unique constraint "inventory_item_pkey"',
    })).toBe(true)
  })

  // Dezelfde code op een andere constraint is geen eerdere poging van ons.
  it('herkent een botsing op een andere constraint niet', () => {
    expect(isAlToegevoegd({
      code: '23505',
      message: 'duplicate key value violates unique constraint "iets_anders_key"',
    })).toBe(false)
  })

  it('herkent een andere code of iets dat geen databasefout is niet', () => {
    expect(isAlToegevoegd({ code: '23514', message: 'inventory_item_pkey' })).toBe(false)
    expect(isAlToegevoegd(new Error('netwerk'))).toBe(false)
    expect(isAlToegevoegd(null)).toBe(false)
  })
})

describe('idsVoorPoging', () => {
  let teller = 0
  const nieuwId = () => `id-${++teller}`

  it('maakt bij een eerste poging zoveel id's als gevraagd', () => {
    const p = idsVoorPoging(null, 'a', 3, nieuwId)
    expect(p.sleutel).toBe('a')
    expect(p.ids).toHaveLength(3)
    expect(new Set(p.ids).size).toBe(3)
  })

  // Spec §3: dezelfde gegevens geven dezelfde id's, dus geen dubbel.
  it('geeft bij dezelfde sleutel en hetzelfde aantal de vorige id's terug', () => {
    const vorige = idsVoorPoging(null, 'a', 2, nieuwId)
    expect(idsVoorPoging(vorige, 'a', 2, nieuwId)).toBe(vorige)
  })

  it('maakt nieuwe id's bij een andere sleutel', () => {
    const vorige = idsVoorPoging(null, 'a', 2, nieuwId)
    const nieuw = idsVoorPoging(vorige, 'b', 2, nieuwId)
    expect(nieuw.sleutel).toBe('b')
    expect(nieuw.ids.some((id) => vorige.ids.includes(id))).toBe(false)
  })

  // Review Focus: een ander aantal is een andere toevoeging.
  it('maakt nieuwe id's bij een ander aantal', () => {
    const vorige = idsVoorPoging(null, 'a', 2, nieuwId)
    const nieuw = idsVoorPoging(vorige, 'a', 3, nieuwId)
    expect(nieuw.ids).toHaveLength(3)
    expect(nieuw.ids.some((id) => vorige.ids.includes(id))).toBe(false)
  })
})

describe('toevoegsleutel', () => {
  const basis = { productId: 'p', storagePlaceId: 'kast', aantal: 2, amount: 1, unit: 'stuk', expiresAt: '2026-10-20' }

  // Review Focus: een nieuwe poging na middernacht. acquiredAt is vandaag en
  // hoort dus niet in de sleutel; het zit ook niet in het argumenttype.
  it('hangt alleen af van de ingevulde gegevens', () => {
    expect(toevoegsleutel({ ...basis })).toBe(toevoegsleutel({ ...basis }))
  })

  it('verandert als een ingevuld veld verandert', () => {
    const s = toevoegsleutel(basis)
    expect(toevoegsleutel({ ...basis, aantal: 3 })).not.toBe(s)
    expect(toevoegsleutel({ ...basis, expiresAt: null })).not.toBe(s)
    expect(toevoegsleutel({ ...basis, storagePlaceId: 'koelkast' })).not.toBe(s)
    expect(toevoegsleutel({ ...basis, amount: 0.5, unit: 'kg' })).not.toBe(s)
  })

  it('negeert extra velden zoals acquiredAt', () => {
    const met = { ...basis, acquiredAt: '2026-10-10' } as typeof basis
    const later = { ...basis, acquiredAt: '2026-10-11' } as typeof basis
    expect(toevoegsleutel(met)).toBe(toevoegsleutel(later))
  })
})
```

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `npx vitest run test/utils/voorraad.test.ts`
Expected: FAIL, omdat de drie functies niet bestaan.

- [ ] **Step 3: Schrijf de implementatie**

Aan het einde van `app/utils/voorraad.ts`:

```ts
/**
 * Kwam een eerdere poging met dezelfde id's al aan? Dan botst deze insert op
 * de primaire sleutel (spec geen-dubbele-toevoeging §4). Code én
 * constraintnaam, zoals isSamenhangFout: 23505 alleen is élke unieke botsing.
 */
export function isAlToegevoegd(oorzaak: unknown): boolean {
  if (typeof oorzaak !== 'object' || oorzaak === null) return false
  const { code, message } = oorzaak as { code?: unknown; message?: unknown }
  return code === '23505' && typeof message === 'string' && message.includes('inventory_item_pkey')
}

/** Een toevoeging en haar id's (spec geen-dubbele-toevoeging §3). */
export interface Poging {
  sleutel: string
  ids: string[]
}

/**
 * Dezelfde gegevens geven dezelfde id's: een nieuwe poging na een afgebroken
 * verzoek botst dan op de primaire sleutel in plaats van een dubbel te maken.
 * Andere gegevens, of een ander aantal, zijn een andere toevoeging.
 */
export function idsVoorPoging(vorige: Poging | null, sleutel: string, aantal: number, nieuwId: () => string): Poging {
  if (vorige && vorige.sleutel === sleutel && vorige.ids.length === aantal) return vorige
  return { sleutel, ids: Array.from({ length: aantal }, () => nieuwId()) }
}

/**
 * De sleutel van een voorraadtoevoeging: alleen wat de gebruiker invulde.
 * acquiredAt hoort er niet in: dat is vandaag, en een nieuwe poging na
 * middernacht blijft dezelfde toevoeging.
 */
export function toevoegsleutel(g: {
  productId: string
  storagePlaceId: string
  aantal: number
  amount: number
  unit: string
  expiresAt: string | null
}): string {
  return JSON.stringify([g.productId, g.storagePlaceId, g.aantal, g.amount, g.unit, g.expiresAt])
}
```

- [ ] **Step 4: Draai de tests en zie ze slagen**

Run: `npx vitest run test/utils/voorraad.test.ts`
Expected: PASS.

- [ ] **Step 5: Falsificeer**

| Wijziging | Moet rood worden |
|---|---|
| In `isAlToegevoegd` `&& message.includes('inventory_item_pkey')` weghalen | "herkent een botsing op een andere constraint niet" |
| In `idsVoorPoging` de `if (vorige && …) return vorige` weghalen | "geeft bij dezelfde sleutel en hetzelfde aantal de vorige id's terug" |
| In `idsVoorPoging` `&& vorige.ids.length === aantal` weghalen | "maakt nieuwe id's bij een ander aantal" |
| In `idsVoorPoging` `vorige.sleutel === sleutel &&` weghalen | "maakt nieuwe id's bij een andere sleutel" |
| In `toevoegsleutel` `JSON.stringify(g)` gebruiken (alle velden, ook extra) | "negeert extra velden zoals acquiredAt" |
| In `toevoegsleutel` `g.expiresAt` weglaten | "verandert als een ingevuld veld verandert" |

- [ ] **Step 6: Lint en commit**

```bash
npx eslint app/utils/voorraad.ts test/utils/voorraad.test.ts
npx vitest run
git add app/utils/voorraad.ts test/utils/voorraad.test.ts
git commit -m "feat: idsVoorPoging, toevoegsleutel en isAlToegevoegd"
```

---

### Task 2: De migratie en de databasetests

**Files:**
- Create: `supabase/migrations/20261010100000_geen_dubbele_toevoeging.sql`
- Modify: `test/db/inventory.test.ts`, `test/db/product.test.ts`, `test/db/permissions.test.ts`
- Modify: `app/types/database.types.ts` (opnieuw gegenereerd)

**Interfaces:**
- Produces:
  - in de database: `grant insert (id) on inventory_item to authenticated`, en `create_product(gtin text, brand text, net_content numeric, unit text, locale text, name text, nieuw_id uuid default null) returns uuid`;
  - in de types: `create_product` Args met `nieuw_id?: string`.

- [ ] **Step 1: Schrijf de databasetests**

In `test/db/inventory.test.ts`, binnen `describe('inventory_item: rechten', …)`, na de test `'een buitenstaander kan geen voorraad toevoegen aan andermans huishouden'`:

```ts
  // Spec geen-dubbele-toevoeging §4: de client kiest het id, zodat een nieuwe
  // poging op de primaire sleutel botst in plaats van een dubbel te maken.
  it('een lid mag een item toevoegen met een gekozen id', async () => {
    const eigenaar = await createUser('kiest-id@example.com')
    const gekozen = '00000000-0000-4000-8000-000000000001'
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      await actAs(tx, eigenaar)
      await enableRls(tx)
      await tx`
        insert into inventory_item (id, household_id, product_id, storage_place_id)
        values (${gekozen}, ${hh.id}, ${p}, ${hh.plaats('pantry')})
      `
      await tx`reset role`
      const rijen = await tx<{ id: string }[]>`select id from inventory_item`
      expect(rijen.map((r) => r.id)).toEqual([gekozen])
    })
  })

  it('een tweede insert met hetzelfde id botst op de primaire sleutel en maakt geen dubbel', async () => {
    const eigenaar = await createUser('dubbel-id@example.com')
    const gekozen = '00000000-0000-4000-8000-000000000002'
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      await actAs(tx, eigenaar)
      await enableRls(tx)
      const invoegen = (sql: Sql) => sql`
        insert into inventory_item (id, household_id, product_id, storage_place_id)
        values (${gekozen}, ${hh.id}, ${p}, ${hh.plaats('pantry')})
      `
      await invoegen(tx)
      await expect(tx.savepoint((sp) => invoegen(sp as unknown as Sql))).rejects.toThrow(/inventory_item_pkey/)
      await tx`reset role`
      expect((await tx`select 1 from inventory_item`).length).toBe(1)
    })
  })

  it('een buitenstaander kan ook met een gekozen id niets toevoegen', async () => {
    const eigenaar = await createUser('eigenaar-gekozen@example.com')
    const vreemde = await createUser('vreemde-gekozen@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      await actAs(tx, vreemde)
      await enableRls(tx)
      await expect(tx`
        insert into inventory_item (id, household_id, product_id, storage_place_id)
        values ('00000000-0000-4000-8000-000000000003', ${hh.id}, ${p}, ${hh.plaats('pantry')})
      `).rejects.toThrow(/row-level security/)
    })
  })
```

In `test/db/product.test.ts`, aan het einde van het bestand:

```ts
describe('create_product met een gekozen id', () => {
  beforeEach(resetDb)
  const gekozen = '00000000-0000-4000-8000-0000000000aa'

  // Spec geen-dubbele-toevoeging §5: een nieuwe poging van dezelfde maker
  // krijgt hetzelfde product terug, zonder dubbel en zonder tweede vertaling.
  it('geeft bij een nieuwe poging van dezelfde maker hetzelfde product terug, zonder dubbel', async () => {
    const maker = await createUser('maker-gekozen@example.com')
    await withTx(async (tx) => {
      await actAs(tx, maker)
      await enableRls(tx)
      const [a] = await tx<{ id: string }[]>`select create_product(null, null, null, null, 'nl', 'Melk', ${gekozen}) as id`
      const [b] = await tx<{ id: string }[]>`select create_product(null, null, null, null, 'nl', 'Melk', ${gekozen}) as id`
      expect(a!.id).toBe(gekozen)
      expect(b!.id).toBe(gekozen)
      await tx`reset role`
      expect((await tx`select 1 from product`).length).toBe(1)
      expect((await tx`select 1 from product_translation where product_id = ${gekozen}`).length).toBe(1)
    })
  })

  // Review Focus: alleen bereikbaar buiten de app, want de app maakt bij
  // andere gegevens een nieuw id.
  it('wijzigt bij een nieuwe poging met een andere naam het bestaande product niet', async () => {
    const maker = await createUser('maker-andere-naam@example.com')
    await withTx(async (tx) => {
      await actAs(tx, maker)
      await enableRls(tx)
      await tx`select create_product(null, null, null, null, 'nl', 'Melk', ${gekozen})`
      const [b] = await tx<{ id: string }[]>`select create_product(null, null, null, null, 'nl', 'Kaas', ${gekozen}) as id`
      expect(b!.id).toBe(gekozen)
      await tx`reset role`
      const namen = await tx<{ name: string }[]>`select name from product_translation where product_id = ${gekozen}`
      expect(namen.map((n) => n.name)).toEqual(['Melk'])
    })
  })

  it('weigert het id van andermans product, en verandert niets', async () => {
    const eerste = await createUser('eerste-maker@example.com')
    const ander = await createUser('andere-maker@example.com')
    await withTx(async (tx) => {
      await actAs(tx, eerste)
      await enableRls(tx)
      await tx`select create_product(null, null, null, null, 'nl', 'Melk', ${gekozen})`
      await actAs(tx, ander)
      await expect(
        tx.savepoint((sp) => (sp as unknown as Sql)`select create_product(null, null, null, null, 'nl', 'Kaas', ${gekozen})`),
      ).rejects.toThrow(/product bestaat al/)
      await tx`reset role`
      const namen = await tx<{ name: string }[]>`select name from product_translation where product_id = ${gekozen}`
      expect(namen.map((n) => n.name)).toEqual(['Melk'])
    })
  })

  it('maakt zonder id een nieuw product, zoals voorheen', async () => {
    const maker = await createUser('maker-zonder-id@example.com')
    await withTx(async (tx) => {
      await actAs(tx, maker)
      await enableRls(tx)
      await tx`select create_product(null, null, null, null, 'nl', 'Melk')`
      await tx`select create_product(null, null, null, null, 'nl', 'Melk')`
      await tx`reset role`
      expect((await tx`select 1 from product`).length).toBe(2)
    })
  })
})
```

In `test/db/permissions.test.ts`, in `productFunctions`: vervang `'create_product(text, text, numeric, text, text, text)'` door `'create_product(text, text, numeric, text, text, text, uuid)'`.

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `npm run test:db`
Expected: FAIL.
- "een lid mag een item toevoegen met een gekozen id" en "een tweede insert…": `permission denied for table inventory_item`.
- De `create_product`-tests: de functie met zeven argumenten bestaat niet.
- De rechtentest: de nieuwe handtekening bestaat niet.

"Een buitenstaander kan ook met een gekozen id niets toevoegen" kan al slagen (of falen op `permission denied`); ze pint bestaande RLS vast.

- [ ] **Step 3: Schrijf de migratie**

`supabase/migrations/20261010100000_geen_dubbele_toevoeging.sql`:

```sql
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
```

Pas de migratie toe: `npx supabase migration up --local`.

- [ ] **Step 4: Draai de tests en zie ze slagen**

Run: `npm run test:db`
Expected: PASS, ook de bestaande producttests die `create_product` met zes argumenten aanroepen.

- [ ] **Step 5: Genereer de types opnieuw**

Run: `npx supabase gen types typescript --local > app/types/database.types.ts`
Kijk na dat `create_product` nu `nieuw_id?: string` in zijn `Args` heeft. Run: `npx vue-tsc --noEmit -p .`. Expected: geen fouten.

- [ ] **Step 6: Falsificeer**

Voor de migratie-mutaties: pas het bestand aan, draai `npx supabase db reset --local`, dan `npm run test:db`. Zet terug, draai opnieuw `npx supabase db reset --local` en `npm run test:db`.

| Wijziging | Moet rood worden |
|---|---|
| In de test "een lid mag een item toevoegen met een gekozen id" vóór `enableRls` tijdelijk `await tx\`revoke insert (id) on inventory_item from authenticated\`` (geen migratiewijziging) | die test |
| In de migratie `on conflict (id) do nothing` weghalen | "geeft bij een nieuwe poging van dezelfde maker hetzelfde product terug…" |
| In de migratie het blok `if maker is distinct from actor then raise … end if;` weghalen | "weigert het id van andermans product…" |
| In de migratie `return nieuw_id;` in het blok `if new_id is null` vervangen door doorvallen naar de vertaling (blok weg) | "geeft bij een nieuwe poging van dezelfde maker…" (twee vertalingen) |

- [ ] **Step 7: Commit**

```bash
npx eslint test/db
git add supabase/migrations/20261010100000_geen_dubbele_toevoeging.sql test/db/inventory.test.ts test/db/product.test.ts test/db/permissions.test.ts app/types/database.types.ts
git commit -m "feat: gekozen id's voor items en create_product, idempotent bij een nieuwe poging"
```

---

### Task 3: Items toevoegen zonder dubbel

**Files:**
- Modify: `app/composables/useInventory.ts`
- Modify: `app/pages/inventory/new.vue`
- Create: `e2e/dubbel.spec.ts`

**Interfaces:**
- Consumes: `idsVoorPoging`, `toevoegsleutel`, `isAlToegevoegd`, `Poging` (Task 1); `grant insert (id)` (Task 2).
- Produces:
  - `Toevoeging` met `ids: string[]` in plaats van `aantal: number`;
  - in `e2e/dubbel.spec.ts`: de helpers `slot()`, `tekst()`, `houdEersteAntwoordVast(page, patroon, past)` en `aantalVertalingen(naam)`.

- [ ] **Step 1: Schrijf de e2e-test**

`e2e/dubbel.spec.ts`:

```ts
import { test, expect, type Page, type Request } from '@playwright/test'
import { routePath } from '../routes.config'
import { signIn, createHousehold, bundles, waitForHydration } from './helpers'
import { withDb } from '../test/db/helpers'

// Spec docs/superpowers/specs/2026-10-10-geen-dubbele-toevoeging-design.md §6.

const en = bundles.en

function tekst(sjabloon: string, waarden: Record<string, string | number>): string {
  return Object.entries(waarden).reduce((t, [k, v]) => t.replace(`{${k}}`, String(v)), sjabloon)
}

/** Een belofte die de test zelf vrijgeeft. */
function slot(): { vrij: Promise<void>; vrijgeven: () => void } {
  let vrijgeven!: () => void
  const vrij = new Promise<void>((r) => { vrijgeven = r })
  return { vrij, vrijgeven }
}

/**
 * Laat het eerste verzoek dat aan `past` voldoet bij de server aankomen, maar
 * houdt het antwoord tegen: de pagina breekt het af op de termijn, terwijl de
 * server het al verwerkte. Elk volgend verzoek gaat gewoon door.
 */
async function houdEersteAntwoordVast(page: Page, patroon: string, past: (r: Request) => boolean) {
  const { vrij, vrijgeven } = slot()
  let pogingen = 0
  await page.route(patroon, async (route) => {
    if (!past(route.request())) return route.fallback()
    pogingen++
    if (pogingen > 1) return route.fallback()
    const antwoord = await route.fetch()
    await vrij
    await route.fulfill({ response: antwoord }).catch(() => {})
  })
  return { vrijgeven }
}

/** Hoeveel producten met deze naam er in de catalogus staan, rechtstreeks in de lokale database. */
async function aantalVertalingen(naam: string): Promise<number> {
  let n = 0
  await withDb(async (sql) => {
    const [rij] = await sql<{ n: number }[]>`select count(*)::int as n from product_translation where name = ${naam}`
    n = rij!.n
  })
  return n
}

test('opnieuw opslaan na een afgebroken toevoeging maakt geen dubbel', async ({ page }) => {
  const naam = `Dubbelvrij${Date.now()}`
  await signIn(page, `dubbel-item-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Dirk', huishouden: 'Dubbelhuis' })
  await page.goto(routePath('inventory', 'en'))
  await page.getByRole('link', { name: tekst(en.inventory.addTo, { place: 'Pantry' }), exact: true }).click()
  await waitForHydration(page, 'input')
  await page.getByLabel(en.inventory.searchProduct).fill(naam)
  await page.getByRole('button', { name: tekst(en.products.createNamed, { name: naam }) }).click()
  await page.getByRole('button', { name: en.inventory.createProduct }).click()
  await expect(page.getByRole('button', { name: en.inventory.changeProduct })).toBeVisible()
  await page.getByLabel(en.inventory.count).fill('2')

  const vast = await houdEersteAntwoordVast(page, '**/rest/v1/inventory_item*', (r) => r.method() === 'POST')
  await page.getByRole('button', { name: en.inventory.save }).click()
  // Pas na de termijn van 10 s: de server heeft de twee items, de pagina het antwoord niet.
  await expect(page.getByText(en.householdSettings.error, { exact: true })).toBeVisible({ timeout: 20_000 })

  // Opnieuw opslaan met dezelfde gegevens: dezelfde id's, dus geen dubbel.
  await page.getByRole('button', { name: en.inventory.save }).click()
  await expect(page).toHaveURL(routePath('inventory', 'en'))
  const groep = page.getByRole('region', { name: 'Pantry' }).getByRole('listitem').filter({ hasText: naam }).first()
  await expect(groep).toContainText('×2', { timeout: 15_000 })
  vast.vrijgeven()
})
```

- [ ] **Step 2: Draai de test en zie hem falen**

Run: `npx playwright test e2e/dubbel.spec.ts -g "afgebroken toevoeging" --reporter=line`
Expected: FAIL. De groep toont `×4`, want elke poging maakt nieuwe rijen. Kan de pagina geen id meesturen, dan faalt de tweede poging op een andere manier. Beide zijn rood.

- [ ] **Step 3: Pas `useInventory().add` aan**

In `app/composables/useInventory.ts`:

Importeer `isAlToegevoegd` uit `'~/utils/voorraad'` (naast de bestaande type-import).

In `Toevoeging` vervang je `aantal: number` door:

```ts
  /** Eén per item; een nieuwe poging met dezelfde id's maakt geen dubbel (spec geen-dubbele-toevoeging §4). */
  ids: string[]
```

`add` wordt:

```ts
  async function add(t: Toevoeging): Promise<void> {
    const rijen = t.ids.map((id) => ({
      id,
      household_id: t.householdId,
      product_id: t.productId,
      storage_place_id: t.storagePlaceId,
      amount: t.amount,
      unit: t.unit,
      acquired_at: t.acquiredAt,
      expires_at: t.expiresAt,
    }))
    // Eén insert met N rijen is één statement: alles of niets. Botst ze op de
    // primaire sleutel, dan kwam een eerdere poging met dezelfde id's al
    // helemaal aan (spec geen-dubbele-toevoeging §4).
    const { error } = await supabase.from('inventory_item').insert(rijen)
    if (error && !isAlToegevoegd(error)) throw error
  }
```

Zoek andere aanroepers van `add(`/`Toevoeging` met `grep -rn "aantal:" app` en pas ze aan. Verwacht wordt alleen `inventory/new.vue`.

- [ ] **Step 4: Pas de toevoegpagina aan**

In `app/pages/inventory/new.vue`:

De import uit `'~/utils/voorraad'` krijgt erbij: `idsVoorPoging`, `toevoegsleutel`, `type Poging`.

Na `const error = ref('')`:

```ts
// De id's van de laatste poging: een nieuwe poging met dezelfde gegevens
// hergebruikt ze, zodat een afgebroken toevoeging geen dubbel maakt (spec
// geen-dubbele-toevoeging §3–§4).
let poging: Poging | null = null
```

Het `try`-blok in de opslagfunctie wordt:

```ts
  try {
    const gegevens = {
      productId: product.value.productId,
      storagePlaceId: plaats.value,
      aantal: n,
      amount,
      unit,
      expiresAt: vervaldatum.value || null,
    }
    poging = idsVoorPoging(poging, toevoegsleutel(gegevens), n, () => crypto.randomUUID())
    await add({
      householdId: activeId.value,
      productId: gegevens.productId,
      storagePlaceId: gegevens.storagePlaceId,
      ids: poging.ids,
      amount,
      unit,
      acquiredAt: lokaleDatum(new Date()),
      expiresAt: gegevens.expiresAt,
    })
    toast.add({ title: t('inventory.added', { count: n, name: product.value.naam }), color: 'success' })
    await navigateTo(localePath('inventory'))
  } catch {
```

De `catch` en de `finally` blijven ongewijzigd. Behoud de bestaande typevernauwing van `activeId.value` en `plaats.value` zoals de code ze vóór het `try`-blok al doet. Geeft `vue-tsc` een fout op `storagePlaceId`, gebruik dan dezelfde uitdrukking die het origineel aan `add` gaf.

- [ ] **Step 5: Draai de tests en zie ze slagen**

Run: `npx playwright test e2e/dubbel.spec.ts -g "afgebroken toevoeging" --reporter=line`
Expected: PASS.
Run: `npx playwright test e2e/inventory.spec.ts e2e/offline.spec.ts -g "toevoeg|voegToe|Pantry" --reporter=line`
Expected: PASS. De bestaande toevoegtests blijven groen.

- [ ] **Step 6: Falsificeer**

| Wijziging | Moet rood worden |
|---|---|
| In `new.vue` `idsVoorPoging(poging, …)` vervangen door `idsVoorPoging(null, …)` (elke poging nieuwe id's) | "opnieuw opslaan na een afgebroken toevoeging…" (`×4`) |
| In `add` `&& !isAlToegevoegd(error)` weghalen | "opnieuw opslaan na een afgebroken toevoeging…" (de tweede poging toont weer de fout, geen navigatie) |

- [ ] **Step 7: Lint, types, unit en commit**

```bash
npx eslint app/composables/useInventory.ts app/pages/inventory/new.vue e2e/dubbel.spec.ts
npx vue-tsc --noEmit -p .
npx vitest run
git add app/composables/useInventory.ts app/pages/inventory/new.vue e2e/dubbel.spec.ts
git commit -m "feat: opnieuw opslaan na een afgebroken toevoeging maakt geen dubbel"
```

---

### Task 4: Een product aanmaken zonder dubbel

**Files:**
- Modify: `app/composables/useProducts.ts`
- Modify: `app/components/InventoryProductPicker.vue`
- Modify: `app/pages/products/new.vue`
- Modify: `e2e/dubbel.spec.ts`

**Interfaces:**
- Consumes: `idsVoorPoging`, `Poging` (Task 1); `create_product(…, nieuw_id)` en de types (Task 2); `houdEersteAntwoordVast`, `aantalVertalingen`, `tekst` (Task 3).
- Produces: `useProducts().create(invoer, id?: string): Promise<string>`.

- [ ] **Step 1: Schrijf de e2e-tests**

In `e2e/dubbel.spec.ts`, na de test van Task 3:

```ts
test('opnieuw aanmaken na een afgebroken productaanmaak in de productkiezer maakt geen dubbel', async ({ page }) => {
  const naam = `Kiezerdubbel${Date.now()}`
  await signIn(page, `dubbel-kiezer-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Kim', huishouden: 'Kiezerhuis' })
  await page.goto(routePath('inventory', 'en'))
  await page.getByRole('link', { name: tekst(en.inventory.addTo, { place: 'Pantry' }), exact: true }).click()
  await waitForHydration(page, 'input')
  await page.getByLabel(en.inventory.searchProduct).fill(naam)
  await page.getByRole('button', { name: tekst(en.products.createNamed, { name: naam }) }).click()

  const vast = await houdEersteAntwoordVast(page, '**/rest/v1/rpc/create_product', (r) => r.method() === 'POST')
  await page.getByRole('button', { name: en.inventory.createProduct }).click()
  await expect(page.getByText(en.householdSettings.error, { exact: true })).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: en.inventory.createProduct }).click()
  await expect(page.getByRole('button', { name: en.inventory.changeProduct })).toBeVisible()
  expect(await aantalVertalingen(naam)).toBe(1)
  vast.vrijgeven()
})

test('opnieuw bewaren na een afgebroken productaanmaak op de pagina nieuw product maakt geen dubbel', async ({ page }) => {
  const naam = `Paginadubbel${Date.now()}`
  await signIn(page, `dubbel-pagina-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Pim', huishouden: 'Paginahuis' })
  await page.goto(routePath('products/new', 'en'))
  await waitForHydration(page, 'input')
  await page.getByLabel(en.products.name).fill(naam)

  const vast = await houdEersteAntwoordVast(page, '**/rest/v1/rpc/create_product', (r) => r.method() === 'POST')
  await page.getByRole('button', { name: en.products.save }).click()
  await expect(page.getByText(en.householdSettings.error, { exact: true })).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: en.products.save }).click()
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}/)
  expect(await aantalVertalingen(naam)).toBe(1)
  vast.vrijgeven()
})
```

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `npx playwright test e2e/dubbel.spec.ts -g "productaanmaak" --reporter=line`
Expected: FAIL. Beide tellen 2 vertalingen, omdat elke poging een nieuw product maakt.

- [ ] **Step 3: Pas `useProducts().create` aan**

In `app/composables/useProducts.ts` worden de handtekening en de RPC-aanroep van `create`:

```ts
  /**
   * `id`: gekozen door de aanroeper en hergebruikt bij een nieuwe poging, zodat
   * een afgebroken aanmaak geen dubbel maakt (spec geen-dubbele-toevoeging §5).
   */
  async function create(invoer: ProductInvoer & { locale: string, name: string }, id?: string): Promise<string> {
    const { data, error } = await supabase.rpc('create_product', {
```

Voeg in het argumentobject na `name: invoer.name,` toe:

```ts
      nieuw_id: id,
```

Het bestaande commentaar en de casts blijven.

- [ ] **Step 4: Pas de productkiezer aan**

In `app/components/InventoryProductPicker.vue`:

Importeer `idsVoorPoging` en `type Poging` uit `'~/utils/voorraad'`. Staat er al een import uit dat bestand, voeg ze daar toe.

Boven `async function maakAan()`:

```ts
// Het id van de laatste poging: een nieuwe poging met dezelfde gegevens
// hergebruikt het (spec geen-dubbele-toevoeging §5).
let poging: Poging | null = null
```

Het `try`-blok van `maakAan` wordt:

```ts
  try {
    const invoer = {
      gtin: null,
      brand: merk.value.trim() || null,
      netContent: paar.netContent,
      unit: paar.unit,
      locale: locale.value,
      name: naam.value.trim(),
    }
    poging = idsVoorPoging(poging, JSON.stringify(invoer), 1, () => crypto.randomUUID())
    const id = await create(invoer, poging.ids[0])
    gekozen.value = { productId: id, naam: naam.value.trim() }
    aanmaken.value = false
  } catch {
```

- [ ] **Step 5: Pas de pagina nieuw product aan**

In `app/pages/products/new.vue`:

Importeer `idsVoorPoging` en `type Poging` uit `'~/utils/voorraad'`.

Boven `async function bewaar()`:

```ts
// Het id van de laatste poging: een nieuwe poging met dezelfde gegevens
// hergebruikt het (spec geen-dubbele-toevoeging §5).
let poging: Poging | null = null
```

Het `try`-blok van `bewaar` wordt:

```ts
  try {
    const invoer = {
      gtin: gtin.value.trim() || null,
      brand: merk.value.trim() || null,
      netContent: paar.netContent,
      unit: paar.unit,
      locale: locale.value,
      name: naam.value.trim(),
    }
    poging = idsVoorPoging(poging, JSON.stringify(invoer), 1, () => crypto.randomUUID())
    const id = await create(invoer, poging.ids[0])
    await navigateTo(localePath({ name: 'products-id', params: { id } }))
  } catch {
```

- [ ] **Step 6: Draai de tests en zie ze slagen**

Run: `npx playwright test e2e/dubbel.spec.ts --reporter=line`
Expected: PASS (3 tests).
Run: `npx playwright test e2e/products.spec.ts e2e/inventory.spec.ts --reporter=line` (bestaat een bestand niet, laat het weg).
Expected: PASS.

- [ ] **Step 7: Falsificeer**

| Wijziging | Moet rood worden |
|---|---|
| In de productkiezer `idsVoorPoging(poging, …)` vervangen door `idsVoorPoging(null, …)` | "…in de productkiezer maakt geen dubbel" |
| Op de pagina nieuw product `idsVoorPoging(poging, …)` vervangen door `idsVoorPoging(null, …)` | "…op de pagina nieuw product maakt geen dubbel" |
| In `useProducts().create` `nieuw_id: id` weghalen | beide productaanmaaktests |

- [ ] **Step 8: Lint, types, unit en commit**

```bash
npx eslint app/composables/useProducts.ts app/components/InventoryProductPicker.vue app/pages/products/new.vue e2e/dubbel.spec.ts
npx vue-tsc --noEmit -p .
npx vitest run
git add app/composables/useProducts.ts app/components/InventoryProductPicker.vue app/pages/products/new.vue e2e/dubbel.spec.ts
git commit -m "feat: opnieuw aanmaken na een afgebroken productaanmaak maakt geen dubbel"
```

---

### Task 5: Documentatie en de volledige suite

**Files:**
- Modify: `docs/superpowers/open-bevindingen.md`
- Modify: `docs/superpowers/specs/2026-10-10-geen-dubbele-toevoeging-design.md` (alleen bij afwijkingen)

- [ ] **Step 1: Werk `open-bevindingen.md` bij**

Vervang de rij die begint met `| **Een afgebroken toevoeging kan een duplicaat geven.** |` door:

```
| **Een afgebroken aanmaak van een huishouden, bewaarplaats of uitnodiging kan een duplicaat geven.** | Items en producten zijn idempotent sinds `docs/superpowers/specs/2026-10-10-geen-dubbele-toevoeging-design.md`: de client kiest het id, en een nieuwe poging met dezelfde gegevens botst op de primaire sleutel. Een huishouden, een bewaarplaats en een uitnodiging aanmaken doen dat niet. Een POST die de server al verwerkte maar waarvan het antwoord na 10 s nog niet binnen was, toont een fout, en wie opnieuw opslaat maakt een tweede rij. Die gebeuren zelden, en meestal niet bij slecht signaal. Ook bij items en producten geldt: wie na een fout het formulier aanpast, maakt een nieuwe toevoeging. |
```

- [ ] **Step 2: Draai alles**

```bash
npx vitest run
npm run test:db
npx eslint .
npx vue-tsc --noEmit -p .
npx playwright test --workers=2 --reporter=line
```

Expected: alles groen. Zet de ruwe staart van de e2e-uitvoer (de laatste ~15 regels) in het rapport. Faalt een test in het aanmelden of de opzet, draai hem dan één keer alleen opnieuw en meld beide runs. Een gedragsfout is echt: meld BLOCKED.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/open-bevindingen.md docs/superpowers/specs/2026-10-10-geen-dubbele-toevoeging-design.md
git commit -m "docs: een afgebroken toevoeging van items en producten uit de bevindingen"
```
