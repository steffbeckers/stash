import { describe, it, expect } from 'vitest'
import { safeInternalPath } from '../../app/utils/safe-redirect'

// route.query.redirect kan letterlijk alles zijn: een normale string, maar
// ook een array (herhaalde querysleutel), of iets anders als iemand de URL
// met de hand samenstelt. safeInternalPath moet voor elke vorm een veilig,
// voorspelbaar antwoord geven — een intern pad, of anders null.
describe('safeInternalPath', () => {
  it('geeft een intern pad terug', () => {
    expect(safeInternalPath('/app')).toBe('/app')
  })

  it('wijst een absolute externe URL af', () => {
    expect(safeInternalPath('https://evil.example')).toBeNull()
  })

  it('wijst een protocol-relatieve URL met twee slashes af', () => {
    expect(safeInternalPath('//evil.example')).toBeNull()
  })

  // Het gat dat de review vond: begint met precies één slash, gevolgd door
  // een backslash. Een handgeschreven `!startsWith('//')` mist dit, maar een
  // browser behandelt het als protocol-relatief.
  it('wijst een protocol-relatieve URL met een backslash af', () => {
    expect(safeInternalPath('/\\evil.example')).toBeNull()
  })

  // Zelfde gat, met een tab tussen de twee scheidingstekens.
  it('wijst een protocol-relatieve URL met een tab af', () => {
    expect(safeInternalPath('/\t/evil.example')).toBeNull()
  })

  it('wijst een array af', () => {
    expect(safeInternalPath(['/app'])).toBeNull()
  })

  it('wijst een getal af', () => {
    expect(safeInternalPath(42)).toBeNull()
  })
})
