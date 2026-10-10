# Ongedaan maken heropent alleen je eigen afstreping — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `reopen()` heropent alleen een item dat de ingelogde gebruiker zelf afstreepte, en meldt het wanneer het item intussen van een ander is.

**Architecture:**
- `useInventory().reopen(id)` filtert de update op `closed_by = ik`. Raakt ze niets, dan leest ze het item na, en geeft ze `'heropend' | 'nietGesloten' | 'vanEenAnder'` terug.
- De voorraadpagina meldt `'vanEenAnder'`.
- `ongedaanMakenInWachtrij` krijgt de uitkomst `'vanEenAnder'` en streept het item weer af in de kopie.
- De offline-pagina meldt het ook.
- E2e bootst een huisgenoot na met een echte tweede gebruiker, rechtstreeks in de lokale database.

**Tech Stack:** Nuxt 4, @nuxtjs/supabase 2, @nuxtjs/i18n 10, Playwright, `postgres` (via `test/db/helpers.ts`).

**Spec:** `docs/superpowers/specs/2026-10-10-eigen-afstreping-design.md`

## Global Constraints

- **Elke "Falsificeer"-stap is verplicht.** Breng de wijziging aan, zie de genoemde test ROOD worden, draai terug en zie hem GROEN worden. Blijft een test groen bij zijn falsificatie, dan herschrijf je de test, nooit de falsificatie. Draai terug door opnieuw te bewerken, niet met `git checkout`, zodat ongecommit werk niet verloren gaat. Een commit bevat nooit een gefalsificeerde toestand.
- **Het filter staat in de client:** `.eq('closed_by', ik)` in `reopen`. Er komt geen migratie en geen RPC.
- **De uitkomsten** zijn `Heropening = 'heropend' | 'nietGesloten' | 'vanEenAnder'`, met `Ongedaanuitkomst` uitgebreid met `'vanEenAnder'`.
- **De melding** is `inventory.undoByOther`, in alle drie de locales, met de exacte teksten uit spec §4. De kleur is `warning`.
- **De termijn blijft 10 s, ook in e2e.** Geen vaste pauzes als vervanging voor volgorde.
- **Commentaar, testnamen en meldingen in het Nederlands.**
- **Stop een eigen `nuxt dev` op poort 3000 vóór e2e.** Bij `Another Nuxt dev is already running`: verwijder `.nuxt/nuxt.lock` en kill nooit het genoemde PID. Draai de volledige e2e-suite met `--workers=2`.
- **Elke commit eindigt met de Co-Authored-By-regel van je eigen harness.** Commits worden via 1Password gesigneerd. Faalt dat onduidelijk, meld dan BLOCKED; omzeil het signeren nooit.

## Wat al gemeten is

- **`closed_by`.** `grant select` op `inventory_item` voor `authenticated` dekt `closed_by`. De trigger `stamp_inventory_item_closure` zet `closed_by := auth.uid()` bij `in_stock → closed` en wist het bij `closed → in_stock` (`supabase/migrations/20261001100200_inventory_item_afstrepen.sql`).
- **De databasehelpers.** `test/db/helpers.ts` laadt `.env` zelf (`process.loadEnvFile()`) en exporteert `createUser(email)`, `withTx(fn)` en `actAs(tx, userId)`. Dat laatste zet `request.jwt.claim.sub`, wat `auth.uid()` leest. `DATABASE_URL` staat in de lokale `.env` en in de e2e-job van CI (`.github/workflows/ci.yml`).
- **Een update als superuser omzeilt RLS.** De huisgenoot hoeft dus geen lid te zijn. Het gaat om wie afstreepte (`closed_by`), en dat zet de trigger.
- **Een offline afstreping neemt het oudste item van de variant.** Het id dat de huisgenoot moet raken, komt daarom uit de wachtrij-ingang, niet uit de lijst.

## Bestandsstructuur

| Bestand | Verantwoordelijkheid |
|---|---|
| `app/composables/useInventory.ts` | `Heropening`, `reopen` met filter en nalezen |
| `app/pages/inventory/index.vue` | `ongedaanMaken` en `ongedaanMakenOffline` behandelen de uitkomsten |
| `app/composables/useOfflineVoorraad.ts` | `Ongedaanuitkomst` + `'vanEenAnder'`, en het item weer afstrepen in de kopie |
| `app/components/OfflineVoorraad.vue` | De melding bij `'vanEenAnder'` |
| `i18n/locales/{en,nl,fr}.json` | `inventory.undoByOther` |
| `e2e/offline.spec.ts` | Helpers voor de huisgenoot en vier tests |
| `docs/superpowers/open-bevindingen.md` | De rij verdwijnt |

---

### Task 1: `reopen` heropent alleen je eigen afstreping

**Files:**
- Modify: `app/composables/useInventory.ts`
- Modify: `app/pages/inventory/index.vue` (`ongedaanMaken`)
- Modify: `i18n/locales/en.json`, `nl.json`, `fr.json`
- Modify: `e2e/offline.spec.ts`

**Interfaces:**
- Produces: `export type Heropening = 'heropend' | 'nietGesloten' | 'vanEenAnder'` in `app/composables/useInventory.ts`; `reopen(id: string): Promise<Heropening>`.
- Produces in e2e: de helpers `streepAfAlsHuisgenoot(itemId: string): Promise<void>`, `eersteWachtrijItem(page: Page): Promise<string>` en `idsInKopie(page: Page): Promise<string[]>`.

- [ ] **Step 1: Voeg de melding toe**

In elk van de drie locales, in het blok `inventory`, na `"cannotUndo"`:

- `nl.json`: `"undoByOther": "Niet ongedaan gemaakt: iemand anders heeft dit item intussen afgestreept of verwijderd.",`
- `en.json`: `"undoByOther": "Not undone: someone else checked off or deleted this item in the meantime.",`
- `fr.json`: `"undoByOther": "Pas remis en stock : quelqu'un d'autre a retiré ou supprimé cet article entre-temps.",`

- [ ] **Step 2: Schrijf de helpers en de e2e-test**

In `e2e/offline.spec.ts`, bij de imports:

```ts
import { actAs, createUser, withTx } from '../test/db/helpers'
```

Na de helper `houdEersteAfstrepingVast`:

```ts
/**
 * Een huisgenoot streept dit item af, rechtstreeks in de lokale database: een
 * echte tweede gebruiker, en de trigger zet closed_by op hem. Als superuser
 * omzeilt deze verbinding RLS, dus lid hoeft hij niet te zijn: het gaat om wie
 * afstreepte. Spec eigen-afstreping §5.
 */
async function streepAfAlsHuisgenoot(itemId: string): Promise<void> {
  const huisgenoot = await createUser(`huisgenoot-${Date.now()}@example.com`)
  await withTx(async (tx) => {
    await actAs(tx, huisgenoot)
    await tx`update inventory_item set status = 'closed', closed_reason = 'consumed' where id = ${itemId}`
  })
}

/** Het item van de eerste afstreping in de wachtrij: dat item moet de huisgenoot raken. */
async function eersteWachtrijItem(page: Page): Promise<string> {
  return page.evaluate((s) => JSON.parse(localStorage.getItem(s) ?? '[]')[0].itemId, WACHTRIJ_SLEUTEL)
}

async function idsInKopie(page: Page): Promise<string[]> {
  return page.evaluate(
    (s) => (JSON.parse(localStorage.getItem(s) ?? 'null')?.items ?? []).map((i: { id: string }) => i.id),
    KOPIE_SLEUTEL,
  )
}
```

Na de test `'faalt ook het heropenen, dan zegt ongedaan maken dat het niet bevestigd is'`:

```ts
test('ongedaan maken na een vervallen verzending heropent de afstreping van een huisgenoot niet', async ({ page, context }) => {
  const naam = `Vervallen${Date.now()}`
  await maakHuishoudenMet(page, 'eigen-vervallen', 'Vera', [{ naam, aantal: 2 }])

  await context.setOffline(true)
  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible()
  // De muis op de toast pauzeert zijn timer.
  const ongedaan = page.getByRole('button', { name: en.inventory.undo })
  await ongedaan.hover()

  // Intussen streept een huisgenoot hetzelfde item af.
  await streepAfAlsHuisgenoot(await eersteWachtrijItem(page))

  // Online: mijn verzending raakt niets en vervalt.
  await context.setOffline(false)
  await page.waitForFunction((s) => localStorage.getItem(s) === null, WACHTRIJ_SLEUTEL)

  // Niet meer in de wachtrij, dus een gewone heropening, en die mag de
  // afstreping van de huisgenoot niet raken.
  await ongedaan.click()
  await expect(page.getByText(en.inventory.undoByOther, { exact: true })).toBeVisible()
  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
})
```

- [ ] **Step 3: Draai de test en zie hem falen**

Run: `npx playwright test e2e/offline.spec.ts -g "vervallen verzending heropent" --reporter=line`
Expected: FAIL. `undoByOther` verschijnt nooit, omdat `reopen` het item van de huisgenoot heropent.

- [ ] **Step 4: Pas `reopen` aan**

In `app/composables/useInventory.ts`, boven `export function useInventory()`:

```ts
/** Wat reopen() deed. Spec docs/superpowers/specs/2026-10-10-eigen-afstreping-design.md §3. */
export type Heropening = 'heropend' | 'nietGesloten' | 'vanEenAnder'
```

In `useInventory()`, na `const supabase = useSupabaseClient()`:

```ts
  const user = useSupabaseUser()
```

Vervang `reopen` en haar docblok door:

```ts
  /**
   * Ongedaan maken, alleen van je eigen afstreping (spec eigen-afstreping §3).
   * De trigger wist closed_at, closed_by en closed_reason. Is de plaats
   * intussen weg, dan gooit dit de samenhangfout — herken die met
   * isSamenhangFout().
   *
   * Raakt de update niets, dan leest dit het item na. In voorraad is
   * 'nietGesloten': mijn afstreping kwam nooit aan, of iemand zette het al
   * terug. Gesloten door iemand anders (ook een verwijderd account) of
   * verwijderd is 'vanEenAnder'.
   */
  async function reopen(id: string): Promise<Heropening> {
    const ik = user.value?.sub
    if (!ik) throw new Error('Geen ingelogde gebruiker')
    const { data, error } = await supabase
      .from('inventory_item')
      .update({ status: 'in_stock' })
      .eq('id', id)
      .eq('status', 'closed')
      .eq('closed_by', ik)
      .select('id')
    if (error) throw error
    if ((data ?? []).length === 1) return 'heropend'
    const { data: nu, error: leesfout } = await supabase
      .from('inventory_item')
      .select('status')
      .eq('id', id)
      .maybeSingle()
    if (leesfout) throw leesfout
    return nu?.status === 'in_stock' ? 'nietGesloten' : 'vanEenAnder'
  }
```

- [ ] **Step 5: Pas `ongedaanMaken` op de voorraadpagina aan**

In `app/pages/inventory/index.vue` wordt het `try`-blok van `ongedaanMaken`:

```ts
  try {
    const uitkomst = await reopen(itemId)
    // Zoals bij afstrepen: de kopie meteen, voor het geval de verversing faalt.
    if (uitkomst === 'heropend' && item) offline.zetTerugInDeKopie(item)
    // 'nietGesloten': het stond al in voorraad. Herladen toont de juiste stand.
    // 'vanEenAnder': iemand anders streepte het intussen af of verwijderde het
    // (spec eigen-afstreping §4).
    if (uitkomst === 'vanEenAnder') toast.add({ title: t('inventory.undoByOther'), color: 'warning' })
  } catch (oorzaak) {
```

De `catch` en de `await herlaad()` erna blijven ongewijzigd.

`app/composables/useOfflineVoorraad.ts` roept `reopen` ook aan. Die aanroep gebruikt de uitkomst nog niet (dat is Task 2) en compileert ongewijzigd: `await reopen(item.id)` zonder de waarde te lezen.

- [ ] **Step 6: Draai de tests en zie ze slagen**

Run: `npx playwright test e2e/offline.spec.ts -g "vervallen verzending heropent|hangende afstreping komt|faalt ook het heropenen|serverfout komt niet" --reporter=line`
Expected: PASS. De nieuwe test slaagt, en de bestaande heropen-tests blijven groen.

- [ ] **Step 7: Falsificeer**

| Wijziging | Moet rood worden |
|---|---|
| In `reopen` `.eq('closed_by', ik)` weghalen | "ongedaan maken na een vervallen verzending…" (geen `undoByOther`, en `×2` na de herlaad) |
| In `reopen` na nul rijen altijd `'nietGesloten'` teruggeven | "ongedaan maken na een vervallen verzending…" (geen `undoByOther`) |
| In `ongedaanMaken` de regel met `undoByOther` weghalen | "ongedaan maken na een vervallen verzending…" |

- [ ] **Step 8: Lint, types, unit en commit**

```bash
npx eslint app/composables/useInventory.ts app/pages/inventory/index.vue e2e/offline.spec.ts
npx vue-tsc --noEmit -p .
npx vitest run
git add app/composables/useInventory.ts app/pages/inventory/index.vue i18n/locales e2e/offline.spec.ts
git commit -m "feat: reopen heropent alleen je eigen afstreping en meldt die van een ander"
```

---

### Task 2: Een onzekere afstreping van een huisgenoot komt niet terug

**Files:**
- Modify: `app/composables/useOfflineVoorraad.ts`
- Modify: `app/pages/inventory/index.vue` (`ongedaanMakenOffline`)
- Modify: `app/components/OfflineVoorraad.vue` (`maakOngedaan`)
- Modify: `e2e/offline.spec.ts`

**Interfaces:**
- Consumes: `reopen(id): Promise<Heropening>` en de e2e-helpers (Task 1).
- Produces: `Ongedaanuitkomst = 'teruggezet' | 'nietBevestigd' | 'nietInWachtrij' | 'vanEenAnder'`.

- [ ] **Step 1: Schrijf de e2e-tests**

In `e2e/offline.spec.ts`, na de test van Task 1:

```ts
/** Houdt de eerste PATCH vast zonder hem door te laten: alleen de termijn breekt hem af. Elke volgende gaat door. */
async function houdEersteAfstrepingTegen(page: Page) {
  const { vrij, vrijgeven } = slot()
  let pogingen = 0
  await page.route('**/rest/v1/inventory_item*', async (route) => {
    if (!isPatch(new URL(route.request().url()), route.request().method())) return route.fallback()
    pogingen++
    if (pogingen > 1) return route.fallback()
    await vrij
    await route.abort().catch(() => {})
  })
  return { vrijgeven }
}

test('een onzekere afstreping die een huisgenoot intussen afstreepte, komt bij ongedaan maken niet terug', async ({ page }) => {
  const naam = `Onzekerander${Date.now()}`
  await maakHuishoudenMet(page, 'eigen-onzeker', 'Olaf', [{ naam, aantal: 2 }])
  const tegen = await houdEersteAfstrepingTegen(page)

  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible({ timeout: 20_000 })
  const ongedaan = page.getByRole('button', { name: en.inventory.undo })
  await ongedaan.hover()
  const itemId = await eersteWachtrijItem(page)
  await streepAfAlsHuisgenoot(itemId)

  await ongedaan.click()
  await expect(page.getByText(en.inventory.undoByOther, { exact: true })).toBeVisible()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  expect(await idsInKopie(page)).not.toContain(itemId)
  expect(await wachtrijWaarde(page)).toBeNull()
  tegen.vrijgeven()
})

test('een onzekere afstreping die nooit aankwam, komt bij ongedaan maken gewoon terug', async ({ page }) => {
  const naam = `Nooitaan${Date.now()}`
  await maakHuishoudenMet(page, 'eigen-nooit', 'Nora', [{ naam, aantal: 2 }])
  const tegen = await houdEersteAfstrepingTegen(page)

  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: en.inventory.undo }).click()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  await expect(page.getByText(en.inventory.undoByOther, { exact: true })).toHaveCount(0)
  tegen.vrijgeven()

  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
})

test('ongedaan maken op de offline-pagina meldt een afstreping van een huisgenoot', async ({ page }) => {
  const naam = `Kelderander${Date.now()}`
  await maakHuishoudenMet(page, 'eigen-offlinepagina', 'Otto', [{ naam, aantal: 2 }])

  await page.goto(routePath('offline', 'en'))
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  await streepAf(page, naam)
  await expect(page.getByText(tekst(en.offlineVoorraad.pending, { count: 1 }))).toBeVisible()
  const ongedaan = page.getByRole('button', { name: en.inventory.undo })
  await ongedaan.hover()

  // Het online-event laat de plugin versturen; de PATCH bereikt de server
  // nooit en stuit op de termijn, dus de afstreping is onzeker.
  const tegen = await houdEersteAfstrepingTegen(page)
  const verzonden = page.waitForRequest((r) => isPatch(new URL(r.url()), r.method()))
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await verzonden
  await streepAfAlsHuisgenoot(await eersteWachtrijItem(page))

  // Ongedaan maken wacht op het slot, dus op het einde van de verzending.
  await ongedaan.click()
  await expect(page.getByText(en.inventory.undoByOther, { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  tegen.vrijgeven()
})
```

- [ ] **Step 2: Draai de tests en zie ze falen, op één na**

Run: `npx playwright test e2e/offline.spec.ts -g "huisgenoot intussen afstreepte|nooit aankwam|meldt een afstreping van een huisgenoot" --reporter=line`
Expected:
- "…die een huisgenoot intussen afstreepte…" faalt: `ongedaanMakenInWachtrij` negeert de uitkomst van `reopen`, zet het item terug (`×2`) en toont geen `undoByOther`.
- "…meldt een afstreping van een huisgenoot" faalt om dezelfde reden: geen `undoByOther`.
- "…die nooit aankwam…" **slaagt al**. Het is een regressiebewaking voor `'nietGesloten'`; ze wordt rood bij haar falsificatie in Step 5.

- [ ] **Step 3: Pas de composable aan**

In `app/composables/useOfflineVoorraad.ts`:

```ts
export type Ongedaanuitkomst = 'teruggezet' | 'nietBevestigd' | 'nietInWachtrij' | 'vanEenAnder'
```

In de docblok van `ongedaanMakenInWachtrij` vervang je de zin "Was ze onzeker, dan ook heropenen op de server: reopen() filtert op status 'closed', dus had de server haar niet, dan raakt het niets." door:

```
   * Was ze onzeker, dan ook heropenen op de server. reopen() raakt alleen je
   * eigen afstreping (spec eigen-afstreping §3): had de server haar niet, dan
   * raakt het niets; is het item intussen van een ander, dan 'vanEenAnder'.
```

Het einde van `ongedaanMakenInWachtrij` (vanaf `try {`) wordt:

```ts
    try {
      if ((await reopen(item.id)) !== 'vanEenAnder') return 'teruggezet'
    } catch {
      return 'nietBevestigd'
    }
    // Van een ander: haalUitWachtrij zette het item terug in de kopie, maar het
    // blijft gesloten (spec eigen-afstreping §4).
    streepAfInDeKopie(item.id)
    return 'vanEenAnder'
```

- [ ] **Step 4: Pas de twee pagina's aan**

In `app/pages/inventory/index.vue`, in `ongedaanMakenOffline`, direct na het blok `if (uitkomst === 'nietInWachtrij') { … }`:

```ts
  // Van een ander: niet terug in de lijst (spec eigen-afstreping §4).
  if (uitkomst === 'vanEenAnder') {
    toast.add({ title: t('inventory.undoByOther'), color: 'warning' })
    return
  }
```

In `app/components/OfflineVoorraad.vue`, in `maakOngedaan`, na de regel met `undoUnconfirmed`:

```ts
  if (uitkomst === 'vanEenAnder') toast.add({ title: t('inventory.undoByOther'), color: 'warning' })
```

- [ ] **Step 5: Draai de tests en zie ze slagen**

Run: `npx playwright test e2e/offline.spec.ts -g "huisgenoot|nooit aankwam|onzeker|offline-pagina|ander tabblad" --reporter=line`
Expected: PASS, ook de bestaande onzeker-, offline-pagina- en tabblad-tests.

- [ ] **Step 6: Falsificeer**

| Wijziging | Moet rood worden |
|---|---|
| In `ongedaanMakenInWachtrij` `'vanEenAnder'` als `'teruggezet'` behandelen (altijd `return 'teruggezet'` na `reopen`) | "…die een huisgenoot intussen afstreepte…", "…meldt een afstreping van een huisgenoot" |
| In `ongedaanMakenInWachtrij` `streepAfInDeKopie(item.id)` weghalen | "…die een huisgenoot intussen afstreepte…" (het id staat nog in de kopie) |
| In `ongedaanMakenOffline` de `return` in de tak `'vanEenAnder'` weghalen | "…die een huisgenoot intussen afstreepte…" (`×2`) |
| In `reopen` na nul rijen altijd `'vanEenAnder'` teruggeven | "…die nooit aankwam…" |
| In `OfflineVoorraad.vue` de regel met `undoByOther` weghalen | "…meldt een afstreping van een huisgenoot" |

- [ ] **Step 7: Lint, types, unit en commit**

```bash
npx eslint app/composables/useOfflineVoorraad.ts app/pages/inventory/index.vue app/components/OfflineVoorraad.vue e2e/offline.spec.ts
npx vue-tsc --noEmit -p .
npx vitest run
git add app/composables/useOfflineVoorraad.ts app/pages/inventory/index.vue app/components/OfflineVoorraad.vue e2e/offline.spec.ts
git commit -m "feat: een onzekere afstreping van een huisgenoot komt bij ongedaan maken niet terug"
```

---

### Task 3: Documentatie en de volledige suite

**Files:**
- Modify: `docs/superpowers/open-bevindingen.md`
- Modify: `docs/superpowers/specs/2026-10-10-eigen-afstreping-design.md` (alleen bij afwijkingen)

- [ ] **Step 1: Werk `open-bevindingen.md` bij**

Verwijder de rij die begint met `| **Ongedaan maken na een vervallen verzending heropent andermans afstreping.** |`.

- [ ] **Step 2: Draai alles**

```bash
npx vitest run
npx eslint .
npx vue-tsc --noEmit -p .
npx playwright test --workers=2 --reporter=line
```

Expected: alles groen. Zet de ruwe staart van de e2e-uitvoer (de laatste ~15 regels) in het rapport. Faalt een test in het aanmelden of de opzet, draai hem dan één keer alleen opnieuw en meld beide runs. Een gedragsfout is echt: meld BLOCKED.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/open-bevindingen.md docs/superpowers/specs/2026-10-10-eigen-afstreping-design.md
git commit -m "docs: ongedaan maken na een vervallen verzending uit de bevindingen"
```
