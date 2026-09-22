<script setup lang="ts">
const user = useSupabaseUser()
const localePath = useLocalePath()

watch(user, (value) => {
  if (value) navigateTo(localePath('/app'))
}, { immediate: true })
</script>

<template>
  <UContainer class="py-12">
    <UProgress animation="carousel" />
  </UContainer>
</template>
