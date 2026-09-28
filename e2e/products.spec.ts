import { test, expect } from '@playwright/test'
import { routePath } from '../routes.config'
import { signIn, createHousehold, bundles, waitForHydration } from './helpers'

const en = bundles.en

// De hele weg in één test: aanmaken, terugvinden via zoeken, en een naam in
// een tweede taal erbij. Dat laatste bewijst het vertaalpad, dat geen enkele
// databasetest end-to-end raakt.
test('een gebruiker maakt een product aan en vindt het terug', async ({ page }) => {
  const merk = `Merk${Date.now()}`
  await signIn(page, `catalogus-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Cato', huishouden: 'Cataloghuis' })

  await page.goto(routePath('products/new', 'en'))
  await waitForHydration(page)
  await page.getByLabel(en.products.name).fill('Bio halfvolle melk 1 L')
  await page.getByLabel(en.products.brand).fill(merk)
  await page.getByRole('button', { name: en.products.save }).click()

  // De aanmaakpagina stuurt door naar de productpagina.
  await expect(page.getByRole('heading', { name: 'Bio halfvolle melk 1 L' })).toBeVisible()

  // Een tweede taal erbij, via het NL-vakje. Elke taal heeft een eigen
  // Save-knop met aria-label "Save EN"/"Save NL"/"Save FR" (Taak 6), maar
  // getByRole/getByLabel matchen de naam standaard als deelreeks:
  // { name: en.products.save } ("Save") raakt dus alle vier de knoppen op
  // deze pagina (drie taalknoppen plus de detailknop), en .first() zou altijd
  // op de Engelse landen — ook als je net het NL-vakje hebt ingevuld. Zelfs
  // getByLabel('NL') alleen is dubbelzinnig: een <button> is een labelable
  // element, dus de Save-knop met aria-label "Save NL" matcht net zo goed als
  // het NL-tekstvakje ("NL" is een deelreeks van "Save NL"), en Playwright
  // weigert dan met een strict-mode violation. exact: true dwingt overal de
  // volledige naam af en pakt zo steeds het juiste element.
  await page.getByLabel('NL', { exact: true }).fill('Bio halfvolle melk')
  await page.getByRole('button', { name: `${en.products.save} NL`, exact: true }).click()

  // Herladen in plaats van enkel het veld terug uitlezen: dat laatste zou ook
  // slagen als het opslaan de database nooit raakte, want v-model laat de
  // getypte waarde gewoon staan. Een naam die een volledige paginalaad
  // overleeft komt van de server.
  await page.reload()
  await expect(page.getByLabel('NL', { exact: true })).toHaveValue('Bio halfvolle melk')

  // Terugvinden op een kort woord in een lange naam — precies het geval
  // waar similarity() op stukloopt en word_similarity() niet.
  await page.goto(routePath('products', 'en'))
  await waitForHydration(page, 'input')
  await page.getByLabel(en.products.search).fill('melk')
  await expect(page.getByText(merk)).toBeVisible()
})

// De andere helft van het bewerkrecht. Zonder dit geval zou een UI die de
// knoppen altijd toont er net zo groen uitzien.
test('een vreemde ziet geen bewerkknoppen op andermans product', async ({ page, browser }) => {
  const naam = `Vreemdproduct${Date.now()}`
  await signIn(page, `maker-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Maki', huishouden: 'Makershuis' })

  await page.goto(routePath('products/new', 'en'))
  await waitForHydration(page)
  await page.getByLabel(en.products.name).fill(naam)
  await page.getByRole('button', { name: en.products.save }).click()
  await expect(page.getByRole('heading', { name: naam })).toBeVisible()
  const productUrl = page.url()

  const context = await browser.newContext()
  const vreemde = await context.newPage()
  await signIn(vreemde, `vreemde-${Date.now()}@example.com`)
  await createHousehold(vreemde, { voornaam: 'Vera', huishouden: 'Vreemdhuis' })

  await vreemde.goto(productUrl)
  await expect(vreemde.getByRole('heading', { name: naam })).toBeVisible()
  await expect(vreemde.getByRole('button', { name: en.products.save })).toHaveCount(0)

  await context.close()
})
