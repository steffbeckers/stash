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
