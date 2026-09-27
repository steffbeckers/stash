<script setup lang="ts">
const props = defineProps<{ householdId: string }>()

const { t, d } = useI18n()
const localePath = useLocalePath()
const supabase = useSupabaseClient()

interface Invite {
  id: string
  token: string
  expires_at: string
  max_uses: number
  uses: number
}

const invites = ref<Invite[]>([])
const pending = ref(false)
const copied = ref<string | null>(null)
const error = ref('')

async function load() {
  const { data, error: loadError } = await supabase
    .from('household_invite')
    .select('id, token, expires_at, max_uses, uses')
    .eq('household_id', props.householdId)
    .order('created_at', { ascending: false })
  if (loadError) {
    error.value = t('householdSettings.error')
    return
  }
  error.value = ''
  // Elke geselecteerde kolom is not-null en heeft geen check-constraint die
  // een ruimere kolomtype oplevert dan Invite verwacht, dus de gegenereerde
  // Database-types sluiten hier exact aan — geen cast meer nodig.
  invites.value = data ?? []
}

async function create() {
  pending.value = true
  error.value = ''
  const { error: rpcError } = await supabase.rpc('create_invite', {
    target: props.householdId,
    valid_days: 7,
    uses: 5,
  })
  if (rpcError) error.value = t('householdSettings.error')
  else await load()
  pending.value = false
}

async function revoke(id: string) {
  error.value = ''
  const { error: deleteError } = await supabase.from('household_invite').delete().eq('id', id)
  if (deleteError) error.value = t('householdSettings.error')
  else await load()
}

// localePath(), niet het kale pad: dit is de enige plek die een
// uitnodigingslink produceert (het vult het readonly veld en copy() zet het
// resultaat op het klembord). Zonder taalprefix hier kreeg elke gast een
// Engelse link, ongeacht de taal van de eigenaar die hem aanmaakte, en
// detectBrowserLanguage (redirectOn: 'root') herstelt dat niet op
// /invite/<token> — bevinding 1 van de eindreview. Zelfde patroon als
// login.vue (emailRedirectTo) en invite/[token].vue (de redirect-waarde na
// inloggen).
function linkFor(token: string): string {
  return `${window.location.origin}${localePath({ name: 'invite-token', params: { token } })}`
}

async function copy(token: string) {
  await navigator.clipboard.writeText(linkFor(token))
  copied.value = token
  setTimeout(() => (copied.value = null), 2000)
}

onMounted(load)
</script>

<template>
  <div class="space-y-3">
    <UButton :loading="pending" icon="i-lucide-link" @click="create">
      {{ t('invite.create') }}
    </UButton>

    <UAlert v-if="error" color="error" :description="error" />

    <UCard v-for="invite in invites" :key="invite.id">
      <!-- De knoppen hadden shrink-0 en leverden dus nooit in; op 360px hield
           het linkveld daardoor nog geen 170px over voor een lange token-URL
           in monospace. -->
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div class="min-w-0 text-sm">
          <UInput
            :model-value="linkFor(invite.token)"
            :aria-label="t('invite.linkLabel')"
            readonly
            class="w-full font-mono text-xs"
          />
          <p class="text-muted">
            {{ t('invite.expiresOn', { date: d(new Date(invite.expires_at), 'short') }) }} ·
            {{ t('invite.usesLeft', { count: invite.max_uses - invite.uses }) }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2 sm:shrink-0">
          <UButton size="sm" variant="subtle" @click="copy(invite.token)">
            {{ copied === invite.token ? t('invite.copied') : t('invite.copy') }}
          </UButton>
          <UButton size="sm" color="error" variant="ghost" @click="revoke(invite.id)">
            {{ t('invite.revoke') }}
          </UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>
