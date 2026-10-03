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

// De PATCH op inventory_item: afstrepen (close) en ongedaan maken (reopen).
const isPatch = (url: URL, methode: string) => methode === 'PATCH' && url.pathname.endsWith('/rest/v1/inventory_item')
const wachtrijWaarde = (page: Page) => page.evaluate((s) => localStorage.getItem(s), WACHTRIJ_SLEUTEL)
const pauze = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
  // uit de wachtrij te halen. Er gaat niets naar de server.
  await page.getByRole('button', { name: en.inventory.undo }).click()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')
  expect(await wachtrijWaarde(page)).toBeNull()

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

  // Alleen de eerste PATCH (het versturen) wordt vastgehouden; de PATCH van het
  // heropenen daarna gaat meteen door.
  let vastgehouden = false
  await page.route('**/rest/v1/inventory_item*', async (route) => {
    if (!isPatch(new URL(route.request().url()), route.request().method()) || vastgehouden) return route.fallback()
    vastgehouden = true
    await pauze(1500)
    await route.continue()
  })
  const verzonden = page.waitForRequest((r) => isPatch(new URL(r.url()), r.method()))
  const verstuurd = page.waitForResponse((r) => isPatch(new URL(r.url()), r.request().method()))
  await context.setOffline(false)
  await verzonden

  // Het versturen loopt nu: ongedaan maken moet erop wachten, en daarna de
  // afstreping op de server terugdraaien (serverheropening-tak).
  await page.getByRole('button', { name: en.inventory.undo }).click()
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

  // Een afstreping die nog op het toestel wacht, voor dit item van deze gebruiker.
  await page.evaluate(
    ({ kopieSleutel, wachtrijSleutel, naam }) => {
      const kopie = JSON.parse(localStorage.getItem(kopieSleutel) ?? 'null')
      const item = kopie.items.find((i: { naam: string }) => i.naam === naam)
      const wachtrij = [{ itemId: item.id, reden: 'consumed', eigenaar: kopie.eigenaar, afgestreeptOp: new Date().toISOString(), item }]
      localStorage.setItem(wachtrijSleutel, JSON.stringify(wachtrij))
    },
    { kopieSleutel: KOPIE_SLEUTEL, wachtrijSleutel: WACHTRIJ_SLEUTEL, naam },
  )

  // De PATCH duurt een seconde. Het antwoord van voorraad() is al opgehaald op
  // het moment dat de server het item nog open heeft, maar wordt pas
  // doorgegeven nadat de PATCH klaar is: wie niet eerst wacht op het
  // versturen, toont dat verouderde antwoord.
  const patchKlaar = page.waitForResponse((r) => isPatch(new URL(r.url()), r.request().method()))
  await page.route('**/rest/v1/inventory_item*', async (route) => {
    if (!isPatch(new URL(route.request().url()), route.request().method())) return route.fallback()
    await pauze(1000)
    await route.continue()
  })
  await page.route('**/rest/v1/rpc/voorraad', async (route) => {
    const verouderd = await route.fetch()
    await patchKlaar
    await pauze(500)
    await route.fulfill({ response: verouderd })
  })
  await page.reload()

  await expect(page.getByRole('region', { name: 'Pantry' })).toBeVisible()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  expect(await wachtrijWaarde(page)).toBeNull()
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

  // Het versturen van a blijft hangen; het afstrepen van b gaat gewoon door.
  await page.route('**/rest/v1/inventory_item*', async (route) => {
    const verzoek = route.request()
    if (!isPatch(new URL(verzoek.url()), verzoek.method()) || !verzoek.url().includes(`id=eq.${itemId}`)) return route.fallback()
    await pauze(3000)
    await route.continue()
  })
  const verstuurd = page.waitForResponse((r) => isPatch(new URL(r.url()), r.request().method()) && r.url().includes(`id=eq.${itemId}`))
  await context.setOffline(false)

  // b afstrepen ververst de lijst met het antwoord van de server, waar a nog open staat.
  await streepAf(page, b)
  await expect(groep(page, 'Pantry', b)).toBeHidden()
  await expect(groep(page, 'Pantry', a)).toContainText('×1')

  await verstuurd
  await page.waitForFunction((s) => localStorage.getItem(s) === null, WACHTRIJ_SLEUTEL)
  await page.reload()
  await expect(groep(page, 'Pantry', a)).toContainText('×1')
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
