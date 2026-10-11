import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { routePath } from '../routes.config'
import { signIn, createHousehold, bundles, waitForHydration, openUserMenu } from './helpers'
import { KOPIE_SLEUTEL, WACHTRIJ_SLEUTEL } from '../app/utils/offlineVoorraad'
import { SUPABASE_TERMIJN_MS } from '../app/utils/termijn'
import { actAs, createUser, withDb, withTx } from '../test/db/helpers'

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

// De PATCH op inventory_item: afstrepen (close) en ongedaan maken (reopen).
const isPatch = (url: URL, methode: string) => methode === 'PATCH' && url.pathname.endsWith('/rest/v1/inventory_item')
const wachtrijWaarde = (page: Page) => page.evaluate((s) => localStorage.getItem(s), WACHTRIJ_SLEUTEL)

/** Een belofte die de test zelf vrijgeeft: een verzoek blijft hangen tot dan. */
function slot(): { vrij: Promise<void>; vrijgeven: () => void } {
  let vrijgeven!: () => void
  const vrij = new Promise<void>((r) => { vrijgeven = r })
  return { vrij, vrijgeven }
}

/**
 * Laat de eerste PATCH op inventory_item bij de server aankomen, maar houdt het
 * antwoord tegen tot `vrijgeven()`. De pagina breekt het verzoek af op de
 * termijn, terwijl de server de afstreping wel heeft. Elke volgende PATCH gaat
 * gewoon door, of wordt afgebroken met `daarnaAfbreken`.
 *
 * `aangekomen` wordt vervuld zodra de server de afstreping verwerkte. De test
 * wacht daarop vóór hij ongedaan maakt: zonder die zekerheid scheidt alleen de
 * termijn van 10 s de afstreping van de heropening, en zou een trage
 * `route.fetch()` de heropening eerst laten aankomen, zodat de test groen wordt
 * zonder de bewaking.
 */
async function houdEersteAfstrepingVast(page: Page, opties: { daarnaAfbreken?: boolean } = {}) {
  const { vrij, vrijgeven } = slot()
  const { vrij: aangekomen, vrijgeven: meldAangekomen } = slot()
  let pogingen = 0
  await page.route('**/rest/v1/inventory_item*', async (route) => {
    if (!isPatch(new URL(route.request().url()), route.request().method())) return route.fallback()
    pogingen++
    if (pogingen > 1) return opties.daarnaAfbreken ? route.abort() : route.fallback()
    const antwoord = await route.fetch()
    meldAangekomen()
    await vrij
    await route.fulfill({ response: antwoord }).catch(() => {})
  })
  return { vrijgeven, aangekomen, pogingen: () => pogingen }
}

/**
 * Een huisgenoot streept dit item af, rechtstreeks in de lokale database: een
 * echte tweede gebruiker, en de trigger zet closed_by op hem. Als superuser
 * omzeilt deze verbinding RLS, dus lid hoeft hij niet te zijn: het gaat om wie
 * afstreepte. Spec eigen-afstreping §5.
 */
async function streepAfAlsHuisgenoot(itemId: string): Promise<void> {
  // Een uuid, geen tijdstip: auth.users.email is uniek, en twee workers kunnen
  // in dezelfde milliseconde een huisgenoot maken.
  const huisgenoot = await createUser(`huisgenoot-${crypto.randomUUID()}@example.com`)
  await withTx(async (tx) => {
    await actAs(tx, huisgenoot)
    // Alleen een item in voorraad: was het al gesloten (bv. omdat mijn eigen
    // afstreping toch aankwam), dan zegt de fout dat, niet een rare assertie later.
    const rijen = await tx`
      update inventory_item set status = 'closed', closed_reason = 'consumed'
      where id = ${itemId} and status = 'in_stock' returning id
    `
    if (rijen.length !== 1) throw new Error('Huisgenoot kon niet afstrepen: het item was al gesloten')
  })
}

/**
 * Een huisgenoot verwijdert dit item, rechtstreeks in de lokale database. Als
 * superuser, zoals hierboven: het gaat erom dat het item weg is.
 */
async function verwijderAlsHuisgenoot(itemId: string): Promise<void> {
  await withDb(async (sql) => {
    const rijen = await sql`delete from inventory_item where id = ${itemId} returning id`
    if (rijen.length !== 1) throw new Error('Huisgenoot kon niet verwijderen: het item bestond niet')
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

/**
 * Zet een afstreping van het item met deze naam in de wachtrij, zoals de
 * pagina dat offline doet. Zonder eigenaar: die van de kopie, dus deze gebruiker.
 */
async function zaaiIngang(page: Page, naam: string, eigenaar?: string): Promise<void> {
  await page.evaluate(
    ({ kopieSleutel, wachtrijSleutel, naam, eigenaar }) => {
      const kopie = JSON.parse(localStorage.getItem(kopieSleutel) ?? 'null')
      const item = kopie.items.find((i: { naam: string }) => i.naam === naam)
      const wachtrij = [{ itemId: item.id, reden: 'consumed', eigenaar: eigenaar ?? kopie.eigenaar, afgestreeptOp: new Date().toISOString(), item }]
      localStorage.setItem(wachtrijSleutel, JSON.stringify(wachtrij))
    },
    { kopieSleutel: KOPIE_SLEUTEL, wachtrijSleutel: WACHTRIJ_SLEUTEL, naam, eigenaar },
  )
}

async function maakHuishoudenMet(
  page: Page,
  voorvoegsel: string,
  voornaam: string,
  producten: { naam: string; aantal: number }[],
): Promise<void> {
  await signIn(page, `${voorvoegsel}-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam, huishouden: `${voorvoegsel}huis` })
  for (const p of producten) {
    await voegToe(page, { plaats: 'Pantry', naam: p.naam, aantal: p.aantal })
    await expect(groep(page, 'Pantry', p.naam)).toContainText(`×${p.aantal}`)
  }
}

test('ongedaan maken zonder netwerk haalt de afstreping uit de wachtrij', async ({ page, context }) => {
  const naam = `Terug${Date.now()}`
  await maakHuishoudenMet(page, 'offline-terug', 'Tess', [{ naam, aantal: 2 }])

  await context.setOffline(true)
  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')

  // Wachtrijtak: nog offline, dus de afstreping wacht nog en volstaat het haar
  // uit de wachtrij te halen. Ze is nooit verstuurd, dus zeker, en er gaat
  // niets naar de server.
  const patches: string[] = []
  page.on('request', (r) => { if (isPatch(new URL(r.url()), r.method())) patches.push(r.url()) })
  await page.getByRole('button', { name: en.inventory.undo }).click()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  expect(await wachtrijWaarde(page)).toBeNull()
  expect(patches).toEqual([])
  await expect(page.getByText(en.offlineVoorraad.undoUnconfirmed, { exact: true })).toHaveCount(0)

  await context.setOffline(false)
  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
})

test('ongedaan maken tijdens een verzending wacht op die verzending', async ({ page, context }) => {
  const naam = `Race${Date.now()}`
  await maakHuishoudenMet(page, 'offline-race', 'Rik', [{ naam, aantal: 2 }])

  await context.setOffline(true)
  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible()
  // De muis op de toast pauzeert zijn timer van 5 s: de klik hieronder valt
  // zo zeker binnen zijn levensduur, hoe traag de rest ook is.
  const ongedaan = page.getByRole('button', { name: en.inventory.undo })
  await ongedaan.hover()

  // Alleen de eerste PATCH (het versturen) zit vast tot de test hem vrijgeeft;
  // de PATCH van het heropenen daarna gaat meteen door.
  const { vrij, vrijgeven } = slot()
  let vastgehouden = false
  await page.route('**/rest/v1/inventory_item*', async (route) => {
    if (!isPatch(new URL(route.request().url()), route.request().method()) || vastgehouden) return route.fallback()
    vastgehouden = true
    await vrij
    await route.continue()
  })
  const verzonden = page.waitForRequest((r) => isPatch(new URL(r.url()), r.method()))
  const verstuurd = page.waitForResponse((r) => isPatch(new URL(r.url()), r.request().method()))
  await context.setOffline(false)
  await verzonden

  // Het versturen zit vast: ongedaan maken moet erop wachten, en daarna de
  // afstreping op de server terugdraaien (serverheropening-tak). Pas na de klik
  // vrijgeven, niet na het afwachten ervan: dat wacht zelf op deze verzending.
  // Wie niet wacht, haalt de afstreping nu uit de wachtrij terwijl de server
  // haar zo meteen toch ontvangt.
  await ongedaan.click()
  vrijgeven()
  await verstuurd
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  await page.waitForFunction((s) => localStorage.getItem(s) === null, WACHTRIJ_SLEUTEL)

  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  expect(await wachtrijWaarde(page)).toBeNull()
})

test('eerst versturen, dan laden: de eerste lijst toont de afstreping al', async ({ page }) => {
  const naam = `Eerst${Date.now()}`
  await maakHuishoudenMet(page, 'offline-eerst', 'Eva', [{ naam, aantal: 2 }])

  // Wat de route-handlers zien, in volgorde.
  const volgorde: string[] = []

  // De afstreping komt pas in de wachtrij als de pagina haar huishoudens
  // ophaalt (refresh() in onMounted). De plugin zag bij het opstarten dus een
  // lege wachtrij, en het is de pagina zelf die verstuurt. Stond ze er vóór
  // het herladen al, dan verstuurde de plugin haar, en hing de volgorde zonder
  // het wachten in onMounted af van welk verzoek toevallig eerst klaar was.
  let gezaaid = false
  await page.route('**/rest/v1/household_member*', async (route) => {
    if (!gezaaid) {
      gezaaid = true
      await zaaiIngang(page, naam)
      volgorde.push('in de wachtrij')
    }
    await route.fallback()
  })
  await page.route('**/rest/v1/inventory_item*', async (route) => {
    if (!isPatch(new URL(route.request().url()), route.request().method())) return route.fallback()
    const antwoord = await route.fetch()
    // Vóór het doorgeven: de pagina kan het antwoord pas na deze regel zien.
    volgorde.push('afstreping verstuurd')
    await route.fulfill({ response: antwoord })
  })
  await page.route('**/rest/v1/rpc/voorraad', async (route) => {
    volgorde.push('voorraad gevraagd')
    await route.fallback()
  })
  await page.reload()

  // Ruim boven de standaard 5 s: herladen, hydrateren en het zaaien vanuit de
  // route-handler halen dat met vier workers op dezelfde dev-server niet. De
  // spinner bleef niet hangen: met deze termijn slaagde dat 4 op 4.
  await expect(page.getByRole('region', { name: 'Pantry' })).toBeVisible({ timeout: 30_000 })
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  expect(volgorde).toEqual(['in de wachtrij', 'afstreping verstuurd', 'voorraad gevraagd'])
  expect(await wachtrijWaarde(page)).toBeNull()
})

test('de voorraadpagina wacht op een verzending die de plugin al gestart had', async ({ page }) => {
  const naam = `Plugin${Date.now()}`
  await maakHuishoudenMet(page, 'offline-plugin', 'Pia', [{ naam, aantal: 2 }])
  // Vóór het herladen in de wachtrij: de plugin verstuurt haar bij het opstarten.
  await zaaiIngang(page, naam)

  const volgorde: string[] = []
  let verzendingen = 0
  const pluginVerstuurt = slot()
  const afstreping = slot()

  // De huishoudens blijven hangen tot de afstreping onderweg is. De pagina
  // verstuurt pas na refresh(), dus deze verzending is die van de plugin.
  await page.route('**/rest/v1/household_member*', async (route) => {
    await pluginVerstuurt.vrij
    await route.fallback()
  })
  // De afstreping blijft hangen tot de pagina zich verraadt — een tweede
  // verzending of voorraad() opvragen — of tot de termijn hieronder om is.
  await page.route('**/rest/v1/inventory_item*', async (route) => {
    if (!isPatch(new URL(route.request().url()), route.request().method())) return route.fallback()
    verzendingen++
    pluginVerstuurt.vrijgeven()
    if (verzendingen > 1) afstreping.vrijgeven()
    await afstreping.vrij
    const antwoord = await route.fetch()
    volgorde.push('afstreping verstuurd')
    await route.fulfill({ response: antwoord })
  })
  await page.route('**/rest/v1/rpc/voorraad', async (route) => {
    volgorde.push('voorraad gevraagd')
    afstreping.vrijgeven()
    await route.fallback()
  })
  const huishoudens = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/rest/v1/household_member'))
  const herladen = page.reload()

  // Een pagina die niet wacht, vraagt voorraad() meteen na haar huishoudens
  // op; een die naast de plugin verstuurt, stuurt meteen een tweede PATCH.
  // Beide geven de afstreping zelf vrij. De termijn begrenst alleen hoe lang
  // een fout mag uitblijven: een juiste pagina slaagt hoe traag het ook gaat.
  await huishoudens
  await page.waitForTimeout(2000)
  afstreping.vrijgeven()
  await herladen

  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  expect(volgorde).toEqual(['afstreping verstuurd', 'voorraad gevraagd'])
  expect(verzendingen).toBe(1)
  expect(await wachtrijWaarde(page)).toBeNull()
})

test('een hangende voorraad() geeft na de termijn de foutstand, na één poging', async ({ page }) => {
  await maakHuishoudenMet(page, 'termijn-laden', 'Lars', [])

  // voorraad() bereikt de server nooit. Alleen de termijn kan het afbreken.
  let pogingen = 0
  const { vrij, vrijgeven } = slot()
  await page.route('**/rest/v1/rpc/voorraad', async (route) => {
    pogingen++
    await vrij
    await route.abort().catch(() => {})
  })
  await page.reload()

  // Ruim boven de termijn van 10 s, ruim onder drie pogingen van elk 10 s.
  await expect(page.getByText(en.householdSettings.error, { exact: true })).toBeVisible({ timeout: 20_000 })
  // Eén: de herhaallus van @nuxtjs/supabase zag dat het verzoek afgebroken was.
  expect(pogingen).toBe(1)
  vrijgeven()
})

test('een tokenvernieuwing valt niet onder de termijn', async ({ page }) => {
  await maakHuishoudenMet(page, 'termijn-auth', 'Aiko', [])

  // De vernieuwing hangt langer dan de termijn: alleen zo blijkt dat er geen
  // is. Valt auth eronder, dan breekt de app haar na 10 s af en probeert
  // auth-js opnieuw, en dat is een tweede verzoek (spec §2: een afgebroken
  // vernieuwing die de server al verwerkte, kan de sessie wissen).
  let verzoeken = 0
  await page.route('**/auth/v1/token*', async (route) => {
    verzoeken++
    if (verzoeken === 1) await new Promise((r) => setTimeout(r, SUPABASE_TERMIJN_MS + 2000))
    await route.continue().catch(() => {})
  })

  // Via de Supabase-client van de app zelf: een vernieuwing op commando.
  const fout = await page.evaluate(async () => {
    type Client = { auth: { refreshSession: () => Promise<{ error: { message: string } | null }> } }
    const wortel = document.querySelector('#__nuxt') as unknown as { __vue_app__: { $nuxt: { $supabase: { client: Client } } } }
    const { error } = await wortel.__vue_app__.$nuxt.$supabase.client.auth.refreshSession()
    return error?.message ?? null
  })

  expect(fout).toBeNull()
  expect(verzoeken).toBe(1)
})

test('een hangende afstreping komt na de termijn in de wachtrij, en ongedaan maken heropent haar op de server', async ({ page }) => {
  const naam = `Hang${Date.now()}`
  await maakHuishoudenMet(page, 'termijn-hang', 'Hanna', [{ naam, aantal: 2 }])
  const vast = await houdEersteAfstrepingVast(page)

  await streepAf(page, naam)
  // Pas na de termijn van 10 s: tot dan wacht de pagina op het antwoord.
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  expect(vast.pogingen()).toBe(1)

  // De server heeft de afstreping wel. Ongedaan maken moet haar daar heropenen.
  // De muis op de toast pauzeert zijn timer: hij moet de aankomst overleven.
  const ongedaan = page.getByRole('button', { name: en.inventory.undo })
  await ongedaan.hover()
  await vast.aangekomen
  await ongedaan.click()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  expect(await wachtrijWaarde(page)).toBeNull()

  vast.vrijgeven()
  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
})

test('ongedaan maken van een afstreping die de wachtrij onzeker verstuurde, heropent haar op de server', async ({ page, context }) => {
  const naam = `Onzeker${Date.now()}`
  await maakHuishoudenMet(page, 'termijn-wachtrij', 'Otis', [{ naam, aantal: 2 }])

  await context.setOffline(true)
  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible()
  // De muis op de toast pauzeert zijn timer: hij moet de termijn overleven.
  const ongedaan = page.getByRole('button', { name: en.inventory.undo })
  await ongedaan.hover()

  const vast = await houdEersteAfstrepingVast(page)
  await context.setOffline(false)
  await vast.aangekomen

  // Ongedaan maken wacht op de verzending, die na de termijn onzeker eindigt.
  await ongedaan.click()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2', { timeout: 20_000 })
  expect(await wachtrijWaarde(page)).toBeNull()

  vast.vrijgeven()
  await page.reload()
  // Onder belasting duurt de eerste lijst na een herlaad soms langer dan 5 s; een gedragsfout toont een verkeerd aantal, geen ontbrekende rij.
  await expect(groep(page, 'Pantry', naam)).toContainText('×2', { timeout: 15_000 })
})

test('faalt ook het heropenen, dan zegt ongedaan maken dat het niet bevestigd is', async ({ page }) => {
  const naam = `Onbevestigd${Date.now()}`
  await maakHuishoudenMet(page, 'termijn-onbevestigd', 'Uma', [{ naam, aantal: 2 }])
  const vast = await houdEersteAfstrepingVast(page, { daarnaAfbreken: true })

  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible({ timeout: 20_000 })

  // De muis op de toast pauzeert zijn timer: hij moet de aankomst overleven.
  const ongedaan = page.getByRole('button', { name: en.inventory.undo })
  await ongedaan.hover()
  await vast.aangekomen
  await ongedaan.click()
  await expect(page.getByText(en.offlineVoorraad.undoUnconfirmed, { exact: true })).toBeVisible()
  // Lokaal staat het item terug; de server weet het pas bij de volgende verversing.
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  expect(await wachtrijWaarde(page)).toBeNull()
  vast.vrijgeven()
})

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
  // Onder belasting duurt de eerste lijst na een herlaad soms langer dan 5 s; een gedragsfout toont een verkeerd aantal, geen ontbrekende rij.
  await expect(groep(page, 'Pantry', naam)).toContainText('×1', { timeout: 15_000 })
})

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

test('faalt het nalezen na een onzekere afstreping, dan zegt ongedaan maken dat het niet bevestigd is', async ({ page }) => {
  const naam = `Naleesfout${Date.now()}`
  await maakHuishoudenMet(page, 'eigen-naleesfout', 'Nina', [{ naam, aantal: 2 }])
  const tegen = await houdEersteAfstrepingTegen(page)

  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible({ timeout: 20_000 })
  const ongedaan = page.getByRole('button', { name: en.inventory.undo })
  await ongedaan.hover()
  await streepAfAlsHuisgenoot(await eersteWachtrijItem(page))

  // Het nalezen van reopen() (select=status) bereikt de server nooit. Elke
  // poging: postgrest-js herhaalt een GET na een netwerkfout. Deze route staat
  // na die van houdEersteAfstrepingTegen en krijgt dus elk verzoek eerst; de
  // rest geeft ze door.
  await page.route('**/rest/v1/inventory_item*', async (route) => {
    const verzoek = route.request()
    if (verzoek.method() === 'GET' && verzoek.url().includes('select=status')) return route.abort()
    return route.fallback()
  })

  // De waarheid is onbekend: niet 'iemand anders', maar niet bevestigd. Ruim
  // boven de 5 s: postgrest-js wacht 1, 2 en 4 s tussen zijn pogingen.
  await ongedaan.click()
  await expect(page.getByText(en.offlineVoorraad.undoUnconfirmed, { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(en.inventory.undoByOther, { exact: true })).toHaveCount(0)
  tegen.vrijgeven()
})

test('een onzekere afstreping van een item dat een huisgenoot intussen verwijderde, komt bij ongedaan maken niet terug', async ({ page }) => {
  const naam = `Verwijderd${Date.now()}`
  await maakHuishoudenMet(page, 'eigen-verwijderd', 'Vince', [{ naam, aantal: 2 }])
  const tegen = await houdEersteAfstrepingTegen(page)

  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible({ timeout: 20_000 })
  const ongedaan = page.getByRole('button', { name: en.inventory.undo })
  await ongedaan.hover()
  const itemId = await eersteWachtrijItem(page)
  await verwijderAlsHuisgenoot(itemId)

  // Het nalezen vindt geen rij: dat is 'vanEenAnder', niet 'nietGesloten'.
  await ongedaan.click()
  await expect(page.getByText(en.inventory.undoByOther, { exact: true })).toBeVisible()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  expect(await idsInKopie(page)).not.toContain(itemId)
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
  // Onder belasting duurt de eerste lijst na een herlaad soms langer dan 5 s; een gedragsfout toont een verkeerd aantal, geen ontbrekende rij.
  await expect(groep(page, 'Pantry', naam)).toContainText('×2', { timeout: 15_000 })
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

/**
 * Laat de eerste PATCH op inventory_item bij de server aankomen, gaat dan
 * offline, en geeft de pagina daarna `antwoord`: zonder antwoord een afgebroken
 * verzoek. Zo valt de verbinding weg midden in het antwoord: vóór de poging was
 * het toestel online, in de catch is het offline.
 */
async function verliesVerbindingTijdensAfstreping(
  page: Page,
  context: BrowserContext,
  antwoord?: { status: number; json: unknown },
): Promise<{ afgehandeld: Promise<void> }> {
  let gezien = false
  let afgehandeld!: () => void
  const klaar = new Promise<void>((r) => { afgehandeld = r })
  await page.route('**/rest/v1/inventory_item*', async (route) => {
    if (!isPatch(new URL(route.request().url()), route.request().method()) || gezien) return route.fallback()
    gezien = true
    await route.fetch()
    await context.setOffline(true)
    await page.waitForFunction(() => !navigator.onLine)
    if (antwoord) await route.fulfill(antwoord).catch(() => {})
    else await route.abort().catch(() => {})
    afgehandeld()
  })
  return { afgehandeld: klaar }
}

test('valt de verbinding weg tijdens een afstreping, dan is ze onzeker', async ({ page, context }) => {
  const naam = `Wegval${Date.now()}`
  await maakHuishoudenMet(page, 'termijn-wegval', 'Wout', [{ naam, aantal: 2 }])
  const vast = await verliesVerbindingTijdensAfstreping(page, context)

  await streepAf(page, naam)
  await vast.afgehandeld
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')

  // De server heeft de afstreping. Ongedaan maken probeert haar daar te
  // heropenen, en dat kan offline niet: dus niet bevestigd, en niet stil
  // alleen uit de wachtrij gehaald.
  await page.getByRole('button', { name: en.inventory.undo }).click()
  await expect(page.getByText(en.offlineVoorraad.undoUnconfirmed, { exact: true })).toBeVisible()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  expect(await wachtrijWaarde(page)).toBeNull()
})

test('weigert de server een afstreping en valt daarna de verbinding weg, dan is ze niet onzeker', async ({ page, context }) => {
  const naam = `Geweigerd${Date.now()}`
  await maakHuishoudenMet(page, 'termijn-geweigerd', 'Gijs', [{ naam, aantal: 2 }])
  // Een antwoord met een databasecode: de server antwoordde, en weigerde.
  const vast = await verliesVerbindingTijdensAfstreping(page, context, {
    status: 403,
    json: { code: '42501', message: 'permission denied for table inventory_item', details: null, hint: null },
  })

  await streepAf(page, naam)
  await vast.afgehandeld
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible()

  // Zeker niet toegepast: ongedaan maken haalt haar alleen uit de wachtrij.
  const patches: string[] = []
  page.on('request', (r) => { if (isPatch(new URL(r.url()), r.method())) patches.push(r.url()) })
  await page.getByRole('button', { name: en.inventory.undo }).click()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  expect(await wachtrijWaarde(page)).toBeNull()
  expect(patches).toEqual([])
  await expect(page.getByText(en.offlineVoorraad.undoUnconfirmed, { exact: true })).toHaveCount(0)
})

// Eén eenheid, zodat de tweede afstreping zeker hetzelfde item raakt: bij
// twee eenheden kiest de groep na het terugzetten misschien de andere.
test('een opnieuw afgestreept item erft het onzeker-merk niet', async ({ page, context }) => {
  const naam = `Erfenis${Date.now()}`
  await maakHuishoudenMet(page, 'termijn-erfenis', 'Elin', [{ naam, aantal: 1 }])
  const vast = await houdEersteAfstrepingVast(page)
  const ongedaan = page.getByRole('button', { name: en.inventory.undo })

  // Een onzekere afstreping: de termijn verstrijkt, ze gaat in de wachtrij.
  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(groep(page, 'Pantry', naam)).toBeHidden()
  // Ongedaan maken heropent haar op de server. De muis op de toast pauzeert
  // zijn timer: hij moet de aankomst overleven.
  await ongedaan.hover()
  await vast.aangekomen
  await ongedaan.click()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  await expect(ongedaan).toHaveCount(0)

  // Offline opnieuw afgestreept: deze afstreping is zeker niet verstuurd.
  await context.setOffline(true)
  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible()
  await expect(groep(page, 'Pantry', naam)).toBeHidden()

  // Dus haalt ongedaan maken haar alleen uit de wachtrij, zonder verzoek.
  const patches: string[] = []
  page.on('request', (r) => { if (isPatch(new URL(r.url()), r.method())) patches.push(r.url()) })
  await ongedaan.click()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  expect(await wachtrijWaarde(page)).toBeNull()
  expect(patches).toEqual([])
  await expect(page.getByText(en.offlineVoorraad.undoUnconfirmed, { exact: true })).toHaveCount(0)
  vast.vrijgeven()
})

test('een verversing tijdens het heropenen zet het item niet dubbel terug', async ({ page }) => {
  const a = `Dubbel${Date.now()}`
  const b = `Tussen${Date.now()}`
  await maakHuishoudenMet(page, 'termijn-dubbel', 'Dora', [
    { naam: a, aantal: 2 },
    { naam: b, aantal: 1 },
  ])

  // De eerste PATCH (a sluiten) komt aan maar blijft hangen tot na de termijn.
  // De tweede (a heropenen) komt aan, maar de pagina krijgt een fout met een
  // code terug zodra de test vrijgeeft: de uitkomst is dan 'nietBevestigd', en
  // de toast undoUnconfirmed volgt in hetzelfde synchrone blok als het
  // terugzetten. Die toast is het signaal dat het item terug is.
  // Elke volgende PATCH gaat door.
  const afstreping = slot()
  const heropening = slot()
  let opServer!: () => void
  const heropendOpServer = new Promise<void>((r) => { opServer = r })
  let pogingen = 0
  await page.route('**/rest/v1/inventory_item*', async (route) => {
    if (!isPatch(new URL(route.request().url()), route.request().method())) return route.fallback()
    pogingen++
    if (pogingen > 2) return route.fallback()
    const antwoord = await route.fetch()
    if (pogingen === 1) {
      await afstreping.vrij
      await route.fulfill({ response: antwoord }).catch(() => {})
      return
    }
    opServer()
    await heropening.vrij
    await route.fulfill({ status: 400, json: { code: '22P02', message: 'testfout na de heropening' } }).catch(() => {})
  })

  await streepAf(page, a)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(groep(page, 'Pantry', a)).toContainText('×1')

  // Ongedaan maken: de server heropent a, het antwoord blijft hangen.
  await page.getByRole('button', { name: en.inventory.undo }).click()
  await heropendOpServer

  // b afstrepen ververst de lijst: de server heeft a al weer open.
  await streepAf(page, b)
  await expect(groep(page, 'Pantry', b)).toBeHidden()
  await expect(groep(page, 'Pantry', a)).toContainText('×2')

  // Binnen de termijn vrijgeven. Zodra de toast er is, staat a terug.
  heropening.vrijgeven()
  await expect(page.getByText(en.offlineVoorraad.undoUnconfirmed, { exact: true })).toBeVisible()
  await expect(groep(page, 'Pantry', a)).toContainText('×2')
  await expect(groep(page, 'Pantry', a)).not.toContainText('×3')
  afstreping.vrijgeven()
})

test('een verversing tijdens een verzending zet het afgestreepte item niet terug', async ({ page, context }) => {
  const a = `Verzend${Date.now()}`
  const b = `Ander${Date.now()}`
  await maakHuishoudenMet(page, 'offline-verversing', 'Vera', [
    { naam: a, aantal: 2 },
    { naam: b, aantal: 1 },
  ])

  await context.setOffline(true)
  await streepAf(page, a)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible()
  const itemId: string = await page.evaluate((s) => JSON.parse(localStorage.getItem(s) ?? '[]')[0].itemId, WACHTRIJ_SLEUTEL)

  // Het versturen van a zit vast tot de test het vrijgeeft; het afstrepen van
  // b gaat gewoon door.
  const isVanA = (url: string, methode: string) => isPatch(new URL(url), methode) && url.includes(`id=eq.${itemId}`)
  const { vrij, vrijgeven } = slot()
  await page.route('**/rest/v1/inventory_item*', async (route) => {
    if (!isVanA(route.request().url(), route.request().method())) return route.fallback()
    await vrij
    await route.continue()
  })
  const verzonden = page.waitForRequest((r) => isVanA(r.url(), r.method()))
  const verstuurd = page.waitForResponse((r) => isVanA(r.url(), r.request().method()))
  await context.setOffline(false)
  await verzonden

  // b afstrepen ververst de lijst met het antwoord van de server, waar a nog
  // open staat. b verdwijnt pas met die verversing, dus daarna telt a zoals
  // de verversing het zette.
  await streepAf(page, b)
  await expect(groep(page, 'Pantry', b)).toBeHidden()
  await expect(groep(page, 'Pantry', a)).toContainText('×1')

  // Pas nu mag het versturen van a door.
  vrijgeven()
  await verstuurd
  await page.waitForFunction((s) => localStorage.getItem(s) === null, WACHTRIJ_SLEUTEL)
  await page.reload()
  await expect(groep(page, 'Pantry', a)).toContainText('×1')
})

test('na een online afstreping en ongedaanmaking klopt de kopie, ook als de verversing faalt', async ({ page }) => {
  const naam = `Online${Date.now()}`
  await maakHuishoudenMet(page, 'offline-online', 'Otto', [{ naam, aantal: 1 }])
  const namenInKopie = () =>
    page.evaluate((s) => {
      const kopie = JSON.parse(localStorage.getItem(s) ?? 'null')
      return kopie ? kopie.items.map((i: { naam: string }) => i.naam) : null
    }, KOPIE_SLEUTEL)
  expect(await namenInKopie()).toContain(naam)

  // Alleen de eerstvolgende verversing faalt. Een serverfout en geen
  // netwerkfout: fetchWithRetry van @nuxtjs/supabase probeert die laatste
  // opnieuw, en dan zou de verversing toch slagen.
  const verversingFaaltEenKeer = () =>
    page.route(
      '**/rest/v1/rpc/voorraad',
      (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'kapot' }) }),
      { times: 1 },
    )
  const verversingMislukt = page.getByText(en.inventory.refreshFailed, { exact: true })

  await verversingFaaltEenKeer()
  await streepAf(page, naam)
  // De muis op de toast pauzeert hem: de knop Ongedaan maken blijft staan.
  const ongedaan = page.getByRole('button', { name: en.inventory.undo })
  await ongedaan.hover()
  await expect(verversingMislukt).toBeVisible()
  expect(await namenInKopie()).not.toContain(naam)

  // Ongedaan maken zet het item terug in de kopie vóór de verversing begint.
  await verversingFaaltEenKeer()
  const tweedeVerversing = page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/voorraad'))
  await ongedaan.click()
  expect((await tweedeVerversing).status()).toBe(500)
  expect(await namenInKopie()).toContain(naam)
})

test('een serverfout komt niet in de wachtrij', async ({ page }) => {
  const naam = `Fout${Date.now()}`
  await maakHuishoudenMet(page, 'offline-fout', 'Fien', [{ naam, aantal: 2 }])

  // Het toestel is online: dit is een weigering van de server, geen netwerkfout.
  await page.route('**/rest/v1/inventory_item*', async (route) => {
    if (!isPatch(new URL(route.request().url()), route.request().method())) return route.fallback()
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: '42501', message: 'permission denied for table inventory_item' }),
    })
  })
  await streepAf(page, naam)

  await expect(page.getByText(en.householdSettings.error, { exact: true })).toBeVisible()
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toHaveCount(0)
  expect(await wachtrijWaarde(page)).toBeNull()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
})

test('lukt het bewaren in de wachtrij niet, dan is het een gewone fout', async ({ page, context }) => {
  const naam = `Vol${Date.now()}`
  await maakHuishoudenMet(page, 'offline-vol', 'Vic', [{ naam, aantal: 2 }])

  await context.setOffline(true)
  // Op het prototype: Storage kent benoemde eigenschappen, dus een toewijzing
  // aan localStorage.setItem zou een opgeslagen waarde worden, geen methode.
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('vol', 'QuotaExceededError')
    }
  })
  await streepAf(page, naam)

  await expect(page.getByText(en.householdSettings.error, { exact: true })).toBeVisible()
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toHaveCount(0)
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  expect(await wachtrijWaarde(page)).toBeNull()
})

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
  await groep(page, 'Pantry', naam).locator('button[aria-expanded]').click()
  await expect(page.getByRole('button', { name: en.inventory.edit, exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: en.inventory.delete, exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: en.inventory.closeItem, exact: true }).first()).toBeVisible()

  await streepAf(page, naam)
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  await expect(page.getByText(tekst(en.offlineVoorraad.pending, { count: 1 }))).toBeVisible()

  // Terug op de voorraadpagina wordt eerst verstuurd, dan geladen.
  await page.goto(routePath('inventory', 'en'))
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  // De voorraadpagina filtert wat in de wachtrij staat, dus ×1 bewijst nog niet
  // dat er verstuurd is: dat bewijst een lege wachtrij, en daarna de database.
  await page.waitForFunction((s) => localStorage.getItem(s) === null, WACHTRIJ_SLEUTEL)
  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
})

test('de offline-pagina toont geen items die al in de wachtrij staan', async ({ page }) => {
  const naam = `Dubbel${Date.now()}`
  await maakHuishoudenMet(page, 'offline-dubbel', 'Dora', [{ naam, aantal: 2 }])

  // Het versturen kan niet slagen: de afstreping blijft in de wachtrij, terwijl
  // de kopie het item nog bevat. Zo staat een item in allebei, zoals wanneer
  // het bijwerken van de kopie na het schrijven van de wachtrij mislukt.
  await page.route('**/rest/v1/inventory_item*', (route) =>
    isPatch(new URL(route.request().url()), route.request().method()) ? route.abort() : route.fallback(),
  )
  await page.evaluate(
    ({ kopieSleutel, wachtrijSleutel, naam }) => {
      const kopie = JSON.parse(localStorage.getItem(kopieSleutel) ?? 'null')
      const item = kopie.items.find((i: { naam: string }) => i.naam === naam)
      const wachtrij = [{ itemId: item.id, reden: 'consumed', eigenaar: kopie.eigenaar, afgestreeptOp: new Date().toISOString(), item }]
      localStorage.setItem(wachtrijSleutel, JSON.stringify(wachtrij))
    },
    { kopieSleutel: KOPIE_SLEUTEL, wachtrijSleutel: WACHTRIJ_SLEUTEL, naam },
  )

  await page.goto(routePath('offline', 'en'))
  await expect(page.getByText(tekst(en.offlineVoorraad.pending, { count: 1 }))).toBeVisible()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
})

// De offline-pagina in een huishouden met één product (aantal 2), met de kopie al bewaard.
async function openOfflinePagina(page: Page, voorvoegsel: string, naam: string): Promise<void> {
  await maakHuishoudenMet(page, voorvoegsel, 'Olaf', [{ naam, aantal: 2 }])
  await page.goto(routePath('offline', 'en'))
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
}

test('ongedaan maken op de offline-pagina zet het item terug', async ({ page }) => {
  const naam = `Spijt${Date.now()}`
  await openOfflinePagina(page, 'offline-spijt', naam)

  await streepAf(page, naam)
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  await expect(page.getByText(tekst(en.offlineVoorraad.pending, { count: 1 }))).toBeVisible()

  await page.getByRole('button', { name: en.inventory.undo }).click()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  await expect(page.getByText(tekst(en.offlineVoorraad.pending, { count: 1 }))).toHaveCount(0)
  expect(await wachtrijWaarde(page)).toBeNull()
})

test('ongedaan maken op de offline-pagina heropent een onzeker verstuurde afstreping op de server', async ({ page }) => {
  const naam = `Kelderhang${Date.now()}`
  await maakHuishoudenMet(page, 'termijn-offlinepagina', 'Kees', [{ naam, aantal: 2 }])

  await page.goto(routePath('offline', 'en'))
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  await streepAf(page, naam)
  await expect(page.getByText(tekst(en.offlineVoorraad.pending, { count: 1 }))).toBeVisible()
  const ongedaan = page.getByRole('button', { name: en.inventory.undo })
  await ongedaan.hover()

  // Het online-event laat de plugin versturen; de server krijgt de afstreping,
  // de pagina het antwoord niet.
  const vast = await houdEersteAfstrepingVast(page)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await vast.aangekomen

  await ongedaan.click()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2', { timeout: 20_000 })

  vast.vrijgeven()
  await page.goto(routePath('inventory', 'en'))
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  expect(await wachtrijWaarde(page)).toBeNull()
})

test('faalt het heropenen op de offline-pagina, dan zegt ongedaan maken dat het niet bevestigd is', async ({ page }) => {
  const naam = `Kelderfout${Date.now()}`
  await maakHuishoudenMet(page, 'termijn-offlinefout', 'Koen', [{ naam, aantal: 2 }])

  await page.goto(routePath('offline', 'en'))
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  await streepAf(page, naam)
  await expect(page.getByText(tekst(en.offlineVoorraad.pending, { count: 1 }))).toBeVisible()
  const ongedaan = page.getByRole('button', { name: en.inventory.undo })
  await ongedaan.hover()

  // De server krijgt de afstreping, de pagina het antwoord niet; het
  // heropenen daarna wordt afgebroken.
  const vast = await houdEersteAfstrepingVast(page, { daarnaAfbreken: true })
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await vast.aangekomen

  await ongedaan.click()
  await expect(page.getByText(en.offlineVoorraad.undoUnconfirmed, { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  expect(await wachtrijWaarde(page)).toBeNull()
  vast.vrijgeven()
})

/**
 * Een tweede tabblad met de offline-pagina, online geopend. Afstrepen daar
 * komt altijd zeker in de wachtrij, zonder verzoek naar de server. Dit
 * tabblad krijgt geen online-event, dus verstuurt het niet uit zichzelf: dat
 * zou het verschil verbergen. Een `TOKEN_REFRESHED`/`SIGNED_IN` in tabblad 2
 * zou dat wel doen, maar met het slot wacht die verzending of vindt ze niets.
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
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await vast.aangekomen

  await tab2.getByRole('button', { name: en.inventory.undo }).click()
  await expect(groep(tab2, 'Pantry', naam)).toContainText('×2', { timeout: 20_000 })

  vast.vrijgeven()
  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  expect(await wachtrijWaarde(page)).toBeNull()
})

test('lukt het bewaren in de wachtrij niet op de offline-pagina, dan is het een gewone fout', async ({ page }) => {
  const naam = `Vol${Date.now()}`
  await openOfflinePagina(page, 'offline-pagina-vol', naam)

  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('vol', 'QuotaExceededError')
    }
  })
  await streepAf(page, naam)

  await expect(page.getByText(en.householdSettings.error, { exact: true })).toBeVisible()
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toHaveCount(0)
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  expect(await wachtrijWaarde(page)).toBeNull()
})

test('ongedaan maken van een al verstuurde afstreping zegt dat het niet meer kan', async ({ page }) => {
  const naam = `Laat${Date.now()}`
  await openOfflinePagina(page, 'offline-laat', naam)

  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible()
  // Alsof ze intussen verstuurd is: de wachtrij is leeg.
  await page.evaluate((s) => localStorage.removeItem(s), WACHTRIJ_SLEUTEL)

  await page.getByRole('button', { name: en.inventory.undo }).click()
  await expect(page.getByText(en.offlineVoorraad.alreadySent, { exact: true })).toBeVisible()
  await expect(page.getByText(en.householdSettings.error, { exact: true })).toHaveCount(0)
})

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
  // Nog ingelogd zolang er niet bevestigd is. De modal verbergt de rest van de
  // pagina voor het toegankelijkheidsvlak, vandaar includeHidden.
  await expect(page.getByRole('button', { name: en.nav.account, includeHidden: true })).toBeAttached()
  // En de wachtrij is nog niet gewist.
  expect(await wachtrijWaarde(page)).not.toBeNull()

  await dialoog.getByRole('button', { name: en.auth.signOut }).click()
  await expect(page.getByRole('button', { name: en.nav.language })).toBeVisible()
  expect(await page.evaluate((s) => localStorage.getItem(s), WACHTRIJ_SLEUTEL)).toBeNull()
})

test('annuleren bij de uitlogbevestiging houdt de sessie en de wachtrij', async ({ page }) => {
  const naam = `Annuleer${Date.now()}`
  await signIn(page, `offline-annuleer-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Aron', huishouden: 'Annuleerhuis' })
  await voegToe(page, { plaats: 'Pantry', naam })

  await page.route('**/rest/v1/inventory_item**', (route) =>
    route.request().method() === 'PATCH' ? route.abort() : route.continue())
  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible()

  await openUserMenu(page)
  await page.getByRole('menuitem', { name: en.auth.signOut }).click()
  const dialoog = page.getByRole('dialog')
  await expect(dialoog.getByText(en.offlineVoorraad.signOutTitle)).toBeVisible()

  await dialoog.getByRole('button', { name: en.inventory.cancel }).click()
  await expect(dialoog).toBeHidden()
  // Nog ingelogd, en niets gewist.
  await expect(page.getByRole('button', { name: en.nav.account })).toBeVisible()
  expect(await wachtrijWaarde(page)).not.toBeNull()
  expect(await page.evaluate((s) => localStorage.getItem(s), KOPIE_SLEUTEL)).not.toBeNull()
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

// Een ingang van een andere gebruiker voor een item van deze gebruiker, na het
// laden gezaaid (de plugin heeft zijn opruimronde dan al gehad).
async function zaaiVreemdeIngang(page: Page, naam: string): Promise<void> {
  await zaaiIngang(page, naam, 'een-andere-gebruiker')
}

// Het versturen kan nergens toe leiden: er mag niets naar de server gaan.
const blokkeerPatch = (page: Page) =>
  page.route('**/rest/v1/inventory_item*', (route) =>
    isPatch(new URL(route.request().url()), route.request().method()) ? route.abort() : route.fallback(),
  )

test('na een herlaad ruimt de plugin de wachtrij-ingang van een andere gebruiker op', async ({ page }) => {
  const naam = `Vreemd${Date.now()}`
  await maakHuishoudenMet(page, 'offline-vreemd', 'Vos', [{ naam, aantal: 2 }])
  await blokkeerPatch(page)
  await zaaiVreemdeIngang(page, naam)

  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  // Bewijst ruimOp: bij een herlaad draait de plugin opnieuw.
  await expect.poll(() => wachtrijWaarde(page)).toBeNull()
})

test('laad() telt alleen de wachtrij van de eigen gebruiker, ook zonder opruimronde', async ({ page }) => {
  const naam = `Eigen${Date.now()}`
  await maakHuishoudenMet(page, 'offline-eigen', 'Eef', [{ naam, aantal: 2 }])
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  await blokkeerPatch(page)
  await zaaiVreemdeIngang(page, naam)

  // Navigatie aan de clientzijde: de voorraadpagina laadt opnieuw, maar de
  // plugin (en dus ruimOp) draait niet nog eens.
  await page.getByRole('link', { name: tekst(en.inventory.addTo, { place: 'Pantry' }), exact: true }).click()
  await expect(page).toHaveURL(/\/inventory\/new/)
  await page.goBack()
  await expect(page).toHaveURL(routePath('inventory', 'en'))
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  // De vreemde ingang staat er nog: ruimOp heeft hier niet gedraaid.
  expect(await wachtrijWaarde(page)).not.toBeNull()
})
