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
}

export type Wachtrij = Wachtrijitem[]

export interface Verzendresultaat {
  resterend: Wachtrij
  verstuurd: number
  vervallen: number
  mislukt: number
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

export function leesKopie(opslag: Storage): Kopie | null {
  const waarde = leesJson(opslag, KOPIE_SLEUTEL)
  if (typeof waarde !== 'object' || waarde === null) return null
  const k = waarde as Partial<Kopie>
  const geldig =
    k.versie === 1 &&
    typeof k.eigenaar === 'string' &&
    typeof k.bewaardOp === 'string' &&
    typeof k.huishouden === 'object' && k.huishouden !== null &&
    Array.isArray(k.plaatsen) &&
    Array.isArray(k.items)
  return geldig ? (k as Kopie) : null
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
 * Is dit een netwerkfout? postgrest-js vangt een mislukte fetch op en geeft
 * `{ code: '', message: `${fetchError.name}: ${fetchError.message}` }` terug
 * (node_modules/@supabase/postgrest-js/dist/index.mjs). Een mislukte fetch is
 * altijd een TypeError ("Failed to fetch", "NetworkError…", "Load failed").
 * Een afgebroken verzoek heeft ook code '', maar begint met "AbortError:".
 */
export function isNetwerkfout(oorzaak: unknown, online: boolean): boolean {
  if (!online) return true
  if (oorzaak instanceof TypeError) return true
  if (typeof oorzaak !== 'object' || oorzaak === null) return false
  const { code, message } = oorzaak as { code?: unknown; message?: unknown }
  return code === '' && typeof message === 'string' && message.startsWith('TypeError: ')
}

/**
 * Verstuurt in volgorde (spec §6). `sluit` is useInventory().close(): true is
 * verstuurd, false is vervallen (al afgestreept of verwijderd). Een
 * netwerkfout stopt de verzending en houdt dat item en de rest vast; een
 * andere fout laat het item vallen.
 */
export async function verstuurWachtrij(
  wachtrij: Wachtrij,
  sluit: (itemId: string, reden: Reden) => Promise<boolean>,
): Promise<Verzendresultaat> {
  const resultaat: Verzendresultaat = { resterend: [], verstuurd: 0, vervallen: 0, mislukt: 0 }
  for (let i = 0; i < wachtrij.length; i++) {
    const item = wachtrij[i]!
    try {
      if (await sluit(item.itemId, item.reden)) resultaat.verstuurd++
      else resultaat.vervallen++
    } catch (oorzaak) {
      if (isNetwerkfout(oorzaak, true)) {
        resultaat.resterend = wachtrij.slice(i)
        return resultaat
      }
      resultaat.mislukt++
    }
  }
  return resultaat
}
