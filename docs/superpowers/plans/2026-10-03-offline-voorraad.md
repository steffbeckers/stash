# Offline voorraad — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zonder netwerk de laatst gesynchroniseerde voorraad zien en afstrepen; afstrepingen wachten op het toestel en gaan naar de server zodra er netwerk is.

**Architecture:** Een lokale kopie en een wachtrij in `localStorage`, beheerd door pure functies in `app/utils/offlineVoorraad.ts` en een composable eromheen. De voorraadpagina verstuurt eerst, laadt dan, en bewaart daarna de kopie. Een netwerkfout bij afstrepen zet de afstreping in de wachtrij. Offline levert de service worker (ongewijzigd) de offline-pagina, en die toont de kopie via een client-only component. Een client-plugin verstuurt bij het opstarten en bij `online`, en ruimt de kopie van een andere gebruiker op.

**Tech Stack:** Nuxt 4, @nuxt/ui 4, @nuxtjs/i18n 10, @nuxtjs/supabase 2, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-offline-voorraad-design.md`

## Global Constraints

- **Elke "Falsificeer"-stap is verplicht:** wijziging aanbrengen, de genoemde test ROOD zien, terugdraaien, GROEN zien. Blijft een test groen bij zijn falsificatie, dan wordt de test herschreven, niet de falsificatie verzwakt. Een commit bevat nooit een gefalsificeerde toestand.
- **De service worker (`app/sw.ts`) verandert niet.** Er wordt geen HTML gecachet; alleen data in `localStorage`.
- **Sleutels in `localStorage`:** `stash.offline.kopie` en `stash.offline.wachtrij`. De kopie heeft `versie: 1`.
- **Lezen uit de opslag crasht nooit.** Kapot, ontbrekend, verkeerde versie of vorm: "geen kopie" of een lege wachtrij.
- **Schrijven naar de opslag mag mislukken:** loggen met `console.warn`, nooit gooien naar de pagina.
- **Een netwerkfout is:** `navigator.onLine === false`, een rauwe `TypeError` van fetch, of een supabase-js-foutobject met `code === ''` en een `message` die begint met `'TypeError: '`. Dat is nagemeten in `node_modules/@supabase/postgrest-js/dist/index.mjs` (de `.catch((fetchError) => …)`-tak in `PostgrestBuilder`): de melding is daar `` `${fetchError.name}: ${fetchError.message}` `` met `code: ''`. Een afgebroken verzoek heeft ook `code: ''`, maar begint met `AbortError:` en telt dus niet.
- **`closed_at` is het moment dat de server de afstreping ontvangt** (spec §2). Er komt geen nieuw schrijfpad: versturen gebruikt `useInventory().close()`.
- **Composables die ook in een plugin draaien, gebruiken `useNuxtApp().$i18n`, niet `useI18n()`.** `useI18n()` hoort bovenaan een setup-functie, en de client-plugin heeft er geen.
- **Routepaden komen uit `routes.config.ts`.** Elke nieuwe i18n-sleutel gaat in alle drie de locales; Frans spreekt aan met *vous*.
- **Commentaar, testnamen en meldingen in het Nederlands.**
- **Stop een eigen `nuxt dev` op poort 3000 vóór e2e.** De volledige e2e-suite draai je met `--workers=2` (bekende wispelturigheid bij de standaard workers, zie de bevindingen).
- **Elke commit eindigt met de Co-Authored-By-regel van je eigen harness.** Commits worden via 1Password gesigneerd. Faalt dat onduidelijk, meld dan BLOCKED; omzeil het signeren nooit.

## Wat al gemeten is

**Mount `offline.vue` wel onder de URL `/inventory`?** De service worker levert offline de geprerenderde offline-pagina onder de oorspronkelijke URL. Nagelezen in `node_modules/nuxt/dist/pages/runtime/plugins/router.js`: `createCurrentLocation(base, window.location, nuxtApp.payload.path)` kiest het pad uit de payload (`/offline`) zodra dat verschilt van de URL in de adresbalk. De router mount dus `offline.vue`. Taak 3 bewijst dat aan de gebouwde app.

**De vorm van een fetchfout:** zie de Global Constraints.

## Bestandsstructuur

| Bestand | Verantwoordelijkheid |
|---|---|
| `app/utils/offlineVoorraad.ts` (nieuw) | Typen, lezen/schrijven van de opslag, kopie-bewerkingen, eigenaarsfilter, netwerkfout, versturen — puur |
| `test/utils/offlineVoorraad.test.ts` (nieuw) | Unittests daarvoor |
| `app/composables/useOfflineVoorraad.ts` (nieuw) | Koppeling met `localStorage`, `useInventory().close()` en toasts; één gedeelde lopende verzending |
| `app/plugins/wachtrij.client.ts` (nieuw) | Versturen bij opstarten en bij `online`; opruimen voor een andere gebruiker |
| `app/components/OfflineVoorraad.vue` (nieuw) | De offline-weergave van de kopie |
| `app/pages/offline.vue` | Toont `OfflineVoorraad` als er een kopie is |
| `app/pages/inventory/index.vue` | Versturen, bewaren, wachtrij bij een netwerkfout |
| `app/composables/useInventory.ts` | `useNuxtApp().$i18n` in plaats van `useI18n()` |
| `app/components/InventoryPlace.vue`, `InventoryGroup.vue` | Prop `alleenAfstrepen` |
| `app/components/UserMenu.vue` | Bevestiging bij een wachtrij; wissen bij uitloggen |
| `i18n/locales/{en,nl,fr}.json` | Blok `offlineVoorraad` |
| `e2e/offline.spec.ts` (nieuw) | E2e tegen de dev-server |
| `e2e/pwa/offline.spec.ts` | Eén test erbij tegen de gebouwde app |
| `docs/superpowers/open-bevindingen.md` | Bijgewerkt |

---

### Task 1: De pure kern

**Files:**
- Create: `app/utils/offlineVoorraad.ts`
- Create: `test/utils/offlineVoorraad.test.ts`

**Interfaces:**
- Consumes: `Bewaarplaats`, `Reden`, `VoorraadItem` uit `app/utils/voorraad.ts`.
- Produces (exact, latere taken gebruiken deze namen):
  - `KOPIE_SLEUTEL = 'stash.offline.kopie'`, `WACHTRIJ_SLEUTEL = 'stash.offline.wachtrij'`
  - `interface Kopie { versie: 1; eigenaar: string; huishouden: { id: string; naam: string }; bewaardOp: string; plaatsen: Bewaarplaats[]; items: VoorraadItem[] }`
  - `interface Wachtrijitem { itemId: string; reden: Reden; eigenaar: string; afgestreeptOp: string; item: VoorraadItem }`, `type Wachtrij = Wachtrijitem[]`
  - `interface Verzendresultaat { resterend: Wachtrij; verstuurd: number; vervallen: number; mislukt: number }`
  - `leesKopie(opslag: Storage): Kopie | null`, `leesWachtrij(opslag: Storage): Wachtrij`, `schrijfKopie(opslag, kopie): void`, `schrijfWachtrij(opslag, wachtrij): void` (een lege wachtrij verwijdert de sleutel), `wisKopie(opslag): void`, `wisAlles(opslag): void`
  - `streepAfInKopie(kopie, itemId): Kopie`, `zetTerugInKopie(kopie, item): Kopie`
  - `wachtrijVoor(wachtrij, gebruikerId): Wachtrij`, `ruimOpVoor(kopie, wachtrij, gebruikerId): { kopie: Kopie | null; wachtrij: Wachtrij }`
  - `isNetwerkfout(oorzaak: unknown, online: boolean): boolean`
  - `verstuurWachtrij(wachtrij, sluit: (itemId: string, reden: Reden) => Promise<boolean>): Promise<Verzendresultaat>`

- [ ] **Step 1: Schrijf de falende tests**

`test/utils/offlineVoorraad.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  KOPIE_SLEUTEL,
  WACHTRIJ_SLEUTEL,
  isNetwerkfout,
  leesKopie,
  leesWachtrij,
  ruimOpVoor,
  schrijfKopie,
  schrijfWachtrij,
  streepAfInKopie,
  verstuurWachtrij,
  wachtrijVoor,
  zetTerugInKopie,
  type Kopie,
  type Wachtrijitem,
} from '../../app/utils/offlineVoorraad'
import type { VoorraadItem } from '../../app/utils/voorraad'

/** Een opslag in het geheugen, zodat de tests geen browser nodig hebben. */
class NepOpslag implements Storage {
  private waarden = new Map<string, string>()
  get length(): number { return this.waarden.size }
  clear(): void { this.waarden.clear() }
  getItem(sleutel: string): string | null { return this.waarden.get(sleutel) ?? null }
  key(index: number): string | null { return [...this.waarden.keys()][index] ?? null }
  removeItem(sleutel: string): void { this.waarden.delete(sleutel) }
  setItem(sleutel: string, waarde: string): void { this.waarden.set(sleutel, String(waarde)) }
}

function item(id: string, over: Partial<VoorraadItem> = {}): VoorraadItem {
  return {
    id,
    productId: 'passata',
    naam: 'Passata',
    getoondeTaal: 'nl',
    merk: null,
    storagePlaceId: 'kast',
    amount: 1,
    unit: 'stuk',
    acquiredAt: '2026-10-01',
    expiresAt: null,
    createdAt: '2026-10-01T10:00:00Z',
    ...over,
  }
}

function kopie(over: Partial<Kopie> = {}): Kopie {
  return {
    versie: 1,
    eigenaar: 'ada',
    huishouden: { id: 'h1', naam: 'Thuis' },
    bewaardOp: '2026-10-03T12:00:00Z',
    plaatsen: [{ id: 'kast', name: 'Kast', kind: 'pantry' }],
    items: [item('a'), item('b')],
    ...over,
  }
}

function inWachtrij(itemId: string, eigenaar = 'ada'): Wachtrijitem {
  return { itemId, reden: 'consumed', eigenaar, afgestreeptOp: '2026-10-03T12:00:00Z', item: item(itemId) }
}

describe('de opslag lezen', () => {
  it('geeft de kopie terug die erin geschreven is', () => {
    const opslag = new NepOpslag()
    schrijfKopie(opslag, kopie())
    expect(leesKopie(opslag)?.items.map((i) => i.id)).toEqual(['a', 'b'])
  })

  // De offline-pagina moet altijd openen: een kapotte waarde is "geen kopie".
  it('geeft geen kopie bij kapotte JSON, zonder te crashen', () => {
    const opslag = new NepOpslag()
    opslag.setItem(KOPIE_SLEUTEL, '{niet af')
    expect(leesKopie(opslag)).toBeNull()
  })

  it('geeft geen kopie bij een andere versie', () => {
    const opslag = new NepOpslag()
    opslag.setItem(KOPIE_SLEUTEL, JSON.stringify({ ...kopie(), versie: 2 }))
    expect(leesKopie(opslag)).toBeNull()
  })

  it('geeft geen kopie bij een verkeerde vorm', () => {
    const opslag = new NepOpslag()
    opslag.setItem(KOPIE_SLEUTEL, JSON.stringify({ ...kopie(), items: 'geen lijst' }))
    expect(leesKopie(opslag)).toBeNull()
  })

  it('geeft een lege wachtrij bij kapotte JSON en laat ongeldige elementen weg', () => {
    const opslag = new NepOpslag()
    opslag.setItem(WACHTRIJ_SLEUTEL, '[[')
    expect(leesWachtrij(opslag)).toEqual([])
    opslag.setItem(WACHTRIJ_SLEUTEL, JSON.stringify([inWachtrij('a'), { itemId: 'b' }]))
    expect(leesWachtrij(opslag).map((i) => i.itemId)).toEqual(['a'])
  })

  it('verwijdert de sleutel bij een lege wachtrij', () => {
    const opslag = new NepOpslag()
    schrijfWachtrij(opslag, [inWachtrij('a')])
    schrijfWachtrij(opslag, [])
    expect(opslag.getItem(WACHTRIJ_SLEUTEL)).toBeNull()
  })
})

describe('de kopie bewerken', () => {
  it('afstrepen haalt precies dat item weg', () => {
    expect(streepAfInKopie(kopie(), 'a').items.map((i) => i.id)).toEqual(['b'])
  })

  it('terugzetten zet het item terug, en niet twee keer', () => {
    const zonder = streepAfInKopie(kopie(), 'a')
    const terug = zetTerugInKopie(zonder, item('a'))
    expect(terug.items.map((i) => i.id).sort()).toEqual(['a', 'b'])
    expect(zetTerugInKopie(terug, item('a')).items.length).toBe(2)
  })
})

describe('eigenaars', () => {
  it('wachtrijVoor geeft alleen de afstrepingen van die gebruiker', () => {
    const w = [inWachtrij('a', 'ada'), inWachtrij('b', 'bob')]
    expect(wachtrijVoor(w, 'ada').map((i) => i.itemId)).toEqual(['a'])
  })

  // Spec §8: een andere gebruiker krijgt de kopie van de vorige nooit te zien.
  it('ruimOpVoor laat de kopie en wachtrij van een andere eigenaar weg', () => {
    const r = ruimOpVoor(kopie({ eigenaar: 'ada' }), [inWachtrij('a', 'ada')], 'bob')
    expect(r.kopie).toBeNull()
    expect(r.wachtrij).toEqual([])
  })

  it('ruimOpVoor houdt de eigen kopie en wachtrij', () => {
    const r = ruimOpVoor(kopie({ eigenaar: 'ada' }), [inWachtrij('a', 'ada')], 'ada')
    expect(r.kopie?.eigenaar).toBe('ada')
    expect(r.wachtrij.length).toBe(1)
  })
})

describe('isNetwerkfout', () => {
  // De vorm uit postgrest-js: `${fetchError.name}: ${fetchError.message}`, code ''.
  it('herkent een mislukte fetch in Chromium en in Safari', () => {
    expect(isNetwerkfout({ code: '', message: 'TypeError: Failed to fetch' }, true)).toBe(true)
    expect(isNetwerkfout({ code: '', message: 'TypeError: Load failed' }, true)).toBe(true)
  })

  it('herkent een rauwe TypeError van fetch', () => {
    expect(isNetwerkfout(new TypeError('Failed to fetch'), true)).toBe(true)
  })

  it('telt elke fout als netwerkfout als het toestel offline is', () => {
    expect(isNetwerkfout({ code: '23514', message: 'iets' }, false)).toBe(true)
  })

  it('herkent een databasefout niet als netwerkfout', () => {
    expect(isNetwerkfout({ code: '23514', message: 'new row violates check constraint' }, true)).toBe(false)
    expect(isNetwerkfout({ code: '42501', message: 'permission denied for table inventory_item' }, true)).toBe(false)
  })

  // Zelfde lege code, maar geen netwerk: een afgebroken verzoek.
  it('herkent een afgebroken verzoek niet als netwerkfout', () => {
    expect(isNetwerkfout({ code: '', message: 'AbortError: signal is aborted without reason' }, true)).toBe(false)
  })
})

describe('verstuurWachtrij', () => {
  const netwerkfout = { code: '', message: 'TypeError: Failed to fetch' }

  it('telt verstuurd en vervallen, en laat niets achter', async () => {
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b')], async (id) => id === 'a')
    expect(r).toEqual({ resterend: [], verstuurd: 1, vervallen: 1, mislukt: 0 })
  })

  // Het netwerk is weg: de rest proberen heeft geen zin en mag niet verloren gaan.
  it('stopt bij een netwerkfout en houdt dat item en de rest vast', async () => {
    const geprobeerd: string[] = []
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b'), inWachtrij('c')], async (id) => {
      geprobeerd.push(id)
      if (id === 'b') throw netwerkfout
      return true
    })
    expect(geprobeerd).toEqual(['a', 'b'])
    expect(r.resterend.map((i) => i.itemId)).toEqual(['b', 'c'])
    expect(r.verstuurd).toBe(1)
  })

  it('laat een afstreping met een andere fout vallen en gaat door', async () => {
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b')], async (id) => {
      if (id === 'a') throw { code: '42501', message: 'permission denied' }
      return true
    })
    expect(r).toEqual({ resterend: [], verstuurd: 1, vervallen: 0, mislukt: 1 })
  })
})
```

- [ ] **Step 2: Draai ze en zie ze falen**

Run: `npm run test -- offlineVoorraad`
Expected: FAIL — `Cannot find module '../../app/utils/offlineVoorraad'`.

- [ ] **Step 3: Schrijf de implementatie**

`app/utils/offlineVoorraad.ts`:

```ts
/**
 * De offline voorraad, zonder Nuxt.
 *
 * Een lokale kopie van de voorraad en een wachtrij van afstrepingen, allebei
 * in een `Storage` (in de app: localStorage). De opslag komt als parameter
 * binnen, zodat de unittests een nep-opslag kunnen meegeven. Zie
 * docs/superpowers/specs/2026-10-03-offline-voorraad-design.md.
 */
import type { Bewaarplaats, Reden, VoorraadItem } from './voorraad'

export const KOPIE_SLEUTEL = 'stash.offline.kopie'
export const WACHTRIJ_SLEUTEL = 'stash.offline.wachtrij'

export interface Kopie {
  versie: 1
  /** Gebruikers-id. De kopie draagt haar eigenaar zelf: offline is er misschien geen sessie. */
  eigenaar: string
  huishouden: { id: string; naam: string }
  bewaardOp: string
  plaatsen: Bewaarplaats[]
  items: VoorraadItem[]
}

export interface Wachtrijitem {
  itemId: string
  reden: Reden
  eigenaar: string
  /** Alleen voor weergave; de database zet closed_at zelf bij ontvangst. */
  afgestreeptOp: string
  /** Om ongedaan maken terug te kunnen zetten in de kopie. */
  item: VoorraadItem
}

export type Wachtrij = Wachtrijitem[]

export interface Verzendresultaat {
  resterend: Wachtrij
  verstuurd: number
  vervallen: number
  mislukt: number
}

/** Lezen crasht nooit: de offline-pagina moet altijd openen. */
function leesJson(opslag: Storage, sleutel: string): unknown {
  try {
    const ruw = opslag.getItem(sleutel)
    return ruw === null ? null : JSON.parse(ruw)
  } catch {
    return null
  }
}

export function leesKopie(opslag: Storage): Kopie | null {
  const waarde = leesJson(opslag, KOPIE_SLEUTEL)
  if (typeof waarde !== 'object' || waarde === null) return null
  const k = waarde as Partial<Kopie>
  const geldig =
    k.versie === 1 &&
    typeof k.eigenaar === 'string' &&
    typeof k.bewaardOp === 'string' &&
    typeof k.huishouden === 'object' && k.huishouden !== null &&
    Array.isArray(k.plaatsen) &&
    Array.isArray(k.items)
  return geldig ? (k as Kopie) : null
}

function isWachtrijitem(x: unknown): x is Wachtrijitem {
  if (typeof x !== 'object' || x === null) return false
  const w = x as Partial<Wachtrijitem>
  return (
    typeof w.itemId === 'string' &&
    (w.reden === 'consumed' || w.reden === 'discarded') &&
    typeof w.eigenaar === 'string' &&
    typeof w.item === 'object' && w.item !== null
  )
}

export function leesWachtrij(opslag: Storage): Wachtrij {
  const waarde = leesJson(opslag, WACHTRIJ_SLEUTEL)
  return Array.isArray(waarde) ? waarde.filter(isWachtrijitem) : []
}

/** Kan gooien (opslag vol, privémodus): de aanroeper vangt dat op. */
export function schrijfKopie(opslag: Storage, kopie: Kopie): void {
  opslag.setItem(KOPIE_SLEUTEL, JSON.stringify(kopie))
}

/** Een lege wachtrij verwijdert de sleutel. Kan gooien, zoals schrijfKopie. */
export function schrijfWachtrij(opslag: Storage, wachtrij: Wachtrij): void {
  if (wachtrij.length === 0) opslag.removeItem(WACHTRIJ_SLEUTEL)
  else opslag.setItem(WACHTRIJ_SLEUTEL, JSON.stringify(wachtrij))
}

export function wisKopie(opslag: Storage): void {
  opslag.removeItem(KOPIE_SLEUTEL)
}

export function wisAlles(opslag: Storage): void {
  opslag.removeItem(KOPIE_SLEUTEL)
  opslag.removeItem(WACHTRIJ_SLEUTEL)
}

export function streepAfInKopie(kopie: Kopie, itemId: string): Kopie {
  return { ...kopie, items: kopie.items.filter((i) => i.id !== itemId) }
}

export function zetTerugInKopie(kopie: Kopie, item: VoorraadItem): Kopie {
  if (kopie.items.some((i) => i.id === item.id)) return kopie
  return { ...kopie, items: [...kopie.items, item] }
}

export function wachtrijVoor(wachtrij: Wachtrij, gebruikerId: string): Wachtrij {
  return wachtrij.filter((i) => i.eigenaar === gebruikerId)
}

/** Spec §8: wat van een andere gebruiker is, wordt nooit getoond of verstuurd. */
export function ruimOpVoor(
  kopie: Kopie | null,
  wachtrij: Wachtrij,
  gebruikerId: string,
): { kopie: Kopie | null; wachtrij: Wachtrij } {
  return {
    kopie: kopie !== null && kopie.eigenaar === gebruikerId ? kopie : null,
    wachtrij: wachtrijVoor(wachtrij, gebruikerId),
  }
}

/**
 * Is dit een netwerkfout? postgrest-js vangt een mislukte fetch op en geeft
 * `{ code: '', message: `${fetchError.name}: ${fetchError.message}` }` terug
 * (node_modules/@supabase/postgrest-js/dist/index.mjs). Een mislukte fetch is
 * altijd een TypeError ("Failed to fetch", "NetworkError…", "Load failed").
 * Een afgebroken verzoek heeft ook code '', maar begint met "AbortError:".
 */
export function isNetwerkfout(oorzaak: unknown, online: boolean): boolean {
  if (!online) return true
  if (oorzaak instanceof TypeError) return true
  if (typeof oorzaak !== 'object' || oorzaak === null) return false
  const { code, message } = oorzaak as { code?: unknown; message?: unknown }
  return code === '' && typeof message === 'string' && message.startsWith('TypeError: ')
}

/**
 * Verstuurt in volgorde (spec §6). `sluit` is useInventory().close(): true is
 * verstuurd, false is vervallen (al afgestreept of verwijderd). Een
 * netwerkfout stopt de verzending en houdt dat item en de rest vast; een
 * andere fout laat het item vallen.
 */
export async function verstuurWachtrij(
  wachtrij: Wachtrij,
  sluit: (itemId: string, reden: Reden) => Promise<boolean>,
): Promise<Verzendresultaat> {
  const resultaat: Verzendresultaat = { resterend: [], verstuurd: 0, vervallen: 0, mislukt: 0 }
  for (let i = 0; i < wachtrij.length; i++) {
    const item = wachtrij[i]!
    try {
      if (await sluit(item.itemId, item.reden)) resultaat.verstuurd++
      else resultaat.vervallen++
    } catch (oorzaak) {
      if (isNetwerkfout(oorzaak, true)) {
        resultaat.resterend = wachtrij.slice(i)
        return resultaat
      }
      resultaat.mislukt++
    }
  }
  return resultaat
}
```

- [ ] **Step 4: Draai de tests**

Run: `npm run test -- offlineVoorraad && npm run lint && npm run typecheck`
Expected: alles groen.

- [ ] **Step 5: Falsificeer**

Elke ronde: `npm run test -- offlineVoorraad`, ROOD zien op de genoemde test, terugzetten, groen zien.

| Wijziging | Moet ROOD worden |
|---|---|
| `leesJson`: de `try/catch` weghalen | `geeft geen kopie bij kapotte JSON, zonder te crashen` |
| `leesKopie`: `k.versie === 1 &&` weghalen | `geeft geen kopie bij een andere versie` |
| `leesKopie`: `Array.isArray(k.items)` weghalen | `geeft geen kopie bij een verkeerde vorm` |
| `streepAfInKopie`: de `filter` vervangen door `kopie.items` | `afstrepen haalt precies dat item weg` |
| `zetTerugInKopie`: de `some`-controle weghalen | `terugzetten zet het item terug, en niet twee keer` |
| `wachtrijVoor`: `return wachtrij` | `wachtrijVoor geeft alleen de afstrepingen van die gebruiker` |
| `ruimOpVoor`: `kopie` ongefilterd teruggeven | `ruimOpVoor laat de kopie en wachtrij van een andere eigenaar weg` |
| `isNetwerkfout`: `startsWith('TypeError: ')` vervangen door `true` | `herkent een afgebroken verzoek niet als netwerkfout` |
| `isNetwerkfout`: de regel `if (!online) return true` weghalen | `telt elke fout als netwerkfout als het toestel offline is` |
| `verstuurWachtrij`: `return resultaat` in de netwerktak vervangen door `continue` | `stopt bij een netwerkfout en houdt dat item en de rest vast` |
| `verstuurWachtrij`: `resultaat.mislukt++` vervangen door `throw oorzaak` | `laat een afstreping met een andere fout vallen en gaat door` |

- [ ] **Step 6: Commit**

```bash
git add app/utils/offlineVoorraad.ts test/utils/offlineVoorraad.test.ts
git commit -m "feat: pure kern voor de offline voorraad" -m "<Co-Authored-By-regel van je harness>"
```

---

### Task 2: Bewaren, wachtrij bij een netwerkfout, en versturen

**Files:**
- Create: `app/composables/useOfflineVoorraad.ts`
- Create: `app/plugins/wachtrij.client.ts`
- Create: `e2e/offline.spec.ts`
- Modify: `app/composables/useInventory.ts`
- Modify: `app/pages/inventory/index.vue`
- Modify: `i18n/locales/{en,nl,fr}.json`

**Interfaces:**
- Consumes: Taak 1; `useInventory().close(id, reden): Promise<boolean>`; `useHousehold()`; `signIn`, `createHousehold`, `bundles` uit `e2e/helpers.ts`.
- Produces:
  - `useOfflineVoorraad()` met:
    - `kopie(): Kopie | null`, `wachtrij(): Wachtrij`
    - `bewaar(huishouden: { id: string; naam: string }, plaatsen: Bewaarplaats[], items: VoorraadItem[]): void`
    - `zetInWachtrij(item: VoorraadItem, reden: Reden): void` (haalt het item ook uit de kopie)
    - `haalUitWachtrij(itemId: string): boolean` (true als het er nog in stond; zet het dan terug in de kopie)
    - `ruimOp(gebruikerId: string): void`, `wis(): void`, `wachtendVoorMij(): number`
    - `verstuur(): Promise<void>`
  - i18n-blok `offlineVoorraad` met `queued`, `lastUpdated`, `pending`, `notSent`, `signOutTitle`, `signOutBody`.

- [ ] **Step 1: Vertalingen**

Voeg in alle drie de bestanden een blok `"offlineVoorraad"` toe direct na het blok `"inventory"`:

`en.json`:

```json
  "offlineVoorraad": {
    "queued": "Checked off — it will be sent once you are back online.",
    "lastUpdated": "Last updated {date}",
    "pending": "Waiting to be sent: {count}",
    "notSent": "Some check-offs could not be sent ({count}).",
    "signOutTitle": "Sign out anyway?",
    "signOutBody": "Check-offs not sent yet: {count}. They will be lost if you sign out now."
  },
```

`nl.json`:

```json
  "offlineVoorraad": {
    "queued": "Afgestreept — wordt verstuurd zodra je weer online bent.",
    "lastUpdated": "Laatst bijgewerkt {date}",
    "pending": "Wacht op verzending: {count}",
    "notSent": "Sommige afstrepingen konden niet verstuurd worden ({count}).",
    "signOutTitle": "Toch uitloggen?",
    "signOutBody": "Nog niet verstuurde afstrepingen: {count}. Ze gaan verloren als je nu uitlogt."
  },
```

`fr.json`:

```json
  "offlineVoorraad": {
    "queued": "Retiré — ce sera envoyé dès que vous serez de nouveau en ligne.",
    "lastUpdated": "Dernière mise à jour {date}",
    "pending": "En attente d'envoi : {count}",
    "notSent": "Certains retraits n'ont pas pu être envoyés ({count}).",
    "signOutTitle": "Se déconnecter quand même ?",
    "signOutBody": "Retraits pas encore envoyés : {count}. Ils seront perdus si vous vous déconnectez maintenant."
  },
```

Run: `npm run test -- locales` → groen.

- [ ] **Step 2: `useInventory` zonder `useI18n()`**

In `app/composables/useInventory.ts`: vervang `const { locale } = useI18n()` door

```ts
  // useNuxtApp().$i18n en niet useI18n(): deze composable draait ook in de
  // client-plugin wachtrij.client.ts (via useOfflineVoorraad), en useI18n()
  // hoort bovenaan een setup-functie.
  const { $i18n } = useNuxtApp()
```

en in `load()` `voorkeurstaal: locale.value` door `voorkeurstaal: $i18n.locale.value`.

Run: `npm run typecheck && npm run test:e2e -- inventory --workers=2` → groen (de taal van de namen werkt nog).

- [ ] **Step 3: Schrijf de falende e2e-tests**

`e2e/offline.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'
import { routePath } from '../routes.config'
import { signIn, createHousehold, bundles, waitForHydration } from './helpers'
import { KOPIE_SLEUTEL, WACHTRIJ_SLEUTEL } from '../app/utils/offlineVoorraad'

const en = bundles.en

function tekst(sjabloon: string, waarden: Record<string, string | number>): string {
  return Object.entries(waarden).reduce((t, [k, v]) => t.replace(`{${k}}`, String(v)), sjabloon)
}

/** Een nieuw product toevoegen aan een plaats, en terug op de voorraad. */
async function voegToe(page: Page, opties: { plaats: string; naam: string; aantal?: number }): Promise<void> {
  await page.goto(routePath('inventory', 'en'))
  await page.getByRole('link', { name: tekst(en.inventory.addTo, { place: opties.plaats }), exact: true }).click()
  await waitForHydration(page, 'input')
  await page.getByLabel(en.inventory.searchProduct).fill(opties.naam)
  await page.getByRole('button', { name: tekst(en.products.createNamed, { name: opties.naam }) }).click()
  await page.getByRole('button', { name: en.inventory.createProduct }).click()
  if (opties.aantal) await page.getByLabel(en.inventory.count).fill(String(opties.aantal))
  await page.getByRole('button', { name: en.inventory.save }).click()
  await expect(page).toHaveURL(routePath('inventory', 'en'))
}

function groep(page: Page, plaats: string, naam: string) {
  return page.getByRole('region', { name: plaats }).getByRole('listitem').filter({ hasText: naam }).first()
}

async function streepAf(page: Page, naam: string): Promise<void> {
  await page.getByRole('button', { name: tekst(en.inventory.closeNamed, { name: naam }), exact: true }).click()
  await page.getByRole('button', { name: en.inventory.consumed }).click()
}

test('de voorraadpagina bewaart een lokale kopie', async ({ page }) => {
  const naam = `Kopie${Date.now()}`
  await signIn(page, `offline-kopie-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Kai', huishouden: 'Kopiehuis' })
  await voegToe(page, { plaats: 'Pantry', naam })
  await expect(groep(page, 'Pantry', naam)).toBeVisible()

  const kopie = await page.evaluate((s) => JSON.parse(localStorage.getItem(s) ?? 'null'), KOPIE_SLEUTEL)
  expect(kopie?.huishouden?.naam).toBe('Kopiehuis')
  expect(kopie?.items?.map((i: { naam: string }) => i.naam)).toContain(naam)
})

test('afstrepen zonder netwerk gaat in de wachtrij en wordt verstuurd zodra er netwerk is', async ({ page, context }) => {
  const naam = `Wacht${Date.now()}`
  await signIn(page, `offline-wachtrij-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Wim', huishouden: 'Wachthuis' })
  await voegToe(page, { plaats: 'Pantry', naam, aantal: 2 })
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')

  await context.setOffline(true)
  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')

  // Weer online: de plugin verstuurt bij het online-event, zonder herladen.
  await context.setOffline(false)
  await page.waitForFunction((s) => localStorage.getItem(s) === null, WACHTRIJ_SLEUTEL)

  // En het staat echt in de database.
  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
})
```

Run: `npm run test:e2e -- offline --workers=2`
Expected: FAIL — er is geen kopie (`kopie` is `null`) en geen toast `queued`.

- [ ] **Step 4: Schrijf de composable**

`app/composables/useOfflineVoorraad.ts`:

```ts
import type { Bewaarplaats, Reden, VoorraadItem } from '~/utils/voorraad'
import {
  leesKopie,
  leesWachtrij,
  ruimOpVoor,
  schrijfKopie,
  schrijfWachtrij,
  streepAfInKopie,
  verstuurWachtrij,
  wachtrijVoor,
  wisAlles,
  wisKopie,
  zetTerugInKopie,
  type Kopie,
  type Wachtrij,
} from '~/utils/offlineVoorraad'

// Eén lopende verzending voor de hele app. De plugin en de voorraadpagina
// roepen allebei verstuur() aan; de pagina moet dan wachten op de verzending
// die al loopt, niet ernaast een tweede starten (spec §6).
let lopend: Promise<void> | null = null

/**
 * De lokale kopie en de wachtrij, clientzijdig. Zie spec §4–§6.
 *
 * Gebruikt useNuxtApp().$i18n en niet useI18n(): draait ook in de
 * client-plugin wachtrij.client.ts.
 */
export function useOfflineVoorraad() {
  const user = useSupabaseUser()
  const toast = useToast()
  const { $i18n } = useNuxtApp()
  const { close } = useInventory()

  function opslag(): Storage | null {
    if (!import.meta.client) return null
    try {
      return window.localStorage
    } catch {
      return null
    }
  }

  /** Schrijven mag mislukken (vol, privémodus): loggen, niet gooien. */
  function schrijf(actie: (o: Storage) => void): void {
    const o = opslag()
    if (!o) return
    try {
      actie(o)
    } catch (oorzaak) {
      console.warn('[offline] lokale opslag mislukt', oorzaak)
    }
  }

  function kopie(): Kopie | null {
    const o = opslag()
    return o ? leesKopie(o) : null
  }

  function wachtrij(): Wachtrij {
    const o = opslag()
    return o ? leesWachtrij(o) : []
  }

  function bewaar(huishouden: { id: string; naam: string }, plaatsen: Bewaarplaats[], items: VoorraadItem[]): void {
    const eigenaar = user.value?.sub
    if (!eigenaar) return
    schrijf((o) => schrijfKopie(o, { versie: 1, eigenaar, huishouden, bewaardOp: new Date().toISOString(), plaatsen, items }))
  }

  /** De eigenaar is de ingelogde gebruiker, of — offline zonder sessie — die van de kopie. */
  function zetInWachtrij(item: VoorraadItem, reden: Reden): void {
    schrijf((o) => {
      const k = leesKopie(o)
      const eigenaar = user.value?.sub ?? k?.eigenaar
      if (!eigenaar) return
      schrijfWachtrij(o, [...leesWachtrij(o), { itemId: item.id, reden, eigenaar, afgestreeptOp: new Date().toISOString(), item }])
      if (k) schrijfKopie(o, streepAfInKopie(k, item.id))
    })
  }

  /** true als de afstreping nog wachtte; dan staat het item weer in de kopie. */
  function haalUitWachtrij(itemId: string): boolean {
    let gevonden = false
    schrijf((o) => {
      const w = leesWachtrij(o)
      const weg = w.find((i) => i.itemId === itemId)
      if (!weg) return
      gevonden = true
      schrijfWachtrij(o, w.filter((i) => i.itemId !== itemId))
      const k = leesKopie(o)
      if (k) schrijfKopie(o, zetTerugInKopie(k, weg.item))
    })
    return gevonden
  }

  function ruimOp(gebruikerId: string): void {
    schrijf((o) => {
      const r = ruimOpVoor(leesKopie(o), leesWachtrij(o), gebruikerId)
      if (r.kopie === null) wisKopie(o)
      schrijfWachtrij(o, r.wachtrij)
    })
  }

  function wis(): void {
    schrijf(wisAlles)
  }

  function wachtendVoorMij(): number {
    const id = user.value?.sub
    return id ? wachtrijVoor(wachtrij(), id).length : 0
  }

  async function verstuurNu(): Promise<void> {
    const id = user.value?.sub
    if (!id) return
    const mijn = wachtrijVoor(wachtrij(), id)
    if (mijn.length === 0) return
    const r = await verstuurWachtrij(mijn, (itemId, reden) => close(itemId, reden))
    schrijf((o) => {
      // Wat er tijdens het versturen bijkwam, blijft staan.
      const nieuw = leesWachtrij(o).filter((i) => !mijn.some((m) => m.itemId === i.itemId))
      schrijfWachtrij(o, [...r.resterend, ...nieuw])
    })
    if (r.mislukt > 0) toast.add({ title: $i18n.t('offlineVoorraad.notSent', { count: r.mislukt }), color: 'error' })
  }

  function verstuur(): Promise<void> {
    if (!lopend) lopend = verstuurNu().finally(() => { lopend = null })
    return lopend
  }

  return { kopie, wachtrij, bewaar, zetInWachtrij, haalUitWachtrij, ruimOp, wis, wachtendVoorMij, verstuur }
}
```

- [ ] **Step 5: Schrijf de plugin**

`app/plugins/wachtrij.client.ts`:

```ts
/**
 * Verstuurt de wachtrij van offline afstrepingen: bij het opstarten zodra er
 * een gebruiker is, en bij elk online-event. Spec §5, punt 4.
 */
export default defineNuxtPlugin(() => {
  const user = useSupabaseUser()
  const offline = useOfflineVoorraad()

  // useSupabaseUser() is bij het opstarten mogelijk nog leeg: de sessie komt
  // asynchroon binnen. Daarom een watcher, niet één aanroep.
  watch(
    () => user.value?.sub,
    (id) => {
      if (!id) return
      void offline.verstuur()
    },
    { immediate: true },
  )

  window.addEventListener('online', () => {
    void offline.verstuur()
  })
})
```

- [ ] **Step 6: De voorraadpagina**

In `app/pages/inventory/index.vue`:

1. Voeg een import toe (de bestaande import uit `~/utils/voorraad` blijft zoals ze is):

```ts
import { isNetwerkfout } from '~/utils/offlineVoorraad'
```

2. Na `const { load, loadPlaces, close, reopen } = useInventory()`:

```ts
const offline = useOfflineVoorraad()
```

3. In `laad()`, na `plaatsen.value = p`:

```ts
  offline.bewaar({ id: activeId.value, naam: active.value?.name ?? '' }, p, i)
```

4. In `onMounted`, direct vóór `try { await laad() }`:

```ts
  // Eerst versturen, dan laden: anders zet de server een item terug dat in de
  // wachtrij al afgestreept is (spec §5).
  await offline.verstuur()
```

5. Vervang in `afstrepen()` het `catch`-blok:

```ts
  } catch (oorzaak) {
    const item = items.value.find((i) => i.id === itemId)
    if (item && isNetwerkfout(oorzaak, navigator.onLine)) {
      // Geen netwerk: de afstreping wacht op het toestel (spec §5, punt 2).
      // Niet herladen — dat faalt nu ook, en de lijst klopt al.
      offline.zetInWachtrij(item, reden)
      items.value = items.value.filter((i) => i.id !== itemId)
      toast.add({
        title: t('offlineVoorraad.queued'),
        actions: [{ label: t('inventory.undo'), onClick: () => { void ongedaanMakenOffline(item) } }],
      })
      return
    }
    toast.add({ title: t('householdSettings.error'), color: 'error' })
  }
```

en voeg daaronder toe:

```ts
// Wachtte de afstreping nog, dan volstaat haar uit de wachtrij halen. Was ze
// intussen al verstuurd (het netwerk kwam terug), dan is het een gewone
// ongedaanmaking op de server.
async function ongedaanMakenOffline(item: VoorraadItem): Promise<void> {
  if (offline.haalUitWachtrij(item.id)) {
    items.value = [...items.value, item]
    return
  }
  await ongedaanMaken(item.id)
}
```

- [ ] **Step 7: Draai de tests**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:e2e -- offline inventory --workers=2`
Expected: alles groen.

- [ ] **Step 8: Falsificeer**

| Wijziging | Run | Moet ROOD worden |
|---|---|---|
| In `laad()` de `offline.bewaar(...)`-regel weg | `npm run test:e2e -- offline` | `de voorraadpagina bewaart een lokale kopie` |
| In `afstrepen()` de `isNetwerkfout`-tak weg (altijd de gewone foutmelding) | idem | `afstrepen zonder netwerk …` |
| In de plugin de `online`-listener weg | idem | `afstrepen zonder netwerk …` (de `waitForFunction` loopt uit) |

- [ ] **Step 9: Commit**

```bash
git add app/composables/useOfflineVoorraad.ts app/plugins/wachtrij.client.ts app/composables/useInventory.ts app/pages/inventory/index.vue i18n/locales e2e/offline.spec.ts
git commit -m "feat: afstrepen zonder netwerk gaat in een wachtrij" -m "<Co-Authored-By-regel van je harness>"
```

---

### Task 3: De offline-weergave

**Files:**
- Create: `app/components/OfflineVoorraad.vue`
- Modify: `app/pages/offline.vue`
- Modify: `app/components/InventoryPlace.vue`, `app/components/InventoryGroup.vue`
- Modify: `e2e/offline.spec.ts`, `e2e/pwa/offline.spec.ts`

**Interfaces:**
- Consumes: Taak 1 en 2.
- Produces: prop `alleenAfstrepen?: boolean` op `InventoryPlace` en `InventoryGroup`.

- [ ] **Step 1: Schrijf de falende tests**

Voeg onderaan `e2e/offline.spec.ts` toe:

```ts
test('de offline-pagina toont de kopie en strept af naar de wachtrij', async ({ page }) => {
  const naam = `Kelder${Date.now()}`
  await signIn(page, `offline-pagina-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Olga', huishouden: 'Offlinehuis' })
  await voegToe(page, { plaats: 'Pantry', naam, aantal: 2 })
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')

  await page.goto(routePath('offline', 'en'))
  await expect(page.getByText(en.offline.title)).toBeVisible()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  // Offline geen toevoegen, bewerken of verwijderen.
  await expect(page.getByRole('link', { name: tekst(en.inventory.addTo, { place: 'Pantry' }) })).toHaveCount(0)

  await streepAf(page, naam)
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  await expect(page.getByText(tekst(en.offlineVoorraad.pending, { count: 1 }))).toBeVisible()

  // Terug op de voorraadpagina wordt eerst verstuurd, dan geladen.
  await page.goto(routePath('inventory', 'en'))
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
})
```

Voeg in `e2e/pwa/offline.spec.ts` toe aan de imports:

```ts
import { routePath } from '../../routes.config'
import { KOPIE_SLEUTEL, type Kopie } from '../../app/utils/offlineVoorraad'
```

en onderaan:

```ts
// De koppeling service worker → offline-pagina → kopie, die de dev-tests niet
// kunnen zien. Geen login nodig: de offline-weergave leest alleen de opslag.
test('offline toont /inventory de lokale voorraad', async ({ page, context }) => {
  await page.goto(landing.en)
  await wachtOpServiceWorker(page)

  const kopie: Kopie = {
    versie: 1,
    eigenaar: '00000000-0000-0000-0000-000000000001',
    huishouden: { id: 'h1', naam: 'Kelderhuis' },
    bewaardOp: new Date().toISOString(),
    plaatsen: [{ id: 'p1', name: 'Kelder', kind: 'pantry' }],
    items: [{
      id: 'i1', productId: 'pr1', naam: 'Passata uit de kelder', getoondeTaal: 'en', merk: null,
      storagePlaceId: 'p1', amount: 1, unit: 'stuk', acquiredAt: '2026-10-01', expiresAt: null,
      createdAt: '2026-10-01T10:00:00Z',
    }],
  }
  await page.evaluate(([s, k]) => localStorage.setItem(s, k), [KOPIE_SLEUTEL, JSON.stringify(kopie)] as const)

  await context.setOffline(true)
  await page.goto(routePath('inventory', 'en'))
  await expect(page.getByText(en.offline.title)).toBeVisible()
  await expect(page.getByText('Passata uit de kelder')).toBeVisible()
})
```

Run: `npm run test:e2e -- offline --workers=2`
Expected: de nieuwe dev-test faalt — `/offline` toont geen voorraad.

- [ ] **Step 2: `alleenAfstrepen` op de componenten**

`app/components/InventoryPlace.vue`: voeg aan `defineProps` toe `alleenAfstrepen?: boolean`. Zet `v-if="!alleenAfstrepen"` op de Toevoegen-`UButton`, en geef `:alleen-afstrepen="alleenAfstrepen"` door aan `InventoryGroup`.

`app/components/InventoryGroup.vue`: voeg aan `defineProps` toe `alleenAfstrepen?: boolean`. Zet `v-if="!alleenAfstrepen"` op de Bewerken- en de Verwijderen-`UButton` in de uitgeklapte items. Afstrepen blijft.

- [ ] **Step 3: De weergave**

`app/components/OfflineVoorraad.vue`:

```vue
<script setup lang="ts">
import { groepeerPerPlaats, lokaleDatum, vervaltBinnenkort, type Reden } from '~/utils/voorraad'
import { wachtrijVoor, type Kopie } from '~/utils/offlineVoorraad'

const props = defineProps<{ kopie: Kopie }>()
const emit = defineEmits<{ gewijzigd: [] }>()
const { t, locale } = useI18n()
const toast = useToast()
const offline = useOfflineVoorraad()

const vandaag = lokaleDatum(new Date())
const perPlaats = computed(() => groepeerPerPlaats(props.kopie.items))
const binnenkort = computed(() => vervaltBinnenkort(props.kopie.items, vandaag))
const bijgewerkt = computed(() =>
  new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    .format(new Date(props.kopie.bewaardOp)),
)

const wachtend = ref(0)
function telWachtend() {
  wachtend.value = wachtrijVoor(offline.wachtrij(), props.kopie.eigenaar).length
}
onMounted(telWachtend)

function afstrepen(itemId: string, _naam: string, reden: Reden) {
  const item = props.kopie.items.find((i) => i.id === itemId)
  if (!item) return
  offline.zetInWachtrij(item, reden)
  emit('gewijzigd')
  telWachtend()
  toast.add({
    title: t('offlineVoorraad.queued'),
    actions: [{
      label: t('inventory.undo'),
      onClick: () => {
        offline.haalUitWachtrij(itemId)
        emit('gewijzigd')
        telWachtend()
      },
    }],
  })
}
</script>

<template>
  <div class="text-left">
    <p class="text-sm text-muted">
      {{ kopie.huishouden.naam }} · {{ t('offlineVoorraad.lastUpdated', { date: bijgewerkt }) }}
    </p>
    <p v-if="wachtend > 0" class="mt-1 text-sm">{{ t('offlineVoorraad.pending', { count: wachtend }) }}</p>

    <InventoryExpiring v-if="binnenkort.length" class="mt-6" :items="binnenkort" :vandaag="vandaag" />

    <div class="mt-6 space-y-8">
      <InventoryPlace
        v-for="plaats in kopie.plaatsen"
        :key="plaats.id"
        :plaats="plaats"
        :plaatsen="kopie.plaatsen"
        :groepen="perPlaats.get(plaats.id) ?? []"
        :vandaag="vandaag"
        alleen-afstrepen
        @afstrepen="afstrepen"
      />
    </div>
  </div>
</template>
```

- [ ] **Step 4: De offline-pagina**

`app/pages/offline.vue` (volledig):

```vue
<script setup lang="ts">
import { leesKopie, type Kopie } from '~/utils/offlineVoorraad'

// Geen auth en geen netwerk: deze pagina moet te tonen zijn als er niets meer
// werkt. Wél de lokale kopie van de voorraad, als die er is (spec §7). Die
// komt pas na het mounten uit localStorage — de pagina is geprerenderd en
// heeft tijdens het renderen geen toestel.
const { t } = useI18n()

const kopie = ref<Kopie | null>(null)

function leesOpnieuw() {
  try {
    kopie.value = leesKopie(window.localStorage)
  } catch {
    kopie.value = null
  }
}

onMounted(leesOpnieuw)

function opnieuw() {
  window.location.reload()
}
</script>

<template>
  <UContainer class="py-16">
    <div class="text-center">
      <h1 class="text-3xl font-bold">{{ t('offline.title') }}</h1>
      <p v-if="!kopie" class="mt-3 text-lg text-muted">{{ t('offline.body') }}</p>
      <UButton class="mt-8" size="lg" @click="opnieuw">
        {{ t('offline.retry') }}
      </UButton>
    </div>

    <!-- ClientOnly: de weergave gebruikt de supabase- en toast-composables,
         en die horen niet in de prerender van een pagina zonder sessie. -->
    <ClientOnly>
      <OfflineVoorraad v-if="kopie" class="mt-10" :kopie="kopie" @gewijzigd="leesOpnieuw" />
    </ClientOnly>
  </UContainer>
</template>
```

- [ ] **Step 5: Draai de tests**

Run: `npm run lint && npm run typecheck && npm run test:e2e -- offline inventory mobile --workers=2 && npm run test:e2e:pwa`
Expected: alles groen. De veegtest meet `/offline` ook; overflow los je op in de lay-out, niet in de test.

- [ ] **Step 6: Falsificeer**

| Wijziging | Run | Moet ROOD worden |
|---|---|---|
| In `offline.vue` de `<OfflineVoorraad …/>`-regel weg | `npm run test:e2e -- offline` | `de offline-pagina toont de kopie …` |
| idem | `npm run test:e2e:pwa` | `offline toont /inventory de lokale voorraad` |
| In `InventoryPlace.vue` de `v-if="!alleenAfstrepen"` weg | `npm run test:e2e -- offline` | `de offline-pagina toont de kopie …` |
| In `useOfflineVoorraad.verstuurNu()` direct `return` | `npm run test:e2e -- offline` | `de offline-pagina toont de kopie …` (na herladen ×2) |

- [ ] **Step 7: Commit**

```bash
git add app/components/OfflineVoorraad.vue app/pages/offline.vue app/components/InventoryPlace.vue app/components/InventoryGroup.vue e2e/offline.spec.ts e2e/pwa/offline.spec.ts
git commit -m "feat: de offline-pagina toont de lokale voorraad" -m "<Co-Authored-By-regel van je harness>"
```

---

### Task 4: Privacy — uitloggen en een andere gebruiker

**Files:**
- Modify: `app/components/UserMenu.vue`
- Modify: `app/plugins/wachtrij.client.ts`
- Modify: `e2e/offline.spec.ts`

**Interfaces:**
- Consumes: `useOfflineVoorraad()` (`wis`, `wachtendVoorMij`, `ruimOp`); `openUserMenu` uit `e2e/helpers.ts`.
- Produces: niets voor latere taken.

- [ ] **Step 1: Schrijf de falende tests**

Voeg aan de import uit `./helpers` in `e2e/offline.spec.ts` `openUserMenu` toe, en onderaan:

```ts
test('uitloggen wist de lokale kopie', async ({ page }) => {
  const naam = `Weg${Date.now()}`
  await signIn(page, `offline-uitloggen-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Uma', huishouden: 'Uitloghuis' })
  await voegToe(page, { plaats: 'Pantry', naam })
  await expect(groep(page, 'Pantry', naam)).toBeVisible()

  await openUserMenu(page)
  await page.getByRole('menuitem', { name: en.auth.signOut }).click()
  await expect(page.getByRole('button', { name: en.nav.language })).toBeVisible()

  expect(await page.evaluate((s) => localStorage.getItem(s), KOPIE_SLEUTEL)).toBeNull()
  await page.goto(routePath('offline', 'en'))
  await expect(page.getByText(en.offline.body)).toBeVisible()
  await expect(page.getByText(naam)).toHaveCount(0)
})

test('uitloggen met wachtende afstrepingen vraagt eerst bevestiging', async ({ page }) => {
  const naam = `Bevestig${Date.now()}`
  await signIn(page, `offline-bevestig-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Bea', huishouden: 'Bevestighuis' })
  await voegToe(page, { plaats: 'Pantry', naam })

  // Online, maar het afstrepen zelf faalt op het netwerk: de afstreping komt
  // in de wachtrij en blijft daar, want er komt geen online-event.
  await page.route('**/rest/v1/inventory_item**', (route) =>
    route.request().method() === 'PATCH' ? route.abort() : route.continue())
  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible()

  await openUserMenu(page)
  await page.getByRole('menuitem', { name: en.auth.signOut }).click()
  const dialoog = page.getByRole('dialog')
  await expect(dialoog.getByText(en.offlineVoorraad.signOutTitle)).toBeVisible()
  // Nog ingelogd zolang er niet bevestigd is.
  await expect(page.getByRole('button', { name: en.nav.account })).toBeVisible()

  await dialoog.getByRole('button', { name: en.auth.signOut }).click()
  await expect(page.getByRole('button', { name: en.nav.language })).toBeVisible()
  expect(await page.evaluate((s) => localStorage.getItem(s), WACHTRIJ_SLEUTEL)).toBeNull()
})

// Spec §8. Bewust zonder uit te loggen: dan wist uitloggen de kopie al, en
// bewijst deze test niets over de eigenaarscontrole.
test('een andere gebruiker ziet de kopie van de vorige niet', async ({ page, context }) => {
  const naam = `Vorige${Date.now()}`
  await signIn(page, `offline-a-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Anna', huishouden: 'Annahuis' })
  await voegToe(page, { plaats: 'Pantry', naam })
  await expect(groep(page, 'Pantry', naam)).toBeVisible()

  await context.clearCookies()
  await signIn(page, `offline-b-${Date.now()}@example.com`)

  // B heeft nog geen huishouden, dus de voorraadpagina schrijft geen eigen
  // kopie: wat hier verdwijnt, verdwijnt door de eigenaarscontrole.
  await expect.poll(() => page.evaluate((s) => localStorage.getItem(s), KOPIE_SLEUTEL)).toBeNull()
})
```

Run: `npm run test:e2e -- offline --workers=2`
Expected: de drie nieuwe tests falen.

- [ ] **Step 2: Uitloggen**

In `app/components/UserMenu.vue`, in `<script setup>`: na `const { profile } = useProfile()`:

```ts
const offline = useOfflineVoorraad()
const bevestigUitloggen = ref(false)
const wachtend = ref(0)

// Spec §8: wat nog in de wachtrij staat, gaat verloren bij uitloggen. Dat
// vraagt een bevestiging; zonder wachtrij gewoon uitloggen.
function vraagUitloggen() {
  wachtend.value = offline.wachtendVoorMij()
  if (wachtend.value > 0) {
    bevestigUitloggen.value = true
    return
  }
  void signOut()
}
```

Vervang de functie `signOut`:

```ts
async function signOut() {
  bevestigUitloggen.value = false
  // Eerst wissen: lukt het uitloggen offline niet volledig, dan is de
  // privédata toch al weg van het toestel.
  offline.wis()
  await supabase.auth.signOut()
  await navigateTo(localePath('index'))
}
```

Vervang in `items` `onSelect: () => { void signOut() }` door `onSelect: () => { vraagUitloggen() }`.

Zet in de template, direct na `</UDropdownMenu>` (Vue 3 staat meerdere wortelelementen toe; geen wikkel nodig):

```vue
  <UModal
    v-model:open="bevestigUitloggen"
    :title="t('offlineVoorraad.signOutTitle')"
    :description="t('offlineVoorraad.signOutBody', { count: wachtend })"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton variant="ghost" @click="bevestigUitloggen = false">{{ t('inventory.cancel') }}</UButton>
        <UButton color="error" @click="signOut">{{ t('auth.signOut') }}</UButton>
      </div>
    </template>
  </UModal>
```

- [ ] **Step 3: Een andere gebruiker**

In `app/plugins/wachtrij.client.ts`, in de watcher, direct na `if (!id) return`:

```ts
      // Spec §8: een kopie of wachtrij van een andere gebruiker wordt nooit
      // getoond of verstuurd.
      offline.ruimOp(id)
```

- [ ] **Step 4: Draai de tests**

Run: `npm run lint && npm run typecheck && npm run test:e2e -- offline login --workers=2`
Expected: groen.

- [ ] **Step 5: Falsificeer**

| Wijziging | Moet ROOD worden |
|---|---|
| In `signOut()` `offline.wis()` weg | `uitloggen wist de lokale kopie` |
| In `vraagUitloggen()` de `if (wachtend.value > 0)`-tak weg | `uitloggen met wachtende afstrepingen vraagt eerst bevestiging` |
| In de plugin `offline.ruimOp(id)` weg | `een andere gebruiker ziet de kopie van de vorige niet` |

Telkens met `npm run test:e2e -- offline --workers=2`, terugzetten, groen zien.

- [ ] **Step 6: Volledige suites**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:db && npx playwright test --workers=2 && npm run test:e2e:pwa`
Expected: alles groen. Laat geen dev-server of workerd achter.

- [ ] **Step 7: Commit**

```bash
git add app/components/UserMenu.vue app/plugins/wachtrij.client.ts e2e/offline.spec.ts
git commit -m "feat: uitloggen en een andere gebruiker wissen de offline voorraad" -m "<Co-Authored-By-regel van je harness>"
```

---

### Task 5: Documentatie

**Files:**
- Modify: `docs/superpowers/open-bevindingen.md`

- [ ] **Step 1: Bevindingen**

Zet bovenaan `Laatst gecontroleerd tegen de code op 2026-10-03.`

Verwijder onder "Kleine punten" de rij die begint met `| **Offline data.** |`.

Voeg onder "Functionaliteit die de spec vraagt" toe:

```markdown
| **Offline kan je alleen lezen en afstrepen.** | Toevoegen, bewerken en verwijderen vragen netwerk: toevoegen heeft product-id's nodig die offline bestaan (een lokale catalogus), bewerken conflictregels. Alleen het actieve huishouden wordt gekopieerd. Zie §1 en §11 van `docs/superpowers/specs/2026-10-03-offline-voorraad-design.md`. |
```

Voeg onder "Kleine punten" toe:

```markdown
| **Een offline afstreping krijgt als `closed_at` het moment van verzenden.** | De stempeltrigger zet `now()` bij ontvangst, en de kolomrechten laten de client dat veld bewust niet schrijven. Een afstreping die een dag in de wachtrij stond, staat dus een dag later in de database. Voor de verspillingscijfers per jaar onbelangrijk; een RPC die een tijdstip uit het verleden aanvaardt, zou "de database bepaalt wanneer" openbreken. Spec offline §2. |
| **Offline op iOS is niet automatisch getoetst.** | Playwright's WebKit is geen echte iOS-PWA. `isNetwerkfout` kent Safari's melding ("Load failed") uit de unittest, niet uit een echte iPhone. Vroeg met de hand nakijken op een toestel. |
| **De lokale kopie blijft staan zolang je niet uitlogt.** | Bewust (spec offline §8): de offline-pagina heeft geen sessie om op te steunen, want die verloopt na een uur. Wie een toestel deelt zonder uit te loggen, laat de voorraad zien aan wie de offline-pagina opent — net zoals de sessie zelf blijft staan. |
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/open-bevindingen.md
git commit -m "docs: bevindingen na de offline voorraad" -m "<Co-Authored-By-regel van je harness>"
```
