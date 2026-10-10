/**
 * De voorraad, zonder Nuxt.
 *
 * Alles hier is puur: geen useI18n, geen supabase, geen new Date() buiten
 * lokaleDatum() — "vandaag" komt altijd als parameter binnen. Daardoor is het
 * met gewone unittests te toetsen (test/utils/voorraad.test.ts), zonder de
 * Nuxt-runtime die vitest.config.ts bewust niet biedt.
 *
 * Datums zijn overal strings van de vorm YYYY-MM-DD, zoals Postgres een
 * `date` teruggeeft. Lexicografisch vergelijken is dan chronologisch
 * vergelijken, en er is geen tijdzone die een dag kan verschuiven.
 */

export const EENHEDEN = ['stuk', 'kg', 'g', 'l', 'ml'] as const
export type VoorraadEenheid = (typeof EENHEDEN)[number]
export const GEWICHTSEENHEDEN = ['kg', 'g', 'l', 'ml'] as const

export type Reden = 'consumed' | 'discarded'

/** Spec §6: "vervalt binnenkort" is vandaag + 3 dagen of eerder. */
export const VERVALT_BINNENKORT_DAGEN = 3

/** Spec §6: tegen een typefout die vijfhonderd rijen maakt. */
export const MAX_AANTAL = 50

export interface Bewaarplaats {
  id: string
  name: string
  kind: 'pantry' | 'fridge' | 'freezer' | 'other'
}

export interface GekozenProduct {
  productId: string
  naam: string
}

export interface VoorraadItem {
  id: string
  productId: string
  naam: string
  getoondeTaal: string
  merk: string | null
  storagePlaceId: string
  amount: number
  unit: VoorraadEenheid
  acquiredAt: string
  expiresAt: string | null
  createdAt: string
}

/** Items met dezelfde vervaldatum, hoeveelheid en eenheid: uitwisselbaar. */
export interface Variant {
  sleutel: string
  expiresAt: string | null
  amount: number
  unit: VoorraadEenheid
  /** Oudste created_at eerst: bij afstrepen gaat items[0] eraf. */
  items: VoorraadItem[]
}

export interface Productgroep {
  productId: string
  naam: string
  getoondeTaal: string
  merk: string | null
  items: VoorraadItem[]
  varianten: Variant[]
  vroegsteVervaldatum: string | null
}

export type Groepslabel =
  | { soort: 'aantal'; aantal: number }
  | { soort: 'totaal'; totalen: { unit: VoorraadEenheid; amount: number }[] }

/**
 * De kalenderdag van dit toestel. Niet toISOString(): dat is UTC, en om
 * half één 's nachts in België is het in UTC nog gisteren.
 */
export function lokaleDatum(moment: Date): string {
  const jaar = moment.getFullYear()
  const maand = String(moment.getMonth() + 1).padStart(2, '0')
  const dag = String(moment.getDate()).padStart(2, '0')
  return `${jaar}-${maand}-${dag}`
}

/** Rekent in UTC, zodat een zomeruur-overgang geen dag kan opeten. */
export function plusDagen(datum: string, dagen: number): string {
  const d = new Date(`${datum}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dagen)
  return d.toISOString().slice(0, 10)
}

export function isVervallen(item: { expiresAt: string | null }, vandaag: string): boolean {
  return item.expiresAt !== null && item.expiresAt < vandaag
}

/** Vroegste vervaldatum eerst, zonder datum achteraan, dan oudste eerst. */
function opDatum(a: VoorraadItem, b: VoorraadItem): number {
  if (a.expiresAt !== b.expiresAt) {
    if (a.expiresAt === null) return 1
    if (b.expiresAt === null) return -1
    return a.expiresAt < b.expiresAt ? -1 : 1
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return 0
}

export function vervaltBinnenkort(items: VoorraadItem[], vandaag: string): VoorraadItem[] {
  const grens = plusDagen(vandaag, VERVALT_BINNENKORT_DAGEN)
  return items.filter((i) => i.expiresAt !== null && i.expiresAt <= grens).sort(opDatum)
}

/** Eén rij in de strook: zelfde product, zelfde vervaldatum. */
export interface Strookrij {
  sleutel: string
  productId: string
  naam: string
  expiresAt: string
  aantal: number
}

/**
 * Drie potten passata met dezelfde datum zijn in de strook één rij met ×3.
 * Twee datums blijven twee rijen: dat verschil is wat de strook moet tonen.
 * Bedoeld voor de uitkomst van vervaltBinnenkort(), dus items met een datum.
 */
export function groepeerStrook(items: VoorraadItem[]): Strookrij[] {
  const perSleutel = new Map<string, Strookrij>()
  for (const item of [...items].sort(opDatum)) {
    if (item.expiresAt === null) continue
    const sleutel = `${item.productId}|${item.expiresAt}`
    let rij = perSleutel.get(sleutel)
    if (!rij) {
      rij = { sleutel, productId: item.productId, naam: item.naam, expiresAt: item.expiresAt, aantal: 0 }
      perSleutel.set(sleutel, rij)
    }
    rij.aantal++
  }
  return [...perSleutel.values()]
}

export function varianten(items: VoorraadItem[]): Variant[] {
  const perSleutel = new Map<string, Variant>()
  // Gesorteerd vóór het groeperen: een Map houdt de invoegvolgorde aan, dus
  // de varianten komen er in datumvolgorde uit en hun items oudste eerst.
  for (const item of [...items].sort(opDatum)) {
    const sleutel = `${item.expiresAt ?? 'geen'}|${item.amount}|${item.unit}`
    let variant = perSleutel.get(sleutel)
    if (!variant) {
      variant = { sleutel, expiresAt: item.expiresAt, amount: item.amount, unit: item.unit, items: [] }
      perSleutel.set(sleutel, variant)
    }
    variant.items.push(item)
  }
  return [...perSleutel.values()]
}

export function groepeerPerPlaats(items: VoorraadItem[]): Map<string, Productgroep[]> {
  const perPlaats = new Map<string, Map<string, VoorraadItem[]>>()
  for (const item of items) {
    let perProduct = perPlaats.get(item.storagePlaceId)
    if (!perProduct) {
      perProduct = new Map()
      perPlaats.set(item.storagePlaceId, perProduct)
    }
    let lijst = perProduct.get(item.productId)
    if (!lijst) {
      lijst = []
      perProduct.set(item.productId, lijst)
    }
    lijst.push(item)
  }

  const uitkomst = new Map<string, Productgroep[]>()
  for (const [plaatsId, perProduct] of perPlaats) {
    const groepen = [...perProduct.values()].map((lijst): Productgroep => {
      const v = varianten(lijst)
      const eerste = lijst[0]!
      return {
        productId: eerste.productId,
        naam: eerste.naam,
        getoondeTaal: eerste.getoondeTaal,
        merk: eerste.merk,
        items: [...lijst].sort(opDatum),
        varianten: v,
        // Varianten staan vroegste eerst met "geen datum" achteraan, dus de
        // eerste is de vroegste — of null als geen enkel item een datum heeft.
        vroegsteVervaldatum: v[0]!.expiresAt,
      }
    })
    groepen.sort((a, b) => a.naam.localeCompare(b.naam) || a.productId.localeCompare(b.productId))
    uitkomst.set(plaatsId, groepen)
  }
  return uitkomst
}

/** Spec §6: "×N" als alles 1 stuk is, anders het totaal per eenheid. */
export function groepslabel(items: VoorraadItem[]): Groepslabel {
  if (items.every((i) => i.unit === 'stuk' && i.amount === 1)) {
    return { soort: 'aantal', aantal: items.length }
  }
  const totalen = new Map<VoorraadEenheid, number>()
  for (const i of items) totalen.set(i.unit, (totalen.get(i.unit) ?? 0) + i.amount)
  return {
    soort: 'totaal',
    totalen: EENHEDEN.filter((e) => totalen.has(e)).map((unit) => ({
      unit,
      // Op drie decimalen: 0,684 + 0,5 is in een double 1,1840000000000002.
      amount: Math.round(totalen.get(unit)! * 1000) / 1000,
    })),
  }
}

/** "0,684 kg" in het Nederlands, "0.684 kg" in het Engels. */
export function formatHoeveelheid(amount: number, unit: VoorraadEenheid, locale: string): string {
  return `${new Intl.NumberFormat(locale).format(amount)} ${unit}`
}

/** "3 okt", of "3 okt 2027" buiten het lopende jaar. */
export function formatDatum(datum: string, locale: string, vandaag: string): string {
  const zelfdeJaar = datum.slice(0, 4) === vandaag.slice(0, 4)
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(zelfdeJaar ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(new Date(`${datum}T00:00:00Z`))
}

/**
 * Is dit de samenhangcheck op inventory_item? Dat is wat een plaats met
 * voorraad tegenhoudt, en wat ongedaan maken tegenhoudt als de plaats
 * intussen weg is (spec §4 en §6).
 *
 * Code én constraintnaam: 23514 alleen is élke check-schending, ook een
 * hoeveelheid van nul.
 */
export function isSamenhangFout(oorzaak: unknown): boolean {
  if (typeof oorzaak !== 'object' || oorzaak === null) return false
  const { code, message } = oorzaak as { code?: unknown; message?: unknown }
  return code === '23514' && typeof message === 'string' && message.includes('inventory_item_samenhang')
}

/**
 * Kwam een eerdere poging met dezelfde id's al aan? Dan botst deze insert op
 * de primaire sleutel (spec geen-dubbele-toevoeging §4). Code én
 * constraintnaam, zoals isSamenhangFout: 23505 alleen is élke unieke botsing.
 */
export function isAlToegevoegd(oorzaak: unknown): boolean {
  if (typeof oorzaak !== 'object' || oorzaak === null) return false
  const { code, message } = oorzaak as { code?: unknown; message?: unknown }
  return code === '23505' && typeof message === 'string' && message.includes('inventory_item_pkey')
}

/** Een toevoeging en haar id's (spec geen-dubbele-toevoeging §3). */
export interface Poging {
  sleutel: string
  ids: string[]
}

/**
 * Dezelfde gegevens geven dezelfde id's: een nieuwe poging na een afgebroken
 * verzoek botst dan op de primaire sleutel in plaats van een dubbel te maken.
 * Andere gegevens, of een ander aantal, zijn een andere toevoeging.
 */
export function idsVoorPoging(vorige: Poging | null, sleutel: string, aantal: number, nieuwId: () => string): Poging {
  if (vorige && vorige.sleutel === sleutel && vorige.ids.length === aantal) return vorige
  return { sleutel, ids: Array.from({ length: aantal }, () => nieuwId()) }
}

/**
 * De sleutel van een voorraadtoevoeging: alleen wat de gebruiker invulde.
 * acquiredAt hoort er niet in: dat is vandaag, en een nieuwe poging na
 * middernacht blijft dezelfde toevoeging.
 */
export function toevoegsleutel(g: {
  productId: string
  storagePlaceId: string
  aantal: number
  amount: number
  unit: string
  expiresAt: string | null
}): string {
  return JSON.stringify([g.productId, g.storagePlaceId, g.aantal, g.amount, g.unit, g.expiresAt])
}
