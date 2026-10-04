import { afterEach, describe, it, expect, vi } from 'vitest'
import {
  KOPIE_SLEUTEL,
  WACHTRIJ_SLEUTEL,
  WACHTRIJ_SLOT,
  isNetwerkfout,
  leesKopie,
  leesWachtrij,
  markeerOnzeker,
  metWachtrijslot,
  ruimOpVoor,
  schrijfKopie,
  schrijfWachtrij,
  streepAfInKopie,
  verstuurWachtrij,
  voegWachtrijSamen,
  wachtrijVoor,
  wisAlles,
  wisKopie,
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

  // De termijn (app/utils/termijn.ts) breekt af met een AbortError; postgrest-js
  // maakt daar `AbortError: …` met code '' van.
  it('herkent een afgebroken verzoek als netwerkfout', () => {
    expect(isNetwerkfout({ code: '', message: 'AbortError: signal is aborted without reason' }, true)).toBe(true)
  })

  it('herkent een rauwe AbortError als netwerkfout', () => {
    expect(isNetwerkfout(new DOMException('afgebroken', 'AbortError'), true)).toBe(true)
  })

  // De code beslist, ook als de melding toevallig op een afbreking lijkt.
  it('herkent een databasefout met AbortError in de melding niet als netwerkfout', () => {
    expect(isNetwerkfout({ code: '23514', message: 'AbortError: x' }, true)).toBe(false)
    expect(isNetwerkfout({ name: 'AbortError', code: '23514', message: 'x' }, true)).toBe(false)
  })

  it('herkent een andere DOMException niet als netwerkfout', () => {
    expect(isNetwerkfout(new DOMException('vol', 'QuotaExceededError'), true)).toBe(false)
  })
})

describe('verstuurWachtrij', () => {
  const netwerkfout = { code: '', message: 'TypeError: Failed to fetch' }

  it('telt verstuurd en vervallen, en laat niets achter', async () => {
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b')], async (id) => id === 'a')
    expect(r).toEqual({ resterend: [], verstuurd: 1, vervallen: 1, mislukt: 0, onzeker: null })
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
    expect(r).toMatchObject({ verstuurd: 1, vervallen: 0, mislukt: 0 })
  })

  it('houdt de hele wachtrij vast bij een netwerkfout op het eerste item', async () => {
    const geprobeerd: string[] = []
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b'), inWachtrij('c')], async (id) => {
      geprobeerd.push(id)
      throw netwerkfout
    })
    expect(geprobeerd).toEqual(['a'])
    expect(r.resterend.map((i) => i.itemId)).toEqual(['a', 'b', 'c'])
    expect(r).toMatchObject({ verstuurd: 0, vervallen: 0, mislukt: 0 })
  })

  it('houdt alleen het laatste item vast bij een netwerkfout op het laatste item', async () => {
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b'), inWachtrij('c')], async (id) => {
      if (id === 'c') throw netwerkfout
      return id === 'a'
    })
    expect(r.resterend.map((i) => i.itemId)).toEqual(['c'])
    expect(r).toMatchObject({ verstuurd: 1, vervallen: 1, mislukt: 0 })
  })

  // Een check-constraint: opnieuw versturen lukt nooit, dus het item valt weg.
  it('laat een afstreping met een integriteitsfout (23514) vallen en gaat door met het volgende item', async () => {
    const geprobeerd: string[] = []
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b')], async (id) => {
      geprobeerd.push(id)
      if (id === 'a') throw { code: '23514', message: 'new row violates check constraint' }
      return true
    })
    expect(geprobeerd).toEqual(['a', 'b'])
    expect(r).toEqual({ resterend: [], verstuurd: 1, vervallen: 0, mislukt: 1, onzeker: null })
  })

  it('laat een afstreping met een datafout (22P02) vallen', async () => {
    const r = await verstuurWachtrij([inWachtrij('a')], async () => {
      throw { code: '22P02', message: 'invalid input syntax for type uuid' }
    })
    expect(r).toEqual({ resterend: [], verstuurd: 0, vervallen: 0, mislukt: 1, onzeker: null })
  })

  // Een verlopen sessie: supabase-js stuurt dan de anon-sleutel mee, en anon
  // heeft geen rechten op inventory_item. Met een nieuwe sessie lukt het wel.
  it('houdt een afstreping vast bij permission denied (42501)', async () => {
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b')], async () => {
      throw { code: '42501', message: 'permission denied for table inventory_item' }
    })
    expect(r.resterend.map((i) => i.itemId)).toEqual(['a', 'b'])
    expect(r).toMatchObject({ verstuurd: 0, vervallen: 0, mislukt: 0 })
  })
})

/** Een opslag waarvan lezen faalt, zoals Safari in privémodus of geblokkeerde sitegegevens. */
class KapotteOpslag extends NepOpslag {
  override getItem(): string | null {
    throw new Error('opslag geblokkeerd')
  }
}

describe('lezen crasht nooit', () => {
  it('geeft geen kopie en een lege wachtrij als de opslag zelf gooit', () => {
    const opslag = new KapotteOpslag()
    expect(leesKopie(opslag)).toBeNull()
    expect(leesWachtrij(opslag)).toEqual([])
  })

  it.each(['null', '42', '"tekst"'])('geeft geen kopie bij de opgeslagen waarde %s', (ruw) => {
    const opslag = new NepOpslag()
    opslag.setItem(KOPIE_SLEUTEL, ruw)
    expect(leesKopie(opslag)).toBeNull()
  })

  it('geeft een lege wachtrij als er een object in staat in plaats van een lijst', () => {
    const opslag = new NepOpslag()
    opslag.setItem(WACHTRIJ_SLEUTEL, '{}')
    expect(leesWachtrij(opslag)).toEqual([])
  })

  it('laat wachtrij-elementen weg die geen object zijn', () => {
    const opslag = new NepOpslag()
    opslag.setItem(WACHTRIJ_SLEUTEL, JSON.stringify([null, 'tekst', 42, inWachtrij('a')]))
    expect(leesWachtrij(opslag).map((i) => i.itemId)).toEqual(['a'])
  })

  const kapotteWachtrijitems: [string, unknown][] = [
    ['zonder itemId', { ...inWachtrij('x'), itemId: undefined }],
    ['met een onbekende reden', { ...inWachtrij('x'), reden: 'opgegeten' }],
    ['zonder eigenaar', { ...inWachtrij('x'), eigenaar: undefined }],
    ['zonder item', { ...inWachtrij('x'), item: undefined }],
    ['met item null', { ...inWachtrij('x'), item: null }],
  ]
  it.each(kapotteWachtrijitems)('laat een wachtrij-element %s weg', (_naam, kapot) => {
    const opslag = new NepOpslag()
    opslag.setItem(WACHTRIJ_SLEUTEL, JSON.stringify([kapot, inWachtrij('a')]))
    expect(leesWachtrij(opslag).map((i) => i.itemId)).toEqual(['a'])
  })

  const kopieZonder: [string, Record<string, unknown>][] = [
    ['eigenaar', { eigenaar: undefined }],
    ['bewaardOp', { bewaardOp: undefined }],
    ['huishouden', { huishouden: undefined }],
    ['plaatsen', { plaatsen: undefined }],
    ['items', { items: undefined }],
    ['huishouden.id', { huishouden: { naam: 'Thuis' } }],
    ['huishouden.naam', { huishouden: { id: 'h1' } }],
    ['huishouden (null)', { huishouden: null }],
  ]
  it.each(kopieZonder)('geeft geen kopie zonder %s', (_naam, over) => {
    const opslag = new NepOpslag()
    opslag.setItem(KOPIE_SLEUTEL, JSON.stringify({ ...kopie(), ...over }))
    expect(leesKopie(opslag)).toBeNull()
  })
})

describe('kapotte elementen in de kopie', () => {
  it('laat items weg die geen object zijn', () => {
    const opslag = new NepOpslag()
    opslag.setItem(KOPIE_SLEUTEL, JSON.stringify(kopie({ items: [null, 'tekst', item('a')] as unknown as VoorraadItem[] })))
    expect(leesKopie(opslag)?.items).toEqual([item('a')])
  })

  it.each(['id', 'naam', 'storagePlaceId'])('laat een item zonder %s weg', (veld) => {
    const opslag = new NepOpslag()
    const kapot = { ...item('x'), [veld]: undefined } as unknown as VoorraadItem
    opslag.setItem(KOPIE_SLEUTEL, JSON.stringify(kopie({ items: [kapot, item('a')] })))
    expect(leesKopie(opslag)?.items.map((i) => i.id)).toEqual(['a'])
  })

  it('laat plaatsen weg die geen object zijn', () => {
    const opslag = new NepOpslag()
    const goed = { id: 'kast', name: 'Kast', kind: 'pantry' as const }
    opslag.setItem(KOPIE_SLEUTEL, JSON.stringify(kopie({ plaatsen: [null, goed] as unknown as Kopie['plaatsen'] })))
    expect(leesKopie(opslag)?.plaatsen).toEqual([goed])
  })

  it.each(['id', 'name'])('laat een plaats zonder %s weg', (veld) => {
    const opslag = new NepOpslag()
    const goed = { id: 'kast', name: 'Kast', kind: 'pantry' as const }
    const kapot = { ...goed, id: 'x', [veld]: undefined } as unknown as Kopie['plaatsen'][number]
    opslag.setItem(KOPIE_SLEUTEL, JSON.stringify(kopie({ plaatsen: [kapot, goed] })))
    expect(leesKopie(opslag)?.plaatsen).toEqual([goed])
  })
})

describe('wissen', () => {
  function gevuldeOpslag(): NepOpslag {
    const opslag = new NepOpslag()
    schrijfKopie(opslag, kopie())
    schrijfWachtrij(opslag, [inWachtrij('a')])
    return opslag
  }

  it('wisKopie verwijdert alleen de kopie en laat de wachtrij staan', () => {
    const opslag = gevuldeOpslag()
    wisKopie(opslag)
    expect(opslag.getItem(KOPIE_SLEUTEL)).toBeNull()
    expect(leesWachtrij(opslag).length).toBe(1)
  })

  it('wisAlles verwijdert de kopie en de wachtrij', () => {
    const opslag = gevuldeOpslag()
    wisAlles(opslag)
    expect(opslag.getItem(KOPIE_SLEUTEL)).toBeNull()
    expect(opslag.getItem(WACHTRIJ_SLEUTEL)).toBeNull()
  })
})

describe('ruimOpVoor zonder kopie', () => {
  it('houdt de eigen wachtrij en crasht niet op een ontbrekende kopie', () => {
    const r = ruimOpVoor(null, [inWachtrij('a', 'ada'), inWachtrij('b', 'bob')], 'ada')
    expect(r.kopie).toBeNull()
    expect(r.wachtrij.map((i) => i.itemId)).toEqual(['a'])
  })
})

describe('isNetwerkfout met rare invoer', () => {
  it.each([null, undefined, 'tekst', 42])('geeft false en crasht niet bij %s', (oorzaak) => {
    expect(isNetwerkfout(oorzaak, true)).toBe(false)
  })

  // Pint `code === ''`: dit is een databasefout die toevallig zo begint.
  it('herkent een databasefout niet aan een melding die met TypeError begint', () => {
    expect(isNetwerkfout({ code: '23514', message: 'TypeError: x' }, true)).toBe(false)
  })

  it('geeft false zonder melding', () => {
    expect(isNetwerkfout({ code: '' }, true)).toBe(false)
  })
})

describe('verstuurWachtrij bij onzekerheid', () => {
  const verlopen = { code: 'PGRST301', message: 'JWT expired' }
  const integriteitsfout = { code: '23514', message: 'new row violates check constraint' }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Offline is elke fout onzeker, ook een die online definitief zou zijn.
  it('houdt het item vast bij een integriteitsfout als het toestel offline is', async () => {
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b')], async () => { throw integriteitsfout }, () => false)
    expect(r.resterend.map((i) => i.itemId)).toEqual(['a', 'b'])
    expect(r.mislukt).toBe(0)
  })

  it('houdt een verlopen sessie vast', async () => {
    const r = await verstuurWachtrij([inWachtrij('a')], async () => { throw verlopen }, () => true)
    expect(r.resterend.map((i) => i.itemId)).toEqual(['a'])
    expect(r.mislukt).toBe(0)
  })

  it('gebruikt navigator.onLine als er geen online-functie is meegegeven', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const r = await verstuurWachtrij([inWachtrij('a')], async () => { throw integriteitsfout })
    expect(r.resterend.length).toBe(1)
  })

  const afgebroken: [string, unknown][] = [
    ['een supabase-fout', { code: '', message: 'AbortError: signal is aborted without reason' }],
    ['een DOMException', { name: 'AbortError', message: 'The operation was aborted.' }],
  ]
  it.each(afgebroken)('houdt het item vast bij %s met een afgebroken verzoek', async (_naam, fout) => {
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b')], async () => { throw fout }, () => true)
    expect(r.resterend.map((i) => i.itemId)).toEqual(['a', 'b'])
    expect(r.mislukt).toBe(0)
  })

  // De code beslist, ook als de melding toevallig op een afbreking lijkt.
  it('telt een databasefout met AbortError in de melding als mislukt', async () => {
    const r = await verstuurWachtrij([inWachtrij('a')], async () => { throw { code: '23514', message: 'AbortError: x' } }, () => true)
    expect(r.mislukt).toBe(1)
  })

  // Een serverfout, een captive portal of een proxy: geen databasecode uit
  // klasse 22 of 23, dus geen bewijs dat opnieuw proberen nooit lukt.
  const zonderCode: [string, unknown][] = [
    ['een lege code', { code: '' }],
    ['geen code', { message: 'Bad Gateway' }],
    ['een code die geen string is', { code: 23514, message: 'x' }],
    ['een PostgREST-code', { code: 'PGRST116', message: 'x' }],
  ]
  it.each(zonderCode)('houdt een fout zonder code vast: %s', async (_naam, fout) => {
    const r = await verstuurWachtrij([inWachtrij('a')], async () => { throw fout }, () => true)
    expect(r.resterend.map((i) => i.itemId)).toEqual(['a'])
    expect(r.mislukt).toBe(0)
  })

  it.each([null, undefined, 'tekst', 42])('crasht niet op een worp van %s en houdt die vast', async (worp) => {
    const r = await verstuurWachtrij([inWachtrij('a')], async () => { throw worp }, () => true)
    expect(r.resterend.map((i) => i.itemId)).toEqual(['a'])
    expect(r.mislukt).toBe(0)
  })
})

describe('verstuurWachtrij en onzeker verstuurd', () => {
  const afgebroken = { code: '', message: 'AbortError: signal is aborted without reason' }

  // Online en zonder antwoord van de server: misschien kwam de afstreping toch aan.
  it('meldt het item dat online zonder antwoord faalde als onzeker', async () => {
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b'), inWachtrij('c')], async (id) => {
      if (id === 'b') throw afgebroken
      return true
    }, () => true)
    expect(r.resterend.map((i) => i.itemId)).toEqual(['b', 'c'])
    expect(r.onzeker).toBe('b')
  })

  it('meldt niets als onzeker als het toestel offline was', async () => {
    const r = await verstuurWachtrij([inWachtrij('a')], async () => { throw afgebroken }, () => false)
    expect(r.resterend.length).toBe(1)
    expect(r.onzeker).toBeNull()
  })

  // De verbinding viel weg midden in het antwoord: in de catch is het toestel
  // al offline, maar de server kan de afstreping hebben.
  it('meldt het item als onzeker als het toestel pas tijdens de poging offline ging', async () => {
    let online = true
    const r = await verstuurWachtrij([inWachtrij('a')], async () => {
      online = false
      throw new TypeError('Failed to fetch')
    }, () => online)
    expect(r.resterend.map((i) => i.itemId)).toEqual(['a'])
    expect(r.onzeker).toBe('a')
  })

  // Een code: de server antwoordde en weigerde. Dan is de afstreping zeker niet toegepast.
  it('meldt een fout met een code niet als onzeker', async () => {
    const r = await verstuurWachtrij([inWachtrij('a')], async () => {
      throw { code: '42501', message: 'permission denied for table inventory_item' }
    }, () => true)
    expect(r.resterend.length).toBe(1)
    expect(r.onzeker).toBeNull()
  })

  it('meldt niets als onzeker bij een definitieve fout of bij succes', async () => {
    const r = await verstuurWachtrij([inWachtrij('a'), inWachtrij('b')], async (id) => {
      if (id === 'a') throw { code: '23514', message: 'new row violates check constraint' }
      return true
    }, () => true)
    expect(r).toEqual({ resterend: [], verstuurd: 1, vervallen: 0, mislukt: 1, onzeker: null })
  })
})

describe('voegWachtrijSamen', () => {
  const a = inWachtrij('a')
  const b = inWachtrij('b')

  it('houdt wat nog niet verstuurd is', () => {
    expect(voegWachtrijSamen([a, b], [a, b], [b])).toEqual([b])
  })

  it('laat een intussen ongedaan gemaakt item weg, ook als het niet verstuurd kon worden', () => {
    // a stond in de momentopname en bleef resterend, maar staat niet meer in de opslag.
    expect(voegWachtrijSamen([b], [a, b], [a, b])).toEqual([b])
  })

  it('houdt wat tijdens het versturen bijkwam', () => {
    const c = inWachtrij('c')
    expect(voegWachtrijSamen([a, c], [a], [])).toEqual([c])
  })

  it('behandelt een opnieuw afgestreept item als nieuw, ook al is het id gelijk', () => {
    const opnieuw = { ...a, afgestreeptOp: '2026-10-03T12:05:00Z' }
    // De oude a is verstuurd (niet resterend); de nieuwe a staat er nu en blijft.
    expect(voegWachtrijSamen([opnieuw], [a], [])).toEqual([opnieuw])
  })

  it('raakt de wachtrij van een andere gebruiker niet', () => {
    const vreemd = inWachtrij('v', 'bob')
    expect(voegWachtrijSamen([a, vreemd], [a], [])).toEqual([vreemd])
  })
})

/** Een belofte die de test zelf vrijgeeft. */
function slot(): { vrij: Promise<void>; vrijgeven: () => void } {
  let vrijgeven!: () => void
  const vrij = new Promise<void>((r) => { vrijgeven = r })
  return { vrij, vrijgeven }
}

/** Een LockManager in het geheugen: exclusief, in volgorde van aanvraag. */
function nepSloten() {
  const namen: string[] = []
  let keten: Promise<unknown> = Promise.resolve()
  const locks = {
    request(naam: string, werk: () => unknown) {
      namen.push(naam)
      const uitkomst = keten.then(() => werk())
      keten = uitkomst.catch(() => {})
      return uitkomst
    },
  } as unknown as LockManager
  return { locks, namen }
}

describe('metWachtrijslot', () => {
  // Spec twee-tabbladen §3: versturen en ongedaan maken nooit door elkaar.
  it('laat twee werken onder het slot na elkaar lopen, niet door elkaar', async () => {
    const { locks, namen } = nepSloten()
    const volgorde: string[] = []
    const a = slot()
    const eerste = metWachtrijslot(locks, async () => {}, async () => {
      volgorde.push('a begint')
      await a.vrij
      volgorde.push('a klaar')
    })
    const tweede = metWachtrijslot(locks, async () => {}, () => { volgorde.push('b') })
    await Promise.resolve()
    a.vrijgeven()
    await Promise.all([eerste, tweede])
    expect(volgorde).toEqual(['a begint', 'a klaar', 'b'])
    expect(namen).toEqual([WACHTRIJ_SLOT, WACHTRIJ_SLOT])
  })

  it('geeft de uitkomst van het werk terug', async () => {
    const { locks } = nepSloten()
    expect(await metWachtrijslot(locks, async () => {}, () => 'klaar')).toBe('klaar')
  })

  // Zonder Web Locks: het gedrag van vóór deze spec, wachten in het eigen tabblad.
  it('wacht zonder LockManager eerst op anders()', async () => {
    const volgorde: string[] = []
    const anders = slot()
    const bezig = metWachtrijslot(undefined, () => anders.vrij, () => { volgorde.push('werk') })
    await Promise.resolve()
    expect(volgorde).toEqual([])
    anders.vrijgeven()
    await bezig
    expect(volgorde).toEqual(['werk'])
  })
})

describe('markeerOnzeker', () => {
  it('merkt de ingang met hetzelfde itemId en afgestreeptOp, en geen andere', () => {
    const a = inWachtrij('a')
    const b = inWachtrij('b')
    expect(markeerOnzeker([a, b], a)).toEqual([{ ...a, onzeker: true }, b])
  })

  // Ongedaan gemaakt en opnieuw afgestreept: een nieuwe ingang, een ander moment.
  it('merkt een opnieuw afgestreepte ingang van hetzelfde item niet', () => {
    const oud = inWachtrij('a')
    const nieuw = { ...inWachtrij('a'), afgestreeptOp: '2026-10-03T13:00:00Z' }
    expect(markeerOnzeker([nieuw], oud)).toEqual([nieuw])
  })
})

describe('het onzeker-merk in de opslag', () => {
  it('leesWachtrij bewaart onzeker: true', () => {
    const o = new NepOpslag()
    schrijfWachtrij(o, [{ ...inWachtrij('a'), onzeker: true }])
    expect(leesWachtrij(o)[0]!.onzeker).toBe(true)
  })
})
