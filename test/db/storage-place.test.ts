import { describe, it, expect, beforeEach } from 'vitest'
import { withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('bewaarplaatsen', () => {
  beforeEach(resetDb)

  it('een nieuw huishouden krijgt drie standaardplaatsen', async () => {
    const userId = await createUser('plaats@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`

      const rows = await tx<{ kind: string }[]>`
        select kind from storage_place where household_id = ${hh!.create_household} order by kind
      `
      expect(rows.map((r) => r.kind)).toEqual(['freezer', 'fridge', 'pantry'])
    })
  })

  it('weigert een onbekend soort', async () => {
    const userId = await createUser('soort@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`

      // In een savepoint, niet rechtstreeks op tx: postgres.js registreert op
      // elke query binnen een begin()-blok een eigen .catch() om de transactie
      // te bewaken. Die registratie gebeurt ook als expect().rejects de
      // afwijzing hier al afhandelt, en zou na deze test de hele withTx laten
      // mislukken met exact deze fout - ook al is er niets meer fout. Een
      // savepoint isoleert dat: de mislukking rolt terug tot het savepoint,
      // niet tot het begin van de transactie.
      await expect(
        tx.savepoint(
          (sp) => sp`
            insert into storage_place (household_id, name, kind)
            values (${hh!.create_household}, 'Zolder', 'attic')
          `,
        ),
      ).rejects.toThrow()
    })
  })

  it('verbergt de plaatsen van een ander huishouden', async () => {
    const mine = await createUser('mijn@example.com')
    const theirs = await createUser('hun@example.com')

    await withTx(async (tx) => {
      await actAs(tx, theirs)
      await tx`select create_household('Hun huis')`

      await actAs(tx, mine)
      await enableRls(tx)
      const rows = await tx`select id from storage_place`
      expect(rows.length).toBe(0)
    })
  })

  // Bevinding 2 van de eindreview: dit is, anders dan household_member en
  // household_invite hierboven/verderop, geen "bescherming door afwezigheid"
  // — storage_place heeft al een echte INSERT-policy
  // ("leden mogen bewaarplaatsen aanmaken", with check is_household_member).
  // Er was er alleen nog geen test die een buitenstaander expliciet
  // tegenhoudt; deze test dekt dat.
  it('een buitenstaander kan geen bewaarplaats aanmaken voor andermans huishouden', async () => {
    const owner = await createUser('eigenaar-plaats@example.com')
    const outsider = await createUser('indringer-plaats@example.com')

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
            insert into storage_place (household_id, name, kind)
            values (${hh!.create_household}, 'Indringerskast', 'pantry')
          `,
        ),
      ).rejects.toThrow()

      await tx`reset role`
      const rows = await tx`
        select 1 from storage_place
        where household_id = ${hh!.create_household} and name = 'Indringerskast'
      `
      expect(rows.length).toBe(0)
    })
  })
})
