/**
 * Verstuurt de wachtrij van offline afstrepingen: bij het opstarten zodra er
 * een gebruiker is, bij elk online-event en na een vernieuwde sessie. Spec §5,
 * punt 4.
 */
export default defineNuxtPlugin(() => {
  const user = useSupabaseUser()
  const offline = useOfflineVoorraad()
  const supabase = useSupabaseClient()

  // useSupabaseUser() is bij het opstarten mogelijk nog leeg: de sessie komt
  // asynchroon binnen. Daarom een watcher, niet één aanroep.
  watch(
    () => user.value?.sub,
    (id) => {
      if (!id) return
      // Spec §8: een kopie of wachtrij van een andere gebruiker wordt nooit
      // getoond of verstuurd.
      offline.ruimOp(id)
      void offline.verstuur()
    },
    { immediate: true },
  )

  window.addEventListener('online', () => {
    void offline.verstuur()
  })

  // Verliep de sessie terwijl het toestel offline was, dan verstuurt
  // verstuur() niets (zie verstuurNu). Vernieuwt dezelfde gebruiker daarna
  // zijn token, dan vuurt de watcher hierboven niet: user.sub verandert niet.
  // Daarom hier opnieuw versturen. Niet awaiten: deze callback draait binnen
  // de auth-lock van supabase-js, en verstuur() vraagt zelf de sessie op.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') void offline.verstuur()
  })
})
