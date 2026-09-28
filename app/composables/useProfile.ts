export interface Profile {
  userId: string
  displayName: string | null
  // Toegekend, niet verdiend: `role` bepaalt of je aan andermans gegevens
  // mag komen. Dat staat los van `trust_level`, dat verdiend wordt en
  // bepaalt met welke status je eigen bijdragen starten. Zie §2 van
  // docs/superpowers/specs/2026-09-27-catalogus-producten-design.md.
  //
  // Letterlijke unie, geen string: dit is de enige autorisatiecheck in de
  // app zonder type of test erachter (zie de moderator-tak in
  // app/pages/products/[id].vue). Een getypte union maakt een verkeerd
  // getypte rolnaam op de aanroepplek een compileerfout in plaats van een
  // stille bug die pas opvalt als een moderator zijn knoppen kwijt is
  // (fix 4 van de eindreview).
  role: 'user' | 'moderator' | 'admin'
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
      .select('user_id, display_name, role')
      .eq('user_id', user.value.sub)
      .single()

    if (error) throw error
    profile.value = {
      userId: data.user_id,
      displayName: data.display_name,
      // user_profile.role is een tekstkolom met een check-constraint, geen
      // Postgres-enum, dus het gegenereerde type geeft hier `string` terug
      // in plaats van de letterlijke unie. De check-constraint garandeert
      // de waarde; deze cast benoemt dat, net als Household['role'] in
      // useHousehold.ts.
      role: data.role as Profile['role'],
    }
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
