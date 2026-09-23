import { test, expect } from '@playwright/test'
import { signIn, waitForHydration } from './helpers'

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
