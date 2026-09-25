import { describe, it, expect } from 'vitest'
import { offlinePathFor, routePath } from '../../routes.config'

// De service worker draait buiten Vue en kan useI18n() niet gebruiken. De
// taal moet dus uit het pad komen. Dit is de hele afleiding, en daarmee het
// stuk dat een echte unittest kan krijgen in plaats van een browsertest die
// hoopt.
//
// De paden komen uit routePath(), niet met de hand getypt: routes.config.ts
// is de enige bron van waarheid voor routepaden (zie het commentaar
// bovenaan dat bestand). Een letterlijke kopie hier zou bij een hernoemde
// route stilletjes losraken van wat hij hoort te toetsen.
describe('offlinePathFor', () => {
  it('geeft de Engelse pagina voor een pad zonder prefix', () => {
    expect(offlinePathFor(routePath('inventory', 'en'))).toBe(routePath('offline', 'en'))
  })

  it('geeft de Nederlandse pagina voor een /nl-pad', () => {
    expect(offlinePathFor(routePath('inventory', 'nl'))).toBe(routePath('offline', 'nl'))
  })

  it('geeft de Franse pagina voor een /fr-pad', () => {
    expect(offlinePathFor(routePath('inventory', 'fr'))).toBe(routePath('offline', 'fr'))
  })

  // De wortel '/' staat in geen enkele taal in routePaths — er is geen
  // routenaam voor de wortel zelf. Dit pad blijft daarom bewust een losse
  // string in plaats van een afgeleide: routePath() heeft hier niets om van
  // af te leiden.
  it('geeft de Engelse pagina voor de wortel', () => {
    expect(offlinePathFor('/')).toBe(routePath('offline', 'en'))
  })

  // 'en' is de standaardtaal en heeft dus geen prefix: /en/... bestaat niet
  // als route. Zou deze functie 'en' tóch als prefix herkennen, dan bouwt ze
  // een pad dat nergens heen gaat.
  it('behandelt /en niet als taalprefix', () => {
    expect(offlinePathFor('/en/inventory')).toBe(routePath('offline', 'en'))
  })

  // Een taalcode dieper in het pad is een gewone map, geen prefix. '/settings/nl'
  // bestaat met opzet niet in routePaths: dit pad werkt alleen als test omdat
  // het géén echte route is, dus blijft het een losse string in plaats van
  // een routePath()-aanroep.
  it('laat zich niet misleiden door een map die op een taalcode lijkt', () => {
    expect(offlinePathFor('/settings/nl')).toBe(routePath('offline', 'en'))
  })
})
