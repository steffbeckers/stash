import { test, expect } from '@playwright/test'
import { signIn, bundles, routePath, openUserMenu, createHousehold } from './helpers'

const en = bundles.en

test('een nieuwe gebruiker belandt op onboarding en kan een huishouden starten', async ({ page }) => {
  await signIn(page, `e2e-${Date.now()}@example.com`)

  await createHousehold(page, { voornaam: 'Anna', huishouden: 'Testhuis' })
})

test('een gebruiker zonder huishouden wordt vanaf de app-startpagina doorgestuurd', async ({ page }) => {
  await signIn(page, `e2e-redirect-${Date.now()}@example.com`)

  await page.goto(routePath('inventory', 'en'))
  await expect(page).toHaveURL(new RegExp(routePath('onboarding', 'en')))
})

// De landingspagina stuurde een ingelogde bezoeker meteen door naar /app, dus
// je kon je eigen uitlegpagina niet meer bekijken zodra je een account had.
// Nu blijf je staan; alleen de knop verandert van "beginnen" naar "doorgaan".
test('een ingelogde gebruiker mag op de landingspagina blijven', async ({ page }) => {
  await signIn(page, `e2e-landing-${Date.now()}@example.com`)

  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: en.landing.goToApp })).toBeVisible()
  await expect(page.getByRole('link', { name: en.landing.getStarted })).toHaveCount(0)
})

// Bevinding 6 van de eindreview: er was geen navigatie naar de
// instellingenpagina's — de e2e-tests bereikten ze tot nu toe alleen met
// page.goto(). Deze test klikt in plaats daarvan echt door de nav.
test('een ingelogde gebruiker bereikt beide instellingenpagina\'s via de navigatie', async ({ page }) => {
  await signIn(page, `e2e-nav-${Date.now()}@example.com`)

  await createHousehold(page, { voornaam: 'Bram', huishouden: 'Navigatiehuis' })

  // Instellingen zit sinds de header-herindeling in het avatarmenu, niet meer
  // in de navigatiebalk. Deze test klikt dus eerst het menu open — precies de
  // weg die een gebruiker ook aflegt.
  await openUserMenu(page)
  await page.getByRole('menuitem', { name: en.nav.settings }).click()
  await expect(page).toHaveURL(new RegExp(routePath('settings/profile', 'en')))

  await page.getByRole('link', { name: en.householdSettings.title }).click()
  await expect(page).toHaveURL(new RegExp(routePath('settings/household', 'en')))

  await page.getByRole('link', { name: 'Storage places' }).click()
  await expect(page).toHaveURL(new RegExp(routePath('settings/places', 'en')))
})

test('de eigenaar staat als lid in de huishoudinstellingen', async ({ page }) => {
  const email = `leden-${Date.now()}@example.com`
  await signIn(page, email)

  await createHousehold(page, { voornaam: 'Steffie', huishouden: 'Testhuis' })

  await page.goto(routePath('settings/household', 'en'))
  // Bevinding 7 van de eindreview: signIn() en de rest van deze flow draaien
  // altijd onvertaald (unprefixed = Engels per prefix_except_default), dus
  // de taalalternatie hierboven was theater — hij testte nooit een andere
  // taal. Erger nog: /owner/i matcht ook de "Make owner"-knop zodra er een
  // tweede lid bestaat. exact: true en de echte vertaling sluiten dat uit.
  //
  // Dit bewijst het hele pad in één keer: het onboardingformulier schrijft
  // display_name, en de ledenlijst leest het terug. Tot dit plan werd die
  // kolom nergens geschreven en toonde de lijst voor iedereen "Unnamed" —
  // een half afgemaakte functie waar geen enkele test iets van merkte.
  await expect(page.getByText('Steffie', { exact: false })).toBeVisible()
  await expect(page.getByText(en.householdSettings.noName)).toHaveCount(0)
  await expect(page.getByText(en.householdSettings.roleOwner, { exact: true })).toBeVisible()
})
