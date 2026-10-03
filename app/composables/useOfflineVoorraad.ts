import type { Bewaarplaats, Reden, VoorraadItem } from '~/utils/voorraad'
import {
  leesKopie,
  leesWachtrij,
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
  type Wachtrij,
} from '~/utils/offlineVoorraad'

// Eén lopende verzending voor de hele app. De plugin en de voorraadpagina
// roepen allebei verstuur() aan; de pagina moet dan wachten op de verzending
// die al loopt, niet ernaast een tweede starten (spec §6).
let lopend: Promise<void> | null = null

/**
 * De lokale kopie en de wachtrij, clientzijdig. Zie spec §4–§6.
 *
 * Gebruikt useNuxtApp().$i18n en niet useI18n(): draait ook in de
 * client-plugin wachtrij.client.ts.
 */
export function useOfflineVoorraad() {
  const user = useSupabaseUser()
  const toast = useToast()
  const { $i18n } = useNuxtApp()
  const { close } = useInventory()

  function opslag(): Storage | null {
    if (!import.meta.client) return null
    try {
      return window.localStorage
    } catch {
      return null
    }
  }

  /** Schrijven mag mislukken (vol, privémodus): loggen, niet gooien. */
  function schrijf(actie: (o: Storage) => void): void {
    const o = opslag()
    if (!o) return
    try {
      actie(o)
    } catch (oorzaak) {
      console.warn('[offline] lokale opslag mislukt', oorzaak)
    }
  }

  function kopie(): Kopie | null {
    const o = opslag()
    return o ? leesKopie(o) : null
  }

  function wachtrij(): Wachtrij {
    const o = opslag()
    return o ? leesWachtrij(o) : []
  }

  function bewaar(huishouden: { id: string; naam: string }, plaatsen: Bewaarplaats[], items: VoorraadItem[]): void {
    const eigenaar = user.value?.sub
    if (!eigenaar) return
    schrijf((o) => schrijfKopie(o, { versie: 1, eigenaar, huishouden, bewaardOp: new Date().toISOString(), plaatsen, items }))
  }

  /**
   * De eigenaar is de ingelogde gebruiker, of — offline zonder sessie — die van
   * de kopie. true alleen als de wachtrij echt geschreven is: faalt dat (vol,
   * geen eigenaar), dan mag de aanroeper de afstreping niet als bewaard tonen.
   */
  function zetInWachtrij(item: VoorraadItem, reden: Reden): boolean {
    let gelukt = false
    schrijf((o) => {
      const k = leesKopie(o)
      const eigenaar = user.value?.sub ?? k?.eigenaar
      if (!eigenaar) return
      schrijfWachtrij(o, [...leesWachtrij(o), { itemId: item.id, reden, eigenaar, afgestreeptOp: new Date().toISOString(), item }])
      gelukt = true
      // Mislukt alleen dit, dan staat de afstreping wel in de wachtrij.
      if (k) schrijfKopie(o, streepAfInKopie(k, item.id))
    })
    return gelukt
  }

  /** true als de afstreping nog wachtte; dan staat het item weer in de kopie. */
  function haalUitWachtrij(itemId: string): boolean {
    let gevonden = false
    schrijf((o) => {
      const w = leesWachtrij(o)
      const weg = w.find((i) => i.itemId === itemId)
      if (!weg) return
      gevonden = true
      schrijfWachtrij(o, w.filter((i) => i.itemId !== itemId))
      const k = leesKopie(o)
      if (k) schrijfKopie(o, zetTerugInKopie(k, weg.item))
    })
    return gevonden
  }

  function ruimOp(gebruikerId: string): void {
    schrijf((o) => {
      const r = ruimOpVoor(leesKopie(o), leesWachtrij(o), gebruikerId)
      if (r.kopie === null) wisKopie(o)
      schrijfWachtrij(o, r.wachtrij)
    })
  }

  function wis(): void {
    schrijf(wisAlles)
  }

  function wachtendVoorMij(): number {
    const id = user.value?.sub
    return id ? wachtrijVoor(wachtrij(), id).length : 0
  }

  async function verstuurNu(): Promise<void> {
    const id = user.value?.sub
    if (!id) return
    const mijn = wachtrijVoor(wachtrij(), id)
    if (mijn.length === 0) return
    const r = await verstuurWachtrij(mijn, (itemId, reden) => close(itemId, reden))
    // Herschrijf de wachtrij zoals ze nu in de opslag staat, niet zoals ze was
    // toen het versturen begon (zie voegWachtrijSamen).
    schrijf((o) => schrijfWachtrij(o, voegWachtrijSamen(leesWachtrij(o), mijn, r.resterend)))
    if (r.mislukt > 0) toast.add({ title: $i18n.t('offlineVoorraad.notSent', { count: r.mislukt }), color: 'error' })
  }

  function verstuur(): Promise<void> {
    if (!lopend) lopend = verstuurNu().finally(() => { lopend = null })
    return lopend
  }

  /** Wacht op de lopende verzending, als die er is. Wie de wachtrij wil wijzigen, wacht eerst. */
  function wachtOpVerzending(): Promise<void> {
    return lopend ?? Promise.resolve()
  }

  return { kopie, wachtrij, bewaar, zetInWachtrij, haalUitWachtrij, ruimOp, wis, wachtendVoorMij, verstuur, wachtOpVerzending }
}
