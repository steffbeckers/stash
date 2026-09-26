export interface Profile {
  userId: string
  displayName: string | null
}

/**
 * Het profiel van de ingelogde gebruiker.
 *
 * Naast useHousehold() en met dezelfde vorm, maar één verschil: die haalt
 * bewust op in onMounted omdat hij activeId uit localStorage leest, wat
 * tijdens SSR niet bestaat. Hier geldt dat niet — de sessie is server-side
 * wél bekend (nagemeten: de server-HTML bevat de navigatie van een ingelogde
 * gebruiker). De header toont initialen uit dit profiel, dus ophalen tijdens
 * SSR scheelt een zichtbare flits van icoon naar letters bij elke volledige
 * paginalading.
 */
export function useProfile() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const profile = useState<Profile | null>('profile', () => null)

  async function refresh(): Promise<void> {
    if (!user.value) {
      profile.value = null
      return
    }

    // useSupabaseUser() geeft het JWT-payload: het id staat op `sub`.
    const { data, error } = await supabase
      .from('user_profile')
      .select('user_id, display_name')
      .eq('user_id', user.value.sub)
      .single()

    if (error) throw error
    profile.value = { userId: data.user_id, displayName: data.display_name }
  }

  async function save(displayName: string): Promise<void> {
    if (!user.value) throw new Error('save() zonder ingelogde gebruiker')

    // Een naam van alleen spaties is geen naam. Hij wordt null, zodat de
    // ledenlijst zijn eigen vervangtekst toont in plaats van een lege regel.
    const getrimd = displayName.trim()

    const { error } = await supabase
      .from('user_profile')
      .update({ display_name: getrimd === '' ? null : getrimd })
      .eq('user_id', user.value.sub)

    if (error) throw error
    await refresh()
  }

  return { profile, refresh, save }
}
