import { test, expect, type Page } from '@playwright/test'
import { routePath } from '../routes.config'
import { signIn, createHousehold, bundles, waitForHydration, openUserMenu } from './helpers'
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

/** Een belofte die de test zelf vrijgeeft: een verzoek blijft hangen tot dan. */
function slot(): { vrij: Promise<void>; vrijgeven: () => void } {
  let vrijgeven!: () => void
  const vrij = new Promise<void>((r) => { vrijgeven = r })
  return { vrij, vrijgeven }
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

  await expect(page.getByRole('region', { name: 'Pantry' })).toBeVisible()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
  expect(volgorde).toEqual(['in de wachtrij', 'afstreping verstuurd', 'voorraad gevraagd'])
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
