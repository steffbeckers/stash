import postgres from 'postgres'

// Vite/Vitest injecteert alleen VITE_-variabelen automatisch in process.env.
// DATABASE_URL staat gewoon in .env, dus laden we dat hier zelf. Een
// ontbrekend .env-bestand negeren we; de duidelijkere foutmelding hieronder
// neemt het dan over.
try {
  process.loadEnvFile()
} catch {
  // .env ontbreekt of is onleesbaar — val terug op de check hieronder.
}

export type Sql = ReturnType<typeof postgres>

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL ontbreekt; kopieer .env.example naar .env')

export async function withDb(fn: (sql: Sql) => Promise<void>): Promise<void> {
  const sql = postgres(url!, { max: 1 })
  try {
    await fn(sql)
  } finally {
    await sql.end()
  }
}

/**
 * Bevinding 8 van de eindreview van plan 1: resetDb() truncate't elke tabel
 * in public plus auth.users cascade, tegen wat DATABASE_URL toevallig ook
 * is. Plan 8 heeft .env straks nodig gericht op het gehoste project, en dan
 * vernietigt één `npm run test:db` dat project. Deze guard weigert te
 * draaien tegen alles behalve een lokale host.
 */
export function assertLocalDatabase(databaseUrl: string): void {
  const host = new URL(databaseUrl).hostname
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(
      `resetDb() weigert te draaien tegen host "${host}". Dit commando truncate't elke tabel in ` +
        `public plus auth.users cascade — alleen "localhost" of "127.0.0.1" zijn toegestaan. ` +
        'Wijs DATABASE_URL in .env naar de lokale Supabase-stack (npx supabase start).',
    )
  }
}

export async function resetDb(): Promise<void> {
  assertLocalDatabase(url!)
  await withDb(async (sql) => {
    const tables = await sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public'
    `
    if (tables.length > 0) {
      const list = tables.map((t) => `public."${t.tablename}"`).join(', ')
      await sql.unsafe(`truncate table ${list} cascade`)
    }
    await sql`truncate table auth.users cascade`
  })
}

export async function createUser(email: string): Promise<string> {
  let id = ''
  await withDb(async (sql) => {
    const rows = await sql<{ id: string }[]>`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                              email_confirmed_at, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
              'authenticated', ${email}, '', now(), now(), now())
      returning id
    `
    id = rows[0]!.id
  })
  return id
}

/**
 * Draait fn in één transactie.
 *
 * De transactie is niet optioneel: `set local` werkt alleen binnen een
 * transactieblok. Daarbuiten doet `set local role authenticated` niets,
 * draait de test als superuser, en omzeilt hij RLS volledig — groen, en
 * zonder ook maar iets te bewijzen.
 */
export async function withTx(fn: (tx: Sql) => Promise<void>): Promise<void> {
  await withDb(async (sql) => {
    await sql.begin(async (tx) => {
      await fn(tx as unknown as Sql)
    })
  })
}

/** Zet wie er ingelogd is. Mag meermaals in dezelfde transactie. */
export async function actAs(tx: Sql, userId: string): Promise<void> {
  await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`
}

/**
 * Zet RLS aan voor de rest van de transactie. Doe je opzet hiervóór.
 *
 * Standaard `authenticated` (een ingelogde gebruiker via `actAs`). Geef
 * `'anon'` door om de rol van een niet-ingelogde bezoeker te testen — de rol
 * die de publieke anon-sleutel in de browserbundel gebruikt.
 */
export async function enableRls(tx: Sql, role: 'authenticated' | 'anon' = 'authenticated'): Promise<void> {
  // `set local role` neemt geen bind-parameter (dat is geen geldige SQL);
  // `role` komt uit een TS-unietype hierboven, niet uit ongefilterde
  // gebruikersinvoer, dus een letterlijke string hier is veilig.
  await tx.unsafe(`set local role ${role}`)
}
