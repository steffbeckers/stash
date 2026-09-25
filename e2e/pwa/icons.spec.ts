import { test, expect } from '@playwright/test'

// De icons zijn statische bestanden, maar ze horen ook werkelijk in de
// gebouwde output te belanden. Een manifest dat naar een 404 wijst geeft
// geen foutmelding — de installatie toont dan gewoon een leeg vierkant.
const icons = [
  '/pwa-64x64.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/maskable-icon-512x512.png',
  '/apple-touch-icon-180x180.png',
]

test('elk icoon wordt geserveerd als afbeelding', async ({ request }) => {
  for (const pad of icons) {
    const antwoord = await request.get(pad)
    // Op zichzelf bewijst deze status-check hier weinig: elk pad buiten
    // supabaseExclude redirect naar /login, en Playwright volgt die redirect
    // en houdt over: status 200. Een ontbrekend icoon 404't dus niet, het
    // landt op de inlogpagina. De content-type-check hieronder doet het
    // echte werk — die faalt wél, want /login is text/html, geen image/*.
    expect(antwoord.status(), `status voor ${pad}`).toBe(200)
    expect(antwoord.headers()['content-type'], `content-type voor ${pad}`).toContain('image/')
  }
})

test('de favicon is niet meer die van Nuxt', async ({ request }) => {
  const antwoord = await request.get('/favicon.ico')
  expect(antwoord.status()).toBe(200)
  // Het Nuxt-logo is 4286 bytes. De gegenereerde favicon is een 48x48 uit
  // onze eigen SVG en heeft daarmee een andere grootte. Dit is een grove
  // controle, maar hij vangt wel het geval waarin de generator niet gedraaid
  // is en het oude bestand blijft staan.
  const body = await antwoord.body()
  expect(body.byteLength).not.toBe(4286)
})
