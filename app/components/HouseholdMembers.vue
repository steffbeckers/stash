<script setup lang="ts">
const props = defineProps<{ householdId: string }>()

const { t } = useI18n()
const user = useSupabaseUser()
const { members, loadMembers, setRole, removeMember } = useHousehold()

const ready = ref(false)
const error = ref('')
const busy = ref('')

const amOwner = computed(() =>
  members.value.some((m) => m.userId === user.value?.sub && m.role === 'owner'),
)

// Geverifieerd met de hand (Step 7): een PostgREST-fout van supabase-js is
// hier geen Error-instantie. useHousehold.ts doet `if (error) throw error`
// op het resultaat van de aanroep, en zonder .throwOnError() is dat kale
// object gewoon JSON.parse() van de HTTP-foutrespons — {code, details,
// hint, message} zonder prototype-keten naar Error. `cause instanceof
// Error` is dus altijd false voor deze foutmeldingen; vandaar deze
// structurele check op de vorm van het object in plaats van op zijn type.
function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const message = (cause as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return ''
}

async function changeRole(userId: string, role: 'owner' | 'member') {
  busy.value = userId
  try {
    await setRole(props.householdId, userId, role)
    error.value = ''
  } catch {
    error.value = t('householdSettings.error')
  } finally {
    busy.value = ''
  }
}

async function remove(userId: string) {
  busy.value = userId
  try {
    await removeMember(props.householdId, userId)
    error.value = ''
  } catch (cause) {
    // De trigger prevent_last_owner_removal weigert het verwijderen van de
    // laatste eigenaar. Dat is geen storing maar een regel, dus die krijgt
    // een eigen melding in plaats van de algemene foutmelding.
    error.value = errorMessage(cause).includes('minstens één eigenaar')
      ? t('householdSettings.cannotRemoveLastOwner')
      : t('householdSettings.error')
  } finally {
    busy.value = ''
  }
}

async function load() {
  try {
    await loadMembers(props.householdId)
  } catch {
    error.value = t('householdSettings.error')
    return
  }
  error.value = ''
  ready.value = true
}

onMounted(load)
watch(() => props.householdId, load)

// useSupabaseUser() geeft het JWT-payload: het id staat op .sub, niet op .id.
const isSelf = (userId: string) => userId === user.value?.sub
</script>

<template>
  <div>
    <UAlert v-if="error" color="error" :description="error" />
    <UProgress v-else-if="!ready" animation="carousel" />
    <ul v-else class="divide-y divide-default">
      <li v-for="member in members" :key="member.userId" class="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:gap-3">
        <span class="min-w-0 break-words sm:flex-1">
          {{ member.displayName || t('householdSettings.noName') }}
          <span v-if="isSelf(member.userId)" class="text-muted">({{ t('householdSettings.you') }})</span>
        </span>
        <div class="flex flex-wrap items-center gap-2">
          <UBadge :color="member.role === 'owner' ? 'primary' : 'neutral'" variant="subtle">
            {{ member.role === 'owner' ? t('householdSettings.roleOwner') : t('householdSettings.roleMember') }}
          </UBadge>
          <UButton
            v-if="amOwner && member.role === 'member'"
            size="xs"
            variant="ghost"
            :loading="busy === member.userId"
            @click="changeRole(member.userId, 'owner')"
          >
            {{ t('householdSettings.makeOwner') }}
          </UButton>
          <UButton
            v-if="amOwner"
            size="xs"
            color="error"
            variant="ghost"
            :loading="busy === member.userId"
            @click="remove(member.userId)"
          >
            {{ t('householdSettings.removeMember') }}
          </UButton>
        </div>
      </li>
    </ul>
  </div>
</template>
