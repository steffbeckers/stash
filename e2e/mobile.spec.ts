import { test, expect, type Page } from '@playwright/test'
import { routePaths, routePath, localeCodes, defaultLocale, type RouteKey } from '../routes.config'
import { signIn, createHousehold, bundles, waitForHydration } from './helpers'

// 360×740, niet 375×812. 375 is de gangbare ontwerpmaat, 360 de eerlijke
// ondergrens van wat er rondloopt. Slaagt 360, dan slaagt 375 mee.
test.use({ viewport: { width: 360, height: 740 } })

// Elke route uit routes.config.ts doet mee. Wie er een uitzondert schrijft
// hier waarom, zodat zichtbaar blijft wat er níet gedekt is.
const uitzonderingen: Partial<Record<RouteKey, string>> = {
  'confirm': 'stuurt meteen door zodra de sessie er is; geen stabiele pagina om te meten',
  'invite/[token]': 'heeft een echt token nodig en wordt gedekt door invite.spec.ts',
}

const teMeten = (Object.keys(routePaths) as RouteKey[]).filter((route) => !(route in uitzonderingen))

/**
 * Meet horizontale overflow op één pagina.
 *
 * De URL-controle is niet decoratief. Zonder haar meet deze test bij een
 * kapotte auth-guard eenentwintig keer de inlogpagina, staat hij groen, en
 * bewijst hij niets over de pagina's die hij beweert te dekken. Dat is
 * precies de faalmodus die dit project al veertien keer heeft opgeleverd.
 */
async function verwachtGeenOverflow(page: Page, pad: string): Promise<void> {
  await page.goto(pad)
  // Een kaal string-argument is bij toHaveURL() geen substring- maar een
  // exacte match, opgelost tegen playwright.config.ts' baseURL — dus geen
  // handmatige regex-escaping nodig, en geen risico dat een pad dat toevallig
  // op hetzelfde staartje eindigt (het oude patroon was niet aan het begin
  // verankerd) hier ten onrechte voor doorgaat.
  await expect(page, `${pad} stuurde door naar ${page.url()}`).toHaveURL(pad)

  // page.goto() lost al op bij 'load', vóór hydratie. Overflow die pas ná
  // hydratie verschijnt (bv. door een client-only element) zou hierzonder
  // ongezien blijven. Dezelfde selector als e2e/locales.spec.ts gebruikt
  // voor headeralleen-pagina's.
  await waitForHydration(page, 'header button')

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))

  expect(scrollWidth, `${pad} loopt ${scrollWidth - clientWidth}px over`).toBeLessThanOrEqual(clientWidth)
}

test('geen afgeschermde pagina loopt horizontaal over op 360px', async ({ page }) => {
  await signIn(page, `mobiel-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Mo', huishouden: 'Mobielhuis' })

  for (const locale of localeCodes) {
    for (const route of teMeten) {
      await verwachtGeenOverflow(page, routePath(route, locale))
    }

    // Bewijst dat deze hele reeks metingen de ingelogde header trof, niet de
    // smallere uitgelogde variant — anders zou een toekomstige wijziging die
    // per ongeluk de verkeerde header op een afgeschermde pagina toont hier
    // groen blijven staan. Eén keer per taal, niet per route: welke header
    // getoond wordt hangt af van de sessie, niet van de route.
    await expect(page.getByRole('button', { name: bundles[locale].nav.account })).toBeVisible()
  }
})

// De landingspagina krijgt een eigen geval, om twee redenen. Ze staat niet in
// routePaths (er is geen routenaam voor de wortel; zie dezelfde constatering
// in test/routes/offline-path.test.ts). En ze is de enige plek waar de header
// van een uitgelogde bezoeker te zien is — met de compacte taalschakelaar die
// in dit plan verandert, en die de veegtest hierboven dus nooit ziet.
//
// De cookie wordt expliciet gezet omdat detectBrowserLanguage met
// redirectOn: 'root' juist op '/' doorstuurt naar de taal uit die cookie.
// Zonder deze regel hangt de uitkomst af van de volgorde waarin de talen
// getest worden.
for (const locale of localeCodes) {
  test(`de landingspagina loopt niet over op 360px in ${locale}`, async ({ page }) => {
    await page.context().addCookies([
      { name: 'stash_locale', value: locale, url: 'http://localhost:3000' },
    ])

    const pad = locale === defaultLocale ? '/' : `/${locale}`
    await verwachtGeenOverflow(page, pad)

    // Bewijst dat we de juiste taal én een uitgelogde header meten: de
    // taalschakelaar hoort hier te staan, de avatar niet.
    await expect(page.getByRole('button', { name: bundles[locale].nav.language })).toBeVisible()
    await expect(page.getByRole('button', { name: bundles[locale].nav.account })).toHaveCount(0)
  })
}

/**
 * Twee elementen staan niet op dezelfde regel.
 *
 * Een breedtegrens ("het veld is minstens N pixels breed") zou een verzonnen
 * getal zijn. Dit is een directe uitspraak over de fix — onder `sm` stapelt
 * de rij — en hij wordt rood zodra iemand dat terugdraait.
 *
 * Deze test bestaat omdat de veegtest hierboven niet volstaat, en dat is
 * gemeten en niet beredeneerd: het naamveld van het bewaarplaatsen-formulier
 * was in het Frans op 360px samengedrukt tot 49px, binnen een formulier van
 * 328px dat keurig binnen de viewport bleef. Nul page-overflow, onbruikbaar
 * veld, groene veegtest.
 */
async function verwachtGestapeld(
  boven: import('@playwright/test').Locator,
  onder: import('@playwright/test').Locator,
  naam: string,
): Promise<void> {
  const a = await boven.boundingBox()
  const b = await onder.boundingBox()
  expect(a, `${naam}: het bovenste element is niet zichtbaar`).not.toBeNull()
  expect(b, `${naam}: het onderste element is niet zichtbaar`).not.toBeNull()
  expect(b!.y, `${naam} staat nog op dezelfde regel`).toBeGreaterThanOrEqual(a!.y + a!.height)
}

test('bediening staat gestapeld op 360px in plaats van samengedrukt', async ({ page }) => {
  await signIn(page, `stapel-${Date.now()}@example.com`)
  // De voornaam mag geen deelreeks van de huishoudnaam zijn: getByText doet
  // standaard een deelreeksvergelijking, en 'Stapel' zou dan ook 'Stapelhuis'
  // matchen — een selector die per ongeluk het verkeerde element pakt.
  await createHousehold(page, { voornaam: 'Vera', huishouden: 'Stapelhuis' })

  await page.goto(routePath('settings/places', 'en'))
  await verwachtGestapeld(
    page.getByPlaceholder(bundles.en.places.name),
    page.getByRole('button', { name: bundles.en.places.add }),
    'bewaarplaatsen-formulier',
  )

  await page.goto(routePath('settings/household', 'en'))
  await expect(page.getByText('Vera')).toBeVisible()
  await verwachtGestapeld(
    page.getByText('Vera'),
    page.getByRole('button', { name: bundles.en.householdSettings.removeMember }),
    'ledenrij',
  )

  await page.getByRole('button', { name: bundles.en.invite.create }).click()
  const linkveld = page.getByRole('textbox', { name: bundles.en.invite.linkLabel })
  await expect(linkveld).toBeVisible()
  await verwachtGestapeld(
    linkveld,
    page.getByRole('button', { name: bundles.en.invite.copy }),
    'uitnodigingskaart',
  )
})
