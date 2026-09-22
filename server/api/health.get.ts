export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  return {
    status: 'ok',
    version: config.public.appVersion,
  }
})
