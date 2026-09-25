import { test, expect } from '@playwright/test'
import { localeCodes, manifestPath, routePath } from '../../routes.config'
import { bundles, localeNames, prefix } from '../helpers'

// Eén manifest per taal, want start_url bepaalt wat het icoon op het
// startscherm opent — en dat is per taal een ander pad. Ze delen id, zodat
// de browser dit als één app ziet en niet als drie.
test('elk manifest opent de voorraad in zijn eigen taal', async ({ request }) => {
  for (const taal of localeCodes) {
    const antwoord = await request.get(manifestPath(taal))

    expect(antwoord.status(), `status voor ${taal}`).toBe(200)
    expect(antwoord.headers()['content-type'], `content-type voor ${taal}`)
      .toContain('application/manifest+json')

    const manifest = await antwoord.json()
    expect(manifest.start_url, `start_url voor ${taal}`).toBe(routePath('inventory', taal))
    expect(manifest.id, `id voor ${taal}`).toBe('/')
    expect(manifest.scope, `scope voor ${taal}`).toBe('/')
  }
})

test('een onbekende taal geeft geen manifest', async ({ request }) => {
  // Bewust niet manifestPath('de'): 'de' is geen LocaleCode, en dat is precies
  // het punt van deze test — een taal buiten de configuratie moet 404 geven.
  const antwoord = await request.get('/manifest/de')
  expect(antwoord.status()).toBe(404)
})

test('de pagina verwijst naar het manifest van de getoonde taal', async ({ page }) => {
  await page.goto('/nl')
  const href = await page.getAttribute('link[rel="manifest"]', 'href')
  expect(href).toBe(manifestPath('nl'))
})

// De test hierboven leest de href vlak na page.goto(): op dat moment heeft
// app.vue's setup() al gedraaid mét de taal uit de aangevraagde URL, dus een
// kale, niet-reactieve template-string zou die test óók laten slagen. Dat is
// precies de foutklasse die deze codebase al vaker is tegengekomen: een pad
// dat één keer wordt vastgelegd in plaats van herberekend. Deze test schakelt
// van taal zónder nieuwe paginalading en bewijst dus wat de vorige niet kan.
//
// Bewust géén waitForHydration() (e2e/helpers.ts), in tegenstelling tot
// locales.spec.ts. Die helper steunt op de aanwezigheid van
// __vueParentComponent, en die eigenschap bleek hier structureel afwezig —
// niet omdat hydratatie mislukt (los geverifieerd: dezelfde klik-en-wissel-
// reeks hieronder werkt betrouwbaar zonder deze wachtstap, en de marker
// ontbreekt zelfs ná een geslaagde interactie), maar omdat
// __vueParentComponent in de gebouwde productiebundel van deze app niet
// verschijnt. e2e/pwa/* draait altijd tegen die gebouwde app (nooit tegen
// nuxt dev, waar locales.spec.ts wél tegen draait); waitForHydration() is dus
// hier het verkeerde gereedschap, geen echte hydratatiestoring. Playwright's
// eigen actionability-wachten op de klik hieronder volstaat.
test('de manifest-link volgt een taalwissel zonder herlading', async ({ page }) => {
  await page.goto(prefix('fr'))
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', manifestPath('fr'))

  // Een sentinel op window overleeft alleen een navigatie die geen nieuwe
  // pagina laadt. Zonder deze controle zou een schakelaar die per ongeluk
  // toch herlaadt deze test ook laten slagen — en dan meet hij enkel dat de
  // SSR-render van /nl klopt (dat bewijst de vorige test al), niet dat de
  // link reactief is.
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__geenHerlading = true
  })

  // De schakelaar is een dropdown: eerst openen, dan de taal kiezen. Dezelfde
  // manier als locales.spec.ts gebruikt voor de reguliere e2e-suite.
  await page.getByRole('button', { name: bundles.fr.nav.language }).click()
  await page.getByRole('menuitem', { name: localeNames.nl }).click()

  await expect(page).toHaveURL(new RegExp(`${prefix('nl')}/?$`))

  const overleefd = await page.evaluate(() => '__geenHerlading' in window)
  expect(overleefd, 'de taalwissel mag geen paginalading veroorzaken').toBe(true)

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', manifestPath('nl'))
})
