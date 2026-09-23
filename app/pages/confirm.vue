<script setup lang="ts">
const user = useSupabaseUser()
const route = useRoute()
const localePath = useLocalePath()

// Zelfde controle als in login.vue (app/utils/safe-redirect.ts): een
// query-parameter is invoer van buiten, ook als hij van onze eigen
// inlogpagina lijkt te komen.
const target = computed(() => safeInternalPath(route.query.redirect) ?? localePath('/app'))

watch(user, (value) => {
  if (value) navigateTo(target.value)
}, { immediate: true })
</script>

<template>
  <UContainer class="py-12">
    <UProgress animation="carousel" />
  </UContainer>
</template>
