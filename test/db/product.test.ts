import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('product', () => {
  beforeEach(resetDb)

  it('weigert een barcode die geen geldige lengte heeft', async () => {
    await withDb(async (sql) => {
      await expect(
        sql`insert into product (gtin) values ('12345')`,
      ).rejects.toThrow(/product_gtin_vorm/)
    })
  })

  it('laat een barcode van dertien cijfers toe', async () => {
    await withDb(async (sql) => {
      await sql`insert into product (gtin) values ('5400101234567')`
      const [row] = await sql<{ gtin: string }[]>`select gtin from product`
      expect(row!.gtin).toBe('5400101234567')
    })
  })

  // Een inhoud zonder eenheid is geen gegeven maar ruis: 1000 wát?
  it('weigert een inhoud zonder eenheid', async () => {
    await withDb(async (sql) => {
      await expect(
        sql`insert into product (net_content) values (1000)`,
      ).rejects.toThrow(/product_inhoud_en_eenheid/)
    })
  })

  it('weigert een eenheid zonder inhoud', async () => {
    await withDb(async (sql) => {
      await expect(
        sql`insert into product (unit) values ('ml')`,
      ).rejects.toThrow(/product_inhoud_en_eenheid/)
    })
  })

  it('laat inhoud en eenheid samen toe', async () => {
    await withDb(async (sql) => {
      await sql`insert into product (net_content, unit) values (1000, 'ml')`
      const [row] = await sql<{ net_content: string }[]>`select net_content from product`
      expect(Number(row!.net_content)).toBe(1000)
    })
  })

  // Zonder deze grens fragmenteert 'EN' of 'nl-BE' de catalogus stilzwijgend:
  // twee rijen die voor Postgres verschillen en voor een mens hetzelfde zijn.
  it('weigert een taalcode die we niet voeren', async () => {
    await withDb(async (sql) => {
      const [p] = await sql<{ id: string }[]>`insert into product default values returning id`
      await expect(
        sql`insert into product_translation (product_id, locale, name, source)
            values (${p!.id}, 'de', 'Milch', 'user')`,
      ).rejects.toThrow(/product_translation_locale/)
    })
  })

  it('weigert een lege naam', async () => {
    await withDb(async (sql) => {
      const [p] = await sql<{ id: string }[]>`insert into product default values returning id`
      await expect(
        sql`insert into product_translation (product_id, locale, name, source)
            values (${p!.id}, 'nl', '   ', 'user')`,
      ).rejects.toThrow(/product_translation_naam/)
    })
  })

  // De invariant uit spec §3. Een check-constraint kan dit niet: die ziet één
  // rij, en dit gaat over de vraag of er nog een andere rij overblijft.
  it('weigert het verwijderen van de laatste naam', async () => {
    await withDb(async (sql) => {
      const [p] = await sql<{ id: string }[]>`insert into product default values returning id`
      await sql`insert into product_translation (product_id, locale, name, source)
                values (${p!.id}, 'nl', 'Melk', 'user')`
      await expect(
        sql`delete from product_translation where product_id = ${p!.id}`,
      ).rejects.toThrow(/minstens één naam/)
    })
  })

  // De falsificatie van de test hierboven: zonder dit geval zou een trigger
  // die élke verwijdering weigert er net zo groen uitzien.
  it('laat het verwijderen van een naam toe zolang er een andere blijft', async () => {
    await withDb(async (sql) => {
      const [p] = await sql<{ id: string }[]>`insert into product default values returning id`
      await sql`insert into product_translation (product_id, locale, name, source)
                values (${p!.id}, 'nl', 'Melk', 'user'), (${p!.id}, 'en', 'Milk', 'user')`
      await sql`delete from product_translation where product_id = ${p!.id} and locale = 'en'`
      const rows = await sql`select 1 from product_translation where product_id = ${p!.id}`
      expect(rows.length).toBe(1)
    })
  })

  // De trigger mag een cascade niet blokkeren. Gemeten gedrag: bij een losse
  // verwijdering bestaat het product nog, bij een cascade is het al weg —
  // daarop onderscheidt de trigger de twee gevallen.
  it('laat het verwijderen van een product zijn namen meenemen', async () => {
    await withDb(async (sql) => {
      const [p] = await sql<{ id: string }[]>`insert into product default values returning id`
      await sql`insert into product_translation (product_id, locale, name, source)
                values (${p!.id}, 'nl', 'Melk', 'user')`
      await sql`delete from product where id = ${p!.id}`
      const rows = await sql`select 1 from product_translation where product_id = ${p!.id}`
      expect(rows.length).toBe(0)
    })
  })

  it('laat een ingelogde gebruiker de catalogus lezen', async () => {
    const userId = await createUser('lezer@example.com')
    await withDb(async (sql) => {
      const [p] = await sql<{ id: string }[]>`insert into product default values returning id`
      await sql`insert into product_translation (product_id, locale, name, source)
                values (${p!.id}, 'nl', 'Melk', 'user')`
    })
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const rows = await tx`select id from product`
      expect(rows.length).toBe(1)
    })
  })

  // Spec §2: het hoofdontwerp zegt "open voor iedereen", maar er is geen
  // pagina die een uitgelogde bezoeker kan bereiken. anon-leesrecht zou dus
  // aanvalsoppervlak zijn zonder gebruiker.
  it('laat anon de catalogus niet lezen', async () => {
    await withDb(async (sql) => {
      await sql`insert into product default values`
    })
    await withTx(async (tx) => {
      await enableRls(tx, 'anon')
      const rows = await tx`select id from product`
      expect(rows.length).toBe(0)
    })
  })

  // Er is geen insert-policy. Zonder deze test zou iemand er later een
  // toevoegen "omdat het handiger is", en dan staat de invariant uit §3 open.
  it('weigert een rechtstreekse insert buiten de RPC om', async () => {
    const userId = await createUser('insteker@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`insert into product default values`),
      ).rejects.toThrow(/row-level security/)
    })
  })
})
