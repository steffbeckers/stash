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

  // Bevinding 2 van de eindreview: elke RLS-negatieftest dekte tot nu toe
  // alleen SELECT. household_member heeft geen INSERT- of UPDATE-policy —
  // schrijven wordt vandaag alleen geweigerd omdat er geen enkele policy
  // bestaat die het toestaat ("bescherming door afwezigheid"), niet omdat
  // een policy het expliciet blokkeert. Dat verdwijnt stilletjes zodra iemand
  // ooit een permissieve policy toevoegt. Deze drie tests dekken dat gat en
  // zijn stuk voor stuk aantoonbaar dragend (zie het eindrapport voor de
  // rood/groen-bewijsvoering per test).

  it('een buitenstaander kan zichzelf niet toevoegen aan andermans huishouden', async () => {
    const owner = await createUser('eigenaar-schrijf@example.com')
    const outsider = await createUser('indringer-lid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Gesloten huis')`

      await actAs(tx, outsider)
      await enableRls(tx)
      // Savepoint isoleert de mislukte insert van de rest van de transactie:
      // zie create-household.test.ts voor de volledige uitleg.
      await expect(
        tx.savepoint(
          (sp) => sp`
            insert into household_member (household_id, user_id, role)
            values (${hh!.create_household}, ${outsider}, 'member')
          `,
        ),
      ).rejects.toThrow()

      await tx`reset role`
      const rows = await tx`
        select 1 from household_member
        where household_id = ${hh!.create_household} and user_id = ${outsider}
      `
      expect(rows.length).toBe(0)
    })
  })

  it('een gewoon lid kan zichzelf niet tot eigenaar promoveren', async () => {
    const owner = await createUser('eigenaar-promo@example.com')
    const member = await createUser('lid-promo@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const [inv] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 5)
      `

      await actAs(tx, member)
      await tx`select accept_invite(${inv!.create_invite})`

      await enableRls(tx)
      // Geen INSERT/UPDATE-policy op household_member: RLS geeft hier geen
      // fout maar raakt nul rijen, net als bij de UPDATE/DELETE-voorbeelden
      // op household elders in deze suite.
      const updated = await tx`
        update household_member set role = 'owner'
        where household_id = ${hh!.create_household} and user_id = ${member}
      `
      expect(updated.count).toBe(0)

      await tx`reset role`
      const rows = await tx<{ role: string }[]>`
        select role from household_member
        where household_id = ${hh!.create_household} and user_id = ${member}
      `
      expect(rows[0]!.role).toBe('member')
    })
  })

  // Dit dekt meteen ook het gat dat de eindreview aanwees: de DELETE-policy op
  // household_member ("eigenaars mogen leden verwijderen") had geen enkele
  // test die een buitenstaander- of niet-eigenaarpoging afwees.
  it('een gewoon lid kan een ander lid niet verwijderen', async () => {
    const owner = await createUser('eigenaar-del@example.com')
    const memberA = await createUser('lid-a-del@example.com')
    const memberB = await createUser('lid-b-del@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`

      const [inv1] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 5)
      `
      await actAs(tx, memberA)
      await tx`select accept_invite(${inv1!.create_invite})`

      await actAs(tx, owner)
      const [inv2] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 5)
      `
      await actAs(tx, memberB)
      await tx`select accept_invite(${inv2!.create_invite})`

      await actAs(tx, memberA)
      await enableRls(tx)
      const deleted = await tx`
        delete from household_member
        where household_id = ${hh!.create_household} and user_id = ${memberB}
      `
      expect(deleted.count).toBe(0)

      await tx`reset role`
      const rows = await tx`
        select 1 from household_member
        where household_id = ${hh!.create_household} and user_id = ${memberB}
      `
      expect(rows.length).toBe(1)
    })
  })
})
