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
