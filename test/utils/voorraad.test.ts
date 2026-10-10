import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  formatDatum,
  formatHoeveelheid,
  groepeerPerPlaats,
  groepeerStrook,
  groepslabel,
  idsVoorPoging,
  isAlToegevoegd,
  isSamenhangFout,
  isVervallen,
  lokaleDatum,
  plusDagen,
  toevoegsleutel,
  varianten,
  vervaltBinnenkort,
  type VoorraadItem,
} from '../../app/utils/voorraad'

// Tests die de tijdzone stubben, geven hem hier weer terug: niets lekt door
// naar de andere tests in dit bestand.
afterEach(() => {
  vi.unstubAllEnvs()
})

let teller = 0
// created_at loopt op met elke aanroep, zodat "oudste eerst" iets betekent.
function item(over: Partial<VoorraadItem> = {}): VoorraadItem {
  teller++
  return {
    id: `i${teller}`,
    productId: 'passata',
    naam: 'Passata',
    getoondeTaal: 'nl',
    merk: null,
    storagePlaceId: 'kast',
    amount: 1,
    unit: 'stuk',
    acquiredAt: '2026-10-01',
    expiresAt: null,
    createdAt: `2026-10-01T10:00:00.${String(teller).padStart(3, '0')}Z`,
    ...over,
  }
}

describe('datums', () => {
  // Tokio is UTC+9: om 00:30 lokale tijd is het in UTC nog gisteren. Een
  // implementatie op toISOString() geeft dan de verkeerde dag. De test zet
  // de tijdzone zelf, dus hij wordt op elke machine rood bij die fout,
  // ook in CI (UTC).
  it('lokaleDatum geeft de dag van het toestel, niet die van UTC', () => {
    vi.stubEnv('TZ', 'Asia/Tokyo')
    expect(lokaleDatum(new Date(2026, 9, 1, 0, 30))).toBe('2026-10-01')
  })

  it('plusDagen gaat over de maandgrens', () => {
    expect(plusDagen('2026-10-30', 3)).toBe('2026-11-02')
  })

  it('isVervallen: gisteren wel, vandaag niet, zonder datum niet', () => {
    expect(isVervallen({ expiresAt: '2026-09-30' }, '2026-10-01')).toBe(true)
    expect(isVervallen({ expiresAt: '2026-10-01' }, '2026-10-01')).toBe(false)
    expect(isVervallen({ expiresAt: null }, '2026-10-01')).toBe(false)
  })
})

describe('vervaltBinnenkort', () => {
  // Spec §6: vandaag + 3 dagen zit erin, vandaag + 4 niet. Beide grenzen,
  // zodat een verschuiving in welke richting ook rood wordt.
  it('neemt tot en met vandaag + 3 dagen mee, en vervallen items ook', () => {
    const vervallen = item({ expiresAt: '2026-09-30' })
    const opDeGrens = item({ expiresAt: '2026-10-04' })
    const netErover = item({ expiresAt: '2026-10-05' })
    const zonderDatum = item({ expiresAt: null })
    const uitkomst = vervaltBinnenkort([netErover, zonderDatum, opDeGrens, vervallen], '2026-10-01')
    expect(uitkomst.map((i) => i.id)).toEqual([vervallen.id, opDeGrens.id])
  })
})

describe('groepeerStrook', () => {
  // Drie potten passata met dezelfde datum waren drie identieke rijen.
  it('voegt hetzelfde product met dezelfde datum samen tot één rij', () => {
    const rijen = groepeerStrook([
      item({ expiresAt: '2026-10-03' }),
      item({ expiresAt: '2026-10-03' }),
      item({ expiresAt: '2026-10-03' }),
    ])
    expect(rijen.map((r) => [r.naam, r.expiresAt, r.aantal])).toEqual([['Passata', '2026-10-03', 3]])
  })

  // Het verschil in datum is net wat de strook moet tonen.
  it('houdt twee datums van hetzelfde product apart, vroegste eerst', () => {
    const rijen = groepeerStrook([
      item({ expiresAt: '2026-10-02' }),
      item({ expiresAt: '2026-10-04' }),
      item({ expiresAt: '2026-10-02' }),
    ])
    expect(rijen.map((r) => [r.expiresAt, r.aantal])).toEqual([['2026-10-02', 2], ['2026-10-04', 1]])
  })

  it('houdt twee producten met dezelfde datum apart', () => {
    const rijen = groepeerStrook([
      item({ productId: 'passata', naam: 'Passata', expiresAt: '2026-10-03' }),
      item({ productId: 'yoghurt', naam: 'Yoghurt', expiresAt: '2026-10-03' }),
    ])
    expect(rijen.map((r) => r.naam)).toEqual(['Passata', 'Yoghurt'])
  })
})

describe('formatHoeveelheid', () => {
  // Het groepslabel formatteerde al per taal, de losse items niet: "0.684"
  // naast "0,684" op hetzelfde scherm.
  it('schrijft een decimaal getal in de taal van de gebruiker', () => {
    expect(formatHoeveelheid(0.684, 'kg', 'nl')).toBe('0,684 kg')
    expect(formatHoeveelheid(0.684, 'kg', 'en')).toBe('0.684 kg')
  })
})

describe('varianten', () => {
  it('zelfde datum en hoeveelheid is één variant, oudste eerst', () => {
    const eerste = item({ expiresAt: '2026-10-10' })
    const tweede = item({ expiresAt: '2026-10-10' })
    const v = varianten([tweede, eerste])
    expect(v.length).toBe(1)
    expect(v[0]!.items.map((i) => i.id)).toEqual([eerste.id, tweede.id])
  })

  it('een andere datum is een andere variant', () => {
    expect(varianten([item({ expiresAt: '2026-10-10' }), item({ expiresAt: '2026-10-12' })]).length).toBe(2)
  })

  // Gehakt van 0,684 kg en van 0,5 kg met dezelfde datum zijn niet
  // uitwisselbaar: wie afstreept, moet kunnen zeggen welk.
  it('zelfde datum maar een andere hoeveelheid is een andere variant', () => {
    const v = varianten([
      item({ expiresAt: '2026-10-10', amount: 0.684, unit: 'kg' }),
      item({ expiresAt: '2026-10-10', amount: 0.5, unit: 'kg' }),
    ])
    expect(v.length).toBe(2)
  })

  it('zelfde datum en hoeveelheid maar een andere eenheid is een andere variant', () => {
    const v = varianten([
      item({ expiresAt: '2026-10-10', amount: 1, unit: 'g' }),
      item({ expiresAt: '2026-10-10', amount: 1, unit: 'kg' }),
    ])
    expect(v.length).toBe(2)
  })

  it('sorteert de vroegste datum eerst en zonder datum achteraan', () => {
    const v = varianten([
      item({ expiresAt: null }),
      item({ expiresAt: '2026-10-12' }),
      item({ expiresAt: '2026-10-03' }),
    ])
    expect(v.map((x) => x.expiresAt)).toEqual(['2026-10-03', '2026-10-12', null])
  })
})

describe('groepeerPerPlaats', () => {
  it('groepeert per plaats en per product, op naam gesorteerd', () => {
    const items = [
      item({ productId: 'z', naam: 'Zout', storagePlaceId: 'kast' }),
      item({ productId: 'a', naam: 'Appelmoes', storagePlaceId: 'kast' }),
      item({ productId: 'a', naam: 'Appelmoes', storagePlaceId: 'kast' }),
      item({ productId: 'm', naam: 'Melk', storagePlaceId: 'koelkast' }),
    ]
    const perPlaats = groepeerPerPlaats(items)
    expect(perPlaats.get('kast')!.map((g) => [g.naam, g.items.length])).toEqual([['Appelmoes', 2], ['Zout', 1]])
    expect(perPlaats.get('koelkast')!.map((g) => g.naam)).toEqual(['Melk'])
  })

  it('de vroegste vervaldatum negeert items zonder datum', () => {
    const [groep] = groepeerPerPlaats([
      item({ expiresAt: null }),
      item({ expiresAt: '2026-10-08' }),
    ]).get('kast')!
    expect(groep!.vroegsteVervaldatum).toBe('2026-10-08')
  })
})

describe('groepslabel', () => {
  it('telt stuks als alles 1 stuk is', () => {
    expect(groepslabel([item(), item(), item()])).toEqual({ soort: 'aantal', aantal: 3 })
  })

  it('telt hoeveelheden op per eenheid zodra er gewogen wordt', () => {
    expect(groepslabel([
      item({ amount: 0.684, unit: 'kg' }),
      item({ amount: 0.5, unit: 'kg' }),
    ])).toEqual({ soort: 'totaal', totalen: [{ unit: 'kg', amount: 1.184 }] })
  })

  // Eén kilo is geen "×1": de eenheid telt mee.
  it('een enkele hoeveelheid in een gewichtseenheid is een totaal, geen aantal', () => {
    expect(groepslabel([item({ amount: 1, unit: 'kg' })]))
      .toEqual({ soort: 'totaal', totalen: [{ unit: 'kg', amount: 1 }] })
  })

  // Twee stuks in één item is geen "×1": de hoeveelheid telt mee.
  it('een item van 2 stuks is een totaal, geen aantal', () => {
    expect(groepslabel([item({ amount: 2, unit: 'stuk' })]))
      .toEqual({ soort: 'totaal', totalen: [{ unit: 'stuk', amount: 2 }] })
  })

  it('houdt een totaal per eenheid, in de volgorde van EENHEDEN', () => {
    expect(groepslabel([
      item({ amount: 0.5, unit: 'kg' }),
      item({ amount: 1, unit: 'stuk' }),
    ])).toEqual({
      soort: 'totaal',
      totalen: [{ unit: 'stuk', amount: 1 }, { unit: 'kg', amount: 0.5 }],
    })
  })
})

describe('formatDatum', () => {
  // Op inhoud, niet op de exacte tekst: de leestekens verschillen per ICU.
  it('laat het jaar weg binnen het lopende jaar', () => {
    // Een negatieve UTC-offset: zonder timeZone: 'UTC' wordt dit "2 okt".
    vi.stubEnv('TZ', 'America/New_York')
    const tekst = formatDatum('2026-10-03', 'nl', '2026-10-01')
    expect(tekst).toContain('3')
    expect(tekst).toContain('okt')
    expect(tekst).not.toContain('2026')
  })

  it('toont het jaar buiten het lopende jaar', () => {
    expect(formatDatum('2027-03-05', 'nl', '2026-10-01')).toContain('2027')
  })
})

describe('isSamenhangFout', () => {
  // supabase-js gooit plain objects, geen Error-instanties.
  it('herkent de blokkade van de samenhangcheck', () => {
    expect(isSamenhangFout({
      code: '23514',
      message: 'new row for relation "inventory_item" violates check constraint "inventory_item_samenhang"',
    })).toBe(true)
  })

  // Dezelfde code, een andere check: die mag niet als "plaats heeft nog
  // voorraad" gemeld worden.
  it('herkent een andere check-schending niet als blokkade', () => {
    expect(isSamenhangFout({
      code: '23514',
      message: 'new row for relation "inventory_item" violates check constraint "inventory_item_hoeveelheid"',
    })).toBe(false)
  })

  it('herkent iets dat geen databasefout is niet', () => {
    expect(isSamenhangFout(new Error('netwerk'))).toBe(false)
    expect(isSamenhangFout(null)).toBe(false)
  })
})

describe('isAlToegevoegd', () => {
  // Spec geen-dubbele-toevoeging §4: een eerdere poging met dezelfde id's kwam
  // al aan, en deze insert botst op de primaire sleutel.
  it('herkent een botsing op de primaire sleutel van inventory_item', () => {
    expect(isAlToegevoegd({
      code: '23505',
      message: 'duplicate key value violates unique constraint "inventory_item_pkey"',
    })).toBe(true)
  })

  // Dezelfde code op een andere constraint is geen eerdere poging van ons.
  it('herkent een botsing op een andere constraint niet', () => {
    expect(isAlToegevoegd({
      code: '23505',
      message: 'duplicate key value violates unique constraint "iets_anders_key"',
    })).toBe(false)
  })

  it('herkent een andere code of iets dat geen databasefout is niet', () => {
    expect(isAlToegevoegd({ code: '23514', message: 'inventory_item_pkey' })).toBe(false)
    expect(isAlToegevoegd(new Error('netwerk'))).toBe(false)
    expect(isAlToegevoegd(null)).toBe(false)
  })
})

describe('idsVoorPoging', () => {
  let teller = 0
  const nieuwId = () => `id-${++teller}`

  it("maakt bij een eerste poging zoveel id's als gevraagd", () => {
    const p = idsVoorPoging(null, 'a', 3, nieuwId)
    expect(p.sleutel).toBe('a')
    expect(p.ids).toHaveLength(3)
    expect(new Set(p.ids).size).toBe(3)
  })

  // Spec §3: dezelfde gegevens geven dezelfde id's, dus geen dubbel.
  it("geeft bij dezelfde sleutel en hetzelfde aantal de vorige id's terug", () => {
    const vorige = idsVoorPoging(null, 'a', 2, nieuwId)
    expect(idsVoorPoging(vorige, 'a', 2, nieuwId)).toBe(vorige)
  })

  it("maakt nieuwe id's bij een andere sleutel", () => {
    const vorige = idsVoorPoging(null, 'a', 2, nieuwId)
    const nieuw = idsVoorPoging(vorige, 'b', 2, nieuwId)
    expect(nieuw.sleutel).toBe('b')
    expect(nieuw.ids.some((id) => vorige.ids.includes(id))).toBe(false)
  })

  // Review Focus: een ander aantal is een andere toevoeging.
  it("maakt nieuwe id's bij een ander aantal", () => {
    const vorige = idsVoorPoging(null, 'a', 2, nieuwId)
    const nieuw = idsVoorPoging(vorige, 'a', 3, nieuwId)
    expect(nieuw.ids).toHaveLength(3)
    expect(nieuw.ids.some((id) => vorige.ids.includes(id))).toBe(false)
  })
})

describe('toevoegsleutel', () => {
  const basis = { productId: 'p', storagePlaceId: 'kast', aantal: 2, amount: 1, unit: 'stuk', expiresAt: '2026-10-20' }

  // Review Focus: een nieuwe poging na middernacht. acquiredAt is vandaag en
  // hoort dus niet in de sleutel; het zit ook niet in het argumenttype.
  it('hangt alleen af van de ingevulde gegevens', () => {
    expect(toevoegsleutel({ ...basis })).toBe(toevoegsleutel({ ...basis }))
  })

  it('verandert als een ingevuld veld verandert', () => {
    const s = toevoegsleutel(basis)
    expect(toevoegsleutel({ ...basis, aantal: 3 })).not.toBe(s)
    expect(toevoegsleutel({ ...basis, expiresAt: null })).not.toBe(s)
    expect(toevoegsleutel({ ...basis, storagePlaceId: 'koelkast' })).not.toBe(s)
    expect(toevoegsleutel({ ...basis, amount: 0.5, unit: 'kg' })).not.toBe(s)
  })

  it('negeert extra velden zoals acquiredAt', () => {
    const met = { ...basis, acquiredAt: '2026-10-10' } as typeof basis
    const later = { ...basis, acquiredAt: '2026-10-11' } as typeof basis
    expect(toevoegsleutel(met)).toBe(toevoegsleutel(later))
  })
})
