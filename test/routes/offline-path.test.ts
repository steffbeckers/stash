import { describe, it, expect } from 'vitest'
import { offlinePathFor } from '../../routes.config'

// De service worker draait buiten Vue en kan useI18n() niet gebruiken. De
// taal moet dus uit het pad komen. Dit is de hele afleiding, en daarmee het
// stuk dat een echte unittest kan krijgen in plaats van een browsertest die
// hoopt.
describe('offlinePathFor', () => {
  it('geeft de Engelse pagina voor een pad zonder prefix', () => {
    expect(offlinePathFor('/inventory')).toBe('/offline')
  })

  it('geeft de Nederlandse pagina voor een /nl-pad', () => {
    expect(offlinePathFor('/nl/voorraad')).toBe('/nl/offline')
  })

  it('geeft de Franse pagina voor een /fr-pad', () => {
    expect(offlinePathFor('/fr/stock')).toBe('/fr/hors-ligne')
  })

  it('geeft de Engelse pagina voor de wortel', () => {
    expect(offlinePathFor('/')).toBe('/offline')
  })

  // 'en' is de standaardtaal en heeft dus geen prefix: /en/... bestaat niet
  // als route. Zou deze functie 'en' tóch als prefix herkennen, dan bouwt ze
  // een pad dat nergens heen gaat.
  it('behandelt /en niet als taalprefix', () => {
    expect(offlinePathFor('/en/inventory')).toBe('/offline')
  })

  // Een taalcode dieper in het pad is een gewone map, geen prefix.
  it('laat zich niet misleiden door een map die op een taalcode lijkt', () => {
    expect(offlinePathFor('/settings/nl')).toBe('/offline')
  })
})
