/**
 * Verstuurt de wachtrij van offline afstrepingen: bij het opstarten zodra er
 * een gebruiker is, en bij elk online-event. Spec §5, punt 4.
 */
export default defineNuxtPlugin(() => {
  const user = useSupabaseUser()
  const offline = useOfflineVoorraad()

  // useSupabaseUser() is bij het opstarten mogelijk nog leeg: de sessie komt
  // asynchroon binnen. Daarom een watcher, niet één aanroep.
  watch(
    () => user.value?.sub,
    (id) => {
      if (!id) return
      void offline.verstuur()
    },
    { immediate: true },
  )

  window.addEventListener('online', () => {
    void offline.verstuur()
  })
})
