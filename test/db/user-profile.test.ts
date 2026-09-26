import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('user_profile', () => {
  beforeEach(resetDb)

  it('ontstaat automatisch bij een nieuwe gebruiker', async () => {
    const userId = await createUser('nieuw@example.com')
    await withTx(async (tx) => {
      const rows = await tx`select * from user_profile where user_id = ${userId}`
      expect(rows.length).toBe(1)
    })
  })

  it('start op trust_level 0 en rol user', async () => {
    const userId = await createUser('start@example.com')
    await withTx(async (tx) => {
      const rows = await tx<{ trust_level: number; role: string }[]>`
        select trust_level, role from user_profile where user_id = ${userId}
      `
      expect(rows[0]!.trust_level).toBe(0)
      expect(rows[0]!.role).toBe('user')
    })
  })

  it('verdwijnt wanneer de gebruiker verdwijnt', async () => {
    const userId = await createUser('weg@example.com')
    await withTx(async (tx) => {
      await tx`delete from auth.users where id = ${userId}`
      const rows = await tx`select * from user_profile where user_id = ${userId}`
      expect(rows.length).toBe(0)
    })
  })

  // De ledenlijst rendert display_name ongefilterd. Zonder bovengrens kan
  // één gebruiker de layout van iedereen in zijn huishouden breken — en dat
  // is precies de belofte die e2e/mobile.spec.ts hard maakt.
  it('weigert een weergavenaam van meer dan 60 tekens', async () => {
    const userId = await createUser('te-lang@example.com')
    await withDb(async (sql) => {
      await expect(
        sql`update user_profile set display_name = ${'a'.repeat(61)} where user_id = ${userId}`,
      ).rejects.toThrow(/display_name_length/)
    })
  })

  // De falsificatie van de test hierboven: zonder dit geval zou een
  // constraint van `<= 0` ook slagen, en dan was élke naam geweigerd.
  it('laat een weergavenaam van precies 60 tekens toe', async () => {
    const userId = await createUser('grens@example.com')
    await withDb(async (sql) => {
      await sql`update user_profile set display_name = ${'a'.repeat(60)} where user_id = ${userId}`
      const [row] = await sql<{ display_name: string | null }[]>`
        select display_name from user_profile where user_id = ${userId}
      `
      expect(row!.display_name).toHaveLength(60)
    })
  })

  // De twee tests hieronder draaien wel onder RLS. Zonder hen zou deze suite
  // even groen zijn met `enable row level security` volledig weggehaald — en
  // dan bewijst ze niets over de policies die de tabel beschermen.

  it('laat een gebruiker het profiel van iemand anders niet wijzigen', async () => {
    const mine = await createUser('mijn-profiel@example.com')
    const theirs = await createUser('ander-profiel@example.com')

    await withTx(async (tx) => {
      await actAs(tx, mine)
      await enableRls(tx)
      const result = await tx`
        update user_profile set display_name = 'gekaapt' where user_id = ${theirs}
      `
      // RLS geeft hier geen fout maar raakt nul rijen; dat is het bewijs.
      expect(result.count).toBe(0)
    })

    await withDb(async (sql) => {
      const [row] = await sql<{ display_name: string | null }[]>`
        select display_name from user_profile where user_id = ${theirs}
      `
      expect(row!.display_name).toBeNull()
    })
  })

  it('laat profielen lezen door andere ingelogde gebruikers', async () => {
    const mine = await createUser('lezer@example.com')
    const theirs = await createUser('gelezene@example.com')

    await withTx(async (tx) => {
      await actAs(tx, mine)
      await enableRls(tx)
      const rows = await tx`select user_id from user_profile where user_id = ${theirs}`
      // De select-policy is `to authenticated using (true)`: elke ingelogde
      // gebruiker mag elk profiel lezen, want weergavenamen zijn publiek
      // binnen de app. Zie de test hieronder voor de grens: anon mag dit niet.
      expect(rows.length).toBe(1)
    })
  })

  // Bevinding 1 van de eindreview van plan 1: deze policy had geen
  // `to authenticated` (rol was {public}) en anon — de rol van de publieke
  // anon-sleutel die standaard in de browserbundel zit — kon zo de hele
  // gebruikersregistratie uitlezen via GET /rest/v1/user_profile?select=*:
  // user_id, display_name, trust_level en role van iedereen. Zonder deze
  // test kan die grens weer stilletjes verdwijnen.
  it('laat anon geen enkel profiel lezen', async () => {
    const theirs = await createUser('anoniem-doelwit@example.com')

    await withTx(async (tx) => {
      await enableRls(tx, 'anon')
      const rows = await tx`select user_id from user_profile where user_id = ${theirs}`
      expect(rows.length).toBe(0)
    })
  })
})
