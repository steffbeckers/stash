import { test, expect } from '@playwright/test'
import { waitForHydration, bundles, routePath } from './helpers'

const en = bundles.en

test('de homepage blijft publiek', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible()
})

test('een afgeschermde pagina stuurt je naar inloggen', async ({ page }) => {
  await page.goto(routePath('inventory', 'en'))
  await expect(page).toHaveURL(new RegExp(routePath('login', 'en')))
})

test('het inlogformulier toont een bevestiging na versturen', async ({ page }) => {
  await page.goto(routePath('login', 'en'))
  await waitForHydration(page)
  await page.getByLabel(en.auth.email).fill('test@example.com')
  await page.getByRole('button', { name: en.auth.sendLink }).click()
  await expect(page.getByText(en.auth.linkSent)).toBeVisible()
})

// De auth-guard van @nuxtjs/supabase stuurt altijd naar het kale /login,
// zonder taalprefix. Wie de app in het Nederlands gebruikt en uitgelogd op
// zijn startscherm-icoon tikt, belandt daardoor op een Engelse inlogpagina.
test('de inlogpagina volgt je taalkeuze als je zonder prefix binnenkomt', async ({ page, context }) => {
  await context.addCookies([
    { name: 'stash_locale', value: 'nl', url: 'http://localhost:3000' },
  ])

  await page.goto(routePath('login', 'en'))

  await expect(page).toHaveURL(new RegExp(`${routePath('login', 'nl')}$`))
})

// De keerzijde: wie het Engels gekozen heeft moet op de Engelse pagina
// blijven staan. Zonder deze test zou een doorstuur die áltijd naar het
// Nederlands gaat de vorige test halen.
test('de inlogpagina stuurt niet door als je taalkeuze al klopt', async ({ page, context }) => {
  await context.addCookies([
    { name: 'stash_locale', value: 'en', url: 'http://localhost:3000' },
  ])

  await page.goto(routePath('login', 'en'))

  await expect(page).toHaveURL(new RegExp(`${routePath('login', 'en')}$`))
})
