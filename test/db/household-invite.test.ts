import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('uitnodigingen', () => {
  beforeEach(resetDb)

  it('een uitgenodigde wordt lid', async () => {
    const owner = await createUser('eigenaar@example.com')
    const guest = await createUser('gast@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const [inv] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 5)
      `

      await actAs(tx, guest)
      await tx`select accept_invite(${inv!.create_invite})`

      const members = await tx<{ role: string }[]>`
        select role from household_member
        where household_id = ${hh!.create_household} and user_id = ${guest}
      `
      expect(members[0]!.role).toBe('member')
    })
  })

  it('weigert een verlopen uitnodiging', async () => {
    const owner = await createUser('eig2@example.com')
    const guest = await createUser('gast2@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const [inv] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 5)
      `
      await tx`
        update household_invite set expires_at = now() - interval '1 day'
        where token = ${inv!.create_invite}
      `

      await actAs(tx, guest)
      // Savepoint isoleert de mislukte oproep van de rest van de transactie:
      // postgres.js registreert anders een fouttracker op het omringende
      // begin()-blok die withTx laat mislukken, ook al vangt expect() de
      // afwijzing hier al af.
      await expect(
        tx.savepoint((sp) => sp`select accept_invite(${inv!.create_invite})`),
      ).rejects.toThrow()
    })
  })

  it('weigert een uitnodiging waarvan het gebruik op is', async () => {
    const owner = await createUser('eig3@example.com')
    const guest = await createUser('gast3@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const [inv] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 1)
      `
      await tx`update household_invite set uses = 1 where token = ${inv!.create_invite}`

      await actAs(tx, guest)
      // Zelfde reden als hierboven: savepoint isoleert de mislukte oproep.
      await expect(
        tx.savepoint((sp) => sp`select accept_invite(${inv!.create_invite})`),
      ).rejects.toThrow()
    })
  })

  it('alleen een eigenaar mag uitnodigen', async () => {
    const owner = await createUser('eig4@example.com')
    const member = await createUser('lid4@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const [inv] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 5)
      `

      await actAs(tx, member)
      await tx`select accept_invite(${inv!.create_invite})`

      // Zelfde reden als hierboven: savepoint isoleert de mislukte oproep.
      await expect(
        tx.savepoint((sp) => sp`select create_invite(${hh!.create_household}::uuid, 7, 5)`),
      ).rejects.toThrow()
    })
  })

  // Deze test dekt een gat dat de review van taak 7 blootlegde: de
  // `revoke all` / `grant execute`-regels onder aan de migratie worden door
  // geen enkele test aangeraakt, omdat alle andere tests als superuser draaien.
  // Verwijder die grant en de app breekt voor echte gebruikers terwijl de
  // suite groen blijft.
  it('alleen ingelogde gebruikers mogen de uitnodigingsfuncties aanroepen', async () => {
    await withTx(async (tx) => {
      const [row] = await tx<{ can_auth: boolean; can_anon: boolean }[]>`
        select
          has_function_privilege('authenticated', 'create_invite(uuid, int, int)', 'execute') as can_auth,
          has_function_privilege('anon',          'create_invite(uuid, int, int)', 'execute') as can_anon
      `
      expect(row!.can_auth).toBe(true)
      expect(row!.can_anon).toBe(false)
    })
  })

  it('een gewoon lid ziet de uitnodigingen van het huishouden niet', async () => {
    const owner = await createUser('eig6@example.com')
    const member = await createUser('lid6@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const [inv] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 5)
      `

      await actAs(tx, member)
      await tx`select accept_invite(${inv!.create_invite})`

      // Vanaf hier onder RLS: alleen eigenaars mogen uitnodigingen zien.
      await enableRls(tx)
      const rows = await tx`select id from household_invite`
      expect(rows.length).toBe(0)
    })
  })

  // Bevinding 2 van de eindreview: household_invite heeft geen INSERT- of
  // UPDATE-policy. Schrijven wordt vandaag alleen geweigerd omdat er geen
  // enkele policy bestaat die het toestaat ("bescherming door afwezigheid"),
  // niet omdat een policy het expliciet blokkeert — dat verdwijnt stilletjes
  // zodra iemand ooit een permissieve policy toevoegt. Deze twee tests dekken
  // dat gat.

  it('een buitenstaander kan geen uitnodiging met een zelfgekozen token invoegen', async () => {
    const owner = await createUser('eig-token@example.com')
    const outsider = await createUser('indringer-token@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`

      await actAs(tx, outsider)
      await enableRls(tx)
      // Savepoint isoleert de mislukte insert van de rest van de transactie:
      // zie create-household.test.ts voor de volledige uitleg.
      await expect(
        tx.savepoint(
          (sp) => sp`
            insert into household_invite (household_id, token, created_by, expires_at, max_uses)
            values (${hh!.create_household}, 'zelfgekozen-token', ${outsider}, now() + interval '7 days', 5)
          `,
        ),
      ).rejects.toThrow()

      await tx`reset role`
      const rows = await tx`select 1 from household_invite where token = 'zelfgekozen-token'`
      expect(rows.length).toBe(0)
    })
  })

  it('een buitenstaander kan het gebruikstelraam van een uitnodiging niet resetten', async () => {
    const owner = await createUser('eig-uses@example.com')
    const outsider = await createUser('indringer-uses@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const [inv] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 1)
      `
      await tx`update household_invite set uses = 1 where token = ${inv!.create_invite}`

      await actAs(tx, outsider)
      await enableRls(tx)
      // Geen INSERT/UPDATE-policy op household_invite: RLS geeft hier geen
      // fout maar raakt nul rijen, net als bij de UPDATE/DELETE-voorbeelden
      // op household elders in deze suite.
      const updated = await tx`update household_invite set uses = 0 where token = ${inv!.create_invite}`
      expect(updated.count).toBe(0)

      await tx`reset role`
      const [row] = await tx<{ uses: number }[]>`
        select uses from household_invite where token = ${inv!.create_invite}
      `
      expect(row!.uses).toBe(1)
    })
  })

  it('tweemaal accepteren verandert niets', async () => {
    const owner = await createUser('eig5@example.com')
    const guest = await createUser('gast5@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const [inv] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 5)
      `

      await actAs(tx, guest)
      await tx`select accept_invite(${inv!.create_invite})`
      await tx`select accept_invite(${inv!.create_invite})`

      const members = await tx`
        select 1 from household_member
        where household_id = ${hh!.create_household} and user_id = ${guest}
      `
      expect(members.length).toBe(1)

      const [row] = await tx<{ uses: number }[]>`
        select uses from household_invite where token = ${inv!.create_invite}
      `
      expect(row!.uses).toBe(1)
    })
  })
})
