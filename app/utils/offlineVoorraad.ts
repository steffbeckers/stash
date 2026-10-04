/**
 * De offline voorraad, zonder Nuxt.
 *
 * Een lokale kopie van de voorraad en een wachtrij van afstrepingen, allebei
 * in een `Storage` (in de app: localStorage). De opslag komt als parameter
 * binnen, zodat de unittests een nep-opslag kunnen meegeven. Zie
 * docs/superpowers/specs/2026-10-03-offline-voorraad-design.md.
 */
import type { Bewaarplaats, Reden, VoorraadItem } from './voorraad'

export const KOPIE_SLEUTEL = 'stash.offline.kopie'
export const WACHTRIJ_SLEUTEL = 'stash.offline.wachtrij'

export interface Kopie {
  versie: 1
  /** Gebruikers-id. De kopie draagt haar eigenaar zelf: offline is er misschien geen sessie. */
  eigenaar: string
  huishouden: { id: string; naam: string }
  bewaardOp: string
  plaatsen: Bewaarplaats[]
  items: VoorraadItem[]
}

export interface Wachtrijitem {
  itemId: string
  reden: Reden
  eigenaar: string
  /** Alleen voor weergave; de database zet closed_at zelf bij ontvangst. */
  afgestreeptOp: string
  /** Om ongedaan maken terug te kunnen zetten in de kopie. */
  item: VoorraadItem
  /**
   * De laatste verzendpoging faalde zonder antwoord van de server terwijl het
   * toestel vooraf online was: misschien kreeg de server de afstreping toch
   * (spec termijn §5). In de ingang en niet in het geheugen, zodat elk
   * tabblad het ziet (spec twee-tabbladen §4). Alleen precies true telt.
   */
  onzeker?: true
}

export type Wachtrij = Wachtrijitem[]

export interface Verzendresultaat {
  resterend: Wachtrij
  verstuurd: number
  vervallen: number
  mislukt: number
  /**
   * Het item waarvan de poging online faalde zonder antwoord van de server:
   * misschien kreeg de server het toch (spec termijn §5). Anders null.
   */
  onzeker: string | null
}

/** Lezen crasht nooit: de offline-pagina moet altijd openen. */
function leesJson(opslag: Storage, sleutel: string): unknown {
  try {
    const ruw = opslag.getItem(sleutel)
    return ruw === null ? null : JSON.parse(ruw)
  } catch {
    return null
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

/** Genoeg om de pagina te renderen zonder te crashen op een kapot element. */
function isHuishouden(x: unknown): x is Kopie['huishouden'] {
  return isRecord(x) && typeof x.id === 'string' && typeof x.naam === 'string'
}

function isPlaats(x: unknown): x is Bewaarplaats {
  return isRecord(x) && typeof x.id === 'string' && typeof x.name === 'string'
}

function isVoorraadItem(x: unknown): x is VoorraadItem {
  return (
    isRecord(x) &&
    typeof x.id === 'string' &&
    typeof x.naam === 'string' &&
    typeof x.storagePlaceId === 'string'
  )
}

export function leesKopie(opslag: Storage): Kopie | null {
  const waarde = leesJson(opslag, KOPIE_SLEUTEL)
  if (typeof waarde !== 'object' || waarde === null) return null
  const k = waarde as Partial<Kopie>
  const geldig =
    k.versie === 1 &&
    typeof k.eigenaar === 'string' &&
    typeof k.bewaardOp === 'string' &&
    isHuishouden(k.huishouden) &&
    Array.isArray(k.plaatsen) &&
    Array.isArray(k.items)
  if (!geldig) return null
  // Kapotte elementen vallen weg in plaats van de pagina later te laten crashen.
  return { ...(k as Kopie), plaatsen: k.plaatsen!.filter(isPlaats), items: k.items!.filter(isVoorraadItem) }
}

function isWachtrijitem(x: unknown): x is Wachtrijitem {
  if (typeof x !== 'object' || x === null) return false
  const w = x as Partial<Wachtrijitem>
  return (
    typeof w.itemId === 'string' &&
    (w.reden === 'consumed' || w.reden === 'discarded') &&
    typeof w.eigenaar === 'string' &&
    typeof w.item === 'object' && w.item !== null
  )
}

export function leesWachtrij(opslag: Storage): Wachtrij {
  const waarde = leesJson(opslag, WACHTRIJ_SLEUTEL)
  return Array.isArray(waarde) ? waarde.filter(isWachtrijitem) : []
}

/** Kan gooien (opslag vol, privémodus): de aanroeper vangt dat op. */
export function schrijfKopie(opslag: Storage, kopie: Kopie): void {
  opslag.setItem(KOPIE_SLEUTEL, JSON.stringify(kopie))
}

/** Een lege wachtrij verwijdert de sleutel. Kan gooien, zoals schrijfKopie. */
export function schrijfWachtrij(opslag: Storage, wachtrij: Wachtrij): void {
  if (wachtrij.length === 0) opslag.removeItem(WACHTRIJ_SLEUTEL)
  else opslag.setItem(WACHTRIJ_SLEUTEL, JSON.stringify(wachtrij))
}

export function wisKopie(opslag: Storage): void {
  opslag.removeItem(KOPIE_SLEUTEL)
}

export function wisAlles(opslag: Storage): void {
  opslag.removeItem(KOPIE_SLEUTEL)
  opslag.removeItem(WACHTRIJ_SLEUTEL)
}

export function streepAfInKopie(kopie: Kopie, itemId: string): Kopie {
  return { ...kopie, items: kopie.items.filter((i) => i.id !== itemId) }
}

export function zetTerugInKopie(kopie: Kopie, item: VoorraadItem): Kopie {
  if (kopie.items.some((i) => i.id === item.id)) return kopie
  return { ...kopie, items: [...kopie.items, item] }
}

export function wachtrijVoor(wachtrij: Wachtrij, gebruikerId: string): Wachtrij {
  return wachtrij.filter((i) => i.eigenaar === gebruikerId)
}

/** Spec §8: wat van een andere gebruiker is, wordt nooit getoond of verstuurd. */
export function ruimOpVoor(
  kopie: Kopie | null,
  wachtrij: Wachtrij,
  gebruikerId: string,
): { kopie: Kopie | null; wachtrij: Wachtrij } {
  return {
    kopie: kopie !== null && kopie.eigenaar === gebruikerId ? kopie : null,
    wachtrij: wachtrijVoor(wachtrij, gebruikerId),
  }
}

/**
 * De wachtrij na een verzending, samengevoegd met wat er intussen in de
 * opslag staat (`huidig`). Een item uit de momentopname (`verzonden`) blijft
 * alleen staan als het nog niet verstuurd is (`resterend`) én nog in `huidig`
 * staat: is het intussen ongedaan gemaakt, dan blijft het weg. Al het andere
 * in `huidig` — ook een item dat ongedaan gemaakt en opnieuw afgestreept is,
 * met een andere `afgestreeptOp` — is nieuw en blijft staan.
 */
export function voegWachtrijSamen(huidig: Wachtrij, verzonden: Wachtrij, resterend: Wachtrij): Wachtrij {
  const zelfde = (a: Wachtrijitem, b: Wachtrijitem) => a.itemId === b.itemId && a.afgestreeptOp === b.afgestreeptOp
  return huidig.filter((i) => !verzonden.some((v) => zelfde(v, i)) || resterend.some((r) => zelfde(r, i)))
}

/**
 * Zet het onzeker-merk op precies de ingang van deze afstreping: hetzelfde
 * itemId én afgestreeptOp, zoals voegWachtrijSamen een ingang herkent. Een
 * opnieuw afgestreepte ingang van hetzelfde item blijft ongemoeid.
 */
export function markeerOnzeker(wachtrij: Wachtrij, ingang: Wachtrijitem): Wachtrij {
  return wachtrij.map((w) =>
    w.itemId === ingang.itemId && w.afgestreeptOp === ingang.afgestreeptOp ? { ...w, onzeker: true } : w,
  )
}

export const WACHTRIJ_SLOT = 'stash.wachtrij'

/**
 * Doet `werk` onder het wachtrijslot (spec twee-tabbladen §3). Met Web Locks
 * is dat slot exclusief over alle tabbladen van deze oorsprong, en laat een
 * tabblad dat sluit het vanzelf los. Zonder Web Locks eerst wachten op
 * `anders`: in de app is dat de verzending in het eigen tabblad, het gedrag
 * van vóór het slot.
 */
export async function metWachtrijslot<T>(
  locks: LockManager | undefined,
  anders: () => Promise<unknown>,
  werk: () => T | Promise<T>,
): Promise<T> {
  if (locks) return locks.request(WACHTRIJ_SLOT, () => werk()) as Promise<T>
  await anders()
  return werk()
}

/**
 * Is dit een netwerkfout? postgrest-js vangt een mislukte fetch op en geeft
 * `{ code: '', message: `${fetchError.name}: ${fetchError.message}` }` terug
 * (node_modules/@supabase/postgrest-js/dist/index.mjs). Een mislukte fetch is
 * een TypeError ("Failed to fetch", "NetworkError…", "Load failed"). Een
 * verzoek dat de termijn afbrak (app/utils/termijn.ts), is een AbortError.
 */
export function isNetwerkfout(oorzaak: unknown, online: boolean): boolean {
  if (!online) return true
  if (oorzaak instanceof TypeError) return true
  if (!isRecord(oorzaak)) return false
  // De afgebroken fetch zelf, nog niet ingepakt door postgrest-js. Een
  // DOMException heeft een numerieke code, een databasefout een string.
  if (oorzaak.name === 'AbortError' && typeof oorzaak.code !== 'string') return true
  const { code, message } = oorzaak
  return code === '' && typeof message === 'string' && (message.startsWith('TypeError: ') || message.startsWith('AbortError: '))
}

/**
 * Een expliciete data- of integriteitsfout: een SQLSTATE van vijf tekens uit
 * klasse 22 (data, bv. 22P02 ongeldige invoer) of 23 (integriteit, bv. 23514
 * check-constraint). Alleen zo'n fout zegt dat opnieuw proberen nooit lukt.
 */
function isDefinitieveFout(oorzaak: unknown): boolean {
  return isRecord(oorzaak) && typeof oorzaak.code === 'string' && /^2[23][0-9A-Z]{3}$/.test(oorzaak.code)
}

/** Een niet-lege code: de server antwoordde, en weigerde. */
export function heeftFoutcode(oorzaak: unknown): boolean {
  return isRecord(oorzaak) && typeof oorzaak.code === 'string' && oorzaak.code !== ''
}

/** In een omgeving zonder navigator (of zonder onLine) gaan we uit van online. */
function standaardOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/**
 * Verstuurt in volgorde (spec §6). `sluit` is useInventory().close(): true is
 * verstuurd, false is vervallen (al afgestreept, verwijderd, of geen lid meer:
 * RLS maakt van dat laatste nul rijen, geen fout).
 *
 * Sluiten is idempotent, dus een item bewaren kost niets en het laten vallen
 * kan werk kwijtmaken. Daarom valt een item alleen weg (`mislukt`) bij een
 * expliciete data- of integriteitsfout (klasse 22 of 23) terwijl het toestel
 * online is (`online()`). Elke andere fout stopt de verzending en houdt dat
 * item en de rest vast: een netwerkfout, een afgebroken verzoek, een verlopen
 * sessie (42501 met de anon-sleutel, PGRST301), een serverfout, een antwoord
 * zonder databasecode (captive portal, proxy) of een gegooide niet-object.
 *
 * Faalt een poging zonder antwoord van de server (geen code) terwijl het
 * toestel vóór de poging online was, dan is dat item `onzeker`: ongedaan maken
 * moet het ook op de server heropenen. Vóór de poging, niet in de `catch`:
 * valt de verbinding weg midden in het antwoord, dan is het toestel daar al
 * offline, terwijl de server de afstreping misschien heeft.
 */
export async function verstuurWachtrij(
  wachtrij: Wachtrij,
  sluit: (itemId: string, reden: Reden) => Promise<boolean>,
  online: () => boolean = standaardOnline,
): Promise<Verzendresultaat> {
  const resultaat: Verzendresultaat = { resterend: [], verstuurd: 0, vervallen: 0, mislukt: 0, onzeker: null }
  for (let i = 0; i < wachtrij.length; i++) {
    const item = wachtrij[i]!
    const vooraf = online()
    try {
      if (await sluit(item.itemId, item.reden)) resultaat.verstuurd++
      else resultaat.vervallen++
    } catch (oorzaak) {
      const isOnline = online()
      if (!isOnline || !isDefinitieveFout(oorzaak)) {
        resultaat.resterend = wachtrij.slice(i)
        if (vooraf && !heeftFoutcode(oorzaak)) resultaat.onzeker = item.itemId
        return resultaat
      }
      resultaat.mislukt++
    }
  }
  return resultaat
}
