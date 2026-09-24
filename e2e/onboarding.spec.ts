import { test, expect } from '@playwright/test'
import { signIn, waitForHydration, bundles } from './helpers'

const en = bundles.en

test('een nieuwe gebruiker belandt op onboarding en kan een huishouden starten', async ({ page }) => {
  await signIn(page, `e2e-${Date.now()}@example.com`)

  await page.goto('/onboarding')
  await waitForHydration(page)
  await page.getByLabel('Household name').fill('Testhuis')
  await page.getByRole('button', { name: 'Start' }).click()

  await expect(page.getByText('Testhuis')).toBeVisible()
})

test('een gebruiker zonder huishouden wordt vanaf de app-startpagina doorgestuurd', async ({ page }) => {
  await signIn(page, `e2e-redirect-${Date.now()}@example.com`)

  await page.goto('/app')
  await expect(page).toHaveURL(/\/onboarding/)
})

test('een ingelogde gebruiker op de landingspagina belandt in de app', async ({ page }) => {
  await signIn(page, `e2e-landing-${Date.now()}@example.com`)

  await page.goto('/')
  await expect(page).toHaveURL(/\/(app|onboarding)/)
})

// Bevinding 6 van de eindreview: er was geen navigatie naar de
// instellingenpagina's — de e2e-tests bereikten ze tot nu toe alleen met
// page.goto(). Deze test klikt in plaats daarvan echt door de nav.
test('een ingelogde gebruiker bereikt beide instellingenpagina\'s via de navigatie', async ({ page }) => {
  await signIn(page, `e2e-nav-${Date.now()}@example.com`)

  await page.goto('/onboarding')
  await waitForHydration(page)
  await page.getByLabel('Household name').fill('Navigatiehuis')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByText('Navigatiehuis')).toBeVisible()

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings\/household/)

  await page.getByRole('link', { name: 'Storage places' }).click()
  await expect(page).toHaveURL(/\/settings\/places/)
})

test('de eigenaar staat als lid in de huishoudinstellingen', async ({ page }) => {
  const email = `leden-${Date.now()}@example.com`
  await signIn(page, email)

  await page.goto('/onboarding')
  await waitForHydration(page)
  await page.getByLabel(en.onboarding.name).fill('Testhuis')
  await page.getByRole('button', { name: en.onboarding.start }).click()

  await page.goto('/settings/household')
  // Bevinding 7 van de eindreview: signIn() en de rest van deze flow draaien
  // altijd onvertaald (unprefixed = Engels per prefix_except_default), dus
  // de taalalternatie hierboven was theater — hij testte nooit een andere
  // taal. Erger nog: /owner/i matcht ook de "Make owner"-knop zodra er een
  // tweede lid bestaat. exact: true en de echte vertaling sluiten dat uit.
  await expect(page.getByText(en.householdSettings.roleOwner, { exact: true })).toBeVisible()
})
