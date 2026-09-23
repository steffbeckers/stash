import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('health endpoint', async () => {
  await setup({ server: true, dev: true })

  it('geeft status ok terug', async () => {
    const res = await $fetch<{ status: string; version: string }>('/api/health')
    expect(res.status).toBe('ok')
  })

  it('geeft een versie terug', async () => {
    const res = await $fetch<{ status: string; version: string }>('/api/health')
    expect(typeof res.version).toBe('string')
    expect(res.version.length).toBeGreaterThan(0)
  })
})
