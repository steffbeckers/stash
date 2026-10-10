# Geen dubbele toevoeging na een afgebroken verzoek — ontwerp

Sinds de termijn (`2026-10-04-termijn-design.md`) breekt elk PostgREST-verzoek
na 10 s af. Een toevoeging die de server al opsloeg, maar waarvan het
antwoord nog niet binnen was, toont dan een fout. Wie opnieuw opslaat, maakt
een tweede rij. Zie de rij "Een afgebroken toevoeging kan een duplicaat
geven." in `docs/superpowers/open-bevindingen.md`.

Deze spec maakt twee toevoegingen idempotent: voorraad toevoegen, en een
product aanmaken. Dat gebeurt met een id dat de client kiest, en dat een
nieuwe poging hergebruikt.

## 1. Wat dit oplevert, en wat niet

**Wel:**
- Items toevoegen (`useInventory().add`) maakt geen dubbel meer, hoe vaak de
  gebruiker na een fout ook opnieuw opslaat met dezelfde gegevens.
- Een product aanmaken (`useProducts().create`, vanuit de productkiezer en de
  pagina "nieuw product") maakt geen dubbel meer.

**Niet:**
- **Een huishouden, een bewaarplaats of een uitnodiging aanmaken.** Die
  gebeuren zelden, en meestal niet bij slecht signaal. Ze blijven een
  bevinding.
- **Een aangepast formulier na een fout.** Verandert de gebruiker iets en
  slaat hij dan op, dan is dat een nieuwe toevoeging, met nieuwe id's. Kwam
  de eerste poging toch aan, dan staan er beide.

## 2. De beslissingen

| Beslissing | Waarom | Kosten als het fout is |
|---|---|---|
| Een id dat de client kiest, hergebruikt bij een nieuwe poging | Een dubbel kan dan echt niet meer, wat de gebruiker ook doet. De database zegt het met de primaire sleutel. | Twee migraties en databasetests. |
| Niet: na een onzekere fout naar de voorraad sturen met "misschien al toegevoegd" | Dat hangt af van wat de gebruiker daarna doet. | Geen. |
| Niet: een unieke regel op productnamen | Twee merken mogen dezelfde productnaam hebben. | Geen. |
| `insert (id)` vrijgeven op `inventory_item` | De insert blijft onder RLS: alleen in een huishouden waar je lid van bent. | Een client kan een id kiezen. Een botsing met een bestaand id geeft alleen `23505`. Dat verraadt niets bruikbaars, want id's zijn willekeurige UUID's. |
| `23505` op `inventory_item_pkey` telt als gelukt | De insert is één statement, alles of niets. Botst ze op de sleutel, dan staat een eerdere poging met dezelfde id's er al helemaal. | Botst een gekozen id met een rij die geen eerdere poging was (kans van één op 2¹²²), dan zegt de app "toegevoegd" terwijl er niets bijkwam. |
| `create_product` krijgt een optioneel id; de oude handtekening verdwijnt | Eén versie van de functie, geen twee overloads naast elkaar. De functie blijft `security definer`: ze bestaat al, en is niet nieuw. | Een client die de oude handtekening aanroept, faalt. De enige client is deze app, en die gaat mee. |
| Een bestaand product met dat id, gemaakt door iemand anders, is een fout | Anders "neemt" een client met een gekozen id andermans product over als zijn nieuwe product. | Geen. |
| Eén pure functie beslist of id's hergebruikt worden | Drie aanroepers (items, productkiezer, pagina "nieuw product") doen hetzelfde, en de regel is los te toetsen. | Geen. |

## 3. De id's per poging

In `app/utils/voorraad.ts`, puur:

```ts
export interface Poging {
  sleutel: string
  ids: string[]
}

export function idsVoorPoging(
  vorige: Poging | null,
  sleutel: string,
  aantal: number,
  nieuwId: () => string,
): Poging
```

- **Dezelfde poging.** Is `vorige` er, met dezelfde `sleutel` en `aantal`
  id's, dan geeft de functie `vorige` terug. Dezelfde gegevens geven dus
  dezelfde id's.
- **Een nieuwe poging.** Anders maakt de functie `aantal` nieuwe id's met
  `nieuwId()`, onder de nieuwe `sleutel`.
- **De sleutel** is een string die de ingevulde gegevens vastlegt. De
  aanroeper bouwt ze, bijvoorbeeld met `JSON.stringify` van de velden die
  naar de server gaan, zonder de id's.

De aanroepers onthouden hun `Poging` in een `ref` en geven
`crypto.randomUUID` mee als `nieuwId`.

## 4. Items toevoegen

- **Migratie.** `grant insert (id) on inventory_item to authenticated`. De
  bestaande kolomrechten en RLS blijven.
- **`useInventory().add(t)`.** `Toevoeging` krijgt `ids: string[]`, één per
  item. De rijen worden ingevoegd met die id's.
  - Faalt de insert met `isAlToegevoegd(error)`, dan telt dat als gelukt.
  - Elke andere fout gooit, zoals nu.
- **`isAlToegevoegd(oorzaak)`** in `app/utils/voorraad.ts` is waar voor een
  fout met `code === '23505'` waarvan de melding `inventory_item_pkey`
  bevat. Zo herkent ook `isSamenhangFout` een fout: aan code én
  constraintnaam.
- **De toevoegpagina** (`app/pages/inventory/new.vue`) houdt een
  `Poging | null` bij. Bij opslaan:
  1. `idsVoorPoging(vorige, sleutel, aantal, () => crypto.randomUUID())`;
  2. de uitkomst onthouden;
  3. `add` met die id's.
  Na een geslaagde toevoeging verlaat de pagina zichzelf, zoals nu.
- **Wat de gebruiker ziet** verandert niet. Na een fout verschijnt de
  bestaande foutmelding. Opnieuw opslaan geeft de gewone bevestiging, zonder
  dubbel.

## 5. Een product aanmaken

- **Migratie.**
  - `drop function create_product(text, text, numeric, text, text, text)`.
  - `create function create_product(gtin text, brand text, net_content numeric, unit text, locale text, name text, nieuw_id uuid default null) returns uuid`,
    `security definer`, `set search_path = public`.
  - Daarna `revoke all … from public, anon` en `grant execute … to authenticated`
    voor de nieuwe handtekening, met hetzelfde patroon als
    `20260927100100_product_rpc.sql`.
- **Gedrag:**
  1. **De bestaande controles blijven:** de aanroeper is ingelogd en de naam
     is niet leeg.
  2. **`insert into product (id, …) values (coalesce(nieuw_id, gen_random_uuid()), …) on conflict (id) do nothing returning id`.**
     Is er een rij ingevoegd, dan volgt de vertaling, en geeft de functie
     het id terug, zoals nu.
  3. **Werd er niets ingevoegd** (alleen mogelijk met `nieuw_id`), dan:
     - is `created_by` van dat product de aanroeper: het id teruggeven,
       zonder tweede vertaling;
     - anders: `raise exception`, en er verandert niets.
- **`useProducts().create(invoer)`** krijgt een optioneel `id` en geeft het
  door als `nieuw_id`.
- **De aanroepers** houden elk een `Poging | null` bij, met `aantal` 1:
  - de productkiezer (`app/components/InventoryProductPicker.vue`);
  - de pagina "nieuw product" (`app/pages/products/new.vue`).
  Ze geven `ids[0]` als `id` mee.
- **Wat de gebruiker ziet** verandert niet.

## 6. Testen

Elke bewaking krijgt een test die rood wordt als je ze weghaalt. De termijn
blijft 10 s, en er zijn geen vaste pauzes als vervanging voor volgorde.

### Databasetests — `test/db/`

| Test | Falsificatie |
|---|---|
| Een lid voegt een item in met een gekozen id; het item heeft dat id | De grant `insert (id)` weglaten |
| Dezelfde insert nog eens geeft `23505` op `inventory_item_pkey`, en er blijft één rij | — (eigenschap van de primaire sleutel, vastgepind) |
| Een niet-lid kan ook met een gekozen id niets invoegen | — (bestaande RLS, vastgepind) |
| `create_product` met een id, twee keer door dezelfde gebruiker: hetzelfde id, één product, één vertaling | `on conflict … do nothing` weghalen; de tak "zelfde maker" weghalen |
| `create_product` met het id van andermans product geeft een fout, en verandert niets | De controle op `created_by` weghalen |
| `create_product` zonder id werkt zoals voorheen | — (de bestaande producttests blijven groen) |

### Unit — `test/utils/voorraad.test.ts`

| Test | Falsificatie |
|---|---|
| `isAlToegevoegd` is waar voor `23505` met `inventory_item_pkey` | De nieuwe functie weglaten (test faalt op import) |
| `isAlToegevoegd` is onwaar voor `23505` op een andere constraint, voor een andere code en voor iets wat geen databasefout is | De constraintnaam niet controleren |
| `idsVoorPoging` geeft bij dezelfde sleutel en hetzelfde aantal de vorige id's terug | Altijd nieuwe id's maken |
| `idsVoorPoging` maakt nieuwe id's bij een andere sleutel, en bij een ander aantal | Altijd `vorige` teruggeven als die er is |

### End-to-end

1. **Een item toevoegen waarvan het antwoord hangt.**
   - De insert komt op de server aan (`route.fetch()`), maar het antwoord
     blijft hangen tot de termijn. De pagina toont de fout. Opnieuw opslaan
     met dezelfde gegevens leidt naar de voorraad.
   - **Verwacht:** `×N`, niet `×2N`.
   - **Rood** als de toevoegpagina elke poging nieuwe id's geeft, en zonder
     `isAlToegevoegd` (dan geeft de tweede poging weer een fout).
2. **Een product aanmaken in de productkiezer waarvan het antwoord hangt.**
   - De RPC komt aan, het antwoord hangt tot de termijn, de fout verschijnt.
     Opnieuw aanmaken.
   - **Verwacht:** in de catalogus één product met die naam.
   - **Rood** als de productkiezer elke poging een nieuw id geeft.
3. **Hetzelfde op de pagina "nieuw product".**
   - **Rood** als die pagina elke poging een nieuw id geeft.

### Wat niet beloofd wordt

- **Een aangepast formulier na een fout** geeft nieuwe id's (§1). Daar is
  geen test voor, want het is bewust zo.
- **Een id-botsing met een rij die geen eerdere poging was** (§2) is niet te
  toetsen: ze vraagt een UUID-botsing.

## 7. Gevolgen voor bestaand werk

| Wat | Gevolg |
|---|---|
| Nieuwe migratie | `grant insert (id) on inventory_item`; `create_product` met `nieuw_id` |
| `app/utils/voorraad.ts` | `Poging`, `idsVoorPoging`, `isAlToegevoegd` |
| `app/composables/useInventory.ts` | `Toevoeging.ids`; `add` voegt met id's in en vangt `isAlToegevoegd` op |
| `app/composables/useProducts.ts` | `create` met optioneel `id` |
| `app/pages/inventory/new.vue`, `app/components/InventoryProductPicker.vue`, `app/pages/products/new.vue` | Een `Poging` per formulier |
| `database.types.ts` | Opnieuw genereren voor de nieuwe handtekening van `create_product` |
| `test/db/`, `test/utils/voorraad.test.ts`, e2e | Tests uit §6 |
| `docs/superpowers/open-bevindingen.md` | De rij "Een afgebroken toevoeging kan een duplicaat geven." wordt: huishouden, bewaarplaats en uitnodiging blijven open |
