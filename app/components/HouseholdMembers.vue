<script setup lang="ts">
const props = defineProps<{ householdId: string }>()

const { t } = useI18n()
const user = useSupabaseUser()
const { members, loadMembers, setRole } = useHousehold()

const ready = ref(false)
const error = ref('')
const busy = ref('')

const amOwner = computed(() =>
  members.value.some((m) => m.userId === user.value?.sub && m.role === 'owner'),
)

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
      <li v-for="member in members" :key="member.userId" class="flex items-center gap-3 py-2">
        <span class="flex-1">
          {{ member.displayName || t('householdSettings.noName') }}
          <span v-if="isSelf(member.userId)" class="text-muted">({{ t('householdSettings.you') }})</span>
        </span>
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
      </li>
    </ul>
  </div>
</template>
