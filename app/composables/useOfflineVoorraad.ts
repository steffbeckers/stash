import type { Bewaarplaats, Reden, VoorraadItem } from '~/utils/voorraad'
import {
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
  type Wachtrij,
  type Wachtrijitem,
} from '~/utils/offlineVoorraad'

// Eén lopende verzending voor de hele app. De plugin en de voorraadpagina
// roepen allebei verstuur() aan; de pagina moet dan wachten op de verzending
// die al loopt, niet ernaast een tweede starten (spec §6).
let lopend: Promise<void> | null = null

/** Web Locks als de browser ze kent (spec twee-tabbladen §3). */
function sloten(): LockManager | undefined {
  return import.meta.client && typeof navigator !== 'undefined' ? navigator.locks : undefined
}

export type Ongedaanuitkomst = 'teruggezet' | 'nietBevestigd' | 'nietInWachtrij' | 'vanEenAnder'

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
  const { close, reopen } = useInventory()
  const supabase = useSupabaseClient()

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
   * `onzeker`: de afstreping is misschien al op de server (spec termijn §5).
   * Het merk staat in de ingang zelf, en een nieuwe ingang erft er nooit een.
   */
  function zetInWachtrij(item: VoorraadItem, reden: Reden, opties: { onzeker?: boolean } = {}): boolean {
    let gelukt = false
    schrijf((o) => {
      const k = leesKopie(o)
      const eigenaar = user.value?.sub ?? k?.eigenaar
      if (!eigenaar) return
      const ingang: Wachtrijitem = {
        itemId: item.id,
        reden,
        eigenaar,
        afgestreeptOp: new Date().toISOString(),
        item,
        ...(opties.onzeker ? { onzeker: true as const } : {}),
      }
      schrijfWachtrij(o, [...leesWachtrij(o), ingang])
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

  /**
   * Na een geslaagde online afstreping of ongedaanmaking: de kopie meteen
   * bijwerken. Faalt de verversing daarna, dan klopt de kopie toch, en toont
   * de offline-pagina geen afgestreept item als in voorraad (of omgekeerd).
   */
  function streepAfInDeKopie(itemId: string): void {
    schrijf((o) => {
      const k = leesKopie(o)
      if (k) schrijfKopie(o, streepAfInKopie(k, itemId))
    })
  }

  function zetTerugInDeKopie(item: VoorraadItem): void {
    schrijf((o) => {
      const k = leesKopie(o)
      if (k) schrijfKopie(o, zetTerugInKopie(k, item))
    })
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
    // Alleen een snelle controle: de wachtrij die verstuurd wordt, komt pas
    // binnen het slot.
    if (wachtrijVoor(wachtrij(), id).length === 0) return
    // Geen sessie, geen verzending. Staat de app langer dan een uur open
    // terwijl het toestel offline is, dan verloopt het access-token: auth-js
    // houdt user.sub nog vast, maar getSession() geeft geen sessie meer, en
    // supabase-js stuurt dan de anon-sleutel mee. De database antwoordt met
    // 42501 (anon mag niet aan inventory_item). verstuurWachtrij houdt dat wel
    // vast, maar versturen heeft dan geen zin: de plugin probeert opnieuw
    // zodra de sessie vernieuwd is (TOKEN_REFRESHED of SIGNED_IN).
    const { data } = await supabase.auth.getSession()
    if (!data.session) return
    // Binnen het slot: een verzending of ongedaanmaking in een ander tabblad
    // gaat voor of na, nooit tegelijk (spec twee-tabbladen §3). De sessie
    // hierboven bewust erbuiten: auth heeft geen termijn, en een hangende
    // vernieuwing zou het slot voor alle tabbladen vasthouden. Dat houdt auth
    // in het gewone geval buiten het slot, maar niet altijd: close() vraagt
    // binnen het slot via supabase-js zelf ook de sessie op, en komt het
    // token tijdens de verzending in de vernieuwingsmarge, dan kan een
    // vernieuwing toch binnen het slot lopen (zie open-bevindingen).
    const mislukt = await metWachtrijslot(sloten(), () => Promise.resolve(), async () => {
      // Opnieuw lezen: een ander tabblad kan intussen verstuurd of ongedaan
      // gemaakt hebben.
      const mijn = wachtrijVoor(wachtrij(), id)
      if (mijn.length === 0) return 0
      const r = await verstuurWachtrij(mijn, (itemId, reden) => close(itemId, reden))
      // Is r.onzeker gezet, dan is resterend[0] precies de ingang die faalde.
      const onzekere = r.onzeker ? r.resterend[0] : undefined
      // Herschrijf de wachtrij zoals ze nu in de opslag staat, niet zoals ze
      // was toen het versturen begon (zie voegWachtrijSamen).
      schrijf((o) => {
        const samen = voegWachtrijSamen(leesWachtrij(o), mijn, r.resterend)
        schrijfWachtrij(o, onzekere ? markeerOnzeker(samen, onzekere) : samen)
      })
      return r.mislukt
    })
    if (mislukt > 0) toast.add({ title: $i18n.t('offlineVoorraad.notSent', { count: mislukt }), color: 'error' })
  }

  function verstuur(): Promise<void> {
    if (!lopend) lopend = verstuurNu().finally(() => { lopend = null })
    return lopend
  }

  /**
   * Wacht op de lopende verzending in dit tabblad, als die er is. Alleen nog de
   * terugval zonder Web Locks: met Web Locks coördineert het slot (zie
   * metWachtrijslot).
   */
  function wachtOpVerzending(): Promise<void> {
    return lopend ?? Promise.resolve()
  }

  /**
   * Ongedaan maken van een afstreping uit de wachtrij (spec termijn §6, spec
   * twee-tabbladen §3). 'nietInWachtrij': ze is intussen verstuurd; de
   * aanroeper beslist wat dan. Was ze onzeker, dan ook heropenen op de server.
   * reopen() raakt alleen je eigen afstreping (spec eigen-afstreping §3): had de
   * server haar niet, dan raakt het niets; is het item intussen van een ander,
   * dan 'vanEenAnder'.
   */
  async function ongedaanMakenInWachtrij(item: VoorraadItem): Promise<Ongedaanuitkomst> {
    // Binnen het slot, en alleen synchroon werk: een verzending in dit of een
    // ander tabblad is dan klaar, en neemt de afstreping daarna niet meer mee.
    // Zonder Web Locks: wachten op de verzending in dit tabblad.
    const stand = await metWachtrijslot(sloten(), wachtOpVerzending, () => {
      const wasOnzeker = wachtrij().some((w) => w.itemId === item.id && w.onzeker === true)
      if (!haalUitWachtrij(item.id)) return 'weg' as const
      return wasOnzeker ? ('onzeker' as const) : ('zeker' as const)
    })
    if (stand === 'weg') return 'nietInWachtrij'
    if (stand === 'zeker') return 'teruggezet'
    try {
      if ((await reopen(item.id)) !== 'vanEenAnder') return 'teruggezet'
    } catch {
      return 'nietBevestigd'
    }
    // Van een ander: haalUitWachtrij zette het item terug in de kopie, maar het
    // blijft gesloten (spec eigen-afstreping §4).
    streepAfInDeKopie(item.id)
    return 'vanEenAnder'
  }

  return {
    kopie,
    wachtrij,
    bewaar,
    zetInWachtrij,
    haalUitWachtrij,
    streepAfInDeKopie,
    zetTerugInDeKopie,
    ruimOp,
    wis,
    wachtendVoorMij,
    verstuur,
    wachtOpVerzending,
    ongedaanMakenInWachtrij,
  }
}
