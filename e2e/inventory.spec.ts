import { test, expect, type Page } from '@playwright/test'
import { routePath } from '../routes.config'
import { signIn, createHousehold, bundles, waitForHydration } from './helpers'

const en = bundles.en

/**
 * De lokale datum over `dagen` dagen, als YYYY-MM-DD.
 *
 * Bewust niet geïmporteerd uit app/utils/voorraad.ts: een fout daar zou dan
 * in de app én in de test zitten, en de test zou hem nooit zien.
 */
function datumOver(dagen: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dagen)
  const maand = String(d.getMonth() + 1).padStart(2, '0')
  const dag = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${maand}-${dag}`
}

function tekst(sjabloon: string, waarden: Record<string, string | number>): string {
  return Object.entries(waarden).reduce((t, [k, v]) => t.replace(`{${k}}`, String(v)), sjabloon)
}

/**
 * Voegt iets toe via de knop van een plaats op het startscherm.
 * `nieuw` maakt het product inline aan; anders wordt het gezocht en gekozen.
 */
async function voegToe(
  page: Page,
  opties: { plaats: string; naam: string; nieuw?: boolean; aantal?: number; vervaldatum?: string },
): Promise<void> {
  await page.goto(routePath('inventory', 'en'))
  await page.getByRole('link', { name: tekst(en.inventory.addTo, { place: opties.plaats }), exact: true }).click()
  await waitForHydration(page, 'input')

  await page.getByLabel(en.inventory.searchProduct).fill(opties.naam)
  if (opties.nieuw) {
    await page.getByRole('button', { name: tekst(en.products.createNamed, { name: opties.naam }) }).click()
    await page.getByRole('button', { name: en.inventory.createProduct }).click()
  } else {
    // exact: de knop "Create "<naam>"" bevat de naam ook.
    await page.getByRole('button', { name: opties.naam, exact: true }).click()
  }

  if (opties.aantal) await page.getByLabel(en.inventory.count).fill(String(opties.aantal))
  if (opties.vervaldatum) await page.getByLabel(en.inventory.expiresAt).fill(opties.vervaldatum)
  await page.getByRole('button', { name: en.inventory.save }).click()
  await expect(page).toHaveURL(routePath('inventory', 'en'))
}

function groep(page: Page, plaats: string, naam: string) {
  return page.getByRole('region', { name: plaats }).getByRole('listitem').filter({ hasText: naam }).first()
}

test('een nieuw product toevoegen zet het in de gekozen plaats', async ({ page }) => {
  const naam = `Passata${Date.now()}`
  await signIn(page, `voorraad-toevoegen-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Vic', huishouden: 'Voorraadhuis' })

  await voegToe(page, { plaats: 'Pantry', naam, nieuw: true, aantal: 3 })

  await expect(groep(page, 'Pantry', naam)).toContainText('×3')
  // De andere helft: het staat niet ook in een andere plaats.
  await expect(page.getByRole('region', { name: 'Fridge' }).getByText(naam)).toHaveCount(0)
})

// Alleen de positieve kant zou ook slagen met een strook die alles toont.
test('de strook toont wat binnenkort vervalt en niet wat later vervalt', async ({ page }) => {
  const snel = `Yoghurt${Date.now()}`
  const later = `Rijst${Date.now()}`
  await signIn(page, `voorraad-strook-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Sven', huishouden: 'Strookhuis' })

  await voegToe(page, { plaats: 'Fridge', naam: snel, nieuw: true, vervaldatum: datumOver(2) })
  await voegToe(page, { plaats: 'Pantry', naam: later, nieuw: true, vervaldatum: datumOver(10) })

  const strook = page.getByRole('region', { name: en.inventory.expiringSoon })
  await expect(strook.getByText(snel)).toBeVisible()
  await expect(strook.getByText(later)).toHaveCount(0)
  // Bewijst dat het tweede item er wél is: anders slaagt de regel hierboven
  // ook als het toevoegen stil mislukte.
  await expect(groep(page, 'Pantry', later)).toBeVisible()
  // Samen met de regel hierboven pint dit de voorkeur uit ?plaats=: de
  // plaatsen staan in willekeurige volgorde, dus wie de query negeert kan
  // niet tegelijk snel→Fridge én later→Pantry halen.
  await expect(groep(page, 'Fridge', snel)).toBeVisible()
})

test('afstrepen en ongedaan maken', async ({ page }) => {
  const naam = `Bonen${Date.now()}`
  await signIn(page, `voorraad-afstrepen-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Ada', huishouden: 'Afstreephuis' })
  await voegToe(page, { plaats: 'Pantry', naam, nieuw: true, aantal: 3 })

  await page.getByRole('button', { name: tekst(en.inventory.closeNamed, { name: naam }), exact: true }).click()
  // Uitwisselbaar: geen keuze, de redenknoppen zijn meteen actief.
  await expect(page.getByRole('radio')).toHaveCount(0)
  await page.getByRole('button', { name: en.inventory.consumed }).click()
  await expect(groep(page, 'Pantry', naam)).toContainText('×2')

  await page.getByRole('button', { name: en.inventory.undo }).click()
  await expect(groep(page, 'Pantry', naam)).toContainText('×3')

  // De toast en de lijst op het scherm bewijzen niets over de database.
  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×3')
})

test('bij verschillende vervaldatums vraagt afstrepen welke', async ({ page }) => {
  const naam = `Passata${Date.now()}`
  await signIn(page, `voorraad-varianten-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Vera', huishouden: 'Variantenhuis' })
  await voegToe(page, { plaats: 'Pantry', naam, nieuw: true, vervaldatum: datumOver(5) })
  await voegToe(page, { plaats: 'Pantry', naam, vervaldatum: datumOver(20) })

  await page.getByRole('button', { name: tekst(en.inventory.closeNamed, { name: naam }), exact: true }).click()

  const keuzes = page.getByRole('radio')
  await expect(keuzes).toHaveCount(2)
  await expect(keuzes.nth(0)).not.toBeChecked()
  await expect(keuzes.nth(1)).not.toBeChecked()
  const opgemaakt = page.getByRole('button', { name: en.inventory.consumed })
  await expect(opgemaakt).toBeDisabled()

  await keuzes.nth(0).check()
  await expect(opgemaakt).toBeEnabled()

  // Sluit zonder af te strepen en open opnieuw: de vorige keuze mag niet
  // blijven staan, anders streept wie snel doorklikt de verkeerde af.
  await page.keyboard.press('Escape')
  await expect(keuzes).toHaveCount(0)
  await page.getByRole('button', { name: tekst(en.inventory.closeNamed, { name: naam }), exact: true }).click()
  await expect(keuzes).toHaveCount(2)
  await expect(keuzes.nth(0)).not.toBeChecked()
  await expect(opgemaakt).toBeDisabled()

  await keuzes.nth(0).check()
  await expect(opgemaakt).toBeEnabled()
  await opgemaakt.click()

  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
})
