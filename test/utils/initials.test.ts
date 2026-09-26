import { describe, it, expect } from 'vitest'
import { initials } from '../../app/utils/initials'

// De avatar in de header toont deze letters. Er is geen naam verplicht in de
// database, dus elke leeg-achtige invoer moet een voorspelbaar `null`
// opleveren waar de component op kan terugvallen — niet een lege string die
// als een lege cirkel rendert.
describe('initials', () => {
  it('geeft één letter bij één voornaam', () => {
    expect(initials('Steff')).toBe('S')
  })

  it('geeft twee letters bij twee woorden', () => {
    expect(initials('Steff Beckers')).toBe('SB')
  })

  it('neemt hoogstens twee letters bij drie woorden', () => {
    expect(initials('Jean Baptiste Dupont')).toBe('JB')
  })

  it('behandelt een koppelteken als onderdeel van één woord', () => {
    expect(initials('Jean-Pierre Dupont')).toBe('JD')
  })

  it('maakt er hoofdletters van', () => {
    expect(initials('steff')).toBe('S')
  })

  it('werkt op letters met accenten', () => {
    expect(initials('éva')).toBe('É')
  })

  // De reden voor `[...woord][0]` in plaats van `woord[0]`: dit teken bestaat
  // in UTF-16 uit een surrogaatpaar (twee code-eenheden). `woord[0]` zou alleen
  // de eerste code-eenheid pakken — een onbruikbaar half teken — terwijl
  // `[...woord]` per volledig code point itereert.
  it('houdt een teken buiten het basisvlak heel', () => {
    expect(initials('😀blij')).toBe('😀')
  })

  // Deze drie zijn de reden dat de functie `string | null` teruggeeft en niet
  // gewoon een string: alledrie komen ze in de praktijk voor. display_name is
  // null voor iedereen die nog nooit een naam heeft ingevuld.
  it('geeft null bij null', () => {
    expect(initials(null)).toBeNull()
  })

  it('geeft null bij een lege string', () => {
    expect(initials('')).toBeNull()
  })

  it('geeft null bij alleen spaties', () => {
    expect(initials('   ')).toBeNull()
  })
})
