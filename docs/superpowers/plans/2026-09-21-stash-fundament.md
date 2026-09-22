# Stash — Plan 1: Fundament — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een draaiende Nuxt 4-app op Cloudflare Workers waarin je kan inloggen, een huishouden starten of via een uitnodigingslink lid worden, en bewaarplaatsen beheren.

**Architecture:** Nuxt 4 met SSR, uitgerold als Cloudflare Worker via de Nitro-preset. Supabase (Postgres, Auth, Storage) in de EU-regio levert database en authenticatie. Privédata leest en schrijft de client rechtstreeks via `supabase-js` onder row-level security; alles wat globale data raakt of geld kost loopt later via `server/api`. Migraties zijn bestanden in `supabase/migrations`.

**Tech Stack:** Nuxt 4, Nuxt UI, `@nuxtjs/supabase`, `@nuxtjs/i18n`, Supabase CLI, Cloudflare Workers + Wrangler, Vitest, Playwright, `pg` voor databasetests.

**Spec:** `docs/superpowers/specs/2026-09-21-stash-design.md`

**Waar dit plan in past:** plan 1 van 8. Hierna volgen Catalogus, Voorraad, Bonnen, Matching, Prijzen, Consensus en Oplevering. Dit plan levert geen productfunctionaliteit op, maar wel het fundament waar alle andere plannen op staan: auth, huishoudens, RLS, meertaligheid en een werkende deploy.

## Global Constraints

Deze gelden voor elke taak in elk plan van dit project.

- **Node 20 of hoger.** Wrangler en Nuxt 4 vereisen het.
- **Nuxt 4** met SSR aan. Geen static generation.
- **Nuxt UI** voor alle interfacecomponenten. Geen tweede componentbibliotheek, geen eigen knoppen waar `UButton` volstaat.
- **Hosting: Cloudflare Workers.** Geen Node-specifieke API's zonder `nodejs_compat`. Geen `sharp` of andere native bindings — beeldbewerking gebeurt in de browser.
- **Supabase in de EU-regio (Frankfurt).** Bij het aanmaken van het project expliciet kiezen.
- **Locales: `en`, `nl`, `fr`.** `en` is de terugvaltaal. Elke gebruikerstekst gaat door i18n; geen hardgecodeerde strings in componenten.
- **Geldbedragen zijn gehele centen** (`int`), nooit floats. Valuta is altijd `EUR`.
- **De client schrijft nooit rechtstreeks naar globale data.** Producten, aliassen en prijzen gaan altijd via `server/api`. Privédata (huishouden, voorraad, bonnen) mag wel rechtstreeks, want RLS schermt die af.
- **Migraties zijn bestanden** in `supabase/migrations`, aangemaakt met de Supabase CLI en gecommit. Nooit klikken in het dashboard.
- **Elke tabel met gebruikersdata heeft RLS aan** vanaf de migratie die hem aanmaakt. Niet later toevoegen.
- **Bonfoto's in een private bucket, productfoto's in een publieke.** Nooit door elkaar.

**Vereisten op de machine:** Docker Desktop (voor lokale Supabase), Node 20+, en een Cloudflare-account. Op Windows draait de Supabase CLI prima, maar Docker moet draaien voordat `supabase start` werkt.

---

### Task 1: Nuxt 4-project dat op Cloudflare Workers draait

Een leeg maar deploybaar project. Dit is de taak die bewijst dat de riskantste keuze uit de spec — Nuxt op Workers — daadwerkelijk werkt, vóór er iets op gebouwd wordt.

**Files:**
- Create: `package.json`, `nuxt.config.ts`, `wrangler.jsonc`, `tsconfig.json`
- Create: `app/app.vue`, `app/pages/index.vue`
- Create: `server/api/health.get.ts`
- Create: `vitest.config.ts`
- Test: `test/server/health.test.ts`

**Interfaces:**
- Consumes: niets, dit is de eerste taak
- Produces: een draaiend Nuxt-project met `server/api/health.get.ts` dat `{ status: 'ok', version: string }` teruggeeft. Latere taken voegen routes toe naast deze.

- [ ] **Step 1: Nuxt-project aanmaken in de bestaande map**

De map bevat al `docs/` en een git-repo. Nuxt initialiseren zonder die te overschrijven:

```bash
npx nuxi@latest init . --packageManager npm --no-install --force
```

`--force` is nodig omdat de map niet leeg is. Vraagt de installatie of hij een
git-repo moet initialiseren, antwoord dan **nee** — die bestaat al en bevat de
spec. Controleer daarna dat `docs/` er nog staat:

```bash
ls docs/superpowers/specs/
```

- [ ] **Step 2: Afhankelijkheden installeren**

```bash
npm install
npm install @nuxt/ui
npm install -D wrangler nitro-cloudflare-dev vitest @nuxt/test-utils happy-dom
```

- [ ] **Step 3: `nuxt.config.ts` schrijven**

```ts
export default defineNuxtConfig({
  compatibilityDate: '2026-09-21',
  modules: ['@nuxt/ui', 'nitro-cloudflare-dev'],
  css: ['~/assets/css/main.css'],
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
  },
  runtimeConfig: {
    public: {
      appVersion: process.env.NUXT_PUBLIC_APP_VERSION || 'dev',
    },
  },
})
```

- [ ] **Step 4: Het CSS-instappunt voor Nuxt UI aanmaken**

Create `app/assets/css/main.css`:

```css
@import "tailwindcss";
@import "@nuxt/ui";
```

- [ ] **Step 5: `app/app.vue` vervangen**

`nuxi init` genereert een `app.vue` met `<NuxtWelcome />`. Zonder `<NuxtPage />` rendert geen enkele pagina, en Nuxt UI heeft `<UApp>` als wortel nodig voor overlays en toasts.

Replace `app/app.vue`:

```vue
<template>
  <UApp>
    <NuxtRouteAnnouncer />
    <NuxtPage />
  </UApp>
</template>
```

- [ ] **Step 6: `wrangler.jsonc` schrijven**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "stash",
  "main": ".output/server/index.mjs",
  "compatibility_date": "2026-09-21",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "binding": "ASSETS",
    "directory": ".output/public"
  },
  "observability": {
    "enabled": true
  }
}
```

- [ ] **Step 7: De falende test schrijven**

Create `test/server/health.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('health endpoint', async () => {
  await setup({ server: true })

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
```

Create `vitest.config.ts`:

```ts
import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    environment: 'nuxt',
  },
})
```

Voeg toe aan `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest",
"deploy": "nuxt build && wrangler deploy"
```

- [ ] **Step 8: De test draaien en zien dat hij faalt**

```bash
npm test
```

Verwacht: FAIL. De route `/api/health` bestaat niet, dus `$fetch` geeft een 404.

- [ ] **Step 9: De minimale implementatie schrijven**

Create `server/api/health.get.ts`:

```ts
export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  return {
    status: 'ok',
    version: config.public.appVersion,
  }
})
```

- [ ] **Step 10: De test draaien en zien dat hij slaagt**

```bash
npm test
```

Verwacht: PASS, beide tests.

- [ ] **Step 11: Lokaal draaien in de Workers-runtime**

```bash
npm run dev
```

Open `http://localhost:3000/api/health` en controleer dat je `{"status":"ok","version":"dev"}` ziet. `nitro-cloudflare-dev` zorgt dat dit de echte Workers-runtime gebruikt en niet Node — dat is het punt van deze stap.

- [ ] **Step 12: Naar Cloudflare uitrollen**

```bash
npx wrangler login
npm run deploy
```

Open de URL die Wrangler teruggeeft, met `/api/health` erachter. Zie je het JSON-antwoord, dan is de riskantste aanname uit de spec bevestigd.

**Faalt dit:** noteer de exacte fout en stop. Overstappen naar een container-host is een andere Nitro-preset en verder geen herwerk, maar dat is een beslissing voor de mens — niet iets om omheen te knutselen.

- [ ] **Step 13: `.gitignore` aanvullen en committen**

Voeg toe aan `.gitignore`:

```
.output
.nuxt
.wrangler
node_modules
.env
.env.*
!.env.example
```

```bash
git add -A
git commit -m "feat: Nuxt 4 op Cloudflare Workers met health-endpoint"
```

---

### Task 2: Supabase lokaal, migraties en een testdatabase

**Files:**
- Create: `supabase/config.toml` (door de CLI)
- Create: `supabase/migrations/0001_extensions.sql`
- Create: `test/db/helpers.ts`
- Create: `.env.example`
- Test: `test/db/extensions.test.ts`

**Interfaces:**
- Consumes: het project uit Task 1
- Produces: `test/db/helpers.ts` met `withDb(fn: (sql: Sql) => Promise<void>): Promise<void>` en `resetDb(): Promise<void>`. Elke latere databasetest gebruikt deze twee.

- [ ] **Step 1: Supabase initialiseren**

```bash
npx supabase init
npx supabase start
```

`supabase start` vereist een draaiende Docker Desktop. De uitvoer toont een API-URL, een anon key en een service role key. Bewaar die voor de volgende stap.

- [ ] **Step 2: Omgevingsvariabelen vastleggen**

Create `.env.example`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key uit supabase start>
SUPABASE_SERVICE_KEY=<service role key uit supabase start>
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
NUXT_PUBLIC_APP_VERSION=dev
```

Kopieer naar `.env` en vul de echte sleutels in. `.env` staat al in `.gitignore`.

- [ ] **Step 3: De falende test schrijven**

Create `test/db/helpers.ts`:

```ts
import postgres from 'postgres'

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

export async function resetDb(): Promise<void> {
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
```

Voeg in hetzelfde bestand ook deze helpers toe. Ze worden pas vanaf Task 5
gebruikt, maar ze horen hier omdat elke latere databasetest ze nodig heeft en
ze anders zes keer woordelijk gekopieerd zouden worden:

```ts
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

/** Zet RLS aan voor de rest van de transactie. Doe je opzet hiervóór. */
export async function enableRls(tx: Sql): Promise<void> {
  await tx`set local role authenticated`
}
```

De drie samen dekken twee soorten test:

- **Bewijzen dat RLS werkt:** opzet doen, dan `actAs` + `enableRls`, dan de
  query die wel of niets mag zien.
- **Een `security definer`-functie aanroepen** met een bekende `auth.uid()`:
  alleen `actAs`, geen `enableRls` — dan zit RLS de opzet niet in de weg.

`actAs` mag meerdere keren in dezelfde transactie, wat nodig is zodra een
test een eigenaar iets laat doen en daarna een gast.

`resetDb` leegt **alle** tabellen in het publieke schema, niet alleen
`auth.users`. Alleen gebruikers wissen laat huishoudens zonder leden achter,
en die lekken dan door naar de volgende test. Omdat de lijst dynamisch is,
blijft deze helper werken naarmate latere taken tabellen toevoegen.

**Controleer eenmalig dat `auth.uid()` de claim oppikt.** Voeg deze test toe
aan `test/db/extensions.test.ts` en laat hem slagen voordat je verdergaat:

```ts
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
```

Geeft die test `null` terug, gebruik dan in **beide** helpers de JSON-vorm in
plaats van de losse claim:

```ts
await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`
```

Dit eenmalig uitzoeken scheelt je in elke volgende taak een zoektocht naar
tests die groen zijn maar niets bewijzen.

Create `test/db/extensions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { withDb } from './helpers'

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
```

Installeer de databaseclient:

```bash
npm install -D postgres
```

- [ ] **Step 4: De test draaien en zien dat hij faalt**

```bash
npx vitest run test/db --environment node
```

Verwacht: FAIL. `pg_trgm` is niet geïnstalleerd, dus de eerste test vindt nul rijen.

- [ ] **Step 5: De migratie schrijven**

```bash
npx supabase migration new extensions
```

Dat maakt `supabase/migrations/<timestamp>_extensions.sql`. Zet erin:

```sql
create extension if not exists pg_trgm;
create extension if not exists "uuid-ossp";
```

- [ ] **Step 6: De migratie toepassen en de test opnieuw draaien**

```bash
npx supabase db reset
npx vitest run test/db --environment node
```

Verwacht: PASS, beide tests.

- [ ] **Step 7: Databasetests een eigen commando geven**

`test/db` heeft een draaiende Docker en een lokale database nodig; `npm test`
moet ook zonder dat kunnen draaien. Splits daarom de configuratie.

Create `vitest.db.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/db/**/*.test.ts'],
    fileParallelism: false,
  },
})
```

Pas `vitest.config.ts` aan zodat hij `test/db` overslaat. **Let op:** Task 1
heeft dit bestand bewust op `defineConfig` met `environment: 'node'` gezet, met
een toelichting erboven. Behoud beide — voeg alleen `exclude` toe en raak de
omgeving niet aan:

```ts
import { defineConfig } from 'vitest/config'

// health.test.ts gebruikt @nuxt/test-utils/e2e (setup + $fetch tegen een
// echt draaiende server), niet het mounten van componenten. E2e-tests
// moeten een gewoon `environment: 'node'`-project zijn en mogen
// defineVitestConfig niet gebruiken: die combinatie breekt het bundelen
// van testbestanden (nuxt/test-utils#1490).
export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['test/db/**', 'node_modules/**', 'e2e/**'],
  },
})
```

Voeg toe aan `package.json` scripts:

```json
"test:db": "vitest run --config vitest.db.config.ts",
"test:all": "npm run test && npm run test:db"
```

`fileParallelism: false` is belangrijk: databasetests delen één database en zouden elkaar anders omvergooien.

**Vereiste vóór je begint:** Docker Desktop moet draaien. `npx supabase start`
faalt anders met een verbindingsfout naar de Docker-daemon. Draait Docker niet
en kan jij hem niet starten, rapporteer dan BLOCKED — dit is een
omgevingsvereiste, geen taakprobleem.

- [ ] **Step 8: Beide testsuites draaien**

```bash
npm run test:all
```

Verwacht: PASS in beide.

- [ ] **Step 9: Committen**

```bash
git add -A
git commit -m "feat: Supabase lokaal met migraties en een testdatabase"
```

---

### Task 3: Meertaligheid met en, nl en fr

**Files:**
- Modify: `nuxt.config.ts`
- Create: `i18n/locales/en.json`, `i18n/locales/nl.json`, `i18n/locales/fr.json`
- Modify: `app/pages/index.vue`
- Test: `test/i18n/locales.test.ts`

**Interfaces:**
- Consumes: het project uit Task 1
- Produces: `$t(key)` beschikbaar in elke component, en drie locale-bestanden die altijd dezelfde sleutels moeten bevatten. Elke latere taak die tekst toont voegt sleutels toe aan alle drie.

- [ ] **Step 1: De falende test schrijven**

Deze test bewaakt iets dat anders gegarandeerd misgaat: een sleutel toevoegen in één taal en de andere twee vergeten.

Create `test/i18n/locales.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import en from '../../i18n/locales/en.json'
import nl from '../../i18n/locales/nl.json'
import fr from '../../i18n/locales/fr.json'

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null
      ? flatten(value as Record<string, unknown>, path)
      : [path]
  })
}

describe('locale-bestanden', () => {
  const enKeys = flatten(en).sort()

  it('nl heeft exact dezelfde sleutels als en', () => {
    expect(flatten(nl).sort()).toEqual(enKeys)
  })

  it('fr heeft exact dezelfde sleutels als en', () => {
    expect(flatten(fr).sort()).toEqual(enKeys)
  })

  it('heeft geen lege vertalingen', () => {
    for (const [name, bundle] of [['nl', nl], ['fr', fr], ['en', en]] as const) {
      const empty = flatten(bundle).filter((path) => {
        const value = path.split('.').reduce<any>((acc, key) => acc?.[key], bundle)
        return typeof value === 'string' && value.trim() === ''
      })
      expect(empty, `lege vertalingen in ${name}`).toEqual([])
    }
  })
})
```

- [ ] **Step 2: De test draaien en zien dat hij faalt**

```bash
npm test -- test/i18n
```

Verwacht: FAIL. De locale-bestanden bestaan niet.

- [ ] **Step 3: De locale-bestanden aanmaken**

Create `i18n/locales/en.json`:

```json
{
  "app": {
    "name": "Stash",
    "tagline": "Know what you have at home"
  },
  "nav": {
    "inventory": "Inventory",
    "settings": "Settings"
  }
}
```

Create `i18n/locales/nl.json`:

```json
{
  "app": {
    "name": "Stash",
    "tagline": "Weet wat je in huis hebt"
  },
  "nav": {
    "inventory": "Voorraad",
    "settings": "Instellingen"
  }
}
```

Create `i18n/locales/fr.json`:

```json
{
  "app": {
    "name": "Stash",
    "tagline": "Sachez ce que vous avez chez vous"
  },
  "nav": {
    "inventory": "Stock",
    "settings": "Paramètres"
  }
}
```

- [ ] **Step 4: De test draaien en zien dat hij slaagt**

```bash
npm test -- test/i18n
```

Verwacht: PASS, alle drie.

- [ ] **Step 5: De i18n-module installeren en configureren**

```bash
npm install @nuxtjs/i18n
```

Pas `nuxt.config.ts` aan:

```ts
export default defineNuxtConfig({
  compatibilityDate: '2026-09-21',
  modules: ['@nuxt/ui', '@nuxtjs/i18n', 'nitro-cloudflare-dev'],
  css: ['~/assets/css/main.css'],
  i18n: {
    defaultLocale: 'en',
    strategy: 'prefix_except_default',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'stash_locale',
      redirectOn: 'root',
    },
    locales: [
      { code: 'en', language: 'en-GB', file: 'en.json', name: 'English' },
      { code: 'nl', language: 'nl-BE', file: 'nl.json', name: 'Nederlands' },
      { code: 'fr', language: 'fr-BE', file: 'fr.json', name: 'Français' },
    ],
  },
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
    },
  },
  runtimeConfig: {
    public: {
      appVersion: process.env.NUXT_PUBLIC_APP_VERSION || 'dev',
    },
  },
})
```

`detectBrowserLanguage` met een cookie is de reden dat er geen toestemmingsbanner nodig is: de taalkeuze is strikt noodzakelijk voor het functioneren van de app.

- [ ] **Step 6: De startpagina vertaald maken**

Replace `app/pages/index.vue`:

```vue
<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <UContainer class="py-12">
    <h1 class="text-3xl font-bold">{{ t('app.name') }}</h1>
    <p class="mt-2 text-lg text-muted">{{ t('app.tagline') }}</p>
  </UContainer>
</template>
```

- [ ] **Step 7: Handmatig controleren**

```bash
npm run dev
```

Open `http://localhost:3000` (Engels), `http://localhost:3000/nl` en `http://localhost:3000/fr`. Alle drie tonen de juiste slogan.

- [ ] **Step 8: Committen**

```bash
git add -A
git commit -m "feat: meertaligheid met en, nl en fr, met een test die sleutels gelijk houdt"
```

---

### Task 4: Inloggen met een magic link

**Files:**
- Modify: `nuxt.config.ts`
- Create: `app/pages/login.vue`
- Create: `app/pages/confirm.vue`
- Create: `app/pages/app.vue`
- Modify: `app/pages/index.vue` (wordt de publieke landingspagina)
- Modify: `i18n/locales/en.json`, `i18n/locales/nl.json`, `i18n/locales/fr.json`
- Create: `e2e/login.spec.ts`
- Create: `playwright.config.ts`

**Interfaces:**
- Consumes: het project uit Task 1, de locales uit Task 3
- Produces: `useSupabaseUser()` geeft de ingelogde gebruiker in elke component; `useSupabaseClient()` geeft de client. Elke latere taak leunt hierop. Routes zijn standaard afgeschermd; `/login` en `/confirm` zijn de uitzonderingen.

- [ ] **Step 1: De Supabase-module installeren**

```bash
npm install @nuxtjs/supabase
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Configureren met afscherming standaard aan**

Voeg toe aan `nuxt.config.ts`, in `modules` vóór `nitro-cloudflare-dev`:

```ts
    modules: ['@nuxt/ui', '@nuxtjs/i18n', '@nuxtjs/supabase', 'nitro-cloudflare-dev'],
```

En als eigen blok:

```ts
  supabase: {
    redirect: true,
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: [
        '/', '/nl', '/fr',
        '/login', '/confirm',
        '/nl/login', '/nl/confirm',
        '/fr/login', '/fr/confirm',
      ],
    },
  },
```

Afschermen staat hiermee **standaard aan**: elke nieuwe pagina is beschermd tenzij je hem uitzondert. Dat is de veilige richting — vergeten afschermen is erger dan per ongeluk afgeschermd.

- [ ] **Step 3: Vertaalsleutels toevoegen**

Voeg toe aan alle drie de locale-bestanden, binnen het hoofdobject.

`en.json`:

```json
  "auth": {
    "signIn": "Sign in",
    "email": "Email address",
    "sendLink": "Send me a link",
    "linkSent": "Check your inbox — we sent you a sign-in link.",
    "signOut": "Sign out",
    "error": "Something went wrong. Please try again."
  },
  "landing": {
    "getStarted": "Get started"
  },
  "appHome": {
    "title": "Your household"
  }
```

`nl.json`:

```json
  "auth": {
    "signIn": "Inloggen",
    "email": "E-mailadres",
    "sendLink": "Stuur me een link",
    "linkSent": "Kijk in je mailbox — we stuurden je een inloglink.",
    "signOut": "Uitloggen",
    "error": "Er ging iets mis. Probeer het opnieuw."
  },
  "landing": {
    "getStarted": "Aan de slag"
  },
  "appHome": {
    "title": "Je huishouden"
  }
```

`fr.json`:

```json
  "auth": {
    "signIn": "Se connecter",
    "email": "Adresse e-mail",
    "sendLink": "Envoyez-moi un lien",
    "linkSent": "Consultez votre boîte mail — nous vous avons envoyé un lien de connexion.",
    "signOut": "Se déconnecter",
    "error": "Une erreur s'est produite. Veuillez réessayer."
  },
  "landing": {
    "getStarted": "Commencer"
  },
  "appHome": {
    "title": "Votre ménage"
  }
```

- [ ] **Step 3b: De landingspagina en de app-startpagina scheiden**

De homepage blijft publiek. Wie op Stash belandt krijgt uitleg, geen
inlogscherm; pas wie besluit hem te gebruiken klikt door. De app zelf leeft
onder `/app`.

Houd de landingspagina hier bewust dun — dit is een authenticatietaak, geen
marketingtaak. Het verhaal komt later.

Replace `app/pages/index.vue`:

```vue
<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const user = useSupabaseUser()

// Dagelijkse gebruikers horen de uitlegpagina niet elke keer te zien.
watch(user, (value) => {
  if (value) navigateTo(localePath('/app'))
}, { immediate: true })
</script>

<template>
  <UContainer class="py-16 text-center">
    <h1 class="text-4xl font-bold">{{ t('app.name') }}</h1>
    <p class="mt-3 text-lg text-muted">{{ t('app.tagline') }}</p>
    <UButton class="mt-8" size="lg" :to="localePath('/login')">
      {{ t('landing.getStarted') }}
    </UButton>
  </UContainer>
</template>
```

Create `app/pages/app.vue`:

```vue
<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <UContainer class="py-12">
    <h1 class="text-2xl font-bold">{{ t('appHome.title') }}</h1>
  </UContainer>
</template>
```

Task 7 bouwt deze pagina uit tot de echte app-start; hier is hij alleen de
afgeschermde tegenhanger van de publieke landingspagina, zodat er iets bestaat
om de afscherming tegen te testen.

- [ ] **Step 4: De falende e2e-test schrijven**

Create `playwright.config.ts`. Het laden van `.env` staat er vanaf het begin
in, want Task 7 heeft `SUPABASE_URL` en `SUPABASE_SERVICE_KEY` nodig in de
tests. Gebruik dezelfde aanpak als `test/db/helpers.ts` uit Task 2 — de
ingebouwde `process.loadEnvFile()`, geen extra afhankelijkheid:

```ts
import { defineConfig } from '@playwright/test'

// Zelfde reden als in test/db/helpers.ts: de testrunner laadt .env niet
// vanzelf. Een ontbrekend bestand negeren we; de tests falen dan alsnog
// met een duidelijke melding over de ontbrekende variabele.
try {
  process.loadEnvFile()
} catch {
  // .env ontbreekt of is onleesbaar
}

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
```

Create `e2e/login.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('de homepage blijft publiek', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible()
})

test('een afgeschermde pagina stuurt je naar inloggen', async ({ page }) => {
  await page.goto('/app')
  await expect(page).toHaveURL(/\/login/)
})

test('het inlogformulier toont een bevestiging na versturen', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill('test@example.com')
  await page.getByRole('button', { name: /link/i }).click()
  await expect(page.getByText(/inbox/i)).toBeVisible()
})
```

Voeg toe aan `package.json` scripts:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 5: De test draaien en zien dat hij faalt**

```bash
npm run test:e2e
```

Verwacht: FAIL. `/login` bestaat nog niet.

- [ ] **Step 6: De inlogpagina schrijven**

Create `app/pages/login.vue`:

```vue
<script setup lang="ts">
const { t } = useI18n()
const supabase = useSupabaseClient()

const email = ref('')
const sent = ref(false)
const error = ref('')
const pending = ref(false)

async function submit() {
  pending.value = true
  error.value = ''
  const { error: authError } = await supabase.auth.signInWithOtp({
    email: email.value,
    options: { emailRedirectTo: `${window.location.origin}/confirm` },
  })
  pending.value = false
  if (authError) {
    error.value = t('auth.error')
    return
  }
  sent.value = true
}
</script>

<template>
  <UContainer class="max-w-md py-12">
    <h1 class="text-2xl font-bold">{{ t('auth.signIn') }}</h1>

    <UAlert v-if="sent" class="mt-6" color="success" :description="t('auth.linkSent')" />

    <form v-else class="mt-6 space-y-4" @submit.prevent="submit">
      <UFormField :label="t('auth.email')" name="email">
        <UInput v-model="email" type="email" required autocomplete="email" class="w-full" />
      </UFormField>

      <UAlert v-if="error" color="error" :description="error" />

      <UButton type="submit" :loading="pending" block>
        {{ t('auth.sendLink') }}
      </UButton>
    </form>
  </UContainer>
</template>
```

- [ ] **Step 7: De bevestigingspagina schrijven**

Create `app/pages/confirm.vue`:

```vue
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
```

- [ ] **Step 8: De test draaien en zien dat hij slaagt**

```bash
npm run test:e2e
```

Verwacht: PASS, beide tests. De tweede werkt omdat lokale Supabase e-mails opvangt in Inbucket in plaats van ze echt te versturen — `signInWithOtp` slaagt dus zonder mailserver.

- [ ] **Step 9: Handmatig een keer echt inloggen**

```bash
npm run dev
```

Log in met een willekeurig adres, open Inbucket op `http://127.0.0.1:54324`, klik de link, en controleer dat je op de startpagina belandt.

- [ ] **Step 10: Committen**

```bash
git add -A
git commit -m "feat: inloggen met een magic link, routes standaard afgeschermd"
```

---

### Task 5: Gebruikersprofiel dat automatisch ontstaat

**Files:**
- Create: `supabase/migrations/<timestamp>_user_profile.sql`
- Test: `test/db/user-profile.test.ts`

**Interfaces:**
- Consumes: de testhelpers uit Task 2
- Produces: tabel `user_profile(user_id uuid pk, display_name text, trust_level int, role text, created_at timestamptz)`, met een trigger die bij elke nieuwe `auth.users`-rij automatisch een profiel aanmaakt. Latere taken lezen `trust_level` en `role`.

- [ ] **Step 1: De falende test schrijven**

Create `test/db/user-profile.test.ts`:

```ts
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

  // De twee tests hieronder draaien wel onder RLS. Zonder hen zou deze suite
  // even groen zijn met `enable row level security` volledig weggehaald — en
  // dan bewijst ze niets over de policies die de tabel beschermen.

  it('laat een gebruiker het profiel van iemand anders niet wijzigen', async () => {
    const mine = await createUser('mijn-profiel@example.com')
    const theirs = await createUser('ander-profiel@example.com')

    await withTx(async (tx) => {
      await actAs(tx, mine)
      await enableRls(tx)
      const result = await tx`
        update user_profile set display_name = 'gekaapt' where user_id = ${theirs}
      `
      // RLS geeft hier geen fout maar raakt nul rijen; dat is het bewijs.
      expect(result.count).toBe(0)
    })

    await withDb(async (sql) => {
      const [row] = await sql<{ display_name: string | null }[]>`
        select display_name from user_profile where user_id = ${theirs}
      `
      expect(row!.display_name).toBeNull()
    })
  })

  it('laat profielen wel lezen door andere ingelogde gebruikers', async () => {
    const mine = await createUser('lezer@example.com')
    const theirs = await createUser('gelezene@example.com')

    await withTx(async (tx) => {
      await actAs(tx, mine)
      await enableRls(tx)
      const rows = await tx`select user_id from user_profile where user_id = ${theirs}`
      // De select-policy is bewust `using (true)`: weergavenamen zijn publiek.
      // Wie dit ooit dichtzet, hoort deze test te zien falen.
      expect(rows.length).toBe(1)
    })
  })
})
```

- [ ] **Step 2: De test draaien en zien dat hij faalt**

```bash
npm run test:db
```

Verwacht: FAIL met `relation "user_profile" does not exist`.

- [ ] **Step 3: De migratie schrijven**

```bash
npx supabase migration new user_profile
```

Zet in het nieuwe bestand:

```sql
create table user_profile (
  user_id      uuid primary key references auth.users on delete cascade,
  display_name text,
  trust_level  int not null default 0 check (trust_level between 0 and 3),
  role         text not null default 'user' check (role in ('user', 'moderator', 'admin')),
  created_at   timestamptz not null default now()
);

alter table user_profile enable row level security;

create policy "iedereen mag publieke profielvelden lezen"
  on user_profile for select
  using (true);

create policy "je mag je eigen profiel bijwerken"
  on user_profile for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create function handle_new_user() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.user_profile (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
```

`trust_level` en `role` staan bewust **niet** in de update-policy als bewerkbaar veld — een gebruiker mag zichzelf geen moderator maken. Task 10 sluit dat gat volledig met een kolomtrigger; deze policy alleen is niet genoeg, want een update-policy dekt de hele rij.

- [ ] **Step 4: De migratie toepassen en de test draaien**

```bash
npx supabase db reset
npm run test:db
```

Verwacht: PASS, alle drie.

- [ ] **Step 5: Committen**

```bash
git add -A
git commit -m "feat: user_profile met trigger en vertrouwensniveau"
```

---

### Task 6: Huishoudens met row-level security

**Files:**
- Create: `supabase/migrations/<timestamp>_household.sql`
- Test: `test/db/household.test.ts`

**Interfaces:**
- Consumes: `user_profile` uit Task 5, de testhelpers uit Task 2
- Produces: tabellen `household(id, name, created_at)` en `household_member(household_id, user_id, role, joined_at)`, plus de hulpfuncties `is_household_member(target uuid) returns boolean` en `is_household_owner(target uuid) returns boolean`. Elke latere tabel met privédata gebruikt `is_household_member` in zijn RLS-policy. De parameternaam is `target`, niet `household_id` — dat botst anders met de kolomnaam binnen de functie.

**Dit is de eerste taak met echte RLS-tests.** Ze gebruiken `withTx`, `actAs`
en `enableRls` uit Task 2. Twee dingen die je een verkeerde diagnose kunnen
bezorgen:

- **`permission denied for table household`** betekent niet dat RLS werkt,
  maar dat de rol `authenticated` geen `GRANT` heeft. Supabase zet standaard
  privileges voor nieuwe tabellen in `public`; ontbreekt het toch, voeg dan
  onderaan de migratie `grant select, insert, update, delete on <tabel> to
  authenticated;` toe. Een RLS-test die iets mag zien en niets terugkrijgt is
  het verwachte gedrag; een test die een permissiefout geeft is een
  opzetprobleem.
- **Volgorde binnen de transactie:** doe eerst je opzet (rijen aanmaken), dan
  `actAs` en `enableRls`, dan pas de query die je wil bewijzen. Na `enableRls`
  zit RLS je opzet in de weg.

- [ ] **Step 1: De falende test schrijven**

Create `test/db/household.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('huishoudens en RLS', () => {
  beforeEach(resetDb)

  it('laat een lid zijn eigen huishouden zien', async () => {
    const userId = await createUser('lid@example.com')
    await withTx(async (tx) => {
      const [hh] = await tx<{ id: string }[]>`
        insert into household (name) values ('Thuis') returning id
      `
      await tx`
        insert into household_member (household_id, user_id, role)
        values (${hh!.id}, ${userId}, 'owner')
      `

      await actAs(tx, userId)
      await enableRls(tx)
      const rows = await tx`select id from household`
      expect(rows.length).toBe(1)
    })
  })

  it('verbergt het huishouden van iemand anders', async () => {
    const mine = await createUser('ik@example.com')
    const theirs = await createUser('ander@example.com')
    await withTx(async (tx) => {
      const [hh] = await tx<{ id: string }[]>`
        insert into household (name) values ('Van iemand anders') returning id
      `
      await tx`
        insert into household_member (household_id, user_id, role)
        values (${hh!.id}, ${theirs}, 'owner')
      `

      await actAs(tx, mine)
      await enableRls(tx)
      const rows = await tx`select id from household`
      expect(rows.length).toBe(0)
    })
  })

  it('is_household_member klopt voor leden en niet-leden', async () => {
    const member = await createUser('wel@example.com')
    const outsider = await createUser('niet@example.com')
    await withTx(async (tx) => {
      const [hh] = await tx<{ id: string }[]>`
        insert into household (name) values ('Test') returning id
      `
      await tx`
        insert into household_member (household_id, user_id, role)
        values (${hh!.id}, ${member}, 'owner')
      `

      await actAs(tx, member)
      const yes = await tx<{ r: boolean }[]>`select is_household_member(${hh!.id}) as r`
      expect(yes[0]!.r).toBe(true)

      await actAs(tx, outsider)
      const no = await tx<{ r: boolean }[]>`select is_household_member(${hh!.id}) as r`
      expect(no[0]!.r).toBe(false)
    })
  })
})
```

- [ ] **Step 2: De test draaien en zien dat hij faalt**

```bash
npm run test:db
```

Verwacht: FAIL met `relation "household" does not exist`.

- [ ] **Step 3: De migratie schrijven**

```bash
npx supabase migration new household
```

Zet in het nieuwe bestand:

```sql
create table household (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table household_member (
  household_id uuid not null references household on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_member_user_idx on household_member (user_id);

-- security definer omzeilt RLS op household_member en voorkomt zo de
-- oneindige recursie die ontstaat als een policy zijn eigen tabel bevraagt
create function is_household_member(target uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from household_member
    where household_id = target and user_id = auth.uid()
  );
$$;

create function is_household_owner(target uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from household_member
    where household_id = target and user_id = auth.uid() and role = 'owner'
  );
$$;

alter table household enable row level security;
alter table household_member enable row level security;

create policy "leden zien hun huishouden"
  on household for select
  using (is_household_member(id));

create policy "eigenaars mogen hun huishouden wijzigen"
  on household for update
  using (is_household_owner(id))
  with check (is_household_owner(id));

create policy "eigenaars mogen hun huishouden opheffen"
  on household for delete
  using (is_household_owner(id));

create policy "iedereen mag een huishouden starten"
  on household for insert
  with check (auth.uid() is not null);

create policy "leden zien de ledenlijst"
  on household_member for select
  using (is_household_member(household_id));

create policy "eigenaars mogen leden verwijderen"
  on household_member for delete
  using (is_household_owner(household_id) or user_id = auth.uid());
```

De `security definer` op `is_household_member` is niet optioneel. Zonder die vlag bevraagt de policy op `household_member` zijn eigen tabel en draait Postgres in een oneindige recursie.

- [ ] **Step 4: De migratie toepassen en de test draaien**

```bash
npx supabase db reset
npm run test:db
```

Verwacht: PASS, alle drie.

- [ ] **Step 5: Committen**

```bash
git add -A
git commit -m "feat: huishoudens met RLS en de hulpfuncties voor lidmaatschap"
```

---

### Task 7: Een huishouden starten vanuit de app

**Files:**
- Create: `app/pages/onboarding.vue`
- Create: `app/composables/useHousehold.ts`
- Create: `supabase/migrations/<timestamp>_create_household_rpc.sql`
- Modify: `i18n/locales/en.json`, `i18n/locales/nl.json`, `i18n/locales/fr.json`
- Modify: `app/pages/app.vue`
- Test: `test/db/create-household.test.ts`
- Test: `e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes: `household`, `household_member`, `is_household_member` uit Task 6
- Produces: de Postgres-functie `create_household(household_name text) returns uuid`, en de composable `useHousehold()` met exact deze vorm:

```ts
interface Household { id: string; name: string; role: 'owner' | 'member' }

useHousehold(): {
  households: Ref<Household[]>
  activeId:   Ref<string | null>
  refresh:    () => Promise<void>
  setActive:  (id: string) => void
  create:     (name: string) => Promise<string>
}
```

Task 8 en Task 9 gebruiken `activeId`, `refresh` en `setActive`; plan 3 bouwt de huishoudwisselaar op `setActive`.

- [ ] **Step 1: De falende databasetest schrijven**

Een huishouden starten moet de rij én het eigenaarslidmaatschap in één keer aanmaken. Twee losse inserts vanuit de client zouden een huishouden zonder eigenaar kunnen achterlaten.

Create `test/db/create-household.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('create_household', () => {
  beforeEach(resetDb)

  it('maakt het huishouden en het eigenaarslidmaatschap samen aan', async () => {
    const userId = await createUser('starter@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      const [row] = await tx<{ create_household: string }[]>`
        select create_household('Thuis')
      `
      const id = row!.create_household

      const members = await tx<{ role: string }[]>`
        select role from household_member where household_id = ${id} and user_id = ${userId}
      `
      expect(members[0]!.role).toBe('owner')
    })
  })

  it('weigert een lege naam', async () => {
    const userId = await createUser('leeg@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await expect(tx`select create_household('   ')`).rejects.toThrow()
    })
  })

  // De twee tests hieronder vullen een gat uit taak 6: daar was de isolatie van
  // household UPDATE/DELETE en household_member SELECT alleen door analyse
  // vastgesteld, niet door een test. Hier kan het wel, want create_household
  // geeft een tweede huishouden met lidmaatschap in een paar regels.

  it('verbergt de ledenlijst van een ander huishouden', async () => {
    const mine = await createUser('mijn-leden@example.com')
    const theirs = await createUser('hun-leden@example.com')

    await withTx(async (tx) => {
      await actAs(tx, theirs)
      await tx`select create_household('Hun huis')`

      await actAs(tx, mine)
      await enableRls(tx)
      const rows = await tx`select user_id from household_member`
      expect(rows.length).toBe(0)
    })
  })

  it('laat een buitenstaander een huishouden niet hernoemen of verwijderen', async () => {
    const outsider = await createUser('buitenstaander@example.com')
    const owner = await createUser('eigenaar7@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Hun huis')`
      const id = hh!.create_household

      await actAs(tx, outsider)
      await enableRls(tx)

      // RLS geeft geen fout maar raakt nul rijen; dat is het bewijs.
      const updated = await tx`update household set name = 'gekaapt' where id = ${id}`
      expect(updated.count).toBe(0)

      const deleted = await tx`delete from household where id = ${id}`
      expect(deleted.count).toBe(0)

      await tx`reset role`
      const [row] = await tx<{ name: string }[]>`select name from household where id = ${id}`
      expect(row!.name).toBe('Hun huis')
    })
  })

  it('weigert een oproep zonder ingelogde gebruiker', async () => {
    await withTx(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub', '', true)`
      await expect(tx`select create_household('Thuis')`).rejects.toThrow()
    })
  })
})
```

- [ ] **Step 2: De test draaien en zien dat hij faalt**

```bash
npm run test:db
```

Verwacht: FAIL met `function create_household(unknown) does not exist`.

- [ ] **Step 3: De migratie schrijven**

```bash
npx supabase migration new create_household_rpc
```

Zet in het nieuwe bestand:

```sql
create function create_household(household_name text) returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  new_id uuid;
  actor  uuid := auth.uid();
begin
  if actor is null then
    raise exception 'niet ingelogd';
  end if;

  if household_name is null or length(trim(household_name)) = 0 then
    raise exception 'naam mag niet leeg zijn';
  end if;

  insert into household (name) values (trim(household_name)) returning id into new_id;
  insert into household_member (household_id, user_id, role) values (new_id, actor, 'owner');

  return new_id;
end;
$$;

revoke all on function create_household(text) from public;
grant execute on function create_household(text) to authenticated;
```

- [ ] **Step 4: De migratie toepassen en de test draaien**

```bash
npx supabase db reset
npm run test:db
```

Verwacht: PASS, alle drie.

- [ ] **Step 5: De composable schrijven**

Create `app/composables/useHousehold.ts`:

```ts
export interface Household {
  id: string
  name: string
  role: 'owner' | 'member'
}

const ACTIVE_KEY = 'stash_active_household'

export function useHousehold() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  const households = useState<Household[]>('households', () => [])
  const activeId = useState<string | null>('activeHousehold', () => null)

  async function refresh(): Promise<void> {
    if (!user.value) {
      households.value = []
      activeId.value = null
      return
    }

    const { data, error } = await supabase
      .from('household_member')
      .select('role, household(id, name)')
      .eq('user_id', user.value.id)

    if (error) throw error

    households.value = (data ?? []).map((row: any) => ({
      id: row.household.id,
      name: row.household.name,
      role: row.role,
    }))

    const stored = import.meta.client ? localStorage.getItem(ACTIVE_KEY) : null
    const valid = households.value.some((h) => h.id === stored)
    activeId.value = valid ? stored : (households.value[0]?.id ?? null)
  }

  function setActive(id: string): void {
    activeId.value = id
    if (import.meta.client) localStorage.setItem(ACTIVE_KEY, id)
  }

  async function create(name: string): Promise<string> {
    const { data, error } = await supabase.rpc('create_household', { household_name: name })
    if (error) throw error
    await refresh()
    setActive(data as string)
    return data as string
  }

  return { households, activeId, refresh, setActive, create }
}
```

- [ ] **Step 6: Vertaalsleutels toevoegen**

Voeg toe aan alle drie de locale-bestanden.

`en.json`:

```json
  "onboarding": {
    "title": "Get started",
    "startTitle": "Start a household",
    "startHelp": "Track what you have at home, on your own or with others.",
    "name": "Household name",
    "start": "Start",
    "joinTitle": "Join a household",
    "joinHelp": "Someone can send you an invitation link."
  }
```

`nl.json`:

```json
  "onboarding": {
    "title": "Aan de slag",
    "startTitle": "Start een huishouden",
    "startHelp": "Hou bij wat je in huis hebt, alleen of samen met anderen.",
    "name": "Naam van het huishouden",
    "start": "Starten",
    "joinTitle": "Word lid van een huishouden",
    "joinHelp": "Iemand kan je een uitnodigingslink sturen."
  }
```

`fr.json`:

```json
  "onboarding": {
    "title": "Commencer",
    "startTitle": "Créer un ménage",
    "startHelp": "Suivez ce que vous avez chez vous, seul ou avec d'autres.",
    "name": "Nom du ménage",
    "start": "Créer",
    "joinTitle": "Rejoindre un ménage",
    "joinHelp": "Quelqu'un peut vous envoyer un lien d'invitation."
  }
```

- [ ] **Step 7: De onboardingpagina schrijven**

Create `app/pages/onboarding.vue`:

```vue
<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const { create } = useHousehold()

const name = ref('')
const pending = ref(false)
const error = ref('')

async function start() {
  pending.value = true
  error.value = ''
  try {
    await create(name.value)
    await navigateTo(localePath('/app'))
  } catch {
    error.value = t('auth.error')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-md py-12">
    <h1 class="text-2xl font-bold">{{ t('onboarding.title') }}</h1>

    <UCard class="mt-6">
      <template #header>
        <h2 class="font-semibold">{{ t('onboarding.startTitle') }}</h2>
      </template>

      <p class="text-sm text-muted">{{ t('onboarding.startHelp') }}</p>

      <form class="mt-4 space-y-4" @submit.prevent="start">
        <UFormField :label="t('onboarding.name')" name="name">
          <UInput v-model="name" required class="w-full" />
        </UFormField>

        <UAlert v-if="error" color="error" :description="error" />

        <UButton type="submit" :loading="pending" block>
          {{ t('onboarding.start') }}
        </UButton>
      </form>
    </UCard>

    <UCard class="mt-4">
      <template #header>
        <h2 class="font-semibold">{{ t('onboarding.joinTitle') }}</h2>
      </template>
      <p class="text-sm text-muted">{{ t('onboarding.joinHelp') }}</p>
    </UCard>
  </UContainer>
</template>
```

- [ ] **Step 8: De app-startpagina laten doorsturen wanneer er geen huishouden is**

Dit is `app/pages/app.vue`, niet `index.vue` — die laatste is de publieke
landingspagina uit Task 4 en blijft ongemoeid.

Replace `app/pages/app.vue`:

```vue
<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const { households, activeId, refresh } = useHousehold()

const ready = ref(false)

// In onMounted, niet op top-level await: activeId komt uit localStorage en is
// tijdens SSR altijd null. Doorsturen hoort ook een clientbeslissing te zijn,
// anders stuurt de server iemand weg op basis van halve informatie.
onMounted(async () => {
  await refresh()
  if (households.value.length === 0) {
    await navigateTo(localePath('/onboarding'))
    return
  }
  ready.value = true
})

const active = computed(() => households.value.find((h) => h.id === activeId.value))
</script>

<template>
  <UContainer class="py-12">
    <UProgress v-if="!ready" animation="carousel" />
    <template v-else>
      <h1 class="text-3xl font-bold">{{ t('app.name') }}</h1>
      <p class="mt-2 text-lg text-muted">{{ active?.name }}</p>
    </template>
  </UContainer>
</template>
```

- [ ] **Step 9: De e2e-test schrijven**

De test logt in via een echte magic link, opgevraagd met de service-role
sleutel. Dat is dezelfde flow als een gebruiker doorloopt, zonder testcode in
de applicatie en zonder scripts vanaf een extern CDN in de pagina te laden.

Create `e2e/onboarding.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_KEY!

async function signIn(page: import('@playwright/test').Page, email: string) {
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  await admin.auth.admin.createUser({ email, email_confirm: true })

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: 'http://localhost:3000/confirm' },
  })
  if (error) throw error

  await page.goto(data.properties.action_link)
  await page.waitForURL(/\/(confirm|onboarding|$)/)
}

test('een nieuwe gebruiker belandt op onboarding en kan een huishouden starten', async ({ page }) => {
  await signIn(page, `e2e-${Date.now()}@example.com`)

  await page.goto('/onboarding')
  await page.getByLabel('Household name').fill('Testhuis')
  await page.getByRole('button', { name: 'Start' }).click()

  await expect(page.getByText('Testhuis')).toBeVisible()
})

test('een gebruiker zonder huishouden wordt vanaf de app-startpagina doorgestuurd', async ({ page }) => {
  await signIn(page, `e2e-redirect-${Date.now()}@example.com`)

  await page.goto('/app')
  await expect(page).toHaveURL(/\/onboarding/)
})

test('een ingelogde gebruiker op de landingspagina belandt in de app', async ({ page }) => {
  await signIn(page, `e2e-landing-${Date.now()}@example.com`)

  await page.goto('/')
  await expect(page).toHaveURL(/\/(app|onboarding)/)
})
```

De labels zijn exact, niet met een reguliere expressie: de standaardlocale is
`en`, dus `/onboarding` toont de Engelse teksten uit `en.json`. Een test die
`/household name|naam/i` accepteert verbergt juist het geval waarin de
verkeerde taal geladen wordt.

- [ ] **Step 10: De e2e-test draaien**

```bash
npm run test:e2e
```

Verwacht: PASS, beide tests, plus de twee uit Task 4.

Faalt `generateLink` op de vorm van het antwoord, log dan `data.properties` en
gebruik het veld dat de actielink bevat. Faalt hij op ontbrekende
omgevingsvariabelen, controleer dan dat `.env` bestaat en `SUPABASE_SERVICE_KEY`
bevat — `playwright.config.ts` laadt het via `process.loadEnvFile()`.

- [ ] **Step 11: Committen**

```bash
git add -A
git commit -m "feat: een huishouden starten, met een RPC die eigenaar en huishouden samen aanmaakt"
```

---

### Task 8: Uitnodigingslinks

**Files:**
- Create: `supabase/migrations/<timestamp>_household_invite.sql`
- Create: `app/pages/invite/[token].vue`
- Create: `app/components/HouseholdInvites.vue`
- Modify: `i18n/locales/en.json`, `i18n/locales/nl.json`, `i18n/locales/fr.json`
- Test: `test/db/household-invite.test.ts`

**Interfaces:**
- Consumes: `household`, `household_member`, `is_household_owner` uit Task 6
- Produces: tabel `household_invite`, plus de functies `create_invite(target uuid, valid_days int, uses int) returns text` (geeft het token terug) en `accept_invite(invite_token text) returns uuid` (geeft het household_id terug).

- [ ] **Step 1: De falende test schrijven**

Create `test/db/household-invite.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('uitnodigingen', () => {
  beforeEach(resetDb)

  it('een uitgenodigde wordt lid', async () => {
    const owner = await createUser('eigenaar@example.com')
    const guest = await createUser('gast@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const [inv] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 5)
      `

      await actAs(tx, guest)
      await tx`select accept_invite(${inv!.create_invite})`

      const members = await tx<{ role: string }[]>`
        select role from household_member
        where household_id = ${hh!.create_household} and user_id = ${guest}
      `
      expect(members[0]!.role).toBe('member')
    })
  })

  it('weigert een verlopen uitnodiging', async () => {
    const owner = await createUser('eig2@example.com')
    const guest = await createUser('gast2@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const [inv] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 5)
      `
      await tx`
        update household_invite set expires_at = now() - interval '1 day'
        where token = ${inv!.create_invite}
      `

      await actAs(tx, guest)
      await expect(tx`select accept_invite(${inv!.create_invite})`).rejects.toThrow()
    })
  })

  it('weigert een uitnodiging waarvan het gebruik op is', async () => {
    const owner = await createUser('eig3@example.com')
    const guest = await createUser('gast3@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const [inv] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 1)
      `
      await tx`update household_invite set uses = 1 where token = ${inv!.create_invite}`

      await actAs(tx, guest)
      await expect(tx`select accept_invite(${inv!.create_invite})`).rejects.toThrow()
    })
  })

  it('alleen een eigenaar mag uitnodigen', async () => {
    const owner = await createUser('eig4@example.com')
    const member = await createUser('lid4@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const [inv] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 5)
      `

      await actAs(tx, member)
      await tx`select accept_invite(${inv!.create_invite})`

      await expect(
        tx`select create_invite(${hh!.create_household}::uuid, 7, 5)`,
      ).rejects.toThrow()
    })
  })

  // Deze test dekt een gat dat de review van taak 7 blootlegde: de
  // `revoke all` / `grant execute`-regels onder aan de migratie worden door
  // geen enkele test aangeraakt, omdat alle andere tests als superuser draaien.
  // Verwijder die grant en de app breekt voor echte gebruikers terwijl de
  // suite groen blijft.
  it('alleen ingelogde gebruikers mogen de uitnodigingsfuncties aanroepen', async () => {
    await withTx(async (tx) => {
      const [row] = await tx<{ can_auth: boolean; can_anon: boolean }[]>`
        select
          has_function_privilege('authenticated', 'create_invite(uuid, int, int)', 'execute') as can_auth,
          has_function_privilege('anon',          'create_invite(uuid, int, int)', 'execute') as can_anon
      `
      expect(row!.can_auth).toBe(true)
      expect(row!.can_anon).toBe(false)
    })
  })

  it('een gewoon lid ziet de uitnodigingen van het huishouden niet', async () => {
    const owner = await createUser('eig6@example.com')
    const member = await createUser('lid6@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const [inv] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 5)
      `

      await actAs(tx, member)
      await tx`select accept_invite(${inv!.create_invite})`

      // Vanaf hier onder RLS: alleen eigenaars mogen uitnodigingen zien.
      await enableRls(tx)
      const rows = await tx`select id from household_invite`
      expect(rows.length).toBe(0)
    })
  })

  it('tweemaal accepteren verandert niets', async () => {
    const owner = await createUser('eig5@example.com')
    const guest = await createUser('gast5@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const [inv] = await tx<{ create_invite: string }[]>`
        select create_invite(${hh!.create_household}::uuid, 7, 5)
      `

      await actAs(tx, guest)
      await tx`select accept_invite(${inv!.create_invite})`
      await tx`select accept_invite(${inv!.create_invite})`

      const members = await tx`
        select 1 from household_member
        where household_id = ${hh!.create_household} and user_id = ${guest}
      `
      expect(members.length).toBe(1)

      const [row] = await tx<{ uses: number }[]>`
        select uses from household_invite where token = ${inv!.create_invite}
      `
      expect(row!.uses).toBe(1)
    })
  })
})
```

- [ ] **Step 2: De test draaien en zien dat hij faalt**

```bash
npm run test:db
```

Verwacht: FAIL met `relation "household_invite" does not exist`.

- [ ] **Step 3: De migratie schrijven**

```bash
npx supabase migration new household_invite
```

Zet in het nieuwe bestand:

```sql
create table household_invite (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household on delete cascade,
  token        text not null unique,
  created_by   uuid not null references auth.users on delete cascade,
  expires_at   timestamptz not null,
  max_uses     int not null default 5 check (max_uses > 0),
  uses         int not null default 0,
  created_at   timestamptz not null default now()
);

alter table household_invite enable row level security;

create policy "eigenaars zien de uitnodigingen van hun huishouden"
  on household_invite for select
  using (is_household_owner(household_id));

create policy "eigenaars mogen uitnodigingen intrekken"
  on household_invite for delete
  using (is_household_owner(household_id));

create function create_invite(target uuid, valid_days int, uses int)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  new_token text;
begin
  if not is_household_owner(target) then
    raise exception 'alleen een eigenaar mag uitnodigen';
  end if;

  new_token := encode(gen_random_bytes(24), 'base64');
  new_token := replace(replace(replace(new_token, '+', '-'), '/', '_'), '=', '');

  insert into household_invite (household_id, token, created_by, expires_at, max_uses)
  values (target, new_token, auth.uid(), now() + make_interval(days => valid_days), uses);

  return new_token;
end;
$$;

create function accept_invite(invite_token text) returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  inv    household_invite;
  actor  uuid := auth.uid();
begin
  if actor is null then
    raise exception 'niet ingelogd';
  end if;

  select * into inv from household_invite where token = invite_token for update;

  if inv is null then
    raise exception 'uitnodiging bestaat niet';
  end if;

  if inv.expires_at < now() then
    raise exception 'uitnodiging is verlopen';
  end if;

  if inv.uses >= inv.max_uses then
    raise exception 'uitnodiging is niet meer geldig';
  end if;

  -- al lid: niets doen, en het gebruik niet verhogen
  if exists (
    select 1 from household_member
    where household_id = inv.household_id and user_id = actor
  ) then
    return inv.household_id;
  end if;

  insert into household_member (household_id, user_id, role)
  values (inv.household_id, actor, 'member');

  update household_invite set uses = uses + 1 where id = inv.id;

  return inv.household_id;
end;
$$;

revoke all on function create_invite(uuid, int, int) from public;
revoke all on function accept_invite(text) from public;
grant execute on function create_invite(uuid, int, int) to authenticated;
grant execute on function accept_invite(text) to authenticated;
```

Het token gebruikt `gen_random_bytes(24)` en is URL-veilig gemaakt. Dat is 192 bits aan willekeur — niet te raden.

- [ ] **Step 4: De migratie toepassen en de test draaien**

```bash
npx supabase db reset
npm run test:db
```

Verwacht: PASS, alle vijf.

- [ ] **Step 5: Vertaalsleutels toevoegen**

`en.json`:

```json
  "invite": {
    "joining": "Joining household…",
    "success": "You have joined {name}.",
    "failed": "This invitation is no longer valid.",
    "create": "Create invitation link",
    "copy": "Copy link",
    "copied": "Copied",
    "revoke": "Revoke",
    "expiresOn": "Valid until {date}",
    "usesLeft": "{count} uses left"
  }
```

`nl.json`:

```json
  "invite": {
    "joining": "Bezig met lid worden…",
    "success": "Je bent lid geworden van {name}.",
    "failed": "Deze uitnodiging is niet meer geldig.",
    "create": "Uitnodigingslink maken",
    "copy": "Link kopiëren",
    "copied": "Gekopieerd",
    "revoke": "Intrekken",
    "expiresOn": "Geldig tot {date}",
    "usesLeft": "Nog {count} keer te gebruiken"
  }
```

`fr.json`:

```json
  "invite": {
    "joining": "Adhésion en cours…",
    "success": "Vous avez rejoint {name}.",
    "failed": "Cette invitation n'est plus valable.",
    "create": "Créer un lien d'invitation",
    "copy": "Copier le lien",
    "copied": "Copié",
    "revoke": "Révoquer",
    "expiresOn": "Valable jusqu'au {date}",
    "usesLeft": "Encore {count} utilisations"
  }
```

- [ ] **Step 6: De uitnodigingspagina schrijven**

Create `app/pages/invite/[token].vue`:

```vue
<script setup lang="ts">
const { t } = useI18n()
const route = useRoute()
const localePath = useLocalePath()
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const { refresh, setActive } = useHousehold()

const state = ref<'joining' | 'done' | 'failed'>('joining')
const householdName = ref('')

onMounted(async () => {
  if (!user.value) {
    // na inloggen keert de gebruiker hier terug
    await navigateTo(localePath(`/login?redirect=/invite/${route.params.token}`))
    return
  }

  const { data, error } = await supabase.rpc('accept_invite', {
    invite_token: route.params.token as string,
  })

  if (error) {
    state.value = 'failed'
    return
  }

  await refresh()
  setActive(data as string)

  const { data: hh } = await supabase
    .from('household')
    .select('name')
    .eq('id', data as string)
    .single()

  householdName.value = (hh as { name: string } | null)?.name ?? ''
  state.value = 'done'
})
</script>

<template>
  <UContainer class="max-w-md py-12">
    <UProgress v-if="state === 'joining'" animation="carousel" />

    <UAlert
      v-else-if="state === 'done'"
      color="success"
      :description="t('invite.success', { name: householdName })"
    />

    <UAlert v-else color="error" :description="t('invite.failed')" />

    <UButton v-if="state !== 'joining'" class="mt-6" :to="localePath('/app')" block>
      {{ t('app.name') }}
    </UButton>
  </UContainer>
</template>
```

- [ ] **Step 7: Het beheercomponent schrijven**

Create `app/components/HouseholdInvites.vue`:

```vue
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

async function load() {
  const { data } = await supabase
    .from('household_invite')
    .select('id, token, expires_at, max_uses, uses')
    .eq('household_id', props.householdId)
    .order('created_at', { ascending: false })
  invites.value = (data ?? []) as Invite[]
}

async function create() {
  pending.value = true
  await supabase.rpc('create_invite', {
    target: props.householdId,
    valid_days: 7,
    uses: 5,
  })
  await load()
  pending.value = false
}

async function revoke(id: string) {
  await supabase.from('household_invite').delete().eq('id', id)
  await load()
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

    <UCard v-for="invite in invites" :key="invite.id">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0 text-sm">
          <p class="truncate font-mono">{{ linkFor(invite.token) }}</p>
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
```

- [ ] **Step 8: `/invite/*` uitzonderen van afscherming**

Pas het `supabase`-blok in `nuxt.config.ts` aan:

```ts
  supabase: {
    redirect: true,
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: [
        '/', '/nl', '/fr',
        '/login', '/confirm', '/invite/*',
        '/nl/login', '/nl/confirm', '/nl/invite/*',
        '/fr/login', '/fr/confirm', '/fr/invite/*',
      ],
    },
  },
```

De pagina handelt zelf af dat een niet-ingelogde bezoeker eerst moet inloggen en daarna terugkeert.

- [ ] **Step 9: Alles draaien**

```bash
npm run test:all
```

Verwacht: PASS overal.

- [ ] **Step 10: Committen**

```bash
git add -A
git commit -m "feat: uitnodigingslinks met vervaldatum en beperkt gebruik"
```

---

### Task 9: Bewaarplaatsen

**Files:**
- Create: `supabase/migrations/<timestamp>_storage_place.sql`
- Create: `app/pages/settings/places.vue`
- Modify: `i18n/locales/en.json`, `i18n/locales/nl.json`, `i18n/locales/fr.json`
- Test: `test/db/storage-place.test.ts`

**Interfaces:**
- Consumes: `household`, `is_household_member` uit Task 6
- Produces: tabel `storage_place(id, household_id, name, kind, created_at)` met `kind in ('pantry','fridge','freezer','other')`. Plan 3 (Voorraad) verwijst hiernaar vanuit `inventory_item`.

- [ ] **Step 1: De falende test schrijven**

Create `test/db/storage-place.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('bewaarplaatsen', () => {
  beforeEach(resetDb)

  it('een nieuw huishouden krijgt drie standaardplaatsen', async () => {
    const userId = await createUser('plaats@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`

      const rows = await tx<{ kind: string }[]>`
        select kind from storage_place where household_id = ${hh!.create_household} order by kind
      `
      expect(rows.map((r) => r.kind)).toEqual(['freezer', 'fridge', 'pantry'])
    })
  })

  it('weigert een onbekend soort', async () => {
    const userId = await createUser('soort@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`

      await expect(tx`
        insert into storage_place (household_id, name, kind)
        values (${hh!.create_household}, 'Zolder', 'attic')
      `).rejects.toThrow()
    })
  })

  it('verbergt de plaatsen van een ander huishouden', async () => {
    const mine = await createUser('mijn@example.com')
    const theirs = await createUser('hun@example.com')

    await withTx(async (tx) => {
      await actAs(tx, theirs)
      await tx`select create_household('Hun huis')`

      await actAs(tx, mine)
      await enableRls(tx)
      const rows = await tx`select id from storage_place`
      expect(rows.length).toBe(0)
    })
  })
})
```

- [ ] **Step 2: De test draaien en zien dat hij faalt**

```bash
npm run test:db
```

Verwacht: FAIL met `relation "storage_place" does not exist`.

- [ ] **Step 3: De migratie schrijven**

```bash
npx supabase migration new storage_place
```

Zet in het nieuwe bestand:

```sql
create table storage_place (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  kind         text not null check (kind in ('pantry', 'fridge', 'freezer', 'other')),
  created_at   timestamptz not null default now()
);

create index storage_place_household_idx on storage_place (household_id);

alter table storage_place enable row level security;

create policy "leden zien de bewaarplaatsen van hun huishouden"
  on storage_place for select
  using (is_household_member(household_id));

create policy "leden mogen bewaarplaatsen aanmaken"
  on storage_place for insert
  with check (is_household_member(household_id));

create policy "leden mogen bewaarplaatsen wijzigen"
  on storage_place for update
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy "leden mogen bewaarplaatsen verwijderen"
  on storage_place for delete
  using (is_household_member(household_id));

-- Een leeg huishouden is onbruikbaar, dus elk nieuw huishouden
-- start met de drie plaatsen die iedereen heeft.
create or replace function create_household(household_name text) returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  new_id uuid;
  actor  uuid := auth.uid();
begin
  if actor is null then
    raise exception 'niet ingelogd';
  end if;

  if household_name is null or length(trim(household_name)) = 0 then
    raise exception 'naam mag niet leeg zijn';
  end if;

  insert into household (name) values (trim(household_name)) returning id into new_id;
  insert into household_member (household_id, user_id, role) values (new_id, actor, 'owner');

  insert into storage_place (household_id, name, kind) values
    (new_id, 'Pantry', 'pantry'),
    (new_id, 'Fridge', 'fridge'),
    (new_id, 'Freezer', 'freezer');

  return new_id;
end;
$$;
```

De standaardnamen staan in het Engels omdat ze in de database leven en niet door i18n gaan. De gebruiker hernoemt ze; plan 3 toont bij een ongewijzigde naam de vertaling van `kind`.

- [ ] **Step 4: De migratie toepassen en de test draaien**

```bash
npx supabase db reset
npm run test:db
```

Verwacht: PASS, alle drie.

- [ ] **Step 5: Vertaalsleutels toevoegen**

`en.json`:

```json
  "places": {
    "title": "Storage places",
    "add": "Add a place",
    "name": "Name",
    "kind": "Type",
    "pantry": "Pantry",
    "fridge": "Fridge",
    "freezer": "Freezer",
    "other": "Other",
    "delete": "Delete"
  }
```

`nl.json`:

```json
  "places": {
    "title": "Bewaarplaatsen",
    "add": "Plaats toevoegen",
    "name": "Naam",
    "kind": "Soort",
    "pantry": "Voorraadkast",
    "fridge": "Koelkast",
    "freezer": "Vriezer",
    "other": "Andere",
    "delete": "Verwijderen"
  }
```

`fr.json`:

```json
  "places": {
    "title": "Lieux de rangement",
    "add": "Ajouter un lieu",
    "name": "Nom",
    "kind": "Type",
    "pantry": "Garde-manger",
    "fridge": "Réfrigérateur",
    "freezer": "Congélateur",
    "other": "Autre",
    "delete": "Supprimer"
  }
```

- [ ] **Step 6: De beheerpagina schrijven**

Create `app/pages/settings/places.vue`:

```vue
<script setup lang="ts">
const { t } = useI18n()
const supabase = useSupabaseClient()
const { activeId, refresh } = useHousehold()

interface Place {
  id: string
  name: string
  kind: 'pantry' | 'fridge' | 'freezer' | 'other'
}

const places = ref<Place[]>([])
const name = ref('')
const kind = ref<Place['kind']>('pantry')

const kinds = computed(() =>
  (['pantry', 'fridge', 'freezer', 'other'] as const).map((value) => ({
    value,
    label: t(`places.${value}`),
  })),
)

async function load() {
  if (!activeId.value) return
  const { data } = await supabase
    .from('storage_place')
    .select('id, name, kind')
    .eq('household_id', activeId.value)
    .order('created_at')
  places.value = (data ?? []) as Place[]
}

async function add() {
  if (!activeId.value || !name.value.trim()) return
  await supabase.from('storage_place').insert({
    household_id: activeId.value,
    name: name.value.trim(),
    kind: kind.value,
  })
  name.value = ''
  await load()
}

async function remove(id: string) {
  await supabase.from('storage_place').delete().eq('id', id)
  await load()
}

// In onMounted, niet op top-level await: activeId komt uit localStorage en is
// tijdens SSR altijd null. Een top-level await zou de lijst leeg renderen en
// hem na hydratie nooit opnieuw ophalen.
onMounted(async () => {
  await refresh()
  await load()
})
</script>

<template>
  <UContainer class="max-w-lg py-12">
    <h1 class="text-2xl font-bold">{{ t('places.title') }}</h1>

    <div class="mt-6 space-y-2">
      <UCard v-for="place in places" :key="place.id">
        <div class="flex items-center justify-between">
          <div>
            <p class="font-medium">{{ place.name }}</p>
            <p class="text-sm text-muted">{{ t(`places.${place.kind}`) }}</p>
          </div>
          <UButton size="sm" color="error" variant="ghost" @click="remove(place.id)">
            {{ t('places.delete') }}
          </UButton>
        </div>
      </UCard>
    </div>

    <form class="mt-6 flex gap-2" @submit.prevent="add">
      <UInput v-model="name" :placeholder="t('places.name')" class="flex-1" />
      <USelect v-model="kind" :items="kinds" value-key="value" />
      <UButton type="submit">{{ t('places.add') }}</UButton>
    </form>
  </UContainer>
</template>
```

- [ ] **Step 7: Handmatig controleren**

```bash
npm run dev
```

Log in, start een huishouden, ga naar `/settings/places`. Je ziet drie standaardplaatsen, kan er een toevoegen en een verwijderen.

- [ ] **Step 8: Committen**

```bash
git add -A
git commit -m "feat: bewaarplaatsen, met drie standaardplaatsen per nieuw huishouden"
```

---

### Task 10: Het rechtenmodel dichttimmeren

De vorige taken hebben policies geschreven. Deze taak bewijst dat er geen gat in zit — en dicht het gat dat er wél is.

**Files:**
- Create: `supabase/migrations/<timestamp>_harden_permissions.sql`
- Test: `test/db/permissions.test.ts`

**Interfaces:**
- Consumes: alle tabellen uit Task 5 tot en met 9
- Produces: een trigger die `trust_level` en `role` op `user_profile` beschermt, en een trigger die voorkomt dat de laatste eigenaar uit een huishouden verdwijnt.

- [ ] **Step 1: De falende test schrijven**

Create `test/db/permissions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { withDb, withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('rechten', () => {
  beforeEach(resetDb)

  it('een gebruiker kan zichzelf geen moderator maken', async () => {
    const userId = await createUser('sluw@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await expect(tx`
        update user_profile set role = 'moderator' where user_id = ${userId}
      `).rejects.toThrow()
    })
  })

  it('een gebruiker kan zijn eigen vertrouwensniveau niet verhogen', async () => {
    const userId = await createUser('gretig@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await expect(tx`
        update user_profile set trust_level = 3 where user_id = ${userId}
      `).rejects.toThrow()
    })
  })

  it('een gebruiker mag wel zijn weergavenaam wijzigen', async () => {
    const userId = await createUser('naam@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await tx`update user_profile set display_name = 'Steff' where user_id = ${userId}`

      const [row] = await tx<{ display_name: string }[]>`
        select display_name from user_profile where user_id = ${userId}
      `
      expect(row!.display_name).toBe('Steff')
    })
  })

  it('de laatste eigenaar kan het huishouden niet verlaten', async () => {
    const userId = await createUser('laatste@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`

      await expect(tx`
        delete from household_member
        where household_id = ${hh!.create_household} and user_id = ${userId}
      `).rejects.toThrow()
    })
  })

  it('een eigenaar kan wel weg als er een tweede eigenaar is', async () => {
    const first = await createUser('een@example.com')
    const second = await createUser('twee@example.com')

    await withTx(async (tx) => {
      await actAs(tx, first)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const id = hh!.create_household

      await tx`
        insert into household_member (household_id, user_id, role)
        values (${id}, ${second}, 'owner')
      `
      await tx`delete from household_member where household_id = ${id} and user_id = ${first}`

      const rows = await tx`select 1 from household_member where household_id = ${id}`
      expect(rows.length).toBe(1)
    })
  })
})
```

- [ ] **Step 2: De test draaien en zien welke falen**

```bash
npm run test:db
```

Verwacht: de eerste, tweede en vierde test FALEN. De derde en vijfde slagen al. Dat is precies het gat dat deze taak dicht.

- [ ] **Step 3: De migratie schrijven**

```bash
npx supabase migration new harden_permissions
```

Zet in het nieuwe bestand:

```sql
-- Een update-policy werkt op rijniveau, niet op kolomniveau. Zonder deze
-- trigger kan een gebruiker via zijn eigen profiel zijn rol opschroeven.
create function protect_profile_privileges() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- auth.uid() is null bij de service-role en bij migraties; daar mag het wel.
  -- Is er een ingelogde gebruiker, dan is dit per definitie een poging van
  -- iemand die zijn eigen rechten wil opschroeven.
  if auth.uid() is not null then
    if new.trust_level is distinct from old.trust_level then
      raise exception 'vertrouwensniveau is niet zelf te wijzigen';
    end if;
    if new.role is distinct from old.role then
      raise exception 'rol is niet zelf te wijzigen';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_profile_privileges_trigger
  before update on user_profile
  for each row execute function protect_profile_privileges();

-- Een huishouden zonder eigenaar is niet meer te beheren: geen uitnodigingen,
-- geen hernoemen, geen opheffen.
create function prevent_last_owner_removal() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if old.role = 'owner' then
    if (
      select count(*) from household_member
      where household_id = old.household_id and role = 'owner'
    ) <= 1 then
      raise exception 'een huishouden moet minstens één eigenaar houden';
    end if;
  end if;
  return old;
end;
$$;

create trigger prevent_last_owner_removal_trigger
  before delete on household_member
  for each row execute function prevent_last_owner_removal();

-- `revoke all ... from public` haalt Supabase's eigen directe grant aan anon
-- er niet af. Taak 8 ontdekte dat met een has_function_privilege-test:
-- create_invite en accept_invite staan goed, create_household uit taak 7 niet.
-- Niet uitbuitbaar, want de functie weigert zonder ingelogde gebruiker, maar
-- de verdediging in de diepte werkt niet zoals bedoeld en het is inconsistent
-- met de rest.
revoke execute on function create_household(text) from anon;
```

Twee dingen om te weten bij deze migratie:

**Moderatoren promoveren gebeurt niet via de app-client.** De trigger blokkeert
elke rolwijziging zolang er een ingelogde gebruiker is. Vertrouwensniveaus
verhogen en moderatoren aanstellen loopt in plan 7 via een `server/api`-route
met de service-role sleutel, waar `auth.uid()` null is. Dat is precies de
architectuurregel uit de spec, toegepast op rechten.

**De eigenaarstrigger mag het opheffen van een huishouden niet blokkeren.** Die
verwijdering loopt via `on delete cascade` op `household`, en dan wordt de
laatste eigenaarsrij verwijderd terwijl er nog maar één is. Controleer dat in
de volgende stap.

- [ ] **Step 4: Toepassen en alle testen draaien**

```bash
npx supabase db reset
npm run test:db
```

Verwacht: PASS, alle vijf, plus alle eerdere databasetests.

- [ ] **Step 5: Controleren dat een huishouden opheffen nog werkt**

Voeg toe aan `test/db/permissions.test.ts`:

```ts
  it('anon mag geen enkele huishoudfunctie aanroepen', async () => {
    await withTx(async (tx) => {
      const [row] = await tx<{ f: string; anon: boolean; auth: boolean }[]>`
        select 'create_household' as f,
               has_function_privilege('anon', 'create_household(text)', 'execute') as anon,
               has_function_privilege('authenticated', 'create_household(text)', 'execute') as auth
      `
      expect(row!.anon).toBe(false)
      expect(row!.auth).toBe(true)
    })
  })

  it('een huishouden opheffen werkt ondanks de eigenaarstrigger', async () => {
    const userId = await createUser('opheffen@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Weg')`

      await tx`delete from household where id = ${hh!.create_household}`

      const rows = await tx`select 1 from household_member where household_id = ${hh!.create_household}`
      expect(rows.length).toBe(0)
    })
  })
```

```bash
npm run test:db
```

Verwacht: PASS. Faalt dit, dan blokkeert de trigger de cascade en moet hij `when (pg_trigger_depth() = 0)` krijgen.

- [ ] **Step 6: De volledige suite draaien**

```bash
npm run test:all
npm run test:e2e
```

Verwacht: PASS overal.

- [ ] **Step 7: Uitrollen en controleren**

```bash
npx supabase link --project-ref <je-project-ref>
npx supabase db push
npm run deploy
```

Maak het Supabase-project aan in de **EU-regio (Frankfurt)** als dat nog niet gebeurd is. Zet in het Cloudflare-dashboard of via `wrangler secret put` de variabelen `SUPABASE_URL`, `SUPABASE_KEY` en `SUPABASE_SERVICE_KEY` op de productiewaarden.

Log in op de uitgerolde URL, start een huishouden, maak een uitnodigingslink en open die in een privévenster.

- [ ] **Step 8: Committen**

```bash
git add -A
git commit -m "feat: rechtenmodel dichtgetimmerd met triggers voor rol en eigenaarschap"
```

---

### Task 11: De uitnodigingsflow werkend maken

Taak 8 bouwde uitnodigingen, maar de functie heeft aan geen van beide kanten een
werkende ingang. De review stelde twee gaten vast die allebei buiten taak 8's
bestandenlijst vielen:

- De uitnodigingspagina stuurt een uitgelogde bezoeker naar
  `/login?redirect=/invite/<token>`, maar `login.vue` en `confirm.vue` lezen die
  parameter nooit. Een nieuwe gebruiker — de meest voorkomende bezoeker van een
  uitnodigingslink — logt in en belandt op `/app`, zonder foutmelding en zonder
  lidmaatschap.
- `HouseholdInvites.vue` bestaat maar wordt door geen enkele pagina gebruikt, dus
  een eigenaar kan niet eens een link aanmaken.

**Files:**
- Modify: `app/pages/login.vue`
- Modify: `app/pages/confirm.vue`
- Modify: `app/components/HouseholdInvites.vue`
- Modify: `e2e/onboarding.spec.ts` (helpers exporteren)
- Create: `app/pages/settings/household.vue`
- Create: `e2e/invite.spec.ts`
- Modify: `i18n/locales/en.json`, `i18n/locales/nl.json`, `i18n/locales/fr.json`

**Interfaces:**
- Consumes: `useHousehold()` uit Task 7, `create_invite` en `accept_invite` uit Task 8
- Produces: geen nieuwe interfaces; deze taak maakt bestaande werkend

- [ ] **Step 1: De helpers uit Task 7 exporteerbaar maken**

`e2e/onboarding.spec.ts` bevat `signIn()` en de Mailpit-hulpfunctie die de
magic link ophaalt. Zet `export` voor allebei, zodat `e2e/invite.spec.ts` ze kan
importeren. Kopieer ze niet — twee versies van een inloghelper lopen gegarandeerd
uit elkaar.

Wijzig niets aan hun werking.

- [ ] **Step 2: De falende e2e-test schrijven**

Create `e2e/invite.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { signIn, readLatestMagicLink } from './onboarding.spec'

test('een uitgenodigde zonder account wordt na inloggen lid', async ({ page, browser }) => {
  // Eigenaar maakt een huishouden en een uitnodigingslink.
  await signIn(page, `e2e-owner-${Date.now()}@example.com`)
  await page.goto('/onboarding')
  await page.getByLabel('Household name').fill('Uitnodigingshuis')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByText('Uitnodigingshuis')).toBeVisible()

  await page.goto('/settings/household')
  await page.getByRole('button', { name: 'Create invitation link' }).click()
  const link = await page.getByRole('textbox', { name: 'Invitation link' }).inputValue()
  expect(link).toContain('/invite/')

  // Een verse browsercontext: iemand die nergens is ingelogd.
  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  const guestEmail = `e2e-guest-${Date.now()}@example.com`

  await guest.goto(link)
  await expect(guest).toHaveURL(/\/login/)

  await guest.getByLabel(/email/i).fill(guestEmail)
  await guest.getByRole('button', { name: /link/i }).click()
  await expect(guest.getByText(/inbox/i)).toBeVisible()

  // De echte magic link uit Mailpit hoort terug te leiden naar de uitnodiging,
  // niet naar /app.
  const magicLink = await readLatestMagicLink(guestEmail)
  await guest.goto(magicLink)

  await expect(guest.getByText('Uitnodigingshuis')).toBeVisible()
  await guestContext.close()
})
```

- [ ] **Step 3: De test draaien en zien dat hij faalt**

```bash
npm run test:e2e -- invite
```

Verwacht: FAIL. `/settings/household` bestaat niet, dus de knop wordt nooit
gevonden.

- [ ] **Step 4: De redirect door login.vue heen dragen**

Voeg in `app/pages/login.vue` bovenaan `<script setup>` toe:

```ts
const route = useRoute()

// Alleen interne paden. Zonder deze controle kan iemand
// ?redirect=https://kwaadaardig.example in een link zetten en jouw inlogpagina
// gebruiken om mensen naar een phishingsite te sturen.
const redirectTo = computed(() => {
  const value = route.query.redirect
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : null
})
```

En vervang in `submit()` de aanroep van `signInWithOtp` door:

```ts
  const target = new URL('/confirm', window.location.origin)
  if (redirectTo.value) target.searchParams.set('redirect', redirectTo.value)

  const { error: authError } = await supabase.auth.signInWithOtp({
    email: email.value,
    options: { emailRedirectTo: target.toString() },
  })
```

De controle op `startsWith('/')` én niet `'//'` is niet optioneel: `//evil.com`
is een protocol-relatieve URL en gaat gewoon naar buiten.

- [ ] **Step 5: De redirect consumeren in confirm.vue**

Replace `app/pages/confirm.vue`:

```vue
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
```

- [ ] **Step 6: Vertaalsleutels toevoegen**

`en.json`:

```json
  "householdSettings": {
    "title": "Household",
    "invitations": "Invitations",
    "error": "That did not work. Please try again."
  }
```

`nl.json`:

```json
  "householdSettings": {
    "title": "Huishouden",
    "invitations": "Uitnodigingen",
    "error": "Dat is niet gelukt. Probeer het opnieuw."
  }
```

`fr.json`:

```json
  "householdSettings": {
    "title": "Menage",
    "invitations": "Invitations",
    "error": "Cela a echoue. Veuillez reessayer."
  }
```

De Franse tekst staat hier zonder accenten om kopieerfouten te vermijden; zet in
het bestand zelf de juiste accenten: `Ménage`, `Cela a échoué. Veuillez
réessayer.`

- [ ] **Step 7: De instellingenpagina maken**

Create `app/pages/settings/household.vue`:

```vue
<script setup lang="ts">
const { t } = useI18n()
const { activeId, refresh } = useHousehold()

const ready = ref(false)

onMounted(async () => {
  await refresh()
  ready.value = true
})
</script>

<template>
  <UContainer class="max-w-lg py-12">
    <h1 class="text-2xl font-bold">{{ t('householdSettings.title') }}</h1>

    <section class="mt-8">
      <h2 class="mb-3 font-semibold">{{ t('householdSettings.invitations') }}</h2>
      <UProgress v-if="!ready" animation="carousel" />
      <HouseholdInvites v-else-if="activeId" :household-id="activeId" />
    </section>
  </UContainer>
</template>
```

- [ ] **Step 8: Foutafhandeling en een vindbaar linkveld in HouseholdInvites**

`create()` en `revoke()` gooien nu elke fout stilletjes weg. Voeg bovenaan
`<script setup>` toe:

```ts
const error = ref('')
```

Vervang beide functies:

```ts
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
```

Toon de fout in de template, direct onder de aanmaakknop:

```vue
    <UAlert v-if="error" color="error" :description="error" />
```

Vervang de `<p>` met de link door een leesbaar invoerveld met een toegankelijk
label, zodat een schermlezer hem benoemt en de e2e-test hem vindt:

```vue
          <UInput
            :model-value="linkFor(invite.token)"
            aria-label="Invitation link"
            readonly
            class="w-full font-mono text-xs"
          />
```

- [ ] **Step 9: De test draaien en zien dat hij slaagt**

```bash
npm run test:e2e
```

Verwacht: PASS, alle bestaande tests plus de nieuwe uitnodigingsflow.

- [ ] **Step 10: De open-redirectbescherming apart testen**

Dit is beveiligingsgedrag en krijgt dus een eigen test. Voeg toe aan
`e2e/invite.spec.ts`:

```ts
test('een externe redirect wordt genegeerd', async ({ page }) => {
  const email = `e2e-redirect-${Date.now()}@example.com`

  await page.goto('/login?redirect=https://example.com/phishing')
  await page.getByLabel(/email/i).fill(email)
  await page.getByRole('button', { name: /link/i }).click()
  await expect(page.getByText(/inbox/i)).toBeVisible()

  const magicLink = await readLatestMagicLink(email)
  expect(magicLink).not.toContain('example.com')

  // En protocol-relatief mag evenmin.
  const email2 = `e2e-redirect2-${Date.now()}@example.com`
  await page.goto('/login?redirect=//example.com/phishing')
  await page.getByLabel(/email/i).fill(email2)
  await page.getByRole('button', { name: /link/i }).click()
  await expect(page.getByText(/inbox/i)).toBeVisible()

  const magicLink2 = await readLatestMagicLink(email2)
  expect(magicLink2).not.toContain('example.com')
})
```

```bash
npm run test:e2e -- invite
```

Verwacht: PASS, beide tests.

- [ ] **Step 11: Committen**

```bash
git add -A
git commit -m "feat: uitnodigingsflow werkend van link tot lidmaatschap"
```

---

## Wat je na dit plan hebt

Een uitgerolde app op Cloudflare Workers waarin je kan inloggen met een magic link, een huishouden kan starten of via een uitnodigingslink lid worden, bewaarplaatsen kan beheren, en waarin de scheiding tussen huishoudens bewezen dicht is. Drietalig, met een test die de locales gelijk houdt.

Uitnodigen werkt end-to-end: een eigenaar maakt een link, een wildvreemde
klikt hem, logt in en is lid — zonder de uitnodiging onderweg te verliezen.

Nog geen producten, geen voorraad, geen bonnen. Dat is plan 2 en verder.

## Wat dit plan bewust niet doet

- **Geen PWA-laag.** Service worker en offline komen in plan 8, wanneer er iets is om offline te tonen.
- **Geen `product`-tabellen.** Die horen bij plan 2, samen met de Open Food Facts-koppeling.
- **Geen `server/api`-routes voor globale data.** Er is nog geen globale data. De architectuurregel uit de spec gaat gelden vanaf plan 2.
- **Geen huishoudwisselaar in de interface.** De composable ondersteunt meerdere huishoudens en `setActive`, maar een keuzemenu heeft pas nut als er voorraad in zit. Plan 3.
