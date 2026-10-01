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

/**
 * De datum over `dagen` dagen zoals de app hem toont: "Oct 6", en met jaartal
 * als dat niet het lopende jaar is. Bewust opnieuw opgebouwd in plaats van
 * formatDatum() te importeren, om dezelfde reden als datumOver().
 */
function kort(dagen: number): string {
  const datum = datumOver(dagen)
  const zelfdeJaar = datum.slice(0, 4) === datumOver(0).slice(0, 4)
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    ...(zelfdeJaar ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(new Date(`${datum}T00:00:00Z`))
}

/** Een regex die "Oct 2" niet laat samenvallen met "Oct 25". */
function datumRegex(voorvoegsel: string, dagen: number): RegExp {
  return new RegExp(`${voorvoegsel}${kort(dagen)}(?!\\d)`)
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
  // De vroegste vervaldatum staat bovenaan, en alleen daarmee is "nth(0)"
  // hieronder de variant die we bedoelen.
  await expect(keuzes.nth(0)).toHaveAccessibleName(datumRegex('', 5))
  await expect(keuzes.nth(1)).toHaveAccessibleName(datumRegex('', 20))
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

  // Niet alleen "×1": dat is zo ook als de verkeerde variant wegging. De
  // vroegste datum die overblijft, bewijst welke het was.
  const over = groep(page, 'Pantry', naam)
  await expect(over).toContainText('×1')
  await expect(over).toContainText(datumRegex('Expires ', 20))
  await expect(over).not.toContainText(datumRegex('Expires ', 5))
})

test('een item bewerken bewaart de nieuwe vervaldatum', async ({ page }) => {
  const naam = `Melk${Date.now()}`
  await signIn(page, `voorraad-bewerken-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Bea', huishouden: 'Bewerkhuis' })
  await voegToe(page, { plaats: 'Fridge', naam, nieuw: true, vervaldatum: datumOver(5) })

  const g = groep(page, 'Fridge', naam)
  await g.getByRole('button', { name: new RegExp(naam) }).first().click()
  await g.getByRole('button', { name: en.inventory.edit, exact: true }).click()
  await g.getByLabel(en.inventory.expiresAt).fill(datumOver(12))
  await g.getByRole('button', { name: en.inventory.saveItem, exact: true }).click()
  await expect(g.getByRole('button', { name: en.inventory.edit, exact: true })).toBeVisible()

  // Opnieuw laden: het scherm bewijst niets over de database.
  await page.reload()
  await expect(groep(page, 'Fridge', naam)).toContainText(datumRegex('Expires ', 12))
  await expect(groep(page, 'Fridge', naam)).not.toContainText(datumRegex('Expires ', 5))
})

test('verwijderen vraagt eerst bevestiging en laat geen ongedaan maken toe', async ({ page }) => {
  const naam = `Eieren${Date.now()}`
  await signIn(page, `voorraad-verwijderen-${Date.now()}@example.com`)
  await createHousehold(page, { voornaam: 'Dirk', huishouden: 'Verwijderhuis' })
  await voegToe(page, { plaats: 'Pantry', naam, nieuw: true, aantal: 2 })

  const g = groep(page, 'Pantry', naam)
  await expect(g).toContainText('×2')
  await g.getByRole('button', { name: new RegExp(naam) }).first().click()
  await g.getByRole('button', { name: en.inventory.delete, exact: true }).first().click()

  const dialoog = page.getByRole('dialog')
  await expect(dialoog).toBeVisible()
  // Nog niets verwijderd zolang er niet bevestigd is. De dialoog verbergt de
  // rest van de pagina voor getByRole, dus hier een CSS-locator.
  await expect(page.locator('section li').filter({ hasText: naam }).first()).toContainText('×2')

  await dialoog.getByRole('button', { name: en.inventory.delete, exact: true }).click()
  await expect(g).toContainText('×1')
  // Verwijderen is geen afstrepen: er is niets om ongedaan te maken.
  await expect(page.getByRole('button', { name: en.inventory.undo })).toHaveCount(0)

  await page.reload()
  await expect(groep(page, 'Pantry', naam)).toContainText('×1')
})
