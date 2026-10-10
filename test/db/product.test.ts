import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb, type Sql } from './helpers'

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

describe('product-RPCs', () => {
  beforeEach(resetDb)

  // `Sql` wordt al geëxporteerd door test/db/helpers.ts. Breid de bestaande
  // import bovenaan dit bestand uit tot:
  //   import { withDb, withTx, actAs, enableRls, createUser, resetDb, type Sql } from './helpers'
  async function maakProduct(tx: Sql, naam = 'Melk') {
    const [r] = await tx<{ create_product: string }[]>`
      select create_product(null, null, null, null, 'nl', ${naam}) as create_product
    `
    return r!.create_product
  }

  it('maakt het product en de eerste naam samen aan', async () => {
    const userId = await createUser('maker@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      const [naam] = await tx<{ name: string; source: string }[]>`
        select name, source from product_translation where product_id = ${id}
      `
      expect(naam!.name).toBe('Melk')
      expect(naam!.source).toBe('user')
    })
  })

  it('zet een nieuw product van een onbekende gebruiker op proposed', async () => {
    const userId = await createUser('nieuw@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      const [p] = await tx<{ status: string }[]>`select status from product where id = ${id}`
      expect(p!.status).toBe('proposed')
    })
  })

  // De falsificatie van de test hierboven: zonder dit geval zou een
  // implementatie die álles op proposed zet er net zo groen uitzien.
  it('zet een nieuw product van een vertrouwde gebruiker op confirmed', async () => {
    const userId = await createUser('vertrouwd@example.com')
    await withDb(async (sql) => {
      await sql`update user_profile set trust_level = 1 where user_id = ${userId}`
    })
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      const [p] = await tx<{ status: string }[]>`select status from product where id = ${id}`
      expect(p!.status).toBe('confirmed')
    })
  })

  it('laat de maker zijn eigen product bewerken', async () => {
    const userId = await createUser('eigenaar@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      await tx`select update_product(${id}::uuid, null, 'Boni', 1000, 'ml')`
      const [p] = await tx<{ brand: string }[]>`select brand from product where id = ${id}`
      expect(p!.brand).toBe('Boni')
    })
  })

  it('laat een vreemde het product van iemand anders niet bewerken', async () => {
    const mijn = await createUser('mijn-product@example.com')
    const vreemde = await createUser('vreemde@example.com')
    let id = ''
    await withTx(async (tx) => {
      await actAs(tx, mijn)
      await enableRls(tx)
      id = await maakProduct(tx)
    })
    await withTx(async (tx) => {
      await actAs(tx, vreemde)
      await enableRls(tx)
      // Savepoint isoleert de mislukte aanroep: zonder savepoint blijft de
      // transactie ná deze aanroep aborted, en meldt postgres.js dat als een
      // onafgevangen fout op het impliciete commit in plaats van als de
      // hierboven verwachte afwijzing. Zelfde reden als bij de
      // insert-buiten-de-RPC-test hierboven in dit bestand.
      await expect(
        tx.savepoint(
          (sp) => sp`select update_product(${id}::uuid, null, 'Gekaapt', null, null)`,
        ),
      ).rejects.toThrow(/alleen de maker of een moderator/)
    })
  })

  // De andere helft van het paar. Zonder dit geval zou een implementatie die
  // iedereen weigert — inclusief moderators — er groen uitzien.
  it('laat een moderator het product van iemand anders wel bewerken', async () => {
    const mijn = await createUser('mijn-product-2@example.com')
    const mod = await createUser('moderator@example.com')
    await withDb(async (sql) => {
      await sql`update user_profile set role = 'moderator' where user_id = ${mod}`
    })
    let id = ''
    await withTx(async (tx) => {
      await actAs(tx, mijn)
      await enableRls(tx)
      id = await maakProduct(tx)
    })
    await withTx(async (tx) => {
      await actAs(tx, mod)
      await enableRls(tx)
      await tx`select update_product(${id}::uuid, null, 'Gecorrigeerd', null, null)`
      const [p] = await tx<{ brand: string }[]>`select brand from product where id = ${id}`
      expect(p!.brand).toBe('Gecorrigeerd')
    })
  })

  it('voegt een naam in een andere taal toe en vervangt een bestaande', async () => {
    const userId = await createUser('vertaler@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      await tx`select set_product_translation(${id}::uuid, 'en', 'Milk')`
      await tx`select set_product_translation(${id}::uuid, 'en', 'Semi-skimmed milk')`
      const rows = await tx<{ locale: string; name: string }[]>`
        select locale, name from product_translation where product_id = ${id} order by locale
      `
      expect(rows.map((r) => r.locale)).toEqual(['en', 'nl'])
      expect(rows[0]!.name).toBe('Semi-skimmed milk')
    })
  })

  // set_product_translation roept mag_product_bewerken aan net als
  // update_product, maar had tot nu toe geen enkele test die dat bewees: de
  // hele suite bleef groen als je de check eruit haalde. Zelfde paar-vorm als
  // bij update_product hierboven.
  it('laat een vreemde de naam van andermans product niet wijzigen', async () => {
    const mijn = await createUser('naam-mijn@example.com')
    const vreemde = await createUser('naam-vreemde@example.com')
    let id = ''
    await withTx(async (tx) => {
      await actAs(tx, mijn)
      await enableRls(tx)
      id = await maakProduct(tx)
    })
    await withTx(async (tx) => {
      await actAs(tx, vreemde)
      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`select set_product_translation(${id}::uuid, 'en', 'Hijacked')`),
      ).rejects.toThrow(/alleen de maker of een moderator/)
    })
  })

  // De andere helft. Zonder dit geval zou een implementatie die iedereen
  // weigert — moderators incluis — er groen uitzien.
  it('laat een moderator de naam van andermans product wel wijzigen', async () => {
    const mijn = await createUser('naam-mijn-2@example.com')
    const mod = await createUser('naam-mod@example.com')
    await withDb(async (sql) => {
      await sql`update user_profile set role = 'moderator' where user_id = ${mod}`
    })
    let id = ''
    await withTx(async (tx) => {
      await actAs(tx, mijn)
      await enableRls(tx)
      id = await maakProduct(tx)
    })
    await withTx(async (tx) => {
      await actAs(tx, mod)
      await enableRls(tx)
      await tx`select set_product_translation(${id}::uuid, 'en', 'Corrected')`
      const [r] = await tx<{ name: string }[]>`
        select name from product_translation where product_id = ${id} and locale = 'en'
      `
      expect(r!.name).toBe('Corrected')
    })
  })

  it('weigert het verwijderen van de laatste naam via de RPC', async () => {
    const userId = await createUser('laatste@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      // Savepoint: zelfde reden als bij de vreemde-mag-niet-bewerken-test
      // hierboven.
      await expect(
        tx.savepoint((sp) => sp`select remove_product_translation(${id}::uuid, 'nl')`),
      ).rejects.toThrow(/minstens één naam/)
    })
  })

  // remove_product_translation heeft vandaag alleen zijn faalpad getoetst
  // (de laatste naam). Dit is het geslaagde pad: één van twee weghalen.
  it('verwijdert een naam als er een andere overblijft', async () => {
    const userId = await createUser('naam-weg@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      await tx`select set_product_translation(${id}::uuid, 'en', 'Milk')`
      await tx`select remove_product_translation(${id}::uuid, 'en')`
      const rijen = await tx<{ locale: string }[]>`
        select locale from product_translation where product_id = ${id}
      `
      expect(rijen.map((r) => r.locale)).toEqual(['nl'])
    })
  })

  // De vorige test riep remove_product_translation aan als de maker zelf, die
  // mag_product_bewerken's eigenaarstak doorstaat ongeacht of de check
  // bestaat. Dit paar toetst de check zelf, los van eigenaarschap.
  it('laat een vreemde geen naam van andermans product verwijderen', async () => {
    const mijn = await createUser('weg-mijn@example.com')
    const vreemde = await createUser('weg-vreemde@example.com')
    let id = ''
    await withTx(async (tx) => {
      await actAs(tx, mijn)
      await enableRls(tx)
      id = await maakProduct(tx)
      await tx`select set_product_translation(${id}::uuid, 'en', 'Milk')`
    })
    await withTx(async (tx) => {
      await actAs(tx, vreemde)
      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`select remove_product_translation(${id}::uuid, 'en')`),
      ).rejects.toThrow(/alleen de maker of een moderator/)
    })
  })

  // De andere helft. Zonder dit geval zou een implementatie die iedereen
  // weigert — moderators incluis — er groen uitzien.
  it('laat een moderator wel een naam van andermans product verwijderen', async () => {
    const mijn = await createUser('weg-mijn-2@example.com')
    const mod = await createUser('weg-mod@example.com')
    await withDb(async (sql) => {
      await sql`update user_profile set role = 'moderator' where user_id = ${mod}`
    })
    let id = ''
    await withTx(async (tx) => {
      await actAs(tx, mijn)
      await enableRls(tx)
      id = await maakProduct(tx)
      await tx`select set_product_translation(${id}::uuid, 'en', 'Milk')`
    })
    await withTx(async (tx) => {
      await actAs(tx, mod)
      await enableRls(tx)
      await tx`select remove_product_translation(${id}::uuid, 'en')`
      const rijen = await tx<{ locale: string }[]>`
        select locale from product_translation where product_id = ${id}
      `
      expect(rijen.map((r) => r.locale)).toEqual(['nl'])
    })
  })

  it('laat een moderator de status van een product wijzigen', async () => {
    const maker = await createUser('status-maker@example.com')
    const mod = await createUser('status-mod@example.com')
    await withDb(async (sql) => {
      await sql`update user_profile set role = 'moderator' where user_id = ${mod}`
    })
    let id = ''
    await withTx(async (tx) => {
      await actAs(tx, maker)
      await enableRls(tx)
      id = await maakProduct(tx)
    })
    await withTx(async (tx) => {
      await actAs(tx, mod)
      await enableRls(tx)
      await tx`select set_product_status(${id}::uuid, 'rejected')`
      const [p] = await tx<{ status: string }[]>`select status from product where id = ${id}`
      expect(p!.status).toBe('rejected')
    })
  })

  it('laat alleen een moderator de status wijzigen', async () => {
    const userId = await createUser('statuszoeker@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const id = await maakProduct(tx)
      // Savepoint: zelfde reden als bij de vreemde-mag-niet-bewerken-test
      // hierboven.
      await expect(
        tx.savepoint((sp) => sp`select set_product_status(${id}::uuid, 'rejected')`),
      ).rejects.toThrow(/alleen een moderator/)
    })
  })

  // Spiegelt `anon mag geen enkele huishoudfunctie aanroepen`. Elke aanroep
  // gaat in een eigen savepoint: een geweigerde aanroep breekt de transactie
  // af, en zonder savepoint zou de tweede aanroep falen op "current
  // transaction is aborted" in plaats van op de rechten. De query wordt
  // binnen de callback opgebouwd — geef je een al gemaakte query mee, dan
  // draait hij buiten het savepoint.
  it('laat anon geen enkele productfunctie aanroepen', async () => {
    await withTx(async (tx) => {
      await enableRls(tx, 'anon')
      const aanroepen = [
        (sp: Sql) => sp`select create_product(null, null, null, null, 'nl', 'Melk')`,
        (sp: Sql) => sp`select update_product(gen_random_uuid(), null, null, null, null)`,
        (sp: Sql) => sp`select set_product_translation(gen_random_uuid(), 'nl', 'Melk')`,
        (sp: Sql) => sp`select remove_product_translation(gen_random_uuid(), 'nl')`,
        (sp: Sql) => sp`select set_product_status(gen_random_uuid(), 'rejected')`,
      ]
      for (const aanroep of aanroepen) {
        await expect(tx.savepoint((sp) => aanroep(sp as unknown as Sql))).rejects.toThrow(
          /permission denied/,
        )
      }
    })
  })
})

describe('create_product met een gekozen id', () => {
  beforeEach(resetDb)
  const gekozen = '00000000-0000-4000-8000-0000000000aa'

  // Spec geen-dubbele-toevoeging §5: een nieuwe poging van dezelfde maker
  // krijgt hetzelfde product terug, zonder dubbel en zonder tweede vertaling.
  it('geeft bij een nieuwe poging van dezelfde maker hetzelfde product terug, zonder dubbel', async () => {
    const maker = await createUser('maker-gekozen@example.com')
    await withTx(async (tx) => {
      await actAs(tx, maker)
      await enableRls(tx)
      const [a] = await tx<{ id: string }[]>`select create_product(null, null, null, null, 'nl', 'Melk', ${gekozen}) as id`
      const [b] = await tx<{ id: string }[]>`select create_product(null, null, null, null, 'nl', 'Melk', ${gekozen}) as id`
      expect(a!.id).toBe(gekozen)
      expect(b!.id).toBe(gekozen)
      await tx`reset role`
      expect((await tx`select 1 from product`).length).toBe(1)
      expect((await tx`select 1 from product_translation where product_id = ${gekozen}`).length).toBe(1)
    })
  })

  // Review Focus: alleen bereikbaar buiten de app, want de app maakt bij
  // andere gegevens een nieuw id.
  it('wijzigt bij een nieuwe poging met een andere naam het bestaande product niet', async () => {
    const maker = await createUser('maker-andere-naam@example.com')
    await withTx(async (tx) => {
      await actAs(tx, maker)
      await enableRls(tx)
      await tx`select create_product(null, null, null, null, 'nl', 'Melk', ${gekozen})`
      const [b] = await tx<{ id: string }[]>`select create_product(null, null, null, null, 'nl', 'Kaas', ${gekozen}) as id`
      expect(b!.id).toBe(gekozen)
      await tx`reset role`
      const namen = await tx<{ name: string }[]>`select name from product_translation where product_id = ${gekozen}`
      expect(namen.map((n) => n.name)).toEqual(['Melk'])
    })
  })

  it('weigert het id van andermans product, en verandert niets', async () => {
    const eerste = await createUser('eerste-maker@example.com')
    const ander = await createUser('andere-maker@example.com')
    await withTx(async (tx) => {
      await actAs(tx, eerste)
      await enableRls(tx)
      await tx`select create_product(null, null, null, null, 'nl', 'Melk', ${gekozen})`
      await actAs(tx, ander)
      await expect(
        tx.savepoint((sp) => (sp as unknown as Sql)`select create_product(null, null, null, null, 'nl', 'Kaas', ${gekozen})`),
      ).rejects.toThrow(/product bestaat al/)
      await tx`reset role`
      const namen = await tx<{ name: string }[]>`select name from product_translation where product_id = ${gekozen}`
      expect(namen.map((n) => n.name)).toEqual(['Melk'])
    })
  })

  // Een verwijderd account laat een product met created_by null achter. Dat
  // is niemands product meer: een ander mag het niet als eigen product krijgen.
  // `maker <> actor` zou hier null geven en het verweesde product teruggeven.
  it('weigert het id van een product zonder maker, en verandert niets', async () => {
    const eerste = await createUser('verwijderde-maker@example.com')
    const ander = await createUser('andere-gebruiker@example.com')
    await withTx(async (tx) => {
      await actAs(tx, eerste)
      await enableRls(tx)
      await tx`select create_product(null, null, null, null, 'nl', 'Melk', ${gekozen})`
      await tx`reset role`
      await tx`update product set created_by = null where id = ${gekozen}`
      await actAs(tx, ander)
      await expect(
        tx.savepoint((sp) => (sp as unknown as Sql)`select create_product(null, null, null, null, 'nl', 'Kaas', ${gekozen})`),
      ).rejects.toThrow(/product bestaat al/)
      await tx`reset role`
      const namen = await tx<{ name: string }[]>`select name from product_translation where product_id = ${gekozen}`
      expect(namen.map((n) => n.name)).toEqual(['Melk'])
    })
  })

  it('maakt zonder id een nieuw product, zoals voorheen', async () => {
    const maker = await createUser('maker-zonder-id@example.com')
    await withTx(async (tx) => {
      await actAs(tx, maker)
      await enableRls(tx)
      await tx`select create_product(null, null, null, null, 'nl', 'Melk')`
      await tx`select create_product(null, null, null, null, 'nl', 'Melk')`
      await tx`reset role`
      expect((await tx`select 1 from product`).length).toBe(2)
    })
  })
})
