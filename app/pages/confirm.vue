<script setup lang="ts">
const user = useSupabaseUser()
const route = useRoute()
const localePath = useLocalePath()

// Zelfde controle als in login.vue: een query-parameter is invoer van buiten,
// ook als hij van onze eigen inlogpagina lijkt te komen.
const target = computed(() => {
  const value = route.query.redirect
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : localePath('/app')
})

watch(user, (value) => {
  if (value) navigateTo(target.value)
}, { immediate: true })
</script>

<template>
  <UContainer class="py-12">
    <UProgress animation="carousel" />
  </UContainer>
</template>
