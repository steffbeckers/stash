import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('huishoudens en RLS', () => {
  beforeEach(resetDb)

  it('laat een lid zijn eigen huishouden zien', async () => {
    const userId = await createUser('lid@example.com')
    await withTx(async (tx) => {
      const [hh] = await tx<{ id: string }[]>`
        insert into household (name) values ('Thuis') returning id
      `
      await tx`
        insert into household_member (household_id, user_id, role)
        values (${hh!.id}, ${userId}, 'owner')
      `

      await actAs(tx, userId)
      await enableRls(tx)
      const rows = await tx`select id from household`
      expect(rows.length).toBe(1)
    })
  })

  it('verbergt het huishouden van iemand anders', async () => {
    const mine = await createUser('ik@example.com')
    const theirs = await createUser('ander@example.com')
    await withTx(async (tx) => {
      const [hh] = await tx<{ id: string }[]>`
        insert into household (name) values ('Van iemand anders') returning id
      `
      await tx`
        insert into household_member (household_id, user_id, role)
        values (${hh!.id}, ${theirs}, 'owner')
      `

      await actAs(tx, mine)
      await enableRls(tx)
      const rows = await tx`select id from household`
      expect(rows.length).toBe(0)
    })
  })

  it('is_household_member klopt voor leden en niet-leden', async () => {
    const member = await createUser('wel@example.com')
    const outsider = await createUser('niet@example.com')
    await withTx(async (tx) => {
      const [hh] = await tx<{ id: string }[]>`
        insert into household (name) values ('Test') returning id
      `
      await tx`
        insert into household_member (household_id, user_id, role)
        values (${hh!.id}, ${member}, 'owner')
      `

      await actAs(tx, member)
      const yes = await tx<{ r: boolean }[]>`select is_household_member(${hh!.id}) as r`
      expect(yes[0]!.r).toBe(true)

      await actAs(tx, outsider)
      const no = await tx<{ r: boolean }[]>`select is_household_member(${hh!.id}) as r`
      expect(no[0]!.r).toBe(false)
    })
  })
})
