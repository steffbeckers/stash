import { describe, it, expect, beforeEach } from 'vitest'
import { withTx, actAs, createUser, resetDb, type Sql } from './helpers'

// Hulpjes voor de hele voorraadsuite. Ze zaaien als superuser; wie daarna RLS
// aanzet met enableRls(), moet `reset role` doen vóór hij nog iets zaait.

interface Huishouden {
  id: string
  plaats: (kind: 'pantry' | 'fridge' | 'freezer') => string
}

async function maakHuishouden(tx: Sql, eigenaar: string, naam = 'Thuis'): Promise<Huishouden> {
  await actAs(tx, eigenaar)
  const [hh] = await tx<{ id: string }[]>`select create_household(${naam}) as id`
  const plaatsen = await tx<{ id: string; kind: string }[]>`
    select id, kind from storage_place where household_id = ${hh!.id}
  `
  return { id: hh!.id, plaats: (kind) => plaatsen.find((p) => p.kind === kind)!.id }
}

async function maakProduct(tx: Sql, naam = 'Passata'): Promise<string> {
  const [p] = await tx<{ id: string }[]>`insert into product default values returning id`
  await tx`
    insert into product_translation (product_id, locale, name, source)
    values (${p!.id}, 'nl', ${naam}, 'user')
  `
  return p!.id
}

async function maakItem(tx: Sql, huishouden: string, product: string, plaats: string): Promise<string> {
  const [i] = await tx<{ id: string }[]>`
    insert into inventory_item (household_id, product_id, storage_place_id)
    values (${huishouden}, ${product}, ${plaats})
    returning id
  `
  return i!.id
}

/**
 * Streept af met alle velden die de samenhangcheck eist, met de hand. Werkt
 * vóór en ná de stempeltrigger van Taak 3: die overschrijft closed_at alleen
 * maar met een even geldige waarde.
 */
async function sluitAf(tx: Sql, item: string): Promise<void> {
  await tx`
    update inventory_item
       set status = 'closed', closed_at = now(), closed_reason = 'consumed'
     where id = ${item}
  `
}

/** De fout van een belofte, of null als ze slaagde. */
async function fout(belofte: Promise<unknown>): Promise<unknown> {
  try {
    await belofte
    return null
  } catch (oorzaak) {
    return oorzaak
  }
}

describe('inventory_item: schema', () => {
  beforeEach(resetDb)

  // De positieve helft van het paar hieronder: zonder dit geval is een FK die
  // élke plaats weigert net zo groen.
  it('laat een item toe in een plaats van het eigen huishouden', async () => {
    const eigenaar = await createUser('eigen-plaats@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))
      const rows = await tx`select 1 from inventory_item`
      expect(rows.length).toBe(1)
    })
  })

  // RLS controleert alleen household_id. Met een gewone FK op
  // storage_place(id) wijst een item in A probleemloos naar een plaats in B.
  it('weigert een plaats van een ander huishouden', async () => {
    const a = await createUser('a-plaats@example.com')
    const b = await createUser('b-plaats@example.com')
    await withTx(async (tx) => {
      const ha = await maakHuishouden(tx, a, 'A')
      const hb = await maakHuishouden(tx, b, 'B')
      const p = await maakProduct(tx)
      const e = await fout(
        tx.savepoint((sp) => sp`
          insert into inventory_item (household_id, product_id, storage_place_id)
          values (${ha.id}, ${p}, ${hb.plaats('pantry')})
        `),
      )
      expect(e).toMatchObject({ code: '23503', constraint_name: 'inventory_item_plaats_van_huishouden' })
    })
  })

  it('weigert een hoeveelheid van nul', async () => {
    const eigenaar = await createUser('nul@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      const e = await fout(
        tx.savepoint((sp) => sp`
          insert into inventory_item (household_id, product_id, storage_place_id, amount)
          values (${hh.id}, ${p}, ${hh.plaats('pantry')}, 0)
        `),
      )
      expect(e).toMatchObject({ constraint_name: 'inventory_item_hoeveelheid' })
    })
  })

  it('weigert een eenheid die we niet voeren', async () => {
    const eigenaar = await createUser('eenheid@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      const e = await fout(
        tx.savepoint((sp) => sp`
          insert into inventory_item (household_id, product_id, storage_place_id, unit)
          values (${hh.id}, ${p}, ${hh.plaats('pantry')}, 'stuks')
        `),
      )
      expect(e).toMatchObject({ constraint_name: 'inventory_item_eenheid' })
    })
  })

  it('weigert een item in voorraad zonder plaats', async () => {
    const eigenaar = await createUser('zonder-plaats@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      const e = await fout(
        tx.savepoint((sp) => sp`
          insert into inventory_item (household_id, product_id, storage_place_id)
          values (${hh.id}, ${p}, null)
        `),
      )
      expect(e).toMatchObject({ code: '23514', constraint_name: 'inventory_item_samenhang' })
    })
  })

  it('weigert een reden op een item dat nog in voorraad is', async () => {
    const eigenaar = await createUser('reden@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const item = await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))
      const e = await fout(
        tx.savepoint((sp) => sp`update inventory_item set closed_reason = 'consumed' where id = ${item}`),
      )
      expect(e).toMatchObject({ code: '23514', constraint_name: 'inventory_item_samenhang' })
    })
  })

  it('weigert een afstreping zonder reden', async () => {
    const eigenaar = await createUser('geen-reden@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const item = await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))
      const e = await fout(
        tx.savepoint((sp) => sp`
          update inventory_item set status = 'closed', closed_at = now() where id = ${item}
        `),
      )
      expect(e).toMatchObject({ code: '23514', constraint_name: 'inventory_item_samenhang' })
    })
  })

  // De positieve helft van de twee hierboven.
  it('laat een volledige afstreping toe', async () => {
    const eigenaar = await createUser('volledig@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const item = await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))
      await sluitAf(tx, item)
      const [r] = await tx<{ status: string }[]>`select status from inventory_item where id = ${item}`
      expect(r!.status).toBe('closed')
    })
  })

  // Spec §4: de blokkade is geen aparte regel. De FK zet storage_place_id op
  // null, en de samenhangcheck verbiedt null bij in_stock.
  it('weigert een plaats te verwijderen waar nog voorraad in ligt', async () => {
    const eigenaar = await createUser('plaats-vol@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('fridge'))
      const e = await fout(
        tx.savepoint((sp) => sp`delete from storage_place where id = ${hh.plaats('fridge')}`),
      )
      expect(e).toMatchObject({ code: '23514', constraint_name: 'inventory_item_samenhang' })
    })
  })

  // De andere helft: zonder dit geval is een FK die elke verwijdering
  // blokkeert (on delete no action) net zo groen als de echte regel.
  it('laat een plaats met alleen afgestreepte items verwijderen, en die items blijven', async () => {
    const eigenaar = await createUser('plaats-leeg@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const item = await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('fridge'))
      await sluitAf(tx, item)

      await tx`delete from storage_place where id = ${hh.plaats('fridge')}`

      const [r] = await tx<{ status: string; storage_place_id: string | null }[]>`
        select status, storage_place_id from inventory_item where id = ${item}
      `
      expect(r!.status).toBe('closed')
      expect(r!.storage_place_id).toBeNull()
    })
  })

  // De valkuil uit spec §4. Gemeten vóór dit plan (zie "Wat al gemeten is" in
  // het plan): de set null op de items vuurt pas nadat de cascade vanaf
  // household de items al verwijderd heeft, in beide aanmaakvolgordes van de
  // foreign keys. Deze test houdt dat zo. Gaat hij ooit rood, dan is het
  // ontwerp fout, niet de test.
  it('een huishouden met voorraad in meerdere plaatsen opheffen lukt', async () => {
    const eigenaar = await createUser('opheffen-voorraad@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      await maakItem(tx, hh.id, p, hh.plaats('pantry'))
      await maakItem(tx, hh.id, p, hh.plaats('fridge'))
      const afgestreept = await maakItem(tx, hh.id, p, hh.plaats('freezer'))
      await sluitAf(tx, afgestreept)

      await tx`delete from household where id = ${hh.id}`

      const rows = await tx`select 1 from inventory_item`
      expect(rows.length).toBe(0)
    })
  })
})
