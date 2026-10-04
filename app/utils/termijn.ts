/**
 * Een termijn voor Supabase-verzoeken, zonder Nuxt. Zie
 * docs/superpowers/specs/2026-10-04-termijn-design.md §3.
 */

/** Spec §2: ruim genoeg voor een trage verbinding die werkt. */
export const SUPABASE_TERMIJN_MS = 10_000

function urlVan(invoer: RequestInfo | URL): string {
  if (typeof invoer === 'string') return invoer
  if (invoer instanceof URL) return invoer.href
  return invoer.url
}

/**
 * Een fetch die verzoeken naar `voorvoegsel` na `ms` afbreekt.
 *
 * Met een eigen AbortController en abort() zonder reden: dat geeft een
 * AbortError, en die herhaalt postgrest-js nooit. AbortSignal.timeout geeft
 * een TimeoutError, en die herhaalt het bij een GET tot drie keer.
 *
 * De timer wordt niet gewist: na een afgerond verzoek doet abort() niets, en
 * loopt het lezen van het antwoord nog, dan breekt dat ook af.
 *
 * Wijzigt `init` bewust: de herhaallus van @nuxtjs/supabase
 * (runtime/utils/fetch-retry.js) stopt alleen als zijn eigen
 * `init.signal.aborted` waar is. Herhaalt die lus na een TypeError met
 * hetzelfde `init`, dan volgt de nieuwe poging via dat signaal de termijn van
 * de eerste. Het hele verzoek, alle pogingen samen, blijft dus binnen `ms`.
 */
export function metTermijn(fetch: typeof globalThis.fetch, voorvoegsel: string, ms: number): typeof globalThis.fetch {
  return (invoer, init) => {
    if (!urlVan(invoer).startsWith(voorvoegsel)) return fetch(invoer, init)

    const controller = new AbortController()
    setTimeout(() => controller.abort(), ms)

    const eigen = init?.signal ?? (typeof invoer === 'object' && !(invoer instanceof URL) ? invoer.signal : null)
    if (eigen) {
      if (eigen.aborted) controller.abort()
      else eigen.addEventListener('abort', () => controller.abort(), { once: true })
    }

    if (init) init.signal = controller.signal
    return fetch(invoer, { ...init, signal: controller.signal })
  }
}
