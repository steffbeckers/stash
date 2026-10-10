import { test, expect, type Page, type Request } from '@playwright/test'
import { routePath } from '../routes.config'
import { signIn, createHousehold, bundles, waitForHydration } from './helpers'
import { withDb } from '../test/db/helpers'

// Spec docs/superpowers/specs/2026-10-10-geen-dubbele-toevoeging-design.md §6.

const en = bundles.en

function tekst(sjabloon: string, waarden: Record<string, string | number>): string {
  return Object.entries(waarden).reduce((t, [k, v]) => t.replace(`{${k}}`, String(v)), sjabloon)
}

/** Een belofte die de test zelf vrijgeeft. */
function slot(): { vrij: Promise<void>; vrijgeven: () => void } {
  let vrijgeven!: () => void
  const vrij = new Promise<void>((r) => { vrijgeven = r })
  return { vrij, vrijgeven }
}

/**
 * Laat het eerste verzoek dat aan `past` voldoet bij de server aankomen, maar
 * houdt het antwoord tegen: de pagina breekt het af op de termijn, terwijl de
 * server het al verwerkte. Elk volgend verzoek gaat gewoon door.
 */
async function houdEersteAntwoordVast(page: Page, patroon: string, past: (r: Request) => boolean) {
  const { vrij, vrijgeven } = slot()
  let pogingen = 0
  await page.route(patroon, async (route) => {
    if (!past(route.request())) return route.fallback()
    pogingen++
    if (pogingen > 1) return route.fallback()
    const antwoord = await route.fetch()
    await vrij
    await route.fulfill({ response: antwoord }).catch(() => {})
  })
  return { vrijgeven }
}

/** Hoeveel producten met deze naam er in de catalogus staan, rechtstreeks in de lokale database. */
// Nog ongebruikt: de volgende taak voegt de test voor create_product toe.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function aantalVertalingen(naam: string): Promise<number> {
  let n = 0
  await withDb(async (sql) => {
    const [rij] = await sql<{ n: number }[]>`select count(*)::int as n from product_translation where name = ${naam}`
    n = rij!.n
  })
  return n
}

test('opnieuw opslaan na een afgebroken toevoeging maakt geen dubbel', async ({ page }) => {
  const naam = `Dubbelvrij${Date.now()}`
  await signIn(page, `dubbel-item-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Dirk', huishouden: 'Dubbelhuis' })
  await page.goto(routePath('inventory', 'en'))
  await page.getByRole('link', { name: tekst(en.inventory.addTo, { place: 'Pantry' }), exact: true }).click()
  await waitForHydration(page, 'input')
  await page.getByLabel(en.inventory.searchProduct).fill(naam)
  await page.getByRole('button', { name: tekst(en.products.createNamed, { name: naam }) }).click()
  await page.getByRole('button', { name: en.inventory.createProduct }).click()
  await expect(page.getByRole('button', { name: en.inventory.changeProduct })).toBeVisible()
  await page.getByLabel(en.inventory.count).fill('2')

  const vast = await houdEersteAntwoordVast(page, '**/rest/v1/inventory_item*', (r) => r.method() === 'POST')
  await page.getByRole('button', { name: en.inventory.save }).click()
  // Pas na de termijn van 10 s: de server heeft de twee items, de pagina het antwoord niet.
  await expect(page.getByText(en.householdSettings.error, { exact: true })).toBeVisible({ timeout: 20_000 })

  // Opnieuw opslaan met dezelfde gegevens: dezelfde id's, dus geen dubbel.
  await page.getByRole('button', { name: en.inventory.save }).click()
  await expect(page).toHaveURL(routePath('inventory', 'en'))
  const groep = page.getByRole('region', { name: 'Pantry' }).getByRole('listitem').filter({ hasText: naam }).first()
  await expect(groep).toContainText('×2', { timeout: 15_000 })
  vast.vrijgeven()
})
