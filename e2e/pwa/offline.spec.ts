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
// activatie; precacheAndRoute vult de cache tijdens install, dus voor de
// precache-inhoud staat na ready alles klaar.
//
// Activatie is niet hetzelfde als overname. De pagina die de registratie
// deed blijft ongecontroleerd totdat er een vólgende navigatie plaatsvindt
// (app/sw.ts roept bewust geen clients.claim() aan — zie de toelichting
// daar). Zonder de reload hieronder loopt geen enkel verzoek van deze test
// door de fetch-handler, en meet de test dus niets van de service worker
// zelf: dat was precies het gat waar Finding 1 uit de review op wees.
async function wachtOpServiceWorker(page: import('@playwright/test').Page) {
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
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
        //
        // Drie vormen om te controleren, niet alleen de kale '/': de testnaam
        // belooft dat "een gewone pagina" niet gecachet wordt, niet enkel dat
        // één bepaalde padvorm dat niet wordt. Een precachete landingspagina
        // kan zowel onder '/' als onder een 'index.html'-staart terechtkomen
        // — welke van de twee hangt af van hoe de bouwtool het bestand op
        // schijf zet, en daar steunt deze test bewust niet op — en '/nl' is
        // de taalgeprefixte variant van dezelfde pagina. Alleen op '/'
        // controleren zou een precache-entry onder een van de andere twee
        // vormen stilzwijgend doorlaten.
        const pad = new URL(verzoek.url).pathname
        if (pad === '/' || pad === '/index.html' || pad === '/nl') return true
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
//
// Twee vormen van verkeer, bewust allebei getoetst: NavigationRoute matcht
// alleen request.mode 'navigate'. Een fetch() vanuit paginacode (mode 'cors')
// komt daar nooit bij in de buurt — dat dekt dus alleen af dat er geen andere
// route zich met /api/* bemoeit, niet dat NavigationRoute's denylist werkt.
// Een rechtstreekse navigatie naar een API-pad (page.goto) is wél mode
// 'navigate' en is precies het geval dat de denylist in app/sw.ts bewaakt.
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

  let genavigeerd = true
  try {
    await page.goto('/api/health')
  } catch {
    genavigeerd = false
  }

  expect(genavigeerd).toBe(false)
})
