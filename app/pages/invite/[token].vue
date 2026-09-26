<script setup lang="ts">
const { t } = useI18n()
const route = useRoute()
const localePath = useLocalePath()
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const { refresh, setActive } = useHousehold()
const { profile, refresh: refreshProfiel, save } = useProfile()

const state = ref<'joining' | 'done' | 'failed'>('joining')
const householdName = ref('')
const voornaam = ref('')
const naamOpslaan = ref(false)
const naamKlaar = ref(false)

// Alleen vragen aan wie nog geen naam heeft. Wie hier al eerder langskwam
// krijgt gewoon de statuspagina die er stond.
const vraagNaam = computed(() => state.value === 'done' && !naamKlaar.value && !profile.value?.displayName)

async function bewaarNaam() {
  naamOpslaan.value = true
  try {
    await save(voornaam.value)
    naamKlaar.value = true
  } catch {
    // De naam is bijzaak: je bent al lid. Een mislukking hier mag de weg naar
    // je voorraad niet blokkeren, dus we sluiten het blok gewoon.
    naamKlaar.value = true
  } finally {
    naamOpslaan.value = false
  }
}

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
  await refreshProfiel()
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

    <UCard v-if="vraagNaam" class="mt-6">
      <template #header>
        <h2 class="font-semibold">{{ t('invite.nameTitle') }}</h2>
      </template>
      <p class="text-sm text-muted">{{ t('invite.nameHelp') }}</p>
      <form class="mt-4 flex flex-col gap-2 sm:flex-row" @submit.prevent="bewaarNaam">
        <!-- aria-label en geen UFormField: de kop van deze kaart is de vraag
             al, dus een zichtbaar label erboven zou hem herhalen. Zonder dit
             attribuut heeft het veld helemaal geen toegankelijke naam — en
             kan een test het ook alleen op positie vinden. -->
        <UInput
          v-model="voornaam"
          :aria-label="t('profile.name')"
          :maxlength="60"
          class="w-full sm:flex-1"
        />
        <UButton type="submit" :loading="naamOpslaan">{{ t('profile.save') }}</UButton>
      </form>
    </UCard>

    <UButton v-if="state !== 'joining'" class="mt-6" :to="localePath('inventory')" block>
      {{ t('app.name') }}
    </UButton>
  </UContainer>
</template>
