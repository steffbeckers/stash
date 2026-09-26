/**
 * Stuurt een ingelogde bezoeker weg van een pagina die alleen voor
 * uitgelogde bezoekers zin heeft.
 *
 * `immediate: true` is essentieel: useSupabaseUser() heeft bij het opzetten
 * van de watcher meestal al een waarde, en zonder deze vlag vuurt de watcher
 * dan nooit.
 *
 * `{ external: true }` dwingt een volledige paginalading af in plaats van
 * een client-side route-overgang. Dat is hier geen stijlkeuze maar een fix:
 * sinds AppHeader.vue (Taak 4) een top-level await heeft, hangt de
 * root-Suspense van de hele app aan diens profielaanroep. Deze watcher kan
 * vuren terwijl die Suspense nog niet is opgelost (bv. net na het inloggen
 * via een magic link op confirm.vue) — en een `navigateTo()` zónder
 * `external` bleek dan zijn eigen doelroute nooit echt te monteren: de
 * URL in de browser veranderde wel (te zien aan `framenavigated`), maar de
 * pagina's `<script setup>` draaide domweg nooit. Op
 * `/invite/[token]` was het gevolg zichtbaar: de gast bleef voor altijd op
 * het "joining"-scherm staan, ook na twintig seconden, omdat
 * onMounted() nooit vuurde en accept_invite() dus nooit werd aangeroepen.
 * Nagemeten met tijdelijke console.log's in invite/[token].vue en
 * e2e/invite.spec.ts (niet meer aanwezig): het setup()-blok van de
 * doelpagina liep bij een zachte navigatie domweg geen tweede keer.
 * `external: true` omzeilt dat door de klant-router niet te gebruiken.
 */
export function useRedirectWhenSignedIn(target: MaybeRefOrGetter<string>): void {
  const user = useSupabaseUser()

  watch(
    user,
    (value) => {
      if (value) navigateTo(toValue(target), { external: true })
    },
    { immediate: true },
  )
}
