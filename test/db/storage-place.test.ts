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

  // De UPDATE- en DELETE-policies op storage_place hadden geen enkele test.
  // Ze zijn niet fout, maar ongetoetst: niets zou opvallen als ze wegvielen.
  // Eerst het positieve geval, anders is een suite die alles weigert ook groen.
  it('een lid mag een bewaarplaats hernoemen en verwijderen', async () => {
    const userId = await createUser('lid-plaats@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      await enableRls(tx)

      const renamed = await tx`
        update storage_place set name = 'Kelder'
        where household_id = ${hh!.create_household} and kind = 'pantry'
        returning id
      `
      expect(renamed.length).toBe(1)

      const removed = await tx`
        delete from storage_place
        where household_id = ${hh!.create_household} and kind = 'freezer'
        returning id
      `
      expect(removed.length).toBe(1)
    })
  })

  // Een UPDATE of DELETE met een WHERE of RETURNING leest kolommen, en dan
  // past PostgreSQL óók de SELECT-policy toe. Zo'n test wordt dus groen
  // gehouden door de leespolicy en bewijst niets over de schrijfpolicy: met de
  // UPDATE-policy op using(true) bleef hij gewoon groen. Pas toen de
  // SELECT-policy óók openging, werd hij rood.
  //
  // Een kale schrijfopdracht zonder WHERE en zonder RETURNING leest niets. Dan
  // beslist alleen de USING van de schrijfpolicy welke rijen meegaan — en dat
  // is precies de aanval die telt: niet één rij kapen, maar de hele tabel.
  it('een buitenstaander kan andermans bewaarplaatsen niet overschrijven', async () => {
    const owner = await createUser('eigenaar-wijzig@example.com')
    const outsider = await createUser('indringer-wijzig@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      await tx`select create_household('Huis')`

      await actAs(tx, outsider)
      await enableRls(tx)
      await tx`update storage_place set name = 'Gekaapt'`

      await tx`reset role`
      const rows = await tx<{ name: string }[]>`select name from storage_place`
      expect(rows.length).toBe(3)
      expect(rows.some((r) => r.name === 'Gekaapt')).toBe(false)
    })
  })

  it('een buitenstaander kan andermans bewaarplaatsen niet leegvegen', async () => {
    const owner = await createUser('eigenaar-verwijder@example.com')
    const outsider = await createUser('indringer-verwijder@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      await tx`select create_household('Huis')`

      await actAs(tx, outsider)
      await enableRls(tx)
      await tx`delete from storage_place`

      await tx`reset role`
      const [count] = await tx<{ n: number }[]>`select count(*)::int as n from storage_place`
      expect(count!.n).toBe(3)
    })
  })
})
