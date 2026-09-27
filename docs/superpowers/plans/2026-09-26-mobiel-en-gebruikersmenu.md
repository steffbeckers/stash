# Mobiele laag en gebruikersmenu — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stash bruikbaar maken op een telefoon door de header te herbouwen rond een avatarmenu, een profielpagina toe te voegen, de voornaam te vragen bij beide manieren van binnenkomen, en het geheel vast te zetten met twee e2e-tests die op 360px meten.

**Architecture:** De header verhuist uit `app.vue` naar `AppHeader.vue` en splitst in een navigatiedeel en een `UserMenu`. De taalschakelaar verdwijnt voor ingelogde gebruikers uit de header en verschijnt op de nieuwe profielpagina. Profielstatus komt uit een `useProfile()`-composable naast het bestaande `useHousehold()`. Twee e2e-tests bewaken het resultaat: een veegtest tegen horizontale overflow en een stapeltest tegen samengedrukte bediening.

**Tech Stack:** Nuxt 4, @nuxt/ui 4, @nuxtjs/i18n 10, @nuxtjs/supabase 2, Playwright, Vitest, Supabase/Postgres.

**Spec:** `docs/superpowers/specs/2026-09-26-mobiel-en-gebruikersmenu-design.md`

## Global Constraints

Deze gelden voor elke taak hieronder, ook waar ze niet herhaald worden.

- **Routepaden komen altijd uit `routes.config.ts`**, via `routePath(route, locale)` — in productiecode én in tests. Nooit een pad met de hand typen. Zie het commentaar bovenaan dat bestand voor waarom.
- **`localePath()` wil een routenaam, geen pad.** Met `customRoutes: 'config'` bestaat het oorspronkelijke pad niet meer als route. Dus `localePath('settings-profile')`, niet `localePath('/settings/profile')`. Let op het koppelteken: de bestandssleutel is `settings/profile`, de routenaam `settings-profile`.
- **Elke nieuwe i18n-sleutel gaat in alle drie de bestanden** (`i18n/locales/en.json`, `nl.json`, `fr.json`). `test/i18n/locales.test.ts` dwingt identieke sleutels af én weigert lege waarden, dus een vergeten vertaling maakt de unittests rood.
- **Commentaar, testnamen en foutmeldingen in het Nederlands**, zoals de rest van het project.
- **Mobiele testviewport is 360×740.** Niet 375.
- **`display_name` is begrensd op 60 tekens.** Elk invoerveld ervoor krijgt `:maxlength="60"`.
- **Fouten worden nooit stil ingeslikt.** Een mislukte Supabase-aanroep gooit door of toont een melding; een lege lijst mag nooit hetzelfde zijn als een mislukte lijst.
- **`useSupabaseUser()` geeft het JWT-payload**, geen klassiek User-object: het gebruikers-id staat op `.sub`, niet op `.id`.
- **Geen enkele e2e-meting zonder eerst te bevestigen dat je op de bedoelde URL staat.** Dit is geen netheid: zonder die controle meet een veegtest bij een kapotte auth-guard 24 keer de inlogpagina en staat hij groen.

## Bestandsstructuur

**Nieuw:**

| Bestand | Verantwoordelijkheid |
|---|---|
| `supabase/migrations/20260926090000_display_name_length.sql` | De lengtegrens van 60 tekens |
| `app/utils/initials.ts` | Naam → initialen. Pure functie, dus unittestbaar |
| `app/composables/useProfile.ts` | Profielstatus lezen en schrijven |
| `app/components/SettingsTabs.vue` | De drie instellingentabs |
| `app/pages/settings/profile.vue` | Naam en taal wijzigen |
| `app/components/AppHeader.vue` | De header: merknaam, navigatie, taal of avatar |
| `app/components/UserMenu.vue` | Avatar met dropdown naar instellingen en uitloggen |
| `e2e/mobile.spec.ts` | De veegtest en de stapeltest |
| `test/utils/initials.test.ts` | Unittests voor `initials()` |

**Gewijzigd:** `routes.config.ts`, `i18n/locales/{en,nl,fr}.json`, `app/app.vue`, `app/components/LanguageSwitcher.vue`, `app/components/HouseholdMembers.vue`, `app/components/HouseholdInvites.vue`, `app/pages/settings/household.vue`, `app/pages/settings/places.vue`, `app/pages/onboarding.vue`, `app/pages/invite/[token].vue`, `e2e/helpers.ts`, `e2e/onboarding.spec.ts`, `e2e/invite.spec.ts`, `test/db/user-profile.test.ts`, `docs/superpowers/open-bevindingen.md`, `README.md`.

---

### Task 1: De lengtegrens op `display_name`

**Files:**
- Create: `supabase/migrations/20260926090000_display_name_length.sql`
- Test: `test/db/user-profile.test.ts` (toevoegen aan de bestaande `describe`)

**Interfaces:**
- Consumes: niets uit eerdere taken.
- Produces: de constraint `display_name_length` op `user_profile`. Taak 3, 5 en 6 vertrouwen erop dat 60 tekens de grens is en zetten `:maxlength="60"` op hun invoervelden.

- [ ] **Step 1: Schrijf de twee falende tests**

Voeg dit toe aan `test/db/user-profile.test.ts`, binnen de bestaande `describe('user_profile', ...)`:

```ts
  // De ledenlijst rendert display_name ongefilterd. Zonder bovengrens kan
  // één gebruiker de layout van iedereen in zijn huishouden breken — en dat
  // is precies de belofte die e2e/mobile.spec.ts hard maakt.
  it('weigert een weergavenaam van meer dan 60 tekens', async () => {
    const userId = await createUser('te-lang@example.com')
    await withDb(async (sql) => {
      await expect(
        sql`update user_profile set display_name = ${'a'.repeat(61)} where user_id = ${userId}`,
      ).rejects.toThrow(/display_name_length/)
    })
  })

  // De falsificatie van de test hierboven: zonder dit geval zou een
  // constraint van `<= 0` ook slagen, en dan was élke naam geweigerd.
  it('laat een weergavenaam van precies 60 tekens toe', async () => {
    const userId = await createUser('grens@example.com')
    await withDb(async (sql) => {
      await sql`update user_profile set display_name = ${'a'.repeat(60)} where user_id = ${userId}`
      const [row] = await sql<{ display_name: string | null }[]>`
        select display_name from user_profile where user_id = ${userId}
      `
      expect(row!.display_name).toHaveLength(60)
    })
  })
```

- [ ] **Step 2: Draai de tests en controleer dat de eerste faalt**

Run: `npm run test:db -- user-profile`
Expected: "weigert een weergavenaam van meer dan 60 tekens" FAALT (de update slaagt, er wordt niets gegooid). "laat een weergavenaam van precies 60 tekens toe" SLAAGT al.

- [ ] **Step 3: Schrijf de migratie**

`supabase/migrations/20260926090000_display_name_length.sql`:

```sql
-- display_name is tot nu toe een onbegrensde tekstkolom, en hij wordt
-- ongefilterd gerenderd in de ledenlijst van een huishouden. Sinds dit plan
-- belooft e2e/mobile.spec.ts dat geen enkele pagina horizontaal overloopt op
-- 360px. Die belofte mag niet afhangen van de goede wil van de gebruiker:
-- één lid met een naam van 5000 tekens breekt de lijst voor iedereen in
-- hetzelfde huishouden.
--
-- 60 tekens is ruim voor een voornaam of een volledige naam, en kort genoeg
-- om in een ledenrij te passen. De invoervelden krijgen dezelfde maxlength,
-- maar dat is gemak — deze constraint is de echte grens, want een client kan
-- de REST-API rechtstreeks aanspreken.
alter table user_profile
  add constraint display_name_length
  check (display_name is null or char_length(display_name) <= 60);
```

- [ ] **Step 4: Pas de migratie toe**

Run: `npx supabase migration up`
Expected: de migratie wordt toegepast zonder fout. Lukt dat niet omdat de lokale stack uit de pas loopt, gebruik dan `npx supabase db reset` (dat wist lokale data en draait alles opnieuw).

- [ ] **Step 5: Draai de tests opnieuw**

Run: `npm run test:db -- user-profile`
Expected: beide nieuwe tests SLAGEN, en de bestaande tests in dat bestand blijven groen.

- [ ] **Step 6: Falsificeer**

Verwijder de constraint met de hand en draai de tests opnieuw:

Run: `npx supabase db reset` nadat je de migratie tijdelijk hernoemd hebt naar `.sql.uit`, dan `npm run test:db -- user-profile`
Expected: "weigert een weergavenaam van meer dan 60 tekens" wordt ROOD. Blijft hij groen, dan toetst hij iets anders dan de constraint. Zet daarna de naam terug en draai `npx supabase db reset` opnieuw.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260926090000_display_name_length.sql test/db/user-profile.test.ts
git commit -m "feat: begrens display_name op 60 tekens"
```

---

### Task 2: `initials()` en `useProfile()`

**Files:**
- Create: `app/utils/initials.ts`
- Create: `app/composables/useProfile.ts`
- Test: `test/utils/initials.test.ts`

**Interfaces:**
- Consumes: de constraint uit Taak 1 (alleen als aanname over de maximale lengte; geen code-afhankelijkheid).
- Produces:
  - `initials(name: string | null | undefined): string | null` — auto-geïmporteerd door Nuxt vanuit `app/utils/`.
  - `useProfile(): { profile: Ref<Profile | null>, refresh: () => Promise<void>, save: (displayName: string) => Promise<void> }` met `interface Profile { userId: string; displayName: string | null }`. Gebruikt door Taak 3 (profielpagina), Taak 4 (`UserMenu`), Taak 5 (onboarding) en Taak 6 (uitnodiging).

- [ ] **Step 1: Schrijf de falende unittests**

`test/utils/initials.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { initials } from '../../app/utils/initials'

// De avatar in de header toont deze letters. Er is geen naam verplicht in de
// database, dus elke leeg-achtige invoer moet een voorspelbaar `null`
// opleveren waar de component op kan terugvallen — niet een lege string die
// als een lege cirkel rendert.
describe('initials', () => {
  it('geeft één letter bij één voornaam', () => {
    expect(initials('Steff')).toBe('S')
  })

  it('geeft twee letters bij twee woorden', () => {
    expect(initials('Steff Beckers')).toBe('SB')
  })

  it('neemt hoogstens twee letters bij drie woorden', () => {
    expect(initials('Jean Baptiste Dupont')).toBe('JB')
  })

  it('behandelt een koppelteken als onderdeel van één woord', () => {
    expect(initials('Jean-Pierre Dupont')).toBe('JD')
  })

  it('maakt er hoofdletters van', () => {
    expect(initials('steff')).toBe('S')
  })

  it('werkt op letters met accenten', () => {
    expect(initials('éva')).toBe('É')
  })

  // Deze drie zijn de reden dat de functie `string | null` teruggeeft en niet
  // gewoon een string: alledrie komen ze in de praktijk voor. display_name is
  // null voor iedereen die nog nooit een naam heeft ingevuld.
  it('geeft null bij null', () => {
    expect(initials(null)).toBeNull()
  })

  it('geeft null bij een lege string', () => {
    expect(initials('')).toBeNull()
  })

  it('geeft null bij alleen spaties', () => {
    expect(initials('   ')).toBeNull()
  })
})
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

Run: `npm run test -- initials`
Expected: FAIL — het bestand `app/utils/initials.ts` bestaat niet.

- [ ] **Step 3: Schrijf `initials()`**

`app/utils/initials.ts`:

```ts
/**
 * De letters die de avatar toont.
 *
 * Geeft `null` in plaats van een lege string wanneer er geen bruikbare naam
 * is. De avatar valt dan terug op een icoon; een lege string zou als een
 * lege cirkel renderen en er kapot uitzien.
 *
 * `[...woord][0]` en niet `woord[0]`: een naam die met een teken buiten het
 * basisvlak begint (een surrogaatpaar) zou anders op een halve code-eenheid
 * worden afgekapt.
 */
export function initials(name: string | null | undefined): string | null {
  const woorden = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (woorden.length === 0) return null
  return woorden
    .slice(0, 2)
    .map((woord) => [...woord][0]!.toLocaleUpperCase())
    .join('')
}
```

- [ ] **Step 4: Draai de test opnieuw**

Run: `npm run test -- initials`
Expected: alle negen gevallen SLAGEN.

- [ ] **Step 5: Schrijf `useProfile()`**

`app/composables/useProfile.ts`:

```ts
export interface Profile {
  userId: string
  displayName: string | null
}

/**
 * Het profiel van de ingelogde gebruiker.
 *
 * Naast useHousehold() en met dezelfde vorm, maar één verschil: die haalt
 * bewust op in onMounted omdat hij activeId uit localStorage leest, wat
 * tijdens SSR niet bestaat. Hier geldt dat niet — de sessie is server-side
 * wél bekend (nagemeten: de server-HTML bevat de navigatie van een ingelogde
 * gebruiker). De header toont initialen uit dit profiel, dus ophalen tijdens
 * SSR scheelt een zichtbare flits van icoon naar letters bij elke volledige
 * paginalading.
 */
export function useProfile() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const profile = useState<Profile | null>('profile', () => null)

  async function refresh(): Promise<void> {
    if (!user.value) {
      profile.value = null
      return
    }

    // useSupabaseUser() geeft het JWT-payload: het id staat op `sub`.
    const { data, error } = await supabase
      .from('user_profile')
      .select('user_id, display_name')
      .eq('user_id', user.value.sub)
      .single()

    if (error) throw error
    profile.value = { userId: data.user_id, displayName: data.display_name }
  }

  async function save(displayName: string): Promise<void> {
    if (!user.value) throw new Error('save() zonder ingelogde gebruiker')

    // Een naam van alleen spaties is geen naam. Hij wordt null, zodat de
    // ledenlijst zijn eigen vervangtekst toont in plaats van een lege regel.
    const getrimd = displayName.trim()

    const { error } = await supabase
      .from('user_profile')
      .update({ display_name: getrimd === '' ? null : getrimd })
      .eq('user_id', user.value.sub)

    if (error) throw error
    await refresh()
  }

  return { profile, refresh, save }
}
```

- [ ] **Step 6: Controleer types en linter**

Run: `npm run lint && npm run typecheck`
Expected: beide schoon.

**Let op:** `useProfile()` krijgt hier geen eigen test. Een composable met `useState`, `useSupabaseClient` en `useSupabaseUser` heeft een draaiende Nuxt-context nodig, en `vitest.config.ts` draait bewust in `environment: 'node'` zonder Nuxt-runtime (zie het uitgebreide commentaar in dat bestand over waarom dat zo moet blijven). Het schrijfpad wordt end-to-end bewezen in Taak 5: naam invoeren in onboarding, terugzien in de ledenlijst. Dat is een echte dekking, geen uitvlucht — maar hij komt pas drie taken verderop, en tot dan is deze code ongedekt.

- [ ] **Step 7: Commit**

```bash
git add app/utils/initials.ts app/composables/useProfile.ts test/utils/initials.test.ts
git commit -m "feat: initials() en useProfile()"
```

---

### Task 3: De instellingentabs en de profielpagina

**Files:**
- Create: `app/components/SettingsTabs.vue`
- Create: `app/pages/settings/profile.vue`
- Modify: `routes.config.ts` (de `routePaths`-kaart)
- Modify: `app/pages/settings/household.vue` (tabs erin, het losse linkje eruit)
- Modify: `app/pages/settings/places.vue` (tabs erin)
- Modify: `i18n/locales/en.json`, `nl.json`, `fr.json`
- Test: `test/routes/offline-path.test.ts` blijft ongewijzigd, maar moet groen blijven

**Interfaces:**
- Consumes: `useProfile()` uit Taak 2.
- Produces:
  - Routesleutel `settings/profile`, routenaam `settings-profile`. Taak 4's `UserMenu` linkt hiernaartoe met `localePath('settings-profile')`.
  - `<SettingsTabs />`, zonder props.

- [ ] **Step 1: Voeg de route toe**

In `routes.config.ts`, in het `routePaths`-object, vóór de bestaande `settings/household`-regel:

```ts
  'settings/profile': {
    en: '/settings/profile',
    nl: '/instellingen/profiel',
    fr: '/parametres/profil',
  },
```

Niet toevoegen aan `publicRoutes` — deze pagina hoort afgeschermd te zijn.

- [ ] **Step 2: Voeg de vertaalsleutels toe**

In `i18n/locales/en.json`, als nieuw blok op het hoogste niveau (na `"appHome"`):

```json
  "profile": {
    "title": "Profile",
    "name": "Name",
    "nameHelp": "This is the name the others in your household see.",
    "save": "Save",
    "saved": "Saved."
  },
```

In `nl.json`, op dezelfde plek:

```json
  "profile": {
    "title": "Profiel",
    "name": "Naam",
    "nameHelp": "Dit is de naam die de anderen in je huishouden zien.",
    "save": "Opslaan",
    "saved": "Opgeslagen."
  },
```

In `fr.json`:

```json
  "profile": {
    "title": "Profil",
    "name": "Nom",
    "nameHelp": "C'est le nom que voient les autres membres de votre ménage.",
    "save": "Enregistrer",
    "saved": "Enregistré."
  },
```

- [ ] **Step 3: Controleer dat de sleuteltest groen is**

Run: `npm run test -- locales`
Expected: PASS. Faalt hij, dan staan de drie bestanden niet gelijk — vergelijk de sleutelpaden in de foutmelding.

- [ ] **Step 4: Schrijf `SettingsTabs.vue`**

`app/components/SettingsTabs.vue`:

```vue
<script setup lang="ts">
// Dit is bewust een component en geen Nuxt-layout. Een layout is netter,
// maar vereist dat app.vue zijn <NuxtPage /> in <NuxtLayout> wikkelt, en dat
// verandert de renderboom van élke pagina — inclusief de geprerenderde
// offline-pagina die met de hand in de precache is nageteld. Drie pagina's
// zijn die app-brede ingreep niet waard. Komt er een vierde bij, dan is de
// promotie naar een layout mechanisch werk.
const { t } = useI18n()
const localePath = useLocalePath()

// De labels hergebruiken de bestaande sleutels van de pagina's zelf, zodat
// een hernoemde pagina niet op twee plekken hoeft te veranderen.
const items = computed(() => [
  { label: t('profile.title'), to: localePath('settings-profile') },
  { label: t('householdSettings.title'), to: localePath('settings-household') },
  { label: t('places.title'), to: localePath('settings-places') },
])
</script>

<template>
  <!-- overflow-x-auto op de wikkel, w-max op het menu: "Profiel /
       Huishouden / Bewaarplaatsen" is in het Nederlands al krap op 360px, en
       de volgende taal die erbij komt valt niet vooraf te meten. Een
       tabstrip die horizontaal schuift is op mobiel normaal.

       Let op wat dit betekent voor e2e/mobile.spec.ts: schuift de strip
       bínnen deze wikkel, dan is er geen page-overflow en blijft de veegtest
       groen. Dat is de bedoelde uitkomst en geen ontsnapping — maar het is
       precies de vorm waarin "groen bewijst niets" zich in dit project al
       veertien keer heeft voorgedaan, dus het staat hier genoteerd. -->
  <div class="mb-6 overflow-x-auto">
    <UNavigationMenu :items="items" class="w-max" />
  </div>
</template>
```

- [ ] **Step 5: Schrijf de profielpagina**

`app/pages/settings/profile.vue`:

```vue
<script setup lang="ts">
const { t } = useI18n()
const { profile, refresh, save } = useProfile()

const naam = ref('')
const pending = ref(false)
const saved = ref(false)
const error = ref('')

// Tijdens SSR is het profiel er al (zie useProfile). Deze await vult het
// invoerveld dus met een waarde die ook in de server-HTML staat.
try {
  await refresh()
  naam.value = profile.value?.displayName ?? ''
} catch {
  error.value = t('householdSettings.error')
}

async function opslaan() {
  pending.value = true
  error.value = ''
  saved.value = false
  try {
    await save(naam.value)
    saved.value = true
  } catch {
    error.value = t('householdSettings.error')
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-lg py-12">
    <SettingsTabs />
    <h1 class="text-2xl font-bold">{{ t('profile.title') }}</h1>

    <form class="mt-6 space-y-4" @submit.prevent="opslaan">
      <UFormField :label="t('profile.name')" :help="t('profile.nameHelp')" name="name">
        <!-- maxlength 60, gelijk aan de check-constraint display_name_length.
             Het formulier is het gemak; de constraint is de echte grens. -->
        <UInput v-model="naam" :maxlength="60" class="w-full" />
      </UFormField>

      <UAlert v-if="error" color="error" :description="error" />
      <UAlert v-else-if="saved" color="success" :description="t('profile.saved')" />

      <UButton type="submit" :loading="pending">{{ t('profile.save') }}</UButton>
    </form>

    <!-- De taalkeuze hoort hier: ze is een persoonlijke voorkeur, net als je
         naam, en ze is uit de header verdwenen zodra je ingelogd bent. Voor
         uitgelogde bezoekers staat dezelfde component nog wél in de header —
         zie AppHeader.vue en de reden in LanguageSwitcher.vue. -->
    <section class="mt-10">
      <h2 class="mb-3 font-semibold">{{ t('nav.language') }}</h2>
      <LanguageSwitcher />
    </section>
  </UContainer>
</template>
```

- [ ] **Step 6: Zet de tabs op de twee bestaande pagina's**

In `app/pages/settings/household.vue`, vervang het hele blok

```vue
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">{{ t('householdSettings.title') }}</h1>
      <UButton variant="link" :to="localePath('settings-places')">
        {{ t('places.title') }}
      </UButton>
    </div>
```

door

```vue
    <SettingsTabs />
    <h1 class="text-2xl font-bold">{{ t('householdSettings.title') }}</h1>
```

`localePath` wordt daarmee ongebruikt in dat bestand: verwijder ook de regel `const localePath = useLocalePath()` uit het script, anders klaagt de linter.

In `app/pages/settings/places.vue`, voeg `<SettingsTabs />` toe als eerste kind van de `<UContainer>`, direct vóór de `<h1>`.

- [ ] **Step 7: Controleer met de hand op 360px**

Run: `npm run dev`, open `http://localhost:3000/nl/instellingen/profiel` in een venster van 360px breed, ingelogd.
Expected: de drie tabs staan er, de actieve tab is gemarkeerd, en bij het Nederlands schuift de strip horizontaal binnen zijn eigen wikkel zónder dat de pagina zelf zijwaarts schuift. Schuift de pagina wél mee, pas dan de klassen in Step 4 aan tot dat niet meer zo is — de veegtest in Taak 4 is de uiteindelijke scheidsrechter.

- [ ] **Step 8: Draai lint, types en unittests**

Run: `npm run lint && npm run typecheck && npm run test`
Expected: alles schoon en groen.

- [ ] **Step 9: Commit**

```bash
git add routes.config.ts i18n/locales app/components/SettingsTabs.vue app/pages/settings
git commit -m "feat: instellingentabs en een profielpagina"
```

---

### Task 4: De header opsplitsen en de veegtest

**Files:**
- Create: `app/components/AppHeader.vue`
- Create: `app/components/UserMenu.vue`
- Create: `e2e/mobile.spec.ts`
- Modify: `app/app.vue`
- Modify: `app/components/LanguageSwitcher.vue`
- Modify: `e2e/helpers.ts` (nieuwe helpers `createHousehold` en `openUserMenu`)
- Modify: `e2e/onboarding.spec.ts` (de navigatietest)
- Modify: `i18n/locales/en.json`, `nl.json`, `fr.json` (`nav.account`)

**Interfaces:**
- Consumes: `initials()` en `useProfile()` uit Taak 2; routenaam `settings-profile` uit Taak 3.
- Produces:
  - `createHousehold(page, opties: { huishouden: string }): Promise<void>` in `e2e/helpers.ts`. Taak 5 breidt de opties uit met `voornaam`.
  - `openUserMenu(page, locale?): Promise<void>` in `e2e/helpers.ts`.

- [ ] **Step 1: Voeg de sleutel `nav.account` toe**

In `i18n/locales/en.json` binnen `"nav"`: `"account": "Account"`.
In `nl.json` binnen `"nav"`: `"account": "Account"`.
In `fr.json` binnen `"nav"`: `"account": "Compte"`.

- [ ] **Step 2: Maak de taalschakelaar compact**

In `app/components/LanguageSwitcher.vue`, vervang de inhoud van `<template>` door:

```vue
<template>
  <UDropdownMenu :items="items" :ui="{ content: 'w-44' }">
    <!-- De knop toont alleen de taalcode (NL/EN/FR); de volledige namen
         staan in de dropdown. Het aria-label blijft nav.language, dus de
         toegankelijke naam van de knop verandert niet — e2e/locales.spec.ts
         zoekt hem daarop en blijft werken. -->
    <UButton
      :aria-label="t('nav.language')"
      size="sm"
      variant="ghost"
      color="neutral"
      icon="i-lucide-languages"
    >
      {{ locale.toUpperCase() }}
    </UButton>
  </UDropdownMenu>
</template>
```

De `trailing-icon="i-lucide-chevron-down"` vervalt: op 360px telt elke pixel, en de dropdown is al herkenbaar aan het taalicoon. `huidige` wordt daarmee ongebruikt in het script — verwijder die `computed` ook.

- [ ] **Step 3: Schrijf `UserMenu.vue`**

`app/components/UserMenu.vue`:

```vue
<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { t } = useI18n()
const localePath = useLocalePath()
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const { profile } = useProfile()

const letters = computed(() => initials(profile.value?.displayName))

// Valt terug op het e-mailadres zolang er geen naam is. useSupabaseUser()
// geeft het JWT-payload, en `email` is daar een standaardclaim.
const naam = computed(() => profile.value?.displayName || user.value?.email || '')

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo(localePath('index'))
}

// `type: 'label'` en `onSelect` zijn geverifieerd tegen DropdownMenuItem in
// node_modules/@nuxt/ui/dist/runtime/components/DropdownMenu.d.vue.ts.
const items = computed<DropdownMenuItem[][]>(() => [
  [{ label: naam.value, type: 'label' }],
  [
    {
      label: t('nav.settings'),
      icon: 'i-lucide-settings',
      to: localePath('settings-profile'),
    },
    {
      label: t('auth.signOut'),
      icon: 'i-lucide-log-out',
      onSelect: () => { void signOut() },
    },
  ],
])
</script>

<template>
  <UDropdownMenu :items="items" :ui="{ content: 'w-52' }">
    <UButton :aria-label="t('nav.account')" variant="ghost" color="neutral" class="p-0">
      <!-- Geen naam betekent geen letters: dan een icoon in plaats van een
           lege cirkel. Zie initials() in app/utils/initials.ts. -->
      <UAvatar
        size="sm"
        :text="letters ?? undefined"
        :icon="letters ? undefined : 'i-lucide-user'"
        :alt="naam"
      />
    </UButton>
  </UDropdownMenu>
</template>
```

- [ ] **Step 4: Schrijf `AppHeader.vue`**

`app/components/AppHeader.vue`:

```vue
<script setup lang="ts">
// Uit app.vue gehaald: dat bestand beheerde de PWA-head-tags én de
// navigatie én het uitloggen. Met een avatarmenu erbij was dat richting de
// 150 regels gegaan.
const { t } = useI18n()
const localePath = useLocalePath()
const user = useSupabaseUser()
const { refresh } = useProfile()

// Tijdens SSR, niet in onMounted: de avatar toont initialen uit dit profiel
// en zou anders bij elke volledige paginalading van icoon naar letters
// springen. De sessie is server-side bekend, dus dit werkt.
//
// Mislukt het, dan blijft profile null en valt de avatar terug op het icoon.
// Dat is de juiste afloop: een header die weigert te renderen omdat een naam
// niet op te halen was, zou de hele app onbruikbaar maken.
if (user.value) {
  try {
    await refresh()
  } catch {
    // Bewust stil: zie hierboven. De avatar heeft een werkende terugval.
  }
}

// Alleen inhoudelijke routes. Instellingen en uitloggen zitten in het
// avatarmenu — dat is het gangbare patroon, en het is de ruimte die de
// header op 360px in het Frans overeind houdt. Gemeten: mét "Paramètres"
// hier bleef er 16px over, zonder ruim 100px. De catalogus komt hier straks
// bij.
const navItems = computed(() => [
  { label: t('nav.inventory'), to: localePath('inventory') },
])
</script>

<template>
  <header class="border-b border-muted">
    <UContainer class="flex h-14 items-center gap-3">
      <NuxtLink :to="localePath('index')" class="shrink-0 font-bold">
        {{ t('app.name') }}
      </NuxtLink>

      <UNavigationMenu v-if="user" :items="navItems" class="flex-1" />

      <!-- De taalschakelaar blijft staan voor wie niet ingelogd is, op álle
           publieke pagina's en niet alleen de landingspagina: wie via
           /invite/<token> binnenkomt krijgt de taal van de afzender en heeft
           geen andere weg terug. Zie LanguageSwitcher.vue en
           e2e/locales.spec.ts. Ingelogd staat dezelfde component op de
           profielpagina. -->
      <LanguageSwitcher v-if="!user" class="ml-auto" />
      <UserMenu v-else class="ml-auto" />
    </UContainer>
  </header>
</template>
```

- [ ] **Step 5: Maak `app.vue` leeg van navigatie**

In `app/app.vue`: verwijder `navItems`, `signOut`, `const user = ...`, `const supabase = ...` en `const { t } = useI18n()` uit het script als ze daarna ongebruikt zijn (`locale` blijft nodig voor de manifest-link). Vervang het hele `<header>`-blok in de template door `<AppHeader />`. De rest — `UApp`, `useHead`, `NuxtRouteAnnouncer`, `NuxtPage`, `PwaUpdatePrompt` — blijft ongewijzigd staan.

- [ ] **Step 6: Voeg de e2e-helpers toe**

Aan het eind van `e2e/helpers.ts`:

```ts
/**
 * Maakt een huishouden aan via het onboardingformulier.
 *
 * Bestaat omdat vijf bestaande testgevallen dit met de hand doen en het
 * formulier in Taak 5 een veld erbij krijgt. Die call sites worden daar
 * omgezet; tot dan staat deze helper er alleen voor mobile.spec.ts.
 */
export async function createHousehold(
  page: import('@playwright/test').Page,
  opties: { huishouden: string },
): Promise<void> {
  await page.goto(routePath('onboarding', 'en'))
  await waitForHydration(page)
  await page.getByLabel(bundles.en.onboarding.name).fill(opties.huishouden)
  await page.getByRole('button', { name: bundles.en.onboarding.start }).click()
  await expect(page.getByText(opties.huishouden)).toBeVisible()
}

/** Opent het avatarmenu in de header. Instellingen en uitloggen zitten daarin. */
export async function openUserMenu(
  page: import('@playwright/test').Page,
  locale: Locale = 'en',
): Promise<void> {
  await page.getByRole('button', { name: bundles[locale].nav.account }).click()
}
```

- [ ] **Step 7: Schrijf de veegtest**

`e2e/mobile.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'
import { routePaths, routePath, localeCodes, defaultLocale, type RouteKey } from '../routes.config'
import { signIn, createHousehold, bundles } from './helpers'

// 360×740, niet 375×812. 375 is de gangbare ontwerpmaat, 360 de eerlijke
// ondergrens van wat er rondloopt. Slaagt 360, dan slaagt 375 mee.
test.use({ viewport: { width: 360, height: 740 } })

// Elke route uit routes.config.ts doet mee. Wie er een uitzondert schrijft
// hier waarom, zodat zichtbaar blijft wat er níet gedekt is.
const uitzonderingen: Partial<Record<RouteKey, string>> = {
  'confirm': 'stuurt meteen door zodra de sessie er is; geen stabiele pagina om te meten',
  'invite/[token]': 'heeft een echt token nodig en wordt gedekt door invite.spec.ts',
}

const teMeten = (Object.keys(routePaths) as RouteKey[]).filter((route) => !(route in uitzonderingen))

/**
 * Meet horizontale overflow op één pagina.
 *
 * De URL-controle is niet decoratief. Zonder haar meet deze test bij een
 * kapotte auth-guard eenentwintig keer de inlogpagina, staat hij groen, en
 * bewijst hij niets over de pagina's die hij beweert te dekken. Dat is
 * precies de faalmodus die dit project al veertien keer heeft opgeleverd.
 */
async function verwachtGeenOverflow(page: Page, pad: string): Promise<void> {
  await page.goto(pad)
  await expect(page, `${pad} stuurde door naar ${page.url()}`).toHaveURL(
    new RegExp(`${pad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`),
  )

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))

  expect(scrollWidth, `${pad} loopt ${scrollWidth - clientWidth}px over`).toBeLessThanOrEqual(clientWidth)
}

test('geen afgeschermde pagina loopt horizontaal over op 360px', async ({ page }) => {
  await signIn(page, `mobiel-${Date.now()}@example.com`)
  await createHousehold(page, { huishouden: 'Mobielhuis' })

  for (const locale of localeCodes) {
    for (const route of teMeten) {
      await verwachtGeenOverflow(page, routePath(route, locale))
    }
  }
})

// De landingspagina krijgt een eigen geval, om twee redenen. Ze staat niet in
// routePaths (er is geen routenaam voor de wortel; zie dezelfde constatering
// in test/routes/offline-path.test.ts). En ze is de enige plek waar de header
// van een uitgelogde bezoeker te zien is — met de compacte taalschakelaar die
// in dit plan verandert, en die de veegtest hierboven dus nooit ziet.
//
// De cookie wordt expliciet gezet omdat detectBrowserLanguage met
// redirectOn: 'root' juist op '/' doorstuurt naar de taal uit die cookie.
// Zonder deze regel hangt de uitkomst af van de volgorde waarin de talen
// getest worden.
for (const locale of localeCodes) {
  test(`de landingspagina loopt niet over op 360px in ${locale}`, async ({ page }) => {
    await page.context().addCookies([
      { name: 'stash_locale', value: locale, url: 'http://localhost:3000' },
    ])

    const pad = locale === defaultLocale ? '/' : `/${locale}`
    await verwachtGeenOverflow(page, pad)

    // Bewijst dat we de juiste taal én een uitgelogde header meten: de
    // taalschakelaar hoort hier te staan, de avatar niet.
    await expect(page.getByRole('button', { name: bundles[locale].nav.language })).toBeVisible()
    await expect(page.getByRole('button', { name: bundles[locale].nav.account })).toHaveCount(0)
  })
}
```

- [ ] **Step 8: Draai de veegtest tegen de nog ongerepareerde header**

Zet `AppHeader.vue` tijdelijk terug op de oude indeling door in de template `<LanguageSwitcher v-if="!user" />` te vervangen door `<LanguageSwitcher />` en `<UserMenu v-else />` door een uitlogknop met tekst, en zet `nav.settings` terug in `navItems`.

Run: `npm run test:e2e -- mobile`
Expected: de veegtest wordt ROOD, met een melding als `/fr/stock loopt 107px over`. Blijft hij groen, dan meet hij niet wat hij beweert — controleer eerst of de viewport echt op 360 staat en of `signIn` geslaagd is. **Noteer de rode lijst in je rapport**: welke paden, in welke taal, met hoeveel pixels.

- [ ] **Step 9: Zet de header terug en draai opnieuw**

Draai Step 8 terug (de indeling uit Step 4 is de juiste).

Run: `npm run test:e2e -- mobile`
Expected: alle gevallen SLAGEN.

- [ ] **Step 10: Controleer dat de offline-pagina geen data-afhankelijkheid heeft gekregen**

Dit is het echte risico van deze taak. `AppHeader.vue` haalt het profiel op tijdens SSR, en de offline-pagina wordt geprerenderd (`nitro.prerender.routes` in `nuxt.config.ts`) en beland in de precache. Zou de header tijdens dat prerenderen een databaseaanroep doen, dan is de offline-pagina niet langer offline-bestendig — precies de belofte die vorige week met de hand is nageteld.

De `if (user.value)` in Step 4 hoort dat te voorkomen: tijdens prerenderen is er geen sessie. Controleer dat in plaats van het aan te nemen.

Run: `npm run build`, daarna `grep -c "user_profile" .output/public/offline/index.html` en open datzelfde bestand.
Expected: de geprerenderde HTML bevat de header met de taalschakelaar, geen avatar, en geen spoor van een profielaanroep. Faalt de build op de prerender van `/offline`, `/nl/offline` of `/fr/hors-ligne`, dan doet de header daar iets wat hij niet mag.

- [ ] **Step 11: Meet de header na op 360px tegen de gebouwde app**

De veegtest draait tegen de dev-server. Dit is het ene geval waarvan de spec (§10, punt 2) eist dat het ook tegen de build gemeten wordt, omdat de header de enige wijziging is die op elke pagina staat.

Run: `npm run build`, dan `npx wrangler --cwd .output dev --port 3001`. Log in, en meet in de console op een venster van 360px breed, voor elk van `/inventory`, `/nl/voorraad` en `/fr/stock`:

```js
document.documentElement.scrollWidth - document.documentElement.clientWidth
```

Expected: `0` voor alle drie. Noteer de drie getallen in je rapport. Stop de wrangler-server daarna; laat geen `workerd`-proces op 3001 achter (een bekende valkuil uit `open-bevindingen.md`).

- [ ] **Step 12: Werk de navigatietest bij**

In `e2e/onboarding.spec.ts`, in de test `een ingelogde gebruiker bereikt beide instellingenpagina's via de navigatie`, vervang

```ts
  await page.getByRole('link', { name: 'Settings' }).click()
```

door

```ts
  // Instellingen zit sinds de header-herindeling in het avatarmenu, niet meer
  // in de navigatiebalk. Deze test klikt dus eerst het menu open — precies de
  // weg die een gebruiker ook aflegt.
  await openUserMenu(page)
  await page.getByRole('menuitem', { name: en.nav.settings }).click()
  await expect(page).toHaveURL(new RegExp(routePath('settings/profile', 'en')))

  await page.getByRole('link', { name: en.householdSettings.title }).click()
```

en voeg `openUserMenu` toe aan de import uit `./helpers`. De assertie op `settings/household` die er stond blijft daarna staan, gevolgd door de bestaande klik naar `Storage places`.

- [ ] **Step 13: Draai de hele e2e-suite**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:e2e`
Expected: alles groen, inclusief `locales.spec.ts` — die zoekt de taalknop op `aria-label` en de menu-items op hun volledige naam, en beide zijn ongewijzigd gebleven.

- [ ] **Step 14: Commit**

```bash
git add app/app.vue app/components e2e i18n/locales
git commit -m "feat: avatarmenu in de header, taalschakelaar alleen uitgelogd"
```

---

### Task 5: De voornaam in onboarding

**Files:**
- Modify: `app/pages/onboarding.vue`
- Modify: `i18n/locales/en.json`, `nl.json`, `fr.json`
- Modify: `e2e/helpers.ts` (`createHousehold` krijgt `voornaam`)
- Modify: `e2e/onboarding.spec.ts` (twee call sites + strengere ledentest)
- Modify: `e2e/invite.spec.ts` (drie call sites)

**Interfaces:**
- Consumes: `useProfile()` uit Taak 2; `createHousehold` uit Taak 4.
- Produces: `createHousehold(page, { voornaam, huishouden })` — beide velden verplicht. Taak 6 gebruikt deze vorm.

- [ ] **Step 1: Voeg de vertaalsleutel toe**

In `i18n/locales/en.json` binnen `"onboarding"`: `"firstName": "Your first name"`.
In `nl.json` binnen `"onboarding"`: `"firstName": "Je voornaam"`.
In `fr.json` binnen `"onboarding"`: `"firstName": "Votre prénom"`.

- [ ] **Step 2: Werk het onboardingformulier bij**

In `app/pages/onboarding.vue`, in het script: voeg `const { profile, refresh, save } = useProfile()` en `const voornaam = ref('')` toe, en vul het veld voor als er al een naam is:

```ts
try {
  await refresh()
  voornaam.value = profile.value?.displayName ?? ''
} catch {
  // Geen naam kunnen ophalen is geen reden om het formulier te blokkeren;
  // het veld begint dan gewoon leeg.
}
```

Vervang `start()` door:

```ts
async function start() {
  pending.value = true
  error.value = ''
  try {
    // De volgorde is hier een correctheidskwestie, geen smaak. Slaagt het
    // huishouden terwijl de naam faalt, dan zit de gebruiker naamloos in een
    // huishouden en maakt een tweede poging een TWEEDE huishouden aan.
    // Andersom is een mislukking veilig: het profiel opslaan is idempotent.
    await save(voornaam.value)
    await create(name.value)
    await navigateTo(localePath('inventory'))
  } catch {
    error.value = t('auth.error')
  } finally {
    pending.value = false
  }
}
```

In de template, vóór het bestaande `UFormField` voor de huishoudnaam:

```vue
        <UFormField :label="t('onboarding.firstName')" name="firstName">
          <UInput v-model="voornaam" required :maxlength="60" class="w-full" />
        </UFormField>
```

- [ ] **Step 3: Breid de e2e-helper uit**

In `e2e/helpers.ts`, vervang `createHousehold` door:

```ts
export async function createHousehold(
  page: import('@playwright/test').Page,
  opties: { voornaam: string; huishouden: string },
): Promise<void> {
  await page.goto(routePath('onboarding', 'en'))
  await waitForHydration(page)
  await page.getByLabel(bundles.en.onboarding.firstName).fill(opties.voornaam)
  await page.getByLabel(bundles.en.onboarding.name).fill(opties.huishouden)
  await page.getByRole('button', { name: bundles.en.onboarding.start }).click()
  await expect(page.getByText(opties.huishouden)).toBeVisible()
}
```

- [ ] **Step 4: Zet alle call sites om**

In `e2e/mobile.spec.ts`: `createHousehold(page, { voornaam: 'Mo', huishouden: 'Mobielhuis' })`.

In `e2e/onboarding.spec.ts` en `e2e/invite.spec.ts`: vervang elk blok van de vorm

```ts
  await page.goto(routePath('onboarding', 'en'))
  await waitForHydration(page)
  await page.getByLabel('Household name').fill('X')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByText('X')).toBeVisible()
```

door `await createHousehold(page, { voornaam: '<een naam>', huishouden: 'X' })`, en importeer `createHousehold` uit `./helpers`. Het gaat om drie plekken in `invite.spec.ts` (de huishoudens `Uitnodigingshuis`, `Huis2` en `Huis1`) en twee in `onboarding.spec.ts`. Geef elk huishouden een eigen voornaam, zodat een verwisseling in de ledenlijst zichtbaar wordt.

- [ ] **Step 5: Maak de ledentest strenger**

In `e2e/onboarding.spec.ts`, vervang in de test `de eigenaar staat als lid in de huishoudinstellingen` de assertie

```ts
  await expect(page.getByText(en.householdSettings.roleOwner, { exact: true })).toBeVisible()
```

door

```ts
  // Dit bewijst het hele pad in één keer: het onboardingformulier schrijft
  // display_name, en de ledenlijst leest het terug. Tot dit plan werd die
  // kolom nergens geschreven en toonde de lijst voor iedereen "Unnamed" —
  // een half afgemaakte functie waar geen enkele test iets van merkte.
  await expect(page.getByText('Steffie', { exact: false })).toBeVisible()
  await expect(page.getByText(en.householdSettings.noName)).toHaveCount(0)
  await expect(page.getByText(en.householdSettings.roleOwner, { exact: true })).toBeVisible()
```

en zorg dat het `createHousehold`-aanroep in diezelfde test `voornaam: 'Steffie'` meegeeft.

- [ ] **Step 6: Draai de tests**

Run: `npm run test && npm run test:e2e`
Expected: alles groen.

- [ ] **Step 7: Falsificeer de ledentest**

Haal in `app/pages/onboarding.vue` de regel `await save(voornaam.value)` tijdelijk weg.

Run: `npm run test:e2e -- onboarding`
Expected: `de eigenaar staat als lid in de huishoudinstellingen` wordt ROOD op de regel die `Steffie` verwacht. Blijft hij groen, dan toetst hij de naam niet echt. Zet de regel daarna terug.

- [ ] **Step 8: Commit**

```bash
git add app/pages/onboarding.vue i18n/locales e2e
git commit -m "feat: vraag de voornaam tijdens onboarding"
```

---

### Task 6: De voornaam in de uitnodigingsflow

**Files:**
- Modify: `app/pages/invite/[token].vue`
- Modify: `i18n/locales/en.json`, `nl.json`, `fr.json`
- Modify: `e2e/invite.spec.ts`

**Interfaces:**
- Consumes: `useProfile()` uit Taak 2; `createHousehold({ voornaam, huishouden })` uit Taak 5.
- Produces: niets voor latere taken.

- [ ] **Step 1: Voeg de vertaalsleutels toe**

In `en.json` binnen `"invite"`: `"nameTitle": "What should we call you?"` en `"nameHelp": "The others in your household will see this name."`
In `nl.json`: `"nameTitle": "Hoe mogen we je noemen?"` en `"nameHelp": "De anderen in je huishouden zien deze naam."`
In `fr.json`: `"nameTitle": "Comment devons-nous vous appeler ?"` en `"nameHelp": "Les autres membres de votre ménage verront ce nom."`

- [ ] **Step 2: Toon het naamveld alleen wanneer er geen naam is**

In `app/pages/invite/[token].vue`, in het script. Let op de naamsbotsing: dit bestand heeft al een `refresh` uit `useHousehold()`, dus de profielversie krijgt een alias:

```ts
const { profile, refresh: refreshProfiel, save } = useProfile()
```

Daarnaast:

```ts
const voornaam = ref('')
const naamOpslaan = ref(false)
const naamKlaar = ref(false)

// Alleen vragen aan wie nog geen naam heeft. Wie hier al eerder langskwam
// krijgt gewoon de statuspagina die er stond.
const vraagNaam = computed(() => state.value === 'done' && !naamKlaar.value && !profile.value?.displayName)

async function bewaarNaam() {
  naamOpslaan.value = true
  try {
    await save(voornaam.value)
    naamKlaar.value = true
  } catch {
    // De naam is bijzaak: je bent al lid. Een mislukking hier mag de weg naar
    // je voorraad niet blokkeren, dus we sluiten het blok gewoon.
    naamKlaar.value = true
  } finally {
    naamOpslaan.value = false
  }
}
```

Voeg in de bestaande `onMounted`, direct na `await refresh()` van `useHousehold`, een `await refreshProfiel()` toe.

In de template, tussen de succes-`UAlert` en de knop naar de voorraad:

```vue
    <UCard v-if="vraagNaam" class="mt-6">
      <template #header>
        <h2 class="font-semibold">{{ t('invite.nameTitle') }}</h2>
      </template>
      <p class="text-sm text-muted">{{ t('invite.nameHelp') }}</p>
      <form class="mt-4 flex flex-col gap-2 sm:flex-row" @submit.prevent="bewaarNaam">
        <!-- aria-label en geen UFormField: de kop van deze kaart is de vraag
             al, dus een zichtbaar label erboven zou hem herhalen. Zonder dit
             attribuut heeft het veld helemaal geen toegankelijke naam — en
             kan een test het ook alleen op positie vinden. -->
        <UInput
          v-model="voornaam"
          :aria-label="t('profile.name')"
          :maxlength="60"
          class="w-full sm:flex-1"
        />
        <UButton type="submit" :loading="naamOpslaan">{{ t('profile.save') }}</UButton>
      </form>
    </UCard>
```

Het veld is hier bewust niet `required`: `accept_invite` is al gedraaid, dus je bent al lid, en de knop naar je voorraad staat er altijd onder.

- [ ] **Step 3: Breid de uitnodigingstest uit**

In `e2e/invite.spec.ts`, in de test `een uitgenodigde zonder account wordt na inloggen lid`, na `await expect(guest.getByText('Uitnodigingshuis')).toBeVisible()`:

```ts
  // Een genodigde ziet onboarding nooit en zou dus voorgoed naamloos blijven.
  await expect(guest.getByText(en.invite.nameTitle)).toBeVisible()
  await guest.getByLabel(en.profile.name).fill('Genodigde')
  await guest.getByRole('button', { name: en.profile.save }).click()
  await expect(guest.getByText(en.invite.nameTitle)).toHaveCount(0)
```

- [ ] **Step 4: Voeg de falsificatie toe**

Zonder dit tweede geval zou een naamveld dat áltijd verschijnt ook slagen. Voeg toe aan hetzelfde bestand:

```ts
// De andere helft van het geval hierboven. Zonder deze test zou "toon het
// veld altijd" net zo groen zijn, en zou een terugkerende gebruiker elke
// uitnodiging opnieuw om zijn naam gevraagd worden.
test('een genodigde die al een naam heeft, wordt er niet opnieuw om gevraagd', async ({ page, browser }) => {
  const ownerEmail = `eigenaar-naam-${Date.now()}@example.com`
  await signIn(page, ownerEmail)
  await createHousehold(page, { voornaam: 'Eigenaar', huishouden: 'Naamhuis' })

  await page.goto(routePath('settings/household', 'en'))
  await waitForButtonHydration(page)
  await page.getByRole('button', { name: en.invite.create }).click()
  const link = await page.getByRole('textbox', { name: en.invite.linkLabel }).inputValue()

  // Deze genodigde heeft al een huishouden én een naam uit zijn eigen
  // onboarding, en accepteert daarna pas de uitnodiging.
  const context = await browser.newContext()
  const guest = await context.newPage()
  await signIn(guest, `genodigde-naam-${Date.now()}@example.com`)
  await createHousehold(guest, { voornaam: 'Bekend', huishouden: 'Eigenhuis' })

  await guest.goto(link)
  await expect(guest.getByText('Naamhuis')).toBeVisible()
  await expect(guest.getByText(en.invite.nameTitle)).toHaveCount(0)

  await context.close()
})
```

- [ ] **Step 5: Draai de tests**

Run: `npm run test && npm run test:e2e -- invite`
Expected: beide gevallen groen.

- [ ] **Step 6: Falsificeer**

Vervang `vraagNaam` tijdelijk door `computed(() => state.value === 'done')`.

Run: `npm run test:e2e -- invite`
Expected: `een genodigde die al een naam heeft, wordt er niet opnieuw om gevraagd` wordt ROOD. Zet daarna terug.

- [ ] **Step 7: Commit**

```bash
git add app/pages/invite i18n/locales e2e/invite.spec.ts
git commit -m "feat: vraag de voornaam ook aan wie via een uitnodiging binnenkomt"
```

---

### Task 7: De stapelfixes en de stapeltest

**Files:**
- Modify: `app/pages/settings/places.vue` (het toevoegformulier)
- Modify: `app/components/HouseholdMembers.vue` (de ledenrij)
- Modify: `app/components/HouseholdInvites.vue` (de uitnodigingskaart)
- Modify: `e2e/mobile.spec.ts` (de stapeltest erbij)

**Interfaces:**
- Consumes: `signIn` en `createHousehold` uit Taak 4 en 5.
- Produces: niets voor latere taken.

- [ ] **Step 1: Schrijf de falende stapeltest**

Voeg toe aan `e2e/mobile.spec.ts`:

```ts
/**
 * Twee elementen staan niet op dezelfde regel.
 *
 * Een breedtegrens ("het veld is minstens N pixels breed") zou een verzonnen
 * getal zijn. Dit is een directe uitspraak over de fix — onder `sm` stapelt
 * de rij — en hij wordt rood zodra iemand dat terugdraait.
 *
 * Deze test bestaat omdat de veegtest hierboven niet volstaat, en dat is
 * gemeten en niet beredeneerd: het naamveld van het bewaarplaatsen-formulier
 * was in het Frans op 360px samengedrukt tot 49px, binnen een formulier van
 * 328px dat keurig binnen de viewport bleef. Nul page-overflow, onbruikbaar
 * veld, groene veegtest.
 */
async function verwachtGestapeld(
  boven: import('@playwright/test').Locator,
  onder: import('@playwright/test').Locator,
  naam: string,
): Promise<void> {
  const a = await boven.boundingBox()
  const b = await onder.boundingBox()
  expect(a, `${naam}: het bovenste element is niet zichtbaar`).not.toBeNull()
  expect(b, `${naam}: het onderste element is niet zichtbaar`).not.toBeNull()
  expect(b!.y, `${naam} staat nog op dezelfde regel`).toBeGreaterThanOrEqual(a!.y + a!.height)
}

test('bediening staat gestapeld op 360px in plaats van samengedrukt', async ({ page }) => {
  await signIn(page, `stapel-${Date.now()}@example.com`)
  // De voornaam mag geen deelreeks van de huishoudnaam zijn: getByText doet
  // standaard een deelreeksvergelijking, en 'Stapel' zou dan ook 'Stapelhuis'
  // matchen — een selector die per ongeluk het verkeerde element pakt.
  await createHousehold(page, { voornaam: 'Vera', huishouden: 'Stapelhuis' })

  await page.goto(routePath('settings/places', 'en'))
  await verwachtGestapeld(
    page.getByPlaceholder(bundles.en.places.name),
    page.getByRole('button', { name: bundles.en.places.add }),
    'bewaarplaatsen-formulier',
  )

  await page.goto(routePath('settings/household', 'en'))
  await expect(page.getByText('Vera')).toBeVisible()
  await verwachtGestapeld(
    page.getByText('Vera'),
    page.getByRole('button', { name: bundles.en.householdSettings.removeMember }),
    'ledenrij',
  )

  await page.getByRole('button', { name: bundles.en.invite.create }).click()
  const linkveld = page.getByRole('textbox', { name: bundles.en.invite.linkLabel })
  await expect(linkveld).toBeVisible()
  await verwachtGestapeld(
    linkveld,
    page.getByRole('button', { name: bundles.en.invite.copy }),
    'uitnodigingskaart',
  )
})
```

- [ ] **Step 2: Draai de test en controleer dat hij faalt**

Run: `npm run test:e2e -- mobile`
Expected: `bediening staat gestapeld op 360px` wordt ROOD op het eerste geval, met "bewaarplaatsen-formulier staat nog op dezelfde regel". **Noteer welke van de drie falen** — dat scheidt wat gemeten stuk was van wat alleen voorspeld was.

- [ ] **Step 3: Stapel het bewaarplaatsen-formulier**

In `app/pages/settings/places.vue`, vervang

```vue
    <form class="mt-6 flex gap-2" @submit.prevent="add">
      <UInput v-model="name" :placeholder="t('places.name')" class="flex-1" />
      <USelect v-model="kind" :items="kinds" value-key="value" :aria-label="t('places.kind')" />
      <UButton type="submit">{{ t('places.add') }}</UButton>
    </form>
```

door

```vue
    <!-- Onder `sm` gestapeld. Naast elkaar werd het naamveld in het Frans op
         360px teruggedrukt tot 49px: alleen het invoerveld had flex-1, dus
         het leverde als enige in tegenover een keuzelijst van 149px en een
         knop van 114px. -->
    <form class="mt-6 flex flex-col gap-2 sm:flex-row" @submit.prevent="add">
      <UInput v-model="name" :placeholder="t('places.name')" class="w-full sm:flex-1" />
      <USelect v-model="kind" :items="kinds" value-key="value" :aria-label="t('places.kind')" class="w-full sm:w-auto" />
      <UButton type="submit" class="justify-center">{{ t('places.add') }}</UButton>
    </form>
```

- [ ] **Step 4: Stapel de ledenrij**

In `app/components/HouseholdMembers.vue`, vervang de `<li>`-openingstag en groepeer de knoppen:

```vue
      <li v-for="member in members" :key="member.userId" class="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:gap-3">
        <span class="min-w-0 break-words sm:flex-1">
          {{ member.displayName || t('householdSettings.noName') }}
          <span v-if="isSelf(member.userId)" class="text-muted">({{ t('householdSettings.you') }})</span>
        </span>
        <div class="flex flex-wrap items-center gap-2">
```

De bestaande `UBadge` en de twee `UButton`s komen binnen die nieuwe `<div>`, en de `<li>` krijgt aan het eind een extra `</div>` vóór `</li>`.

`min-w-0 break-words` staat er omdat een naam van 60 tekens zonder spaties anders zijn eigen kolom oprekt — de constraint uit Taak 1 begrenst de lengte, niet de vorm.

- [ ] **Step 5: Stapel de uitnodigingskaart**

In `app/components/HouseholdInvites.vue`, vervang

```vue
      <div class="flex items-center justify-between gap-4">
```

door

```vue
      <!-- De knoppen hadden shrink-0 en leverden dus nooit in; op 360px hield
           het linkveld daardoor nog geen 170px over voor een lange token-URL
           in monospace. -->
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
```

en vervang `<div class="flex shrink-0 gap-2">` door `<div class="flex flex-wrap gap-2 sm:shrink-0">`.

- [ ] **Step 6: Draai de test opnieuw**

Run: `npm run test:e2e -- mobile`
Expected: alle gevallen SLAGEN, inclusief de veegtest die er al stond.

- [ ] **Step 7: Meet het naamveld opnieuw**

Run: `npm run dev`, open `http://localhost:3000/fr/parametres/rangements` op 360px breed, ingelogd, en voer in de console uit:

```js
Math.round(document.querySelector('form input').getBoundingClientRect().width)
```

Expected: ruim boven de 49px die er vóór dit plan stond — het veld hoort nu de volle breedte van het formulier te hebben (circa 328px). Noteer het getal in je rapport.

- [ ] **Step 8: Controleer dat de desktopweergave niet verslechterd is**

Open dezelfde drie plekken in een venster van 1280px breed.
Expected: alles staat weer naast elkaar zoals voorheen; `sm:` begint bij 640px, dus boven die breedte verandert er niets.

- [ ] **Step 9: Commit**

```bash
git add app/pages/settings/places.vue app/components/HouseholdMembers.vue app/components/HouseholdInvites.vue e2e/mobile.spec.ts
git commit -m "fix: stapel bediening onder sm in plaats van samen te drukken"
```

---

### Task 8: De documentatie bijwerken

**Files:**
- Modify: `docs/superpowers/open-bevindingen.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: de uitkomsten van alle voorgaande taken.
- Produces: niets.

- [ ] **Step 1: Noteer de openstaande punten**

`docs/superpowers/open-bevindingen.md` gebruikt tabellen met twee kolommen, geen opsommingen. Voeg deze rijen toe in de bestaande secties.

Onder **"Functionaliteit die de spec vraagt"**:

```markdown
| **Tikdoelen van 44×44 zijn niet getoetst.** | Dit plan meet horizontale overflow en of bediening stapelt, niet de minimale grootte van een aanraakdoel. Het raakt elke knop in de app en verdient een eigen ronde; de twee tests in `e2e/mobile.spec.ts` slaan er geen alarm over. |
| **Geüploade profielfoto's ontbreken.** | De avatar toont initialen uit `display_name`, met een icoon als terugval. Een echte foto vraagt een Supabase Storage-bucket met eigen RLS-policies op objecten en verkleinen vóór upload — een eigen subsysteem, bewust buiten dit plan gehouden (zie §2 van de spec). |
```

Onder **"Kleine punten"**:

```markdown
| De mobiele tests draaien tegen de dev-server. | `e2e/mobile.spec.ts` hangt aan `playwright.config.ts` en dus aan `npm run dev`. Aangenomen is dat de Tailwind-uitvoer daar identiek is aan die van de build voor de klassen die het plan gebruikt. Die aanname is niet nagemeten; alleen de header is met de hand tegen de gebouwde app gecontroleerd (Taak 4, Step 11). |
| De instellingen-tabstrip schuift binnen zichzelf. | `SettingsTabs.vue` heeft `overflow-x-auto`, wat bedoeld is: de strip schuift in plaats van de pagina. Gevolg is wel dat de veegtest groen blijft als de tabs in een nieuwe taal onleesbaar krap worden — de overflow blijft dan binnen de wikkel. |
| `useProfile()` heeft geen eigen unittest. | De composable gebruikt `useState`, `useSupabaseClient` en `useSupabaseUser` en heeft dus een Nuxt-runtime nodig, die `vitest.config.ts` bewust niet biedt (zie het commentaar daar). De dekking komt volledig uit de e2e-tests van Taak 5 en 6, die het schrijfpad end-to-end aflopen. |
```

Voeg géén bevinding over de ontbrekende weergavenaam toe of weg: die heeft nooit in dit bestand gestaan (gecontroleerd), ook al bestond het probleem al sinds het profielschema er is. Dat is zelf het vermeldenswaardige deel — noteer het in je rapport, niet in dit bestand.

- [ ] **Step 2: Werk de bevinding over de hydratiewaarschuwing bij**

In dezelfde sectie **"Bedrading en omgeving"** staat een item over `[Vue warn]: Hydration node mismatch` op element `header`. De tekst verwijst naar "`app.vue` heeft precies één `<header v-if="user">`". Dat klopte al niet vóór dit plan — de header in `app.vue` rendert altijd — en de header staat nu bovendien in `AppHeader.vue`.

Corrigeer de verwijzing naar `AppHeader.vue`, en vul aan met wat je nú waarneemt: `AppHeader.vue` heeft sinds dit plan wél twee takken die van `user` afhangen (`LanguageSwitcher v-if="!user"` en `UserMenu v-else`), wat deze klasse waarschuwingen kan versterken.

Run: `npm run dev`, log in, en doorloop `/inventory`, `/nl/voorraad` en `/fr/stock` in een verse browsercontext terwijl je de serverconsole leest.
Expected: noteer of de waarschuwing vaker, even vaak of niet meer verschijnt. Geen van beide uitkomsten blokkeert deze taak — het gaat erom dat de bevinding klopt met de werkelijkheid in plaats van te verouderen.

- [ ] **Step 3: Controleer of de README ergens onwaar is geworden**

De `README.md` documenteert opzet, tests, de PWA en het deployen. Er staat **geen** overzicht van routes of navigatie in, dus er hoeft ook geen `settings/profile` bij — dat is gecontroleerd, niet aangenomen.

Lees de secties "Tests" en "Progressive Web App" na tegen de code die je gewijzigd hebt. Het enige dat hier fout kan zijn geraakt, is de belofte onder "What works offline": de offline-pagina rendert nu `AppHeader.vue`. Taak 4 Step 10 heeft dat al gecontroleerd tegen de gebouwde app.

Klopt alles, **verander dan niets**. Een regel toevoegen om deze stap af te vinken maakt de README slechter, niet beter.

- [ ] **Step 4: Draai alles nog één keer**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:db && npm run test:e2e && npm run test:e2e:pwa`
Expected: alles groen. De PWA-suite draait tegen een gebouwde app en is hier de controle dat de header-herindeling de geprerenderde offline-pagina en de precache niet geraakt heeft.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/open-bevindingen.md README.md
git commit -m "docs: bevindingen en readme na de mobiele laag"
```
