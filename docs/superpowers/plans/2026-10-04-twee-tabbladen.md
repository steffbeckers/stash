# Ongedaan maken over twee tabbladen — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Versturen en ongedaan maken nemen hetzelfde slot over alle tabbladen heen, en het onzeker-merk staat in de wachtrij-ingang, zodat een ongedaanmaking in het ene tabblad nooit verloren gaat door een verzending in het andere.

**Architecture:**
- `metWachtrijslot` voert werk uit onder het Web Locks-slot `stash.wachtrij`. Zonder Web Locks wacht het eerst op een meegegeven belofte.
- `markeerOnzeker` zet het merk op precies één ingang.
- `useOfflineVoorraad` gebruikt beide:
  - `verstuurNu` controleert de sessie buiten het slot en leest en verstuurt de wachtrij erbinnen;
  - `ongedaanMakenInWachtrij` doet alleen het synchrone lezen en weghalen binnen het slot;
  - de onzeker-set in het geheugen verdwijnt.

**Tech Stack:** Nuxt 4, @nuxtjs/supabase 2, Web Locks API, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-04-twee-tabbladen-design.md`

## Global Constraints

- **Elke "Falsificeer"-stap is verplicht.** Breng de wijziging aan, zie de genoemde test ROOD worden, draai terug en zie hem GROEN worden. Blijft een test groen bij zijn falsificatie, dan herschrijf je de test, nooit de falsificatie. Een commit bevat nooit een gefalsificeerde toestand.
- **Het slot heet `stash.wachtrij`** (`WACHTRIJ_SLOT`).
- **De sessiecontrole (`getSession`) staat vóór het slot, nooit erin.** Auth heeft geen termijn.
- **De wachtrij wordt binnen het slot gelezen.** Buiten het slot staat alleen een snelle controle op een lege wachtrij, zonder dat die lezing verder gebruikt wordt.
- **Binnen het slot bij ongedaan maken staat alleen synchroon werk.** `reopen` komt erna.
- **Het merk is `onzeker?: true` in `Wachtrijitem`**, en alleen precies `true` telt. De opslagversie blijft `1`.
- **De termijn blijft 10 s, ook in e2e.** Geen vaste pauzes als vervanging voor volgorde.
- **Commentaar, testnamen en meldingen in het Nederlands.**
- **Stop een eigen `nuxt dev` op poort 3000 vóór e2e.** Bij `Another Nuxt dev is already running`: verwijder `.nuxt/nuxt.lock` en kill nooit het genoemde PID. Draai de volledige e2e-suite met `--workers=2`.
- **Elke commit eindigt met de Co-Authored-By-regel van je eigen harness.** Commits worden via 1Password gesigneerd. Faalt dat onduidelijk, meld dan BLOCKED; omzeil het signeren nooit.

## Wat al gemeten is

- **Een wachtrij-ingang mag extra velden dragen.** `leesWachtrij` filtert met `isWachtrijitem`, dat alleen `itemId`, `reden`, `eigenaar` en `item` controleert en de rest houdt (`app/utils/offlineVoorraad.ts`).
- **`verstuurWachtrij` zet `onzeker` alleen in de tak die `resterend = wachtrij.slice(i)` zet.** Is `r.onzeker` gezet, dan is `r.resterend[0]` dus precies de ingang die faalde. Een `find` op `itemId` in de momentopname zou bij een dubbele ingang voor hetzelfde item de verkeerde kunnen nemen.
- **Twee pagina's in dezelfde Playwright-context delen `localStorage` en Web Locks.** `page.route` geldt per pagina: een route op tabblad 1 raakt de verzoeken van tabblad 2 niet.
- **De plugin (`app/plugins/wachtrij.client.ts`) verstuurt** bij het opstarten, bij het `online`-event van het eigen venster, en bij `TOKEN_REFRESHED`/`SIGNED_IN`.

## Bestandsstructuur

| Bestand | Verantwoordelijkheid |
|---|---|
| `app/utils/offlineVoorraad.ts` | `WACHTRIJ_SLOT`, `metWachtrijslot`, `markeerOnzeker`, `Wachtrijitem.onzeker` |
| `test/utils/offlineVoorraad.test.ts` | Unittests daarvoor |
| `app/composables/useOfflineVoorraad.ts` | Het slot rond versturen en ongedaan maken; het merk in de ingang; de set weg |
| `e2e/offline.spec.ts` | Twee tests met twee tabbladen |
| `docs/superpowers/open-bevindingen.md`, `docs/superpowers/specs/2026-10-04-termijn-design.md` | Bijgewerkt |

---

### Task 1: Het slot en het merk, puur

**Files:**
- Modify: `app/utils/offlineVoorraad.ts`
- Modify: `test/utils/offlineVoorraad.test.ts`

**Interfaces:**
- Produces:
  - `export const WACHTRIJ_SLOT = 'stash.wachtrij'`
  - `export function metWachtrijslot<T>(locks: LockManager | undefined, anders: () => Promise<unknown>, werk: () => T | Promise<T>): Promise<T>`
  - `export function markeerOnzeker(wachtrij: Wachtrij, ingang: Wachtrijitem): Wachtrij`
  - `Wachtrijitem.onzeker?: true`

- [ ] **Step 1: Schrijf de tests**

Voeg in `test/utils/offlineVoorraad.test.ts` aan de import uit `'../../app/utils/offlineVoorraad'` toe: `WACHTRIJ_SLOT`, `markeerOnzeker`, `metWachtrijslot`. Voeg aan het einde van het bestand toe:

```ts
/** Een belofte die de test zelf vrijgeeft. */
function slot(): { vrij: Promise<void>; vrijgeven: () => void } {
  let vrijgeven!: () => void
  const vrij = new Promise<void>((r) => { vrijgeven = r })
  return { vrij, vrijgeven }
}

/** Een LockManager in het geheugen: exclusief, in volgorde van aanvraag. */
function nepSloten() {
  const namen: string[] = []
  let keten: Promise<unknown> = Promise.resolve()
  const locks = {
    request(naam: string, werk: () => unknown) {
      namen.push(naam)
      const uitkomst = keten.then(() => werk())
      keten = uitkomst.catch(() => {})
      return uitkomst
    },
  } as unknown as LockManager
  return { locks, namen }
}

describe('metWachtrijslot', () => {
  // Spec twee-tabbladen §3: versturen en ongedaan maken nooit door elkaar.
  it('laat twee werken onder het slot na elkaar lopen, niet door elkaar', async () => {
    const { locks, namen } = nepSloten()
    const volgorde: string[] = []
    const a = slot()
    const eerste = metWachtrijslot(locks, async () => {}, async () => {
      volgorde.push('a begint')
      await a.vrij
      volgorde.push('a klaar')
    })
    const tweede = metWachtrijslot(locks, async () => {}, () => { volgorde.push('b') })
    await Promise.resolve()
    a.vrijgeven()
    await Promise.all([eerste, tweede])
    expect(volgorde).toEqual(['a begint', 'a klaar', 'b'])
    expect(namen).toEqual([WACHTRIJ_SLOT, WACHTRIJ_SLOT])
  })

  it('geeft de uitkomst van het werk terug', async () => {
    const { locks } = nepSloten()
    expect(await metWachtrijslot(locks, async () => {}, () => 'klaar')).toBe('klaar')
  })

  // Zonder Web Locks: het gedrag van vóór deze spec, wachten in het eigen tabblad.
  it('wacht zonder LockManager eerst op anders()', async () => {
    const volgorde: string[] = []
    const anders = slot()
    const bezig = metWachtrijslot(undefined, () => anders.vrij, () => { volgorde.push('werk') })
    await Promise.resolve()
    expect(volgorde).toEqual([])
    anders.vrijgeven()
    await bezig
    expect(volgorde).toEqual(['werk'])
  })
})

describe('markeerOnzeker', () => {
  it('merkt de ingang met hetzelfde itemId en afgestreeptOp, en geen andere', () => {
    const a = inWachtrij('a')
    const b = inWachtrij('b')
    expect(markeerOnzeker([a, b], a)).toEqual([{ ...a, onzeker: true }, b])
  })

  // Ongedaan gemaakt en opnieuw afgestreept: een nieuwe ingang, een ander moment.
  it('merkt een opnieuw afgestreepte ingang van hetzelfde item niet', () => {
    const oud = inWachtrij('a')
    const nieuw = { ...inWachtrij('a'), afgestreeptOp: '2026-10-03T13:00:00Z' }
    expect(markeerOnzeker([nieuw], oud)).toEqual([nieuw])
  })
})

describe('het onzeker-merk in de opslag', () => {
  it('leesWachtrij bewaart onzeker: true', () => {
    const o = new NepOpslag()
    schrijfWachtrij(o, [{ ...inWachtrij('a'), onzeker: true }])
    expect(leesWachtrij(o)[0]!.onzeker).toBe(true)
  })
})
```

- [ ] **Step 2: Draai de tests en zie ze falen**

Run: `npx vitest run test/utils/offlineVoorraad.test.ts`
Expected: FAIL. `metWachtrijslot`, `markeerOnzeker` en `WACHTRIJ_SLOT` bestaan niet, en `onzeker` is geen veld van `Wachtrijitem` (een typefout voor `vue-tsc`).

- [ ] **Step 3: Schrijf de implementatie**

In `app/utils/offlineVoorraad.ts`, binnen `Wachtrijitem`, na het veld `item`:

```ts
  /**
   * De laatste verzendpoging faalde zonder antwoord van de server terwijl het
   * toestel vooraf online was: misschien kreeg de server de afstreping toch
   * (spec termijn §5). In de ingang en niet in het geheugen, zodat elk
   * tabblad het ziet (spec twee-tabbladen §4). Alleen precies true telt.
   */
  onzeker?: true
```

Na `voegWachtrijSamen`:

```ts
/**
 * Zet het onzeker-merk op precies de ingang van deze afstreping: hetzelfde
 * itemId én afgestreeptOp, zoals voegWachtrijSamen een ingang herkent. Een
 * opnieuw afgestreepte ingang van hetzelfde item blijft ongemoeid.
 */
export function markeerOnzeker(wachtrij: Wachtrij, ingang: Wachtrijitem): Wachtrij {
  return wachtrij.map((w) =>
    w.itemId === ingang.itemId && w.afgestreeptOp === ingang.afgestreeptOp ? { ...w, onzeker: true } : w,
  )
}

export const WACHTRIJ_SLOT = 'stash.wachtrij'

/**
 * Doet `werk` onder het wachtrijslot (spec twee-tabbladen §3). Met Web Locks
 * is dat slot exclusief over alle tabbladen van deze oorsprong, en laat een
 * tabblad dat sluit het vanzelf los. Zonder Web Locks eerst wachten op
 * `anders`: in de app is dat de verzending in het eigen tabblad, het gedrag
 * van vóór het slot.
 */
export async function metWachtrijslot<T>(
  locks: LockManager | undefined,
  anders: () => Promise<unknown>,
  werk: () => T | Promise<T>,
): Promise<T> {
  if (locks) return locks.request(WACHTRIJ_SLOT, () => werk()) as Promise<T>
  await anders()
  return werk()
}
```

- [ ] **Step 4: Draai de tests en zie ze slagen**

Run: `npx vitest run test/utils/offlineVoorraad.test.ts`
Expected: PASS.

- [ ] **Step 5: Falsificeer**

| Wijziging | Moet rood worden |
|---|---|
| In `metWachtrijslot` de tak `if (locks) …` vervangen door `if (locks) return werk()` | "laat twee werken onder het slot na elkaar lopen…" |
| In `metWachtrijslot` `await anders()` weghalen | "wacht zonder LockManager eerst op anders()" |
| In `markeerOnzeker` `&& w.afgestreeptOp === ingang.afgestreeptOp` weghalen | "merkt een opnieuw afgestreepte ingang van hetzelfde item niet" |
| In `metWachtrijslot` `WACHTRIJ_SLOT` vervangen door `'iets anders'` | "laat twee werken onder het slot na elkaar lopen…" (de namen) |

- [ ] **Step 6: Lint, types en commit**

```bash
npx eslint app/utils/offlineVoorraad.ts test/utils/offlineVoorraad.test.ts
npx vue-tsc --noEmit -p .
npx vitest run
git add app/utils/offlineVoorraad.ts test/utils/offlineVoorraad.test.ts
git commit -m "feat: metWachtrijslot en markeerOnzeker voor de wachtrij over tabbladen heen"
```

---

### Task 2: Het slot en het merk in de composable, met twee tabbladen getest

**Files:**
- Modify: `app/composables/useOfflineVoorraad.ts`
- Modify: `e2e/offline.spec.ts`

**Interfaces:**
- Consumes: `metWachtrijslot`, `markeerOnzeker`, `Wachtrijitem.onzeker` (Task 1).
- Produces: geen nieuwe exports. `zetInWachtrij`, `verstuur`, `wachtOpVerzending` en `ongedaanMakenInWachtrij` houden hun handtekening.

- [ ] **Step 1: Schrijf de e2e-tests**

In `e2e/offline.spec.ts`, na de test `'faalt het heropenen op de offline-pagina, dan zegt ongedaan maken dat het niet bevestigd is'`:

```ts
/**
 * Een tweede tabblad met de offline-pagina, online geopend. Afstrepen daar
 * komt altijd zeker in de wachtrij, zonder verzoek naar de server. Dit
 * tabblad krijgt geen online-event, dus verstuurt het zelf niets: dat zou het
 * verschil verbergen.
 */
async function tweedeTabbladMetAfstreping(page: Page, naam: string): Promise<Page> {
  const tab2 = await page.context().newPage()
  await tab2.goto(routePath('offline', 'en'))
  await expect(groep(tab2, 'Pantry', naam)).toContainText('×2')
  await streepAf(tab2, naam)
  await expect(tab2.getByText(tekst(en.offlineVoorraad.pending, { count: 1 }))).toBeVisible()
  // De muis op de toast pauzeert zijn timer: hij moet de verzending overleven.
  await tab2.getByRole('button', { name: en.inventory.undo }).hover()
  return tab2
}

test('ongedaan maken in een ander tabblad wacht op de verzending van dit tabblad', async ({ page }) => {
  const naam = `Tabblad${Date.now()}`
  await maakHuishoudenMet(page, 'tabbladen-wacht', 'Tim', [{ naam, aantal: 2 }])
  const tab2 = await tweedeTabbladMetAfstreping(page, naam)

  // Tabblad 1 verstuurt; zijn PATCH zit vast tot de test hem vrijgeeft.
  const { vrij, vrijgeven } = slot()
  await page.route('**/rest/v1/inventory_item*', async (route) => {
    if (!isPatch(new URL(route.request().url()), route.request().method())) return route.fallback()
    await vrij
    await route.continue()
  })
  const verzonden = page.waitForRequest((r) => isPatch(new URL(r.url()), r.method()))
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await verzonden

  // Tabblad 2 maakt ongedaan terwijl tabblad 1 verstuurt. Zonder slot haalt het
  // de ingang meteen weg, terwijl de server de afstreping zo meteen toch krijgt.
  await tab2.getByRole('button', { name: en.inventory.undo }).click()
  vrijgeven()
  await expect(tab2.getByText(en.offlineVoorraad.alreadySent, { exact: true })).toBeVisible()

  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  expect(await wachtrijWaarde(page)).toBeNull()
})

test('een onzekere verzending van een ander tabblad wordt bij ongedaan maken heropend', async ({ page }) => {
  const naam = `Tabbladonzeker${Date.now()}`
  await maakHuishoudenMet(page, 'tabbladen-onzeker', 'Toon', [{ naam, aantal: 2 }])
  const tab2 = await tweedeTabbladMetAfstreping(page, naam)

  // Tabblad 1 verstuurt: de server krijgt de afstreping, tabblad 1 het antwoord
  // niet. Na de termijn is ze onzeker, en dat merk moet tabblad 2 zien.
  const vast = await houdEersteAfstrepingVast(page)
  const verzonden = page.waitForRequest((r) => isPatch(new URL(r.url()), r.method()))
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await verzonden

  await tab2.getByRole('button', { name: en.inventory.undo }).click()
  await expect(groep(tab2, 'Pantry', naam)).toContainText('×2', { timeout: 20_000 })

  vast.vrijgeven()
  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  expect(await wachtrijWaarde(page)).toBeNull()
})
```

- [ ] **Step 2: Draai de e2e-tests en zie ze falen**

Run: `npx playwright test e2e/offline.spec.ts -g "ander tabblad" --reporter=line`
Expected: FAIL.
- "…wacht op de verzending van dit tabblad": `alreadySent` komt nooit, want tabblad 2 haalt de ingang meteen weg.
- "…wordt bij ongedaan maken heropend": na de herlaad `×1`, want tabblad 2 kent het merk niet en heropent niet.

- [ ] **Step 3: Pas de composable aan**

In `app/composables/useOfflineVoorraad.ts`:

Voeg aan de import uit `'~/utils/offlineVoorraad'` toe: `markeerOnzeker`, `metWachtrijslot`, en het type `Wachtrijitem`.

Vervang het commentaar en de declaratie van de set (`// Afstrepingen die misschien al op de server staan: …` tot en met `const onzeker = new Set<string>()`) door:

```ts
/** Web Locks als de browser ze kent (spec twee-tabbladen §3). */
function sloten(): LockManager | undefined {
  return import.meta.client && typeof navigator !== 'undefined' ? navigator.locks : undefined
}
```

`zetInWachtrij` wordt:

```ts
  /**
   * De eigenaar is de ingelogde gebruiker, of — offline zonder sessie — die van
   * de kopie. true alleen als de wachtrij echt geschreven is: faalt dat (vol,
   * geen eigenaar), dan mag de aanroeper de afstreping niet als bewaard tonen.
   * `onzeker`: de afstreping is misschien al op de server (spec termijn §5).
   * Het merk staat in de ingang zelf, en een nieuwe ingang erft er nooit een.
   */
  function zetInWachtrij(item: VoorraadItem, reden: Reden, opties: { onzeker?: boolean } = {}): boolean {
    let gelukt = false
    schrijf((o) => {
      const k = leesKopie(o)
      const eigenaar = user.value?.sub ?? k?.eigenaar
      if (!eigenaar) return
      const ingang: Wachtrijitem = {
        itemId: item.id,
        reden,
        eigenaar,
        afgestreeptOp: new Date().toISOString(),
        item,
        ...(opties.onzeker ? { onzeker: true as const } : {}),
      }
      schrijfWachtrij(o, [...leesWachtrij(o), ingang])
      gelukt = true
      // Mislukt alleen dit, dan staat de afstreping wel in de wachtrij.
      if (k) schrijfKopie(o, streepAfInKopie(k, item.id))
    })
    return gelukt
  }
```

`verstuurNu` wordt (de bestaande commentaarblok over de sessie blijft woordelijk staan, op de plaats van `// …sessiecommentaar…`):

```ts
  async function verstuurNu(): Promise<void> {
    const id = user.value?.sub
    if (!id) return
    // Alleen een snelle controle: de wachtrij die verstuurd wordt, komt pas
    // binnen het slot.
    if (wachtrijVoor(wachtrij(), id).length === 0) return
    // …sessiecommentaar…
    const { data } = await supabase.auth.getSession()
    if (!data.session) return
    // Binnen het slot: een verzending of ongedaanmaking in een ander tabblad
    // gaat voor of na, nooit tegelijk (spec twee-tabbladen §3). De sessie
    // hierboven bewust erbuiten: auth heeft geen termijn, en een hangende
    // vernieuwing zou het slot voor alle tabbladen vasthouden.
    const mislukt = await metWachtrijslot(sloten(), () => Promise.resolve(), async () => {
      // Opnieuw lezen: een ander tabblad kan intussen verstuurd of ongedaan
      // gemaakt hebben.
      const mijn = wachtrijVoor(wachtrij(), id)
      if (mijn.length === 0) return 0
      const r = await verstuurWachtrij(mijn, (itemId, reden) => close(itemId, reden))
      // Is r.onzeker gezet, dan is resterend[0] precies de ingang die faalde.
      const onzekere = r.onzeker ? r.resterend[0] : undefined
      // Herschrijf de wachtrij zoals ze nu in de opslag staat, niet zoals ze
      // was toen het versturen begon (zie voegWachtrijSamen).
      schrijf((o) => {
        const samen = voegWachtrijSamen(leesWachtrij(o), mijn, r.resterend)
        schrijfWachtrij(o, onzekere ? markeerOnzeker(samen, onzekere) : samen)
      })
      return r.mislukt
    })
    if (mislukt > 0) toast.add({ title: $i18n.t('offlineVoorraad.notSent', { count: mislukt }), color: 'error' })
  }
```

`ongedaanMakenInWachtrij` wordt:

```ts
  /**
   * Ongedaan maken van een afstreping uit de wachtrij (spec termijn §6, spec
   * twee-tabbladen §3). 'nietInWachtrij': ze is intussen verstuurd; de
   * aanroeper beslist wat dan. Was ze onzeker, dan ook heropenen op de
   * server: reopen() filtert op status 'closed', dus had de server haar niet,
   * dan raakt het niets.
   */
  async function ongedaanMakenInWachtrij(item: VoorraadItem): Promise<Ongedaanuitkomst> {
    // Binnen het slot, en alleen synchroon werk: een verzending in dit of een
    // ander tabblad is dan klaar, en neemt de afstreping daarna niet meer mee.
    // Zonder Web Locks: wachten op de verzending in dit tabblad.
    const stand = await metWachtrijslot(sloten(), wachtOpVerzending, () => {
      const wasOnzeker = wachtrij().some((w) => w.itemId === item.id && w.onzeker === true)
      if (!haalUitWachtrij(item.id)) return 'weg' as const
      return wasOnzeker ? ('onzeker' as const) : ('zeker' as const)
    })
    if (stand === 'weg') return 'nietInWachtrij'
    if (stand === 'zeker') return 'teruggezet'
    try {
      await reopen(item.id)
      return 'teruggezet'
    } catch {
      return 'nietBevestigd'
    }
  }
```

Kijk na dat er geen verwijzing naar de verwijderde set `onzeker` overblijft (`grep -n "onzeker\." app/composables/useOfflineVoorraad.ts` geeft niets).

- [ ] **Step 4: Draai de tests en zie ze slagen**

Run: `npx playwright test e2e/offline.spec.ts -g "ander tabblad|tijdens een verzending wacht|hangende afstreping|onzeker verstuurde|erft het onzeker-merk|offline-pagina" --reporter=line`
Expected: PASS. De twee nieuwe tests en de bestaande race-, onzeker- en offline-pagina-tests slagen.

- [ ] **Step 5: Falsificeer**

| Wijziging | Moet rood worden |
|---|---|
| In `ongedaanMakenInWachtrij` `metWachtrijslot(sloten(), wachtOpVerzending, …)` vervangen door het werk direct uitvoeren (zonder slot en zonder wachten) | "…wacht op de verzending van dit tabblad", "…wordt bij ongedaan maken heropend", en de bestaande "ongedaan maken tijdens een verzending wacht op die verzending" |
| In `verstuurNu` het werk direct uitvoeren in plaats van via `metWachtrijslot` | "…wacht op de verzending van dit tabblad" |
| In `verstuurNu` `markeerOnzeker` niet toepassen (altijd `samen` schrijven) | "…wordt bij ongedaan maken heropend", en de bestaande "ongedaan maken van een afstreping die de wachtrij onzeker verstuurde…" |
| In `zetInWachtrij` het veld `onzeker` nooit schrijven | de bestaande "een hangende afstreping komt na de termijn in de wachtrij…" |
| In `ongedaanMakenInWachtrij` `wasOnzeker` ná `haalUitWachtrij` lezen | "…wordt bij ongedaan maken heropend" (de ingang is dan al weg) |

- [ ] **Step 6: Lint, types, unit en commit**

```bash
npx eslint app/composables/useOfflineVoorraad.ts e2e/offline.spec.ts
npx vue-tsc --noEmit -p .
npx vitest run
git add app/composables/useOfflineVoorraad.ts e2e/offline.spec.ts
git commit -m "feat: versturen en ongedaan maken nemen hetzelfde slot over alle tabbladen"
```

---

### Task 3: Documentatie en de volledige suite

**Files:**
- Modify: `docs/superpowers/open-bevindingen.md`
- Modify: `docs/superpowers/specs/2026-10-04-termijn-design.md`
- Modify: `docs/superpowers/specs/2026-10-04-twee-tabbladen-design.md` (alleen bij afwijkingen)

- [ ] **Step 1: Werk `open-bevindingen.md` bij**

Verwijder de rij die begint met `| **Ongedaan maken over twee tabbladen.** |`.

- [ ] **Step 2: Verwijs vanuit de termijn-spec**

In `docs/superpowers/specs/2026-10-04-termijn-design.md`, aan het einde van §5, als nieuwe alinea:

```
Sinds `2026-10-04-twee-tabbladen-design.md` staat het merk niet meer in een
set in het geheugen, maar als `onzeker: true` in de wachtrij-ingang zelf,
zodat elk tabblad het ziet. Versturen en ongedaan maken nemen daar ook
hetzelfde slot over alle tabbladen heen.
```

- [ ] **Step 3: Draai alles**

```bash
npx vitest run
npx eslint .
npx vue-tsc --noEmit -p .
npx playwright test --workers=2 --reporter=line
```

Expected: alles groen. Zet de ruwe staart van de e2e-uitvoer (de laatste ~15 regels) in het rapport. Faalt een test in het aanmelden of de opzet, draai hem dan één keer alleen opnieuw en meld beide runs. Een gedragsfout is echt: meld BLOCKED.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/open-bevindingen.md docs/superpowers/specs/2026-10-04-termijn-design.md docs/superpowers/specs/2026-10-04-twee-tabbladen-design.md
git commit -m "docs: ongedaan maken over twee tabbladen uit de bevindingen"
```
