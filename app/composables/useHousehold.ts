export interface Household {
  id: string
  name: string
  role: 'owner' | 'member'
}

const ACTIVE_KEY = 'stash_active_household'

export function useHousehold() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  const households = useState<Household[]>('households', () => [])
  const activeId = useState<string | null>('activeHousehold', () => null)

  async function refresh(): Promise<void> {
    if (!user.value) {
      households.value = []
      activeId.value = null
      return
    }

    // useSupabaseUser() in dit project (@nuxtjs/supabase 2.x) geeft het
    // JWT-payload terug van auth.getClaims(), geen klassiek User-object: het
    // user-id staat dus op de standaard-JWT-claim `sub`, niet op `id`.
    const { data, error } = await supabase
      .from('household_member')
      .select('role, household(id, name)')
      .eq('user_id', user.value.sub)

    if (error) throw error

    households.value = (data ?? []).map((row: any) => ({
      id: row.household.id,
      name: row.household.name,
      role: row.role,
    }))

    const stored = import.meta.client ? localStorage.getItem(ACTIVE_KEY) : null
    const valid = households.value.some((h) => h.id === stored)
    activeId.value = valid ? stored : (households.value[0]?.id ?? null)
  }

  function setActive(id: string): void {
    activeId.value = id
    if (import.meta.client) localStorage.setItem(ACTIVE_KEY, id)
  }

  async function create(name: string): Promise<string> {
    const { data, error } = await supabase.rpc('create_household', { household_name: name })
    if (error) throw error
    await refresh()
    setActive(data as string)
    return data as string
  }

  return { households, activeId, refresh, setActive, create }
}
