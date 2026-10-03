import { describe, it, expect } from 'vitest'
import {
  KOPIE_SLEUTEL,
  WACHTRIJ_SLEUTEL,
  isNetwerkfout,
  leesKopie,
  leesWachtrij,
  ruimOpVoor,
  schrijfKopie,
  schrijfWachtrij,
  streepAfInKopie,
  verstuurWachtrij,
  wachtrijVoor,
  zetTerugInKopie,
  type Kopie,
  type Wachtrijitem,
} from '../../app/utils/offlineVoorraad'
import type { VoorraadItem } from '../../app/utils/voorraad'

/** Een opslag in het geheugen, zodat de tests geen browser nodig hebben. */
class NepOpslag implements Storage {
  private waarden = new Map<string, string>()
  get length(): number { return this.waarden.size }
  clear(): void { this.waarden.clear() }
  getItem(sleutel: string): string | null { return this.waarden.get(sleutel) ?? null }
  key(index: number): string | null { return [...this.waarden.keys()][index] ?? null }
  removeItem(sleutel: string): void { this.waarden.delete(sleutel) }
  setItem(sleutel: string, waarde: string): void { this.waarden.set(sleutel, String(waarde)) }
}

function item(id: string, over: Partial<VoorraadItem> = {}): VoorraadItem {
  return {
    id,
    productId: 'passata',
    naam: 'Passata',
    getoondeTaal: 'nl',
    merk: null,
    storagePlaceId: 'kast',
    amount: 1,
    unit: 'stuk',
    acquiredAt: '2026-10-01',
    expiresAt: null,
    createdAt: '2026-10-01T10:00:00Z',
    ...over,
  }
}

function kopie(over: Partial<Kopie> = {}): Kopie {
  return {
    versie: 1,
    eigenaar: 'ada',
    huishouden: { id: 'h1', naam: 'Thuis' },
    bewaardOp: '2026-10-03T12:00:00Z',
    plaatsen: [{ id: 'kast', name: 'Kast', kind: 'pantry' }],
    items: [item('a'), item('b')],
    ...over,
  }
}

function inWachtrij(itemId: string, eigenaar = 'ada'): Wachtrijitem {
  return { itemId, reden: 'consumed', eigenaar, afgestreeptOp: '2026-10-03T12:00:00Z', item: item(itemId) }
}

describe('de opslag lezen', () => {
  it('geeft de kopie terug die erin geschreven is', () => {
    const opslag = new NepOpslag()
    schrijfKopie(opslag, kopie())
    expect(leesKopie(opslag)?.items.map((i) => i.id)).toEqual(['a', 'b'])
  })

  // De offline-pagina moet altijd openen: een kapotte waarde is "geen kopie".
  it('geeft geen kopie bij kapotte JSON, zonder te crashen', () => {
    const opslag = new NepOpslag()
    opslag.setItem(KOPIE_SLEUTEL, '{niet af')
    expect(leesKopie(opslag)).toBeNull()
  })

  it('geeft geen kopie bij een andere versie', () => {
    const opslag = new NepOpslag()
    opslag.setItem(KOPIE_SLEUTEL, JSON.stringify({ ...kopie(), versie: 2 }))
    expect(leesKopie(opslag)).toBeNull()
  })

  it('geeft geen kopie bij een verkeerde vorm', () => {
    const opslag = new NepOpslag()
    opslag.setItem(KOPIE_SLEUTEL, JSON.stringify({ ...kopie(), items: 'geen lijst' }))
    expect(leesKopie(opslag)).toBeNull()
  })

  it('geeft een lege wachtrij bij kapotte JSON en laat ongeldige elementen weg', () => {
    const opslag = new NepOpslag()
    opslag.setItem(WACHTRIJ_SLEUTEL, '[[')
    expect(leesWachtrij(opslag)).toEqual([])
    opslag.setItem(WACHTRIJ_SLEUTEL, JSON.stringify([inWachtrij('a'), { itemId: 'b' }]))
    expect(leesWachtrij(opslag).map((i) => i.itemId)).toEqual(['a'])
  })

  it('verwijdert de sleutel bij een lege wachtrij', () => {
    const opslag = new NepOpslag()
    schrijfWachtrij(opslag, [inWachtrij('a')])
    schrijfWachtrij(opslag, [])
    expect(opslag.getItem(WACHTRIJ_SLEUTEL)).toBeNull()
  })
})

describe('de kopie bewerken', () => {
  it('afstrepen haalt precies dat item weg', () => {
    expect(streepAfInKopie(kopie(), 'a').items.map((i) => i.id)).toEqual(['b'])
  })

  it('terugzetten zet het item terug, en niet twee keer', () => {
    const zonder = streepAfInKopie(kopie(), 'a')
    const terug = zetTerugInKopie(zonder, item('a'))
    expect(terug.items.map((i) => i.id).sort()).toEqual(['a', 'b'])
    expect(zetTerugInKopie(terug, item('a')).items.length).toBe(2)
  })
})

describe('eigenaars', () => {
  it('wachtrijVoor geeft alleen de afstrepingen van die gebruiker', () => {
    const w = [inWachtrij('a', 'ada'), inWachtrij('b', 'bob')]
    expect(wachtrijVoor(w, 'ada').map((i) => i.itemId)).toEqual(['a'])
  })

  // Spec §8: een andere gebruiker krijgt de kopie van de vorige nooit te zien.
  it('ruimOpVoor laat de kopie en wachtrij van een andere eigenaar weg', () => {
    const r = ruimOpVoor(kopie({ eigenaar: 'ada' }), [inWachtrij('a', 'ada')], 'bob')
    expect(r.kopie).toBeNull()
    expect(r.wachtrij).toEqual([])
  })

  it('ruimOpVoor houdt de eigen kopie en wachtrij', () => {
    const r = ruimOpVoor(kopie({ eigenaar: 'ada' }), [inWachtrij('a', 'ada')], 'ada')
    expect(r.kopie?.eigenaar).toBe('ada')
    expect(r.wachtrij.length).toBe(1)
  })
})

describe('isNetwerkfout', () => {
  // De vorm uit postgrest-js: `${fetchError.name}: ${fetchError.message}`, code ''.
  it('herkent een mislukte fetch in Chromium en in Safari', () => {
    expect(isNetwerkfout({ code: '', message: 'TypeError: Failed to fetch' }, true)).toBe(true)
    expect(isNetwerkfout({ code: '', message: 'TypeError: Load failed' }, true)).toBe(true)
  })

  it('herkent een rauwe TypeError van fetch', () => {
    expect(isNetwerkfout(new TypeError('Failed to fetch'), true)).toBe(true)
  })

  it('telt elke fout als netwerkfout als het toestel offline is', () => {
    expect(isNetwerkfout({ code: '23514', message: 'iets' }, false)).toBe(true)
  })

  it('herkent een databasefout niet als netwerkfout', () => {
    expect(isNetwerkfout({ code: '23514', message: 'new row violates check constraint' }, true)).toBe(false)
    expect(isNetwerkfout({ code: '42501', message: 'permission denied for table inventory_item' }, true)).toBe(false)
  })

  // Zelfde lege code, maar geen netwerk: een afgebroken verzoek.
  it('herkent een afgebroken verzoek niet als netwerkfout', () => {
    expect(isNetwerkfout({ code: '', message: 'AbortError: signal is aborted without reason' }, true)).toBe(false)
  })
})

describe('verstuurWachtrij', () => {
  const netwerkfout = { code: '', message: 'TypeError: Failed to fetch' }

  it('telt verstuurd en vervallen, en laat niets achter', async () => {
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b')], async (id) => id === 'a')
    expect(r).toEqual({ resterend: [], verstuurd: 1, vervallen: 1, mislukt: 0 })
  })

  // Het netwerk is weg: de rest proberen heeft geen zin en mag niet verloren gaan.
  it('stopt bij een netwerkfout en houdt dat item en de rest vast', async () => {
    const geprobeerd: string[] = []
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b'), inWachtrij('c')], async (id) => {
      geprobeerd.push(id)
      if (id === 'b') throw netwerkfout
      return true
    })
    expect(geprobeerd).toEqual(['a', 'b'])
    expect(r.resterend.map((i) => i.itemId)).toEqual(['b', 'c'])
    expect(r.verstuurd).toBe(1)
  })

  it('laat een afstreping met een andere fout vallen en gaat door', async () => {
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b')], async (id) => {
      if (id === 'a') throw { code: '42501', message: 'permission denied' }
      return true
    })
    expect(r).toEqual({ resterend: [], verstuurd: 1, vervallen: 0, mislukt: 1 })
  })
})
