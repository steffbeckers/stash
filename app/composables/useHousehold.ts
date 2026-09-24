export interface Household {
  id: string
  name: string
  role: 'owner' | 'member'
}

export interface Member {
  userId: string
  displayName: string | null
  role: 'owner' | 'member'
}

const ACTIVE_KEY = 'stash_active_household'

export function useHousehold() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  const households = useState<Household[]>('households', () => [])
  const activeId = useState<string | null>('activeHousehold', () => null)
  const members = useState<Member[]>('householdMembers', () => [])

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

    households.value = (data ?? []).map((row) => ({
      id: row.household.id,
      name: row.household.name,
      // household_member.role is een tekstkolom met een check-constraint,
      // geen Postgres-enum, dus de gegenereerde types geven hier `string`
      // terug in plaats van de letterlijke unie. De check-constraint
      // garandeert de waarde; deze cast benoemt dat, in plaats van de hele
      // rij ongetypeerd te laten zoals de eerdere `(row: any)` deed.
      role: row.role as Household['role'],
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

  async function loadMembers(householdId: string): Promise<void> {
    const { data: memberRows, error: memberError } = await supabase
      .from('household_member')
      .select('user_id, role')
      .eq('household_id', householdId)
      .order('joined_at')

    if (memberError) throw memberError

    // household_member.user_id en user_profile.user_id wijzen allebei
    // onafhankelijk naar auth.users — er is geen foreign key tussen
    // household_member en user_profile onderling (geverifieerd tegen het
    // draaiende schema). PostgREST kan zo'n embedded select() dus niet
    // vertalen; vandaar twee losse queries die hier client-side worden
    // samengevoegd in plaats van de geneste `user_profile(display_name)`-select.
    const userIds = (memberRows ?? []).map((row) => row.user_id)
    const displayNameByUserId = new Map<string, string | null>()

    if (userIds.length > 0) {
      const { data: profileRows, error: profileError } = await supabase
        .from('user_profile')
        .select('user_id, display_name')
        .in('user_id', userIds)

      if (profileError) throw profileError

      for (const row of profileRows ?? []) {
        displayNameByUserId.set(row.user_id, row.display_name)
      }
    }

    members.value = (memberRows ?? []).map((row) => ({
      userId: row.user_id,
      displayName: displayNameByUserId.get(row.user_id) ?? null,
      // role is een tekstkolom met een check-constraint, geen Postgres-enum,
      // dus de gegenereerde types geven `string`. Zelfde cast als bij
      // Household['role'] hierboven.
      role: row.role as Member['role'],
    }))
  }

  async function setRole(householdId: string, userId: string, role: Member['role']): Promise<void> {
    const { error } = await supabase.rpc('set_member_role', {
      target_household: householdId,
      target_user: userId,
      new_role: role,
    })
    if (error) throw error
    await loadMembers(householdId)
  }

  async function removeMember(householdId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('household_member')
      .delete()
      .eq('household_id', householdId)
      .eq('user_id', userId)
    if (error) throw error

    // Verwijdert de kijker zichzelf, dan verandert dat welke huishoudens hij
    // ziet: households/activeId (module-brede useState — zie ook app.vue,
    // settings/places.vue en settings/household.vue, die er alle drie van
    // lezen om te bepalen welk huishouden "actief" is) blijven anders
    // stilzwijgend het zojuist verlaten huishouden aanwijzen, totdat iets
    // anders toevallig refresh() aanroept. loadMembers(householdId) alleen
    // verhelpt dat niet — dat ververst enkel de ledenlijst van het
    // huishouden dat net verlaten is (en levert door RLS meteen een lege
    // lijst op, zonder foutmelding). Verwijdert de kijker een ánder lid,
    // dan verandert zijn eigen lidmaatschap niet, dus dan volstaat de
    // goedkopere loadMembers() zoals voorheen.
    if (userId === user.value?.sub) {
      await refresh()
    } else {
      await loadMembers(householdId)
    }
  }

  return { households, activeId, members, refresh, setActive, create, loadMembers, setRole, removeMember }
}
