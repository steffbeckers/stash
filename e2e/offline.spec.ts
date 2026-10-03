import { test, expect, type Page } from '@playwright/test'
import { routePath } from '../routes.config'
import { signIn, createHousehold, bundles, waitForHydration } from './helpers'
import { KOPIE_SLEUTEL, WACHTRIJ_SLEUTEL } from '../app/utils/offlineVoorraad'

const en = bundles.en

function tekst(sjabloon: string, waarden: Record<string, string | number>): string {
  return Object.entries(waarden).reduce((t, [k, v]) => t.replace(`{${k}}`, String(v)), sjabloon)
}

/** Een nieuw product toevoegen aan een plaats, en terug op de voorraad. */
async function voegToe(page: Page, opties: { plaats: string; naam: string; aantal?: number }): Promise<void> {
  await page.goto(routePath('inventory', 'en'))
  await page.getByRole('link', { name: tekst(en.inventory.addTo, { place: opties.plaats }), exact: true }).click()
  await waitForHydration(page, 'input')
  await page.getByLabel(en.inventory.searchProduct).fill(opties.naam)
  await page.getByRole('button', { name: tekst(en.products.createNamed, { name: opties.naam }) }).click()
  await page.getByRole('button', { name: en.inventory.createProduct }).click()
  if (opties.aantal) await page.getByLabel(en.inventory.count).fill(String(opties.aantal))
  await page.getByRole('button', { name: en.inventory.save }).click()
  await expect(page).toHaveURL(routePath('inventory', 'en'))
}

function groep(page: Page, plaats: string, naam: string) {
  return page.getByRole('region', { name: plaats }).getByRole('listitem').filter({ hasText: naam }).first()
}

async function streepAf(page: Page, naam: string): Promise<void> {
  await page.getByRole('button', { name: tekst(en.inventory.closeNamed, { name: naam }), exact: true }).click()
  await page.getByRole('button', { name: en.inventory.consumed }).click()
}

test('de voorraadpagina bewaart een lokale kopie', async ({ page }) => {
  const naam = `Kopie${Date.now()}`
  await signIn(page, `offline-kopie-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Kai', huishouden: 'Kopiehuis' })
  await voegToe(page, { plaats: 'Pantry', naam })
  await expect(groep(page, 'Pantry', naam)).toBeVisible()

  const kopie = await page.evaluate((s) => JSON.parse(localStorage.getItem(s) ?? 'null'), KOPIE_SLEUTEL)
  expect(kopie?.huishouden?.naam).toBe('Kopiehuis')
  expect(kopie?.items?.map((i: { naam: string }) => i.naam)).toContain(naam)
})

test('afstrepen zonder netwerk gaat in de wachtrij en wordt verstuurd zodra er netwerk is', async ({ page, context }) => {
  const naam = `Wacht${Date.now()}`
  await signIn(page, `offline-wachtrij-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Wim', huishouden: 'Wachthuis' })
  await voegToe(page, { plaats: 'Pantry', naam, aantal: 2 })
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')

  await context.setOffline(true)
  await streepAf(page, naam)
  await expect(page.getByText(en.offlineVoorraad.queued, { exact: true })).toBeVisible()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')

  // Weer online: de plugin verstuurt bij het online-event, zonder herladen.
  await context.setOffline(false)
  await page.waitForFunction((s) => localStorage.getItem(s) === null, WACHTRIJ_SLEUTEL)

  // En het staat echt in de database.
  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
})
