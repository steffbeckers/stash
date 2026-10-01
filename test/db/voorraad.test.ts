import { describe, it, expect, beforeEach } from 'vitest'
import { withTx, actAs, enableRls, createUser, resetDb, type Sql } from './helpers'

describe('voorraad()', () => {
  beforeEach(resetDb)

  async function huishouden(tx: Sql, eigenaar: string): Promise<{ id: string; kast: string }> {
    await actAs(tx, eigenaar)
    const [hh] = await tx<{ id: string }[]>`select create_household('Thuis') as id`
    const [kast] = await tx<{ id: string }[]>`
      select id from storage_place where household_id = ${hh!.id} and kind = 'pantry'
    `
    return { id: hh!.id, kast: kast!.id }
  }

  async function product(tx: Sql, namen: Record<string, string>): Promise<string> {
    const [p] = await tx<{ id: string }[]>`insert into product default values returning id`
    for (const [taal, naam] of Object.entries(namen)) {
      await tx`
        insert into product_translation (product_id, locale, name, source)
        values (${p!.id}, ${taal}, ${naam}, 'user')
      `
    }
    return p!.id
  }

  async function item(tx: Sql, hh: { id: string; kast: string }, productId: string): Promise<string> {
    const [i] = await tx<{ id: string }[]>`
      insert into inventory_item (household_id, product_id, storage_place_id)
      values (${hh.id}, ${productId}, ${hh.kast})
      returning id
    `
    return i!.id
  }

  it('geeft alleen wat in voorraad is', async () => {
    const eigenaar = await createUser('alleen-voorraad@example.com')
    await withTx(async (tx) => {
      const hh = await huishouden(tx, eigenaar)
      const p = await product(tx, { nl: 'Passata' })
      const blijft = await item(tx, hh, p)
      const weg = await item(tx, hh, p)
      await tx`
        update inventory_item set status = 'closed', closed_at = now(), closed_reason = 'consumed'
         where id = ${weg}
      `
      await actAs(tx, eigenaar)
      await enableRls(tx)
      const rows = await tx<{ id: string }[]>`select id from voorraad(${hh.id}, 'nl')`
      expect(rows.map((r) => r.id)).toEqual([blijft])
    })
  })

  // Invoker is hier de bewaking: RLS beslist. Een definer-functie zou als
  // eigenaar van de tabel RLS omzeilen.
  it('een lid ziet zijn voorraad, een buitenstaander krijgt een lege lijst', async () => {
    const eigenaar = await createUser('voorraad-lid@example.com')
    const vreemde = await createUser('voorraad-vreemd@example.com')
    await withTx(async (tx) => {
      const hh = await huishouden(tx, eigenaar)
      await item(tx, hh, await product(tx, { nl: 'Passata' }))
      await enableRls(tx)

      await actAs(tx, eigenaar)
      expect((await tx`select id from voorraad(${hh.id}, 'nl')`).length).toBe(1)

      await actAs(tx, vreemde)
      expect((await tx`select id from voorraad(${hh.id}, 'nl')`).length).toBe(0)
    })
  })

  // Nederlands en Engels: zonder de voorkeurstak wint 'en' (dat sorteert
  // alfabetisch vóór 'nl'), dus deze test ziet het verschil.
  it('toont de naam in de voorkeurstaal en meldt die taal', async () => {
    const eigenaar = await createUser('voorraad-taal@example.com')
    await withTx(async (tx) => {
      const hh = await huishouden(tx, eigenaar)
      await item(tx, hh, await product(tx, { nl: 'Halfvolle melk', en: 'Semi-skimmed milk' }))
      await actAs(tx, eigenaar)
      await enableRls(tx)
      const [r] = await tx<{ naam: string; getoonde_taal: string }[]>`
        select naam, getoonde_taal from voorraad(${hh.id}, 'nl')
      `
      expect(r).toEqual({ naam: 'Halfvolle melk', getoonde_taal: 'nl' })
    })
  })

  // Legt het gedrag vast, maar bewijst de 'en'-tak van de keten níet: bij de
  // talen en, fr en nl sorteert 'en' alfabetisch toch al eerst, dus zonder
  // die tak komt hier hetzelfde uit. Zie de bevinding daarover in
  // docs/superpowers/open-bevindingen.md.
  it('valt terug op een andere taal en meldt welke', async () => {
    const eigenaar = await createUser('voorraad-terugval@example.com')
    await withTx(async (tx) => {
      const hh = await huishouden(tx, eigenaar)
      await item(tx, hh, await product(tx, { en: 'Semi-skimmed milk' }))
      await actAs(tx, eigenaar)
      await enableRls(tx)
      const [r] = await tx<{ naam: string; getoonde_taal: string }[]>`
        select naam, getoonde_taal from voorraad(${hh.id}, 'nl')
      `
      expect(r).toEqual({ naam: 'Semi-skimmed milk', getoonde_taal: 'en' })
    })
  })
})
