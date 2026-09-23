import { describe, it, expect } from 'vitest'
import { withDb } from './helpers'

it('auth.uid() leest de gezette claim', async () => {
  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      const id = '11111111-1111-1111-1111-111111111111'
      await tx`select set_config('request.jwt.claim.sub', ${id}, true)`
      const [row] = await tx<{ uid: string | null }[]>`select auth.uid() as uid`
      expect(row!.uid).toBe(id)
    })
  })
})

describe('database-extensies', () => {
  it('heeft pg_trgm beschikbaar', async () => {
    await withDb(async (sql) => {
      const rows = await sql`select extname from pg_extension where extname = 'pg_trgm'`
      expect(rows.length).toBe(1)
    })
  })

  it('kan similarity berekenen', async () => {
    await withDb(async (sql) => {
      const rows = await sql<{ s: number }[]>`select similarity('melk', 'melkk') as s`
      expect(rows[0]!.s).toBeGreaterThan(0.5)
    })
  })
})
