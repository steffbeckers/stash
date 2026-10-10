import { describe, it, expect, beforeEach } from 'vitest'
import { withTx, actAs, enableRls, createUser, resetDb, type Sql } from './helpers'

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

/** Maakt iemand lid van een bestaand huishouden, zonder de uitnodigingsflow. */
async function voegLidToe(tx: Sql, huishouden: string, lid: string): Promise<void> {
  await tx`
    insert into household_member (household_id, user_id, role)
    values (${huishouden}, ${lid}, 'member')
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

  it('weigert een onbekende afstreepreden', async () => {
    const eigenaar = await createUser('onbekende-reden@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      const e = await fout(
        tx.savepoint((sp) => sp`
          insert into inventory_item (household_id, product_id, storage_place_id, status, closed_at, closed_reason)
          values (${hh.id}, ${p}, ${hh.plaats('pantry')}, 'closed', now(), 'bogus')
        `),
      )
      expect(e).toMatchObject({ constraint_name: 'inventory_item_reden' })
    })
  })

  it('weigert een afstreping zonder tijdstip', async () => {
    const eigenaar = await createUser('geen-tijdstip@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      const e = await fout(
        tx.savepoint((sp) => sp`
          insert into inventory_item (household_id, product_id, storage_place_id, status, closed_at, closed_reason)
          values (${hh.id}, ${p}, ${hh.plaats('pantry')}, 'closed', null, 'consumed')
        `),
      )
      expect(e).toMatchObject({ code: '23514', constraint_name: 'inventory_item_samenhang' })
    })
  })

  it('weigert een tijdstip van afstrepen op een item dat nog in voorraad is', async () => {
    const eigenaar = await createUser('tijdstip-in-voorraad@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      const e = await fout(
        tx.savepoint((sp) => sp`
          insert into inventory_item (household_id, product_id, storage_place_id, closed_at)
          values (${hh.id}, ${p}, ${hh.plaats('pantry')}, now())
        `),
      )
      expect(e).toMatchObject({ code: '23514', constraint_name: 'inventory_item_samenhang' })
    })
  })

  it('weigert een afstreper op een item dat nog in voorraad is', async () => {
    const eigenaar = await createUser('afsteker-in-voorraad@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      const e = await fout(
        tx.savepoint((sp) => sp`
          insert into inventory_item (household_id, product_id, storage_place_id, closed_by)
          values (${hh.id}, ${p}, ${hh.plaats('pantry')}, ${eigenaar})
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
      const plaatsen = await tx`select 1 from storage_place where household_id = ${hh.id}`
      expect(plaatsen.length).toBe(0)
    })
  })
})

describe('inventory_item: rechten', () => {
  beforeEach(resetDb)

  it('een lid ziet de voorraad van zijn huishouden, een buitenstaander niet', async () => {
    const eigenaar = await createUser('ziet@example.com')
    const vreemde = await createUser('ziet-niet@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))

      await actAs(tx, eigenaar)
      await enableRls(tx)
      expect((await tx`select id from inventory_item`).length).toBe(1)

      await actAs(tx, vreemde)
      expect((await tx`select id from inventory_item`).length).toBe(0)
    })
  })

  it('een lid mag voorraad toevoegen', async () => {
    const eigenaar = await createUser('voegt-toe@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      await actAs(tx, eigenaar)
      await enableRls(tx)
      await tx`
        insert into inventory_item (household_id, product_id, storage_place_id)
        values (${hh.id}, ${p}, ${hh.plaats('pantry')})
      `
      await tx`reset role`
      expect((await tx`select 1 from inventory_item`).length).toBe(1)
    })
  })

  it('een buitenstaander kan geen voorraad toevoegen aan andermans huishouden', async () => {
    const eigenaar = await createUser('eigenaar-toevoegen@example.com')
    const vreemde = await createUser('vreemde-toevoegen@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      await actAs(tx, vreemde)
      await enableRls(tx)
      const e = await fout(
        tx.savepoint((sp) => sp`
          insert into inventory_item (household_id, product_id, storage_place_id)
          values (${hh.id}, ${p}, ${hh.plaats('pantry')})
        `),
      )
      expect(String(e)).toMatch(/row-level security/)
    })
  })

  // Spec geen-dubbele-toevoeging §4: de client kiest het id, zodat een nieuwe
  // poging op de primaire sleutel botst in plaats van een dubbel te maken.
  it('een lid mag een item toevoegen met een gekozen id', async () => {
    const eigenaar = await createUser('kiest-id@example.com')
    const gekozen = '00000000-0000-4000-8000-000000000001'
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      await actAs(tx, eigenaar)
      await enableRls(tx)
      await tx`
        insert into inventory_item (id, household_id, product_id, storage_place_id)
        values (${gekozen}, ${hh.id}, ${p}, ${hh.plaats('pantry')})
      `
      await tx`reset role`
      const rijen = await tx<{ id: string }[]>`select id from inventory_item`
      expect(rijen.map((r) => r.id)).toEqual([gekozen])
    })
  })

  it('een tweede insert met hetzelfde id botst op de primaire sleutel en maakt geen dubbel', async () => {
    const eigenaar = await createUser('dubbel-id@example.com')
    const gekozen = '00000000-0000-4000-8000-000000000002'
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      await actAs(tx, eigenaar)
      await enableRls(tx)
      const invoegen = (sql: Sql) => sql`
        insert into inventory_item (id, household_id, product_id, storage_place_id)
        values (${gekozen}, ${hh.id}, ${p}, ${hh.plaats('pantry')})
      `
      await invoegen(tx)
      await expect(tx.savepoint((sp) => invoegen(sp as unknown as Sql))).rejects.toThrow(/inventory_item_pkey/)
      await tx`reset role`
      expect((await tx`select 1 from inventory_item`).length).toBe(1)
    })
  })

  it('een buitenstaander kan ook met een gekozen id niets toevoegen', async () => {
    const eigenaar = await createUser('eigenaar-gekozen@example.com')
    const vreemde = await createUser('vreemde-gekozen@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      await actAs(tx, vreemde)
      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => (sp as unknown as Sql)`
          insert into inventory_item (id, household_id, product_id, storage_place_id)
          values ('00000000-0000-4000-8000-000000000003', ${hh.id}, ${p}, ${hh.plaats('pantry')})
        `),
      ).rejects.toThrow(/row-level security/)
    })
  })

  it('een lid mag zijn voorraad wijzigen', async () => {
    const eigenaar = await createUser('wijzigt@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const item = await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))
      await actAs(tx, eigenaar)
      await enableRls(tx)
      const rows = await tx`
        update inventory_item set expires_at = '2030-01-01' where id = ${item} returning id
      `
      expect(rows.length).toBe(1)
    })
  })

  // Kaal, zonder where en returning: zie de Global Constraints van het plan
  // en test/db/storage-place.test.ts.
  it('een buitenstaander kan andermans voorraad niet overschrijven', async () => {
    const eigenaar = await createUser('eigenaar-overschrijf@example.com')
    const vreemde = await createUser('vreemde-overschrijf@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))
      await actAs(tx, vreemde)
      await enableRls(tx)
      await tx`update inventory_item set expires_at = '2000-01-01'`
      await tx`reset role`
      const [r] = await tx<{ expires_at: string | null }[]>`select expires_at from inventory_item`
      expect(r!.expires_at).toBeNull()
    })
  })

  it('een lid mag voorraad verwijderen', async () => {
    const eigenaar = await createUser('verwijdert@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const item = await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))
      await actAs(tx, eigenaar)
      await enableRls(tx)
      const rows = await tx`delete from inventory_item where id = ${item} returning id`
      expect(rows.length).toBe(1)
    })
  })

  it('een buitenstaander kan andermans voorraad niet leegvegen', async () => {
    const eigenaar = await createUser('eigenaar-veeg@example.com')
    const vreemde = await createUser('vreemde-veeg@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))
      await actAs(tx, vreemde)
      await enableRls(tx)
      await tx`delete from inventory_item`
      await tx`reset role`
      expect((await tx`select 1 from inventory_item`).length).toBe(1)
    })
  })

  // De aanvaller is lid van béide huishoudens, zodat RLS hem niet al
  // tegenhoudt. Anders bewijst deze test niets over de FK (spec §9, punt 2).
  it('ook wie lid is van beide huishoudens kan geen plaats van het ene aan het andere geven', async () => {
    const l = await createUser('beide@example.com')
    const b = await createUser('alleen-b@example.com')
    await withTx(async (tx) => {
      const ha = await maakHuishouden(tx, l, 'A')
      const hb = await maakHuishouden(tx, b, 'B')
      await voegLidToe(tx, hb.id, l)
      const p = await maakProduct(tx)
      const item = await maakItem(tx, ha.id, p, ha.plaats('pantry'))

      await actAs(tx, l)
      await enableRls(tx)

      // De positieve kant: in B met een plaats van B mag het wél.
      await tx`
        insert into inventory_item (household_id, product_id, storage_place_id)
        values (${hb.id}, ${p}, ${hb.plaats('pantry')})
      `

      const bijInsert = await fout(
        tx.savepoint((sp) => sp`
          insert into inventory_item (household_id, product_id, storage_place_id)
          values (${ha.id}, ${p}, ${hb.plaats('pantry')})
        `),
      )
      expect(bijInsert).toMatchObject({ code: '23503', constraint_name: 'inventory_item_plaats_van_huishouden' })

      const bijUpdate = await fout(
        tx.savepoint((sp) => sp`
          update inventory_item set storage_place_id = ${hb.plaats('pantry')} where id = ${item}
        `),
      )
      expect(bijUpdate).toMatchObject({ code: '23503', constraint_name: 'inventory_item_plaats_van_huishouden' })
    })
  })

  // Plaats én huishouden worden samen verzet, zodat de FK klopt en de RLS-
  // check op B slaagt: alleen het ontbrekende kolomrecht houdt dit tegen.
  it('het huishouden van een item ligt vast, ook voor wie lid is van beide', async () => {
    const l = await createUser('verhuis@example.com')
    const b = await createUser('verhuis-b@example.com')
    await withTx(async (tx) => {
      const ha = await maakHuishouden(tx, l, 'A')
      const hb = await maakHuishouden(tx, b, 'B')
      await voegLidToe(tx, hb.id, l)
      const item = await maakItem(tx, ha.id, await maakProduct(tx), ha.plaats('pantry'))

      await actAs(tx, l)
      await enableRls(tx)
      const e = await fout(
        tx.savepoint((sp) => sp`
          update inventory_item
             set household_id = ${hb.id}, storage_place_id = ${hb.plaats('pantry')}
           where id = ${item}
        `),
      )
      expect(String(e)).toMatch(/permission denied/)
    })
  })

  // Een volledig geldige afgestreepte rij, zodat de samenhangcheck haar níet
  // tegenhoudt: alleen het ontbrekende insert-recht op status doet dat.
  it('een item begint altijd in voorraad', async () => {
    const eigenaar = await createUser('begint@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const p = await maakProduct(tx)
      await actAs(tx, eigenaar)
      await enableRls(tx)
      const e = await fout(
        tx.savepoint((sp) => sp`
          insert into inventory_item (household_id, product_id, storage_place_id, status, closed_at, closed_reason)
          values (${hh.id}, ${p}, ${hh.plaats('pantry')}, 'closed', now(), 'consumed')
        `),
      )
      expect(String(e)).toMatch(/permission denied/)
    })
  })

  it('afstreepstempels zijn niet met de hand te zetten', async () => {
    const eigenaar = await createUser('stempel@example.com')
    const ander = await createUser('stempel-ander@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const item = await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))
      await sluitAf(tx, item)

      await actAs(tx, eigenaar)
      await enableRls(tx)
      const opWie = await fout(
        tx.savepoint((sp) => sp`update inventory_item set closed_by = ${ander} where id = ${item}`),
      )
      expect(String(opWie)).toMatch(/permission denied/)
      const opWanneer = await fout(
        tx.savepoint((sp) => sp`update inventory_item set closed_at = '2000-01-01' where id = ${item}`),
      )
      expect(String(opWanneer)).toMatch(/permission denied/)
    })
  })

  // has_any_column_privilege: met rechten per kolom zegt has_table_privilege
  // 'insert' ook voor authenticated false, en dan bewijst een false voor anon
  // niets. Deze vraag is: kan anon aan ook maar één kolom?
  it('anon heeft geen enkel recht op de voorraad', async () => {
    await withTx(async (tx) => {
      const [r] = await tx<Record<string, boolean>[]>`
        select
          has_any_column_privilege('anon', 'inventory_item', 'select') as anon_select,
          has_any_column_privilege('anon', 'inventory_item', 'insert') as anon_insert,
          has_any_column_privilege('anon', 'inventory_item', 'update') as anon_update,
          has_table_privilege('anon', 'inventory_item', 'delete') as anon_delete,
          has_table_privilege('authenticated', 'inventory_item', 'select') as auth_select,
          has_column_privilege('authenticated', 'inventory_item', 'expires_at', 'update') as auth_update_vervaldatum,
          has_column_privilege('authenticated', 'inventory_item', 'household_id', 'update') as auth_update_huishouden
      `
      expect(r).toEqual({
        anon_select: false,
        anon_insert: false,
        anon_update: false,
        anon_delete: false,
        auth_select: true,
        auth_update_vervaldatum: true,
        auth_update_huishouden: false,
      })
    })
  })

  it('een eigenaar kan een huishouden met voorraad opheffen', async () => {
    const eigenaar = await createUser('opheffen-rls@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))
      await actAs(tx, eigenaar)
      await enableRls(tx)
      await tx`delete from household where id = ${hh.id}`
      await tx`reset role`
      expect((await tx`select 1 from inventory_item`).length).toBe(0)
    })
  })
})

describe('inventory_item: afstrepen', () => {
  beforeEach(resetDb)

  it('afstrepen vult zelf in wie en wanneer', async () => {
    const eigenaar = await createUser('afstreper@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const item = await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))
      await actAs(tx, eigenaar)
      await enableRls(tx)
      const [r] = await tx<{ closed_by: string | null; closed_at: Date | null; closed_reason: string }[]>`
        update inventory_item set status = 'closed', closed_reason = 'discarded'
         where id = ${item}
        returning closed_by, closed_at, closed_reason
      `
      expect(r!.closed_by).toBe(eigenaar)
      expect(r!.closed_at).not.toBeNull()
      expect(r!.closed_reason).toBe('discarded')
    })
  })

  it('ongedaan maken wist alle drie de afstreepvelden', async () => {
    const eigenaar = await createUser('ongedaan@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      const item = await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))
      await actAs(tx, eigenaar)
      await enableRls(tx)
      await tx`update inventory_item set status = 'closed', closed_reason = 'consumed' where id = ${item}`
      const [r] = await tx<{ status: string; closed_by: string | null; closed_at: Date | null; closed_reason: string | null }[]>`
        update inventory_item set status = 'in_stock' where id = ${item}
        returning status, closed_by, closed_at, closed_reason
      `
      expect(r).toEqual({ status: 'in_stock', closed_by: null, closed_at: null, closed_reason: null })
    })
  })

  // Spec §3: een referentiële actie is ook een update en vuurt de trigger.
  // Een trigger die bij closed -> closed "voor de zekerheid" de oude stempels
  // terugzet, draait de on delete set null van auth.users stil terug.
  it('een verwijderd account verliest zijn toeschrijving, de afstreping blijft', async () => {
    const eigenaar = await createUser('blijft@example.com')
    const lid = await createUser('vertrekt@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      await voegLidToe(tx, hh.id, lid)
      const item = await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))

      await actAs(tx, lid)
      await enableRls(tx)
      await tx`update inventory_item set status = 'closed', closed_reason = 'consumed' where id = ${item}`

      await tx`reset role`
      await tx`delete from auth.users where id = ${lid}`

      const [r] = await tx<{ status: string; closed_by: string | null }[]>`
        select status, closed_by from inventory_item where id = ${item}
      `
      expect(r).toEqual({ status: 'closed', closed_by: null })
    })
  })

  // Spec §7. Het filter op status in de tweede update is precies wat
  // useInventory.close() meestuurt; deze test bewijst het mechanisme, de
  // review bewaakt dat useInventory het gebruikt (e2e kan geen twee toestellen
  // tegelijk laten tikken).
  it('afstrepen is idempotent: wie te laat is, raakt niets', async () => {
    const eigenaar = await createUser('eerst@example.com')
    const lid = await createUser('te-laat@example.com')
    await withTx(async (tx) => {
      const hh = await maakHuishouden(tx, eigenaar)
      await voegLidToe(tx, hh.id, lid)
      const item = await maakItem(tx, hh.id, await maakProduct(tx), hh.plaats('pantry'))
      await enableRls(tx)

      await actAs(tx, eigenaar)
      await tx`
        update inventory_item set status = 'closed', closed_reason = 'consumed'
         where id = ${item} and status = 'in_stock'
      `

      await actAs(tx, lid)
      const tweede = await tx`
        update inventory_item set status = 'closed', closed_reason = 'discarded'
         where id = ${item} and status = 'in_stock'
        returning id
      `
      expect(tweede.length).toBe(0)

      const [r] = await tx<{ closed_by: string; closed_reason: string }[]>`
        select closed_by, closed_reason from inventory_item where id = ${item}
      `
      expect(r).toEqual({ closed_by: eigenaar, closed_reason: 'consumed' })
    })
  })
})
