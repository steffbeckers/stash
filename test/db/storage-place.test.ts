import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb } from './helpers'

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
})
