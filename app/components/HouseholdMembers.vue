<script setup lang="ts">
const props = defineProps<{ householdId: string }>()

const { t } = useI18n()
const user = useSupabaseUser()
const { members, loadMembers } = useHousehold()

const ready = ref(false)
const error = ref('')

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
      </li>
    </ul>
  </div>
</template>
