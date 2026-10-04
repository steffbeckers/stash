import { metTermijn, SUPABASE_TERMIJN_MS } from '~/utils/termijn'

/**
 * Elk PostgREST-verzoek uit de browser (`/rest/v1/`) telt na de termijn als
 * netwerkfout. Spec docs/superpowers/specs/2026-10-04-termijn-design.md §3.
 *
 * Auth valt erbuiten. Breekt de termijn een tokenvernieuwing af die de server
 * al verwerkte, dan probeert auth-js opnieuw met het oude refresh-token. Dat is
 * dan geroteerd, en buiten de reuse-interval van 10 s (supabase/config.toml)
 * antwoordt GoTrue "already used": is het access-token verlopen, dan wist
 * auth-js de sessie. Ook verify en de PKCE-uitwisseling lukken maar één keer.
 */
export default defineNuxtPlugin(() => {
  const { url } = useRuntimeConfig().public.supabase
  window.fetch = metTermijn(window.fetch.bind(window), `${url}/rest/v1/`, SUPABASE_TERMIJN_MS)
})
