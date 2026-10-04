import { metTermijn, SUPABASE_TERMIJN_MS } from '~/utils/termijn'

/**
 * Elk Supabase-verzoek uit de browser telt na de termijn als netwerkfout.
 * Spec docs/superpowers/specs/2026-10-04-termijn-design.md §3.
 *
 * Orde -25: vóór de plugin van @nuxtjs/supabase (enforce 'pre', orde -20 in
 * internalOrderMap van nuxt/dist/index.mjs). Die vraagt bij het opstarten al
 * de sessie op, en dat kan een tokenvernieuwing zijn.
 */
export default defineNuxtPlugin({
  name: 'termijn',
  order: -25,
  setup() {
    const { url } = useRuntimeConfig().public.supabase
    window.fetch = metTermijn(window.fetch.bind(window), url, SUPABASE_TERMIJN_MS)
  },
})
