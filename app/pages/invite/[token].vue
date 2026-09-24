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
    // na inloggen keert de gebruiker hier terug. localePath() ook om de
    // redirect-waarde zelf, niet enkel om '/login': zonder die tweede
    // localePath() blijft de waarde onvertaald ('/invite/abc'), en
    // confirm.vue navigeert daar na het inloggen letterlijk naartoe —
    // safeInternalPath() keurt dat goed (het is een geldig intern pad), dus
    // de gebruiker belandt zonder foutmelding op de Engelse uitnodiging.
    const invitePath = localePath({
      name: 'invite-token',
      params: { token: route.params.token as string },
    })
    await navigateTo(localePath({ name: 'login', query: { redirect: invitePath } }))
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

  // hh is al correct getypeerd door de gegenereerde Database-types
  // (household.name is not-null), dus geen cast meer nodig.
  householdName.value = hh?.name ?? ''
  state.value = 'done'
})
</script>

<template>
  <UContainer class="max-w-md py-12">
    <div v-if="state === 'joining'">
      <UProgress animation="carousel" />
      <p class="mt-3 text-center text-sm text-muted">{{ t('invite.joining') }}</p>
    </div>

    <UAlert
      v-else-if="state === 'done'"
      color="success"
      :description="t('invite.success', { name: householdName })"
    />

    <UAlert v-else color="error" :description="t('invite.failed')" />

    <UButton v-if="state !== 'joining'" class="mt-6" :to="localePath('inventory')" block>
      {{ t('app.name') }}
    </UButton>
  </UContainer>
</template>
