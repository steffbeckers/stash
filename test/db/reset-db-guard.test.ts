import { describe, it, expect } from 'vitest'
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
