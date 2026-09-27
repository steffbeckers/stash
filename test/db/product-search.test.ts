import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb, type Sql } from './helpers'

// Zoeken draait op trigrammen. De getallen in de commentaren hieronder zijn
// gemeten op deze stack, niet geschat — zie spec §5.
describe('search_products', () => {
  beforeEach(resetDb)

  async function zaai(tx: Sql, namen: Record<string, string>, extra = '') {
    const eerste = Object.entries(namen)[0]!
    const [r] = await tx<{ id: string }[]>`
      select create_product(null, ${extra || null}, null, null, ${eerste[0]}, ${eerste[1]}) as id
    `
    for (const [taal, naam] of Object.entries(namen).slice(1)) {
      await tx`select set_product_translation(${r!.id}::uuid, ${taal}, ${naam})`
    }
    return r!.id
  }

  // DE test van deze taak. similarity('melk', 'Bio halfvolle melk 1 L') is
  // 0,217 en ligt daarmee onder de standaarddrempel van 0,3 — een
  // implementatie op similarity() vindt dit product dus NIET. word_similarity
  // geeft er 1,000 voor. Dit geval gaat rood zodra iemand dat terugdraait.
  it('vindt een lange productnaam op een kort woord', async () => {
    const userId = await createUser('zoeker@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Bio halfvolle melk 1 L' })
      const rijen = await tx<{ naam: string }[]>`select naam from search_products('melk', 'nl', 20)`
      expect(rijen.map((r) => r.naam)).toEqual(['Bio halfvolle melk 1 L'])
    })
  })

  // Bewaakt de verlaagde drempel. word_similarity('mlek', ...) is 0,200; de
  // standaard voor word_similarity is 0,6, dus bij die standaard vindt deze
  // zoekterm niets.
  it('vindt een product ondanks een typefout', async () => {
    const userId = await createUser('typer@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Bio halfvolle melk 1 L' })
      const rijen = await tx`select naam from search_products('mlek', 'nl', 20)`
      expect(rijen.length).toBe(1)
    })
  })

  it('laat een product dat niets met de zoekterm te maken heeft buiten beschouwing', async () => {
    const userId = await createUser('ruis@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Sojadrink natuur' })
      const rijen = await tx`select naam from search_products('melk', 'nl', 20)`
      expect(rijen.length).toBe(0)
    })
  })

  // Zonder ontdubbeling komt een product dat in twee talen matcht er twee
  // keer uit, en toont de UI hetzelfde ding dubbel.
  it('geeft één rij per product, ook als meerdere talen matchen', async () => {
    const userId = await createUser('dubbel@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Melk', en: 'Melk drink' })
      const rijen = await tx`select product_id from search_products('melk', 'nl', 20)`
      expect(rijen.length).toBe(1)
    })
  })

  it('matcht over talen heen', async () => {
    const userId = await createUser('polyglot@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Halfvolle melk', en: 'Semi-skimmed milk' })
      const rijen = await tx`select product_id from search_products('milk', 'nl', 20)`
      expect(rijen.length).toBe(1)
    })
  })

  it('toont de naam in de voorkeurstaal als die bestaat', async () => {
    const userId = await createUser('voorkeur@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Halfvolle melk', en: 'Semi-skimmed milk' })
      const [r] = await tx<{ naam: string; getoonde_taal: string }[]>`
        select naam, getoonde_taal from search_products('milk', 'nl', 20)
      `
      expect(r!.naam).toBe('Halfvolle melk')
      expect(r!.getoonde_taal).toBe('nl')
    })
  })

  // De terugvalketen, plus de melding welke taal je ziet. Zonder de tweede
  // assertie slaagt een implementatie die getoonde_taal nooit invult.
  it('valt terug op een andere taal en meldt welke', async () => {
    const userId = await createUser('terugval@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { en: 'Semi-skimmed milk' })
      const [r] = await tx<{ naam: string; getoonde_taal: string }[]>`
        select naam, getoonde_taal from search_products('milk', 'nl', 20)
      `
      expect(r!.naam).toBe('Semi-skimmed milk')
      expect(r!.getoonde_taal).toBe('en')
    })
  })

  it('laat een afgewezen product uit het resultaat', async () => {
    const userId = await createUser('afgewezen@example.com')
    const mod = await createUser('mod-zoek@example.com')
    await withDb(async (sql) => {
      await sql`update user_profile set role = 'moderator' where user_id = ${mod}`
    })
    let id = ''
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      id = await zaai(tx, { nl: 'Melk' })
    })
    await withTx(async (tx) => {
      await actAs(tx, mod)
      await enableRls(tx)
      await tx`select set_product_status(${id}::uuid, 'rejected')`
      const rijen = await tx`select product_id from search_products('melk', 'nl', 20)`
      expect(rijen.length).toBe(0)
    })
  })

  // De andere helft: een voorgesteld product moet juist wél zichtbaar zijn,
  // anders lijkt je zojuist aangemaakte product verdwenen.
  it('laat een voorgesteld product wel in het resultaat', async () => {
    const userId = await createUser('voorgesteld@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Melk' })
      const [r] = await tx<{ status: string }[]>`select status from search_products('melk', 'nl', 20)`
      expect(r!.status).toBe('proposed')
    })
  })

  it('geeft bij een lege zoekterm de recentste producten', async () => {
    const userId = await createUser('leeg@example.com')

    // Elk product in zijn eigen transactie. now() staat vast binnen een
    // transactie, dus twee producten die in dezelfde transactie ontstaan
    // krijgen een identieke created_at en is "recentste eerst" niet
    // gedefinieerd. In de app gebeurt dat nooit: elke create_product-aanroep
    // is een eigen transactie. De oude opzet toetste dus een situatie die
    // niet bestaat, en viel om op de willekeur van gen_random_uuid().
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Eerste' })
    })

    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Tweede' })
    })

    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      const rijen = await tx<{ naam: string }[]>`select naam from search_products('', 'nl', 20)`
      expect(rijen.map((r) => r.naam)).toEqual(['Tweede', 'Eerste'])
    })
  })

  it('eerbiedigt het maximum', async () => {
    const userId = await createUser('maximum@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await zaai(tx, { nl: 'Melk een' })
      await zaai(tx, { nl: 'Melk twee' })
      const rijen = await tx`select product_id from search_products('melk', 'nl', 1)`
      expect(rijen.length).toBe(1)
    })
  })
})
