<script setup lang="ts">
const props = defineProps<{ householdId: string }>()

const { t, d } = useI18n()
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
  invites.value = (data ?? []) as Invite[]
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

function linkFor(token: string): string {
  return `${window.location.origin}/invite/${token}`
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
      <div class="flex items-center justify-between gap-4">
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
        <div class="flex shrink-0 gap-2">
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
