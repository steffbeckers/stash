import { test, expect } from '@playwright/test'
import en from '../../i18n/locales/en.json' with { type: 'json' }
import nl from '../../i18n/locales/nl.json' with { type: 'json' }

// De landingspagina staat niet in routePaths: bij `prefix_except_default` ís
// de prefix de route, dus er valt niets te vertalen. Vandaar deze twee
// letterlijk, als enige uitzondering op "paden komen uit routes.config.ts".
//
// Het zijn bovendien publieke pagina's, dus er is geen login nodig om het
// navigatiegedrag van de service worker te toetsen.
const landing = { en: '/', nl: '/nl' } as const

// De service worker moet geïnstalleerd zijn én de precache gevuld hebben voor
// een offline-test iets zegt. navigator.serviceWorker.ready wacht op
// activatie; precacheAndRoute vult de cache tijdens install, dus na ready
// staat alles klaar.
async function wachtOpServiceWorker(page: import('@playwright/test').Page) {
  await page.evaluate(() => navigator.serviceWorker.ready)
}

test('offline krijg je de offline-pagina van je eigen taal', async ({ page, context }) => {
  await page.goto(landing.en)
  await wachtOpServiceWorker(page)

  await context.setOffline(true)

  await page.goto(landing.nl)
  await expect(page.getByText(nl.offline.title)).toBeVisible()
})

// Deze test is er omdat de vorige alleen niet genoeg is. Een afleiding die
// altijd de Engelse pagina teruggeeft haalt een test die enkel Nederlands
// controleert nooit — maar een die enkel Engels controleert wél. Beide
// richtingen in één run is de enige vorm die de fout vangt.
test('een andere taalprefix geeft een andere offline-pagina', async ({ page, context }) => {
  await page.goto(landing.en)
  await wachtOpServiceWorker(page)

  await context.setOffline(true)

  await page.goto(landing.nl)
  await expect(page.getByText(nl.offline.title)).toBeVisible()

  await page.goto(landing.en)
  await expect(page.getByText(en.offline.title)).toBeVisible()
})

test('een gewone pagina belandt niet in de cache', async ({ page }) => {
  await page.goto(landing.en)
  await wachtOpServiceWorker(page)

  const gecachet = await page.evaluate(async () => {
    const namen = await caches.keys()
    for (const naam of namen) {
      const cache = await caches.open(naam)
      for (const verzoek of await cache.keys()) {
        // De landingspagina is server-gerenderd en verschilt per gebruiker en
        // per taal. Staat ze in een cache, dan kan ze aan de verkeerde
        // persoon geserveerd worden.
        if (new URL(verzoek.url).pathname === '/') return true
      }
    }
    return false
  })

  expect(gecachet).toBe(false)
})

// De service worker mag API-verkeer met rust laten. Offline hoort /api/health
// dus gewoon te mislukken; lost de aanroep wél op, dan onderschept of cachet
// de worker iets wat hij niet mag aanraken — en dan kan een antwoord van de
// ene gebruiker bij de andere terechtkomen.
test('de service worker raakt /api niet aan', async ({ page, context }) => {
  await page.goto(landing.en)
  await wachtOpServiceWorker(page)

  await context.setOffline(true)

  const gelukt = await page.evaluate(async () => {
    try {
      await fetch('/api/health')
      return true
    } catch {
      return false
    }
  })

  expect(gelukt).toBe(false)
})
