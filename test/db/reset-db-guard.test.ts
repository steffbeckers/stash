import { describe, it, expect, vi, afterEach } from 'vitest'
import { assertLocalDatabase } from './helpers'

// Bevinding 8 van de eindreview van plan 1: resetDb() truncate't elke tabel
// in public plus auth.users cascade tegen wat DATABASE_URL toevallig ook is.
// Plan 8 heeft .env straks nodig gericht op het gehoste project; zonder deze
// guard vernietigt één npm run test:db dat project. Deze tests draaien niet
// tegen een echte database — ze bewijzen alleen dat de guard zelf, vóór er
// ook maar verbonden wordt, de juiste hosts onderscheidt.
describe('assertLocalDatabase', () => {
  it('laat localhost toe', () => {
    expect(() => assertLocalDatabase('postgresql://postgres:postgres@localhost:54322/postgres')).not.toThrow()
  })

  it('laat 127.0.0.1 toe', () => {
    expect(() => assertLocalDatabase('postgresql://postgres:postgres@127.0.0.1:54322/postgres')).not.toThrow()
  })

  it('weigert een gehost Supabase-project', () => {
    expect(() =>
      assertLocalDatabase('postgresql://postgres:wachtwoord@db.abcdefghijkl.supabase.co:5432/postgres'),
    ).toThrow(/localhost|127\.0\.0\.1/)
  })

  it('weigert een willekeurige externe host', () => {
    expect(() => assertLocalDatabase('postgresql://user:pass@example.com:5432/postgres')).toThrow()
  })
})

// Elke helper die verbindt, niet alleen resetDb(): createUser en withTx
// schrijven ook, en de e2e laadt dit bestand. `url` wordt bij het importeren
// gelezen, dus elke test laadt de module opnieuw met een niet-lokale host.
// postgres is vervangen: een helper die toch verbindt, valt op in plaats van
// tegen example.com te blijven hangen.
describe('elke databasehelper weigert een niet-lokale host', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.doUnmock('postgres')
    vi.resetModules()
  })

  async function helpersTegenExterneHost() {
    vi.stubEnv('DATABASE_URL', 'postgresql://u:p@example.com/db')
    const verbindingen: string[] = []
    vi.doMock('postgres', () => ({
      default: (url: string) => {
        verbindingen.push(url)
        throw new Error(`zou verbinden met ${url}`)
      },
    }))
    vi.resetModules()
    const helpers = await import('./helpers')
    return { helpers, verbindingen }
  }

  const melding = /De databasehelpers weigeren te draaien tegen host "example\.com"/

  it('createUser', async () => {
    const { helpers, verbindingen } = await helpersTegenExterneHost()
    await expect(helpers.createUser('x@example.com')).rejects.toThrow(melding)
    expect(verbindingen).toEqual([])
  })

  it('withTx', async () => {
    const { helpers, verbindingen } = await helpersTegenExterneHost()
    await expect(helpers.withTx(async () => {})).rejects.toThrow(melding)
    expect(verbindingen).toEqual([])
  })

  it('withTwoConnections', async () => {
    const { helpers, verbindingen } = await helpersTegenExterneHost()
    await expect(helpers.withTwoConnections(async () => {})).rejects.toThrow(melding)
    expect(verbindingen).toEqual([])
  })

  it('resetDb', async () => {
    const { helpers, verbindingen } = await helpersTegenExterneHost()
    await expect(helpers.resetDb()).rejects.toThrow(melding)
    expect(verbindingen).toEqual([])
  })
})
