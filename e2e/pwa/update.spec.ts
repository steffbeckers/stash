import { test, expect } from '@playwright/test'
import en from '../../i18n/locales/en.json' with { type: 'json' }

// Het positieve geval — er is werkelijk een nieuwe versie — vraagt twee
// builds en is daarom een handmatige controle (zie Step 6). Wat hier wél te
// automatiseren valt is het negatieve geval, en dat is niet niks: een
// component die altijd rendert zou elke gebruiker bij elk bezoek een
// updatemelding tonen voor een update die er niet is.
test('er staat geen updatemelding bij een verse installatie', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)

  await expect(page.getByText(en.pwa.updateAvailable)).toHaveCount(0)
})

// Een structurele test — die pint normaal een implementatiedetail vast in
// plaats van gedrag, en dat is elders in dit plan terecht afgewezen omdat het
// gedrag zelf al door een andere test werd gedekt; de structurele check voegde
// daar niets toe. Hier ligt dat anders. Het positieve geval — een echt
// wachtende worker die op de klik reageert — vraagt twee builds en is dus niet
// in één build te automatiseren (zie Step 6 in het taakrapport); er bestaat
// hier geen enkele gedragstest die dit kan dekken. Deze assertie is precies
// degene die het ontbreken van de listener in app/sw.ts had gevangen: zonder
// listener komt de letterlijke string 'SKIP_WAITING' nergens in sw.js voor
// (bevestigd door de listener tijdelijk te verwijderen en deze test rood te
// zien gaan — zie het taakrapport).
test('sw.js handelt een SKIP_WAITING-bericht af', async ({ request }) => {
  const antwoord = await request.get('/sw.js')
  const inhoud = await antwoord.text()

  expect(inhoud).toContain('SKIP_WAITING')
})
