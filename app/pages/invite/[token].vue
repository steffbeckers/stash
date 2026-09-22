<script setup lang="ts">
const { t } = useI18n()
const route = useRoute()
const localePath = useLocalePath()
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const { refresh, setActive } = useHousehold()

const state = ref<'joining' | 'done' | 'failed'>('joining')
const householdName = ref('')

onMounted(async () => {
  if (!user.value) {
    // na inloggen keert de gebruiker hier terug
    await navigateTo(localePath(`/login?redirect=/invite/${route.params.token}`))
    return
  }

  const { data, error } = await supabase.rpc('accept_invite', {
    invite_token: route.params.token as string,
  })

  if (error) {
    state.value = 'failed'
    return
  }

  await refresh()
  setActive(data as string)

  const { data: hh } = await supabase
    .from('household')
    .select('name')
    .eq('id', data as string)
    .single()

  householdName.value = (hh as { name: string } | null)?.name ?? ''
  state.value = 'done'
})
</script>

<template>
  <UContainer class="max-w-md py-12">
    <UProgress v-if="state === 'joining'" animation="carousel" />

    <UAlert
      v-else-if="state === 'done'"
      color="success"
      :description="t('invite.success', { name: householdName })"
    />

    <UAlert v-else color="error" :description="t('invite.failed')" />

    <UButton v-if="state !== 'joining'" class="mt-6" :to="localePath('/app')" block>
      {{ t('app.name') }}
    </UButton>
  </UContainer>
</template>
