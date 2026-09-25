import { test, expect } from '@playwright/test'
import { localeCodes, routePath } from '../../routes.config'

// Eén manifest per taal, want start_url bepaalt wat het icoon op het
// startscherm opent — en dat is per taal een ander pad. Ze delen id, zodat
// de browser dit als één app ziet en niet als drie.
test('elk manifest opent de voorraad in zijn eigen taal', async ({ request }) => {
  for (const taal of localeCodes) {
    const antwoord = await request.get(`/manifest/${taal}`)

    expect(antwoord.status(), `status voor ${taal}`).toBe(200)
    expect(antwoord.headers()['content-type'], `content-type voor ${taal}`)
      .toContain('application/manifest+json')

    const manifest = await antwoord.json()
    expect(manifest.start_url, `start_url voor ${taal}`).toBe(routePath('inventory', taal))
    expect(manifest.id, `id voor ${taal}`).toBe('/')
    expect(manifest.scope, `scope voor ${taal}`).toBe('/')
  }
})

test('een onbekende taal geeft geen manifest', async ({ request }) => {
  const antwoord = await request.get('/manifest/de')
  expect(antwoord.status()).toBe(404)
})

test('de pagina verwijst naar het manifest van de getoonde taal', async ({ page }) => {
  await page.goto('/nl')
  const href = await page.getAttribute('link[rel="manifest"]', 'href')
  expect(href).toBe('/manifest/nl')
})
