import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('user_profile', () => {
  beforeEach(resetDb)

  it('ontstaat automatisch bij een nieuwe gebruiker', async () => {
    const userId = await createUser('nieuw@example.com')
    await withTx(async (tx) => {
      const rows = await tx`select * from user_profile where user_id = ${userId}`
      expect(rows.length).toBe(1)
    })
  })

  it('start op trust_level 0 en rol user', async () => {
    const userId = await createUser('start@example.com')
    await withTx(async (tx) => {
      const rows = await tx<{ trust_level: number; role: string }[]>`
        select trust_level, role from user_profile where user_id = ${userId}
      `
      expect(rows[0]!.trust_level).toBe(0)
      expect(rows[0]!.role).toBe('user')
    })
  })

  it('verdwijnt wanneer de gebruiker verdwijnt', async () => {
    const userId = await createUser('weg@example.com')
    await withTx(async (tx) => {
      await tx`delete from auth.users where id = ${userId}`
      const rows = await tx`select * from user_profile where user_id = ${userId}`
      expect(rows.length).toBe(0)
    })
  })
})
