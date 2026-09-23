import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('rechten', () => {
  beforeEach(resetDb)

  it('een gebruiker kan zichzelf geen moderator maken', async () => {
    const userId = await createUser('sluw@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      // Savepoint isoleert de mislukte update van de rest van de transactie:
      // zie create-household.test.ts voor de volledige uitleg.
      await expect(
        tx.savepoint(
          (sp) => sp`update user_profile set role = 'moderator' where user_id = ${userId}`,
        ),
      ).rejects.toThrow()
    })
  })

  it('een gebruiker kan zijn eigen vertrouwensniveau niet verhogen', async () => {
    const userId = await createUser('gretig@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      // Zelfde reden als hierboven: savepoint isoleert de mislukte update.
      await expect(
        tx.savepoint((sp) => sp`update user_profile set trust_level = 3 where user_id = ${userId}`),
      ).rejects.toThrow()
    })
  })

  it('een gebruiker mag wel zijn weergavenaam wijzigen', async () => {
    const userId = await createUser('naam@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await tx`update user_profile set display_name = 'Steff' where user_id = ${userId}`

      const [row] = await tx<{ display_name: string }[]>`
        select display_name from user_profile where user_id = ${userId}
      `
      expect(row!.display_name).toBe('Steff')
    })
  })

  it('de laatste eigenaar kan het huishouden niet verlaten', async () => {
    const userId = await createUser('laatste@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`

      // Zelfde reden als hierboven: savepoint isoleert de mislukte delete.
      await expect(
        tx.savepoint(
          (sp) => sp`
            delete from household_member
            where household_id = ${hh!.create_household} and user_id = ${userId}
          `,
        ),
      ).rejects.toThrow()
    })
  })

  it('een eigenaar kan wel weg als er een tweede eigenaar is', async () => {
    const first = await createUser('een@example.com')
    const second = await createUser('twee@example.com')

    await withTx(async (tx) => {
      await actAs(tx, first)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const id = hh!.create_household

      await tx`
        insert into household_member (household_id, user_id, role)
        values (${id}, ${second}, 'owner')
      `
      await tx`delete from household_member where household_id = ${id} and user_id = ${first}`

      const rows = await tx`select 1 from household_member where household_id = ${id}`
      expect(rows.length).toBe(1)
    })
  })

  it('anon mag geen enkele huishoudfunctie aanroepen', async () => {
    await withTx(async (tx) => {
      const [row] = await tx<{ f: string; anon: boolean; auth: boolean }[]>`
        select 'create_household' as f,
               has_function_privilege('anon', 'create_household(text)', 'execute') as anon,
               has_function_privilege('authenticated', 'create_household(text)', 'execute') as auth
      `
      expect(row!.anon).toBe(false)
      expect(row!.auth).toBe(true)
    })
  })

  it('een huishouden opheffen werkt ondanks de eigenaarstrigger', async () => {
    const userId = await createUser('opheffen@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Weg')`

      await tx`delete from household where id = ${hh!.create_household}`

      const rows = await tx`select 1 from household_member where household_id = ${hh!.create_household}`
      expect(rows.length).toBe(0)
    })
  })
})
