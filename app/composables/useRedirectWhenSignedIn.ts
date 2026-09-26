/**
 * Stuurt een ingelogde bezoeker weg van een pagina die alleen voor
 * uitgelogde bezoekers zin heeft.
 *
 * `immediate: true` is essentieel: useSupabaseUser() heeft bij het opzetten
 * van de watcher meestal al een waarde, en zonder deze vlag vuurt de watcher
 * dan nooit.
 */
export function useRedirectWhenSignedIn(target: MaybeRefOrGetter<string>): void {
  const user = useSupabaseUser()

  watch(
    user,
    (value) => {
      if (value) navigateTo(toValue(target))
    },
    { immediate: true },
  )
}
