import { describe, it, expect, beforeEach } from 'vitest'
import { withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('rollen wijzigen', () => {
  beforeEach(resetDb)

  it('een eigenaar kan een lid tot eigenaar promoveren', async () => {
    const owner = await createUser('promo-eigenaar@example.com')
    const member = await createUser('promo-lid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${member})`

      await enableRls(tx)
      await tx`select set_member_role(${id}::uuid, ${member}::uuid, 'owner')`

      await tx`reset role`
      const [row] = await tx<{ role: string }[]>`
        select role from household_member where household_id = ${id} and user_id = ${member}
      `
      expect(row!.role).toBe('owner')
    })
  })

  it('een gewoon lid kan zichzelf niet promoveren', async () => {
    const owner = await createUser('geen-promo-eigenaar@example.com')
    const member = await createUser('geen-promo-lid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${member})`

      await actAs(tx, member)
      await enableRls(tx)
      // Savepoint isoleert de mislukte oproep: zie create-household.test.ts.
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${member}::uuid, 'owner')`),
      ).rejects.toThrow()
    })
  })

  it('een buitenstaander kan niemand promoveren', async () => {
    const owner = await createUser('vreemde-eigenaar@example.com')
    const member = await createUser('vreemde-lid@example.com')
    const outsider = await createUser('vreemde@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      // Doelwit moet een echt lid zijn: mikt de test op de buitenstaander
      // zelf (die geen lid is), dan vangt de "not found"-controle de
      // oproep af en zegt de test niets over de eigenaarscontrole.
      await tx`insert into household_member (household_id, user_id) values (${id}, ${member})`

      await actAs(tx, outsider)
      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${member}::uuid, 'owner')`),
      ).rejects.toThrow()
    })
  })

  it('weigert een onbekende rol', async () => {
    const owner = await createUser('rol-eigenaar@example.com')
    const member = await createUser('rol-lid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${member})`

      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${member}::uuid, 'moderator')`),
      ).rejects.toThrow()
    })
  })

  it('weigert iemand die geen lid is', async () => {
    const owner = await createUser('nietlid-eigenaar@example.com')
    const stranger = await createUser('nietlid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household

      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${stranger}::uuid, 'owner')`),
      ).rejects.toThrow()
    })
  })

  it('de laatste eigenaar blijft beschermd tegen degraderen', async () => {
    const owner = await createUser('laatste-degradatie@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household

      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${owner}::uuid, 'member')`),
      ).rejects.toThrow()
    })
  })

  // Dit is de eigenlijke belofte uit spec §4: de laatste eigenaar zit niet
  // vast, maar moet eerst iemand anders promoveren.
  it('een eigenaar kan vertrekken nadat hij iemand anders heeft gepromoveerd', async () => {
    const first = await createUser('vertrek-eerste@example.com')
    const second = await createUser('vertrek-tweede@example.com')

    await withTx(async (tx) => {
      await actAs(tx, first)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${second})`

      await enableRls(tx)
      await tx`select set_member_role(${id}::uuid, ${second}::uuid, 'owner')`

      const left = await tx`
        delete from household_member where household_id = ${id} and user_id = ${first} returning user_id
      `
      expect(left.length).toBe(1)

      await tx`reset role`
      const [count] = await tx<{ n: number }[]>`
        select count(*)::int as n from household_member where household_id = ${id} and role = 'owner'
      `
      expect(count!.n).toBe(1)
    })
  })

  it('anon mag set_member_role niet aanroepen', async () => {
    await withTx(async (tx) => {
      await enableRls(tx, 'anon')
      await expect(
        tx.savepoint(
          (sp) => sp`select set_member_role(gen_random_uuid(), gen_random_uuid(), 'owner')`,
        ),
      ).rejects.toThrow()
    })
  })
})
