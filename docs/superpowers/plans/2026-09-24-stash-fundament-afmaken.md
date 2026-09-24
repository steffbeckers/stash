# Stash plan 2: het fundament afmaken

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De gaten dichten die plan 1 heeft opengelaten, zodat een huishouden volledig bestuurbaar is en de testsuite dekt wat ze beweert te dekken — vóór er producten, voorraad of bonnen bovenop komen.

**Architecture:** Geen nieuwe tabellen. Eén nieuwe `security definer`-RPC (`set_member_role`) volgens hetzelfde patroon als `create_household`, `create_invite` en `accept_invite`: de functie bewaakt zelf wie hem mag aanroepen, `anon` krijgt geen execute-recht, en RLS wordt niet opengezet met een extra UPDATE-policy. Daarnaast een ledenlijst in de huishoudinstellingen, want promoveren en verwijderen kunnen niet zonder te zien wie er lid is. De rest is testwerk.

**Tech Stack:** Nuxt 4 (SSR) + Nuxt UI, `@nuxtjs/i18n` (en/nl/fr), `@nuxtjs/supabase`, Supabase Postgres met RLS, Vitest (unit + database), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-09-21-stash-design.md`

**Openstaande bevindingen:** `docs/superpowers/open-bevindingen.md`

## Global Constraints

- **Migraties zijn append-only.** Nooit een bestaand migratiebestand wijzigen. `create or replace function` behoudt bestaande rechten en aangehangen triggers; `drop`/`create` niet.
- **Elke tabel met gebruikersdata heeft RLS vanaf de migratie die hem aanmaakt.**
- **Elke nieuwe functie krijgt expliciet `revoke all ... from public, anon` en daarna `grant execute ... to authenticated`.** Alleen `revoke ... from public` volstaat niet: Supabase geeft `anon` een directe grant die de PUBLIC-pseudorol niet raakt.
- **`security definer` alleen waar het nodig is**, met `set search_path = public`. Nodig wanneer de functie rijen moet zien of schrijven die RLS voor de aanroeper wegfiltert; niet nodig voor een functie die enkel `NEW` en `OLD` vergelijkt.
- **Falsificatieplicht (uitspraak 12 uit plan 1).** Elke test die een beveiliging bewaakt, moet aantoonbaar rood worden als die beveiliging wordt weggehaald. Het rapport van de taak vermeldt welke bescherming tijdelijk is verwijderd en welke test daardoor faalde. Een test die niet kan falen, bewijst niets.
- **Let op de leespolicy bij negatieve schrijftests.** PostgreSQL past `SELECT`-policies óók toe op een `UPDATE` of `DELETE` die kolommen leest — in een `WHERE` of een `RETURNING`. Een negatieve schrijftest met een `WHERE` blijft daardoor groen als de schrijfpolicy op `using (true)` staat. Schrijf zulke tests zonder `WHERE`, of test de RPC in plaats van de policy.
- **Databasetests draaien in een transactie.** `set local` werkt alleen binnen een transactieblok; buiten een transactie draait de test als superuser en omzeilt RLS volledig. Gebruik `withTx` + `actAs` + `enableRls` uit `test/db/helpers.ts`. `actAs` zet alleen de JWT-claim; pas `enableRls` schakelt naar de rol `authenticated`.
- **postgres.js vergiftigt de transactie.** Een query die faalt, laat het omhullende `begin()`-blok mislukken, óók als de fout is opgevangen. Een `await expect(...).rejects.toThrow()` op een database-oproep moet daarom in `tx.savepoint(...)`.
- **`useSupabaseUser()` geeft een JWT-payload**, geen User-object: het id staat op `.sub`, nooit op `.id`.
- **Drie talen tegelijk.** Elke nieuwe vertaalsleutel komt in `i18n/locales/en.json`, `nl.json` én `fr.json`. `test/i18n/locales.test.ts` faalt zodra een sleutel in één taal ontbreekt.
- **Controles die groen moeten blijven:** `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:db`, `npm run test:e2e`. CI draait ze alle vijf.
- **Commits worden ondertekend.** Niet `-c commit.gpgsign=false` gebruiken.
- **Per bestand stagen**, nooit `git add -A`.

## File Structure

| Bestand | Verantwoordelijkheid |
| --- | --- |
| `supabase/migrations/<ts>_set_member_role.sql` | **Nieuw.** De RPC die een rol wijzigt, plus de rechten erop. |
| `app/components/HouseholdMembers.vue` | **Nieuw.** Toont wie er lid is, met rol; laat een eigenaar promoveren en verwijderen. |
| `app/composables/useHousehold.ts` | **Wijzigen.** Krijgt `members`, `loadMembers`, `setRole` en `removeMember`. |
| `app/composables/useRedirectWhenSignedIn.ts` | **Nieuw.** De gedeelde watch-op-`user` die nu in twee pagina's is gedupliceerd. |
| `app/pages/settings/household.vue` | **Wijzigen.** Krijgt de ledensectie boven de uitnodigingen. |
| `app/pages/index.vue`, `app/pages/confirm.vue` | **Wijzigen.** Gebruiken de gedeelde composable. |
| `i18n/locales/{en,nl,fr}.json` | **Wijzigen.** Sleutels voor leden, rollen, promoveren en verwijderen. |
| `test/db/member-role.test.ts` | **Nieuw.** Alles rond `set_member_role`. |
| `test/db/household-invite.test.ts` | **Wijzigen.** De gelijktijdigheidstest op de gebruiksteller. |
| `test/db/helpers.ts` | **Wijzigen.** `withTwoConnections` voor gelijktijdigheid; duidelijker `.env`-fout. |
| `e2e/helpers.ts` | **Wijzigen.** Taalonafhankelijke selectors en een eerlijke hydratiewacht. |
| `e2e/locales.spec.ts` | **Nieuw.** De inlogflow onder `/nl` en `/fr`. |
| `nuxt.config.ts`, `README.md` | **Wijzigen.** `NUXT_PUBLIC_APP_VERSION` bij de deploy documenteren. |
| `docs/superpowers/open-bevindingen.md` | **Wijzigen.** Afvinken wat dit plan oplost. |

---

### Task 1: De ledenlijst tonen

Promoveren en verwijderen kunnen niet zonder te zien wie er lid is. Vandaag toont `settings/household.vue` alleen uitnodigingen. Deze taak levert de lijst; taken 2 en 3 hangen er acties aan.

De leesrechten bestaan al: de SELECT-policy op `household_member` is `is_household_member(household_id)`, en die op `user_profile` is `to authenticated using (true)` — weergavenamen zijn bewust publiek binnen de app. Er is dus geen migratie nodig.

**Files:**
- Create: `app/components/HouseholdMembers.vue`
- Modify: `app/composables/useHousehold.ts`
- Modify: `app/pages/settings/household.vue`
- Modify: `i18n/locales/en.json`, `i18n/locales/nl.json`, `i18n/locales/fr.json`
- Test: `e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes: `useHousehold()` uit `app/composables/useHousehold.ts` — bestaande velden `households`, `activeId`, `refresh`, `setActive`, `create`.
- Produces: `useHousehold().members` (`Ref<Member[]>`) en `useHousehold().loadMembers(householdId: string): Promise<void>`, met

  ```ts
  export interface Member {
    userId: string
    displayName: string | null
    role: 'owner' | 'member'
  }
  ```

  Taken 2 en 3 breiden dezelfde composable uit met `setRole` en `removeMember`.

- [ ] **Step 1: De vertaalsleutels toevoegen**

In `i18n/locales/en.json`, binnen het bestaande `householdSettings`-object, na `"invitations"`:

```json
    "members": "Members",
    "roleOwner": "Owner",
    "roleMember": "Member",
    "you": "you",
    "noName": "Unnamed"
```

In `i18n/locales/nl.json`, zelfde plek:

```json
    "members": "Leden",
    "roleOwner": "Eigenaar",
    "roleMember": "Lid",
    "you": "jij",
    "noName": "Naamloos"
```

In `i18n/locales/fr.json`, zelfde plek:

```json
    "members": "Membres",
    "roleOwner": "Propriétaire",
    "roleMember": "Membre",
    "you": "vous",
    "noName": "Sans nom"
```

- [ ] **Step 2: De sleuteltest draaien**

Run: `npm run test -- locales`

Expected: PASS — drie talen, dezelfde sleutels, geen lege waarden. Faalt hij, dan mist een sleutel in één van de drie bestanden.

- [ ] **Step 3: De composable uitbreiden**

In `app/composables/useHousehold.ts`, direct onder de bestaande `Household`-interface:

```ts
export interface Member {
  userId: string
  displayName: string | null
  role: 'owner' | 'member'
}
```

Binnen `useHousehold()`, naast de bestaande `useState`-regels:

```ts
  const members = useState<Member[]>('householdMembers', () => [])
```

En als nieuwe functie, vóór de `return`:

```ts
  async function loadMembers(householdId: string): Promise<void> {
    const { data: memberRows, error: memberError } = await supabase
      .from('household_member')
      .select('user_id, role')
      .eq('household_id', householdId)
      .order('joined_at')

    if (memberError) throw memberError

    // household_member.user_id en user_profile.user_id wijzen allebei
    // onafhankelijk naar auth.users; er is geen foreign key tussen de twee
    // tabellen onderling. PostgREST kan een geneste select dus niet
    // vertalen (PGRST200), vandaar twee queries die hier worden samengevoegd.
    const userIds = (memberRows ?? []).map((row) => row.user_id)
    const displayNameByUserId = new Map<string, string | null>()

    if (userIds.length > 0) {
      const { data: profileRows, error: profileError } = await supabase
        .from('user_profile')
        .select('user_id, display_name')
        .in('user_id', userIds)

      if (profileError) throw profileError

      for (const row of profileRows ?? []) {
        displayNameByUserId.set(row.user_id, row.display_name)
      }
    }

    members.value = (memberRows ?? []).map((row) => ({
      userId: row.user_id,
      displayName: displayNameByUserId.get(row.user_id) ?? null,
      // role is een tekstkolom met een check-constraint, geen Postgres-enum,
      // dus de gegenereerde types geven `string`. Zelfde cast als bij
      // Household['role'] hierboven.
      role: row.role as Member['role'],
    }))
  }
```

Breid de `return` uit naar:

```ts
  return { households, activeId, members, refresh, setActive, create, loadMembers }
```

- [ ] **Step 4: Het component schrijven**

Create `app/components/HouseholdMembers.vue`:

```vue
<script setup lang="ts">
const props = defineProps<{ householdId: string }>()

const { t } = useI18n()
const user = useSupabaseUser()
const { members, loadMembers } = useHousehold()

const ready = ref(false)
const error = ref('')

async function load() {
  try {
    await loadMembers(props.householdId)
  } catch {
    error.value = t('householdSettings.error')
    return
  }
  error.value = ''
  ready.value = true
}

onMounted(load)
watch(() => props.householdId, load)

// useSupabaseUser() geeft het JWT-payload: het id staat op .sub, niet op .id.
const isSelf = (userId: string) => userId === user.value?.sub
</script>

<template>
  <div>
    <UAlert v-if="error" color="error" :description="error" />
    <UProgress v-else-if="!ready" animation="carousel" />
    <ul v-else class="divide-y divide-default">
      <li v-for="member in members" :key="member.userId" class="flex items-center gap-3 py-2">
        <span class="flex-1">
          {{ member.displayName || t('householdSettings.noName') }}
          <span v-if="isSelf(member.userId)" class="text-muted">({{ t('householdSettings.you') }})</span>
        </span>
        <UBadge :color="member.role === 'owner' ? 'primary' : 'neutral'" variant="subtle">
          {{ member.role === 'owner' ? t('householdSettings.roleOwner') : t('householdSettings.roleMember') }}
        </UBadge>
      </li>
    </ul>
  </div>
</template>
```

- [ ] **Step 5: Het component op de pagina zetten**

In `app/pages/settings/household.vue`, vervang de bestaande `<section>` door twee secties:

```vue
    <section class="mt-8">
      <h2 class="mb-3 font-semibold">{{ t('householdSettings.members') }}</h2>
      <UAlert v-if="failed" color="error" :description="t('householdSettings.error')" />
      <UProgress v-else-if="!ready" animation="carousel" />
      <HouseholdMembers v-else-if="activeId" :household-id="activeId" />
    </section>

    <section class="mt-8">
      <h2 class="mb-3 font-semibold">{{ t('householdSettings.invitations') }}</h2>
      <UAlert v-if="failed" color="error" :description="t('householdSettings.error')" />
      <UProgress v-else-if="!ready" animation="carousel" />
      <HouseholdInvites v-else-if="activeId" :household-id="activeId" />
    </section>
```

- [ ] **Step 6: De e2e-test uitbreiden**

In `e2e/onboarding.spec.ts` staat al een test die beide instellingenpagina's via de navigatie bereikt. Voeg daaronder toe:

```ts
test('de eigenaar staat als lid in de huishoudinstellingen', async ({ page }) => {
  const email = `leden-${Date.now()}@example.com`
  await signIn(page, email)

  await page.goto('/onboarding')
  await waitForHydration(page)
  await page.getByLabel(/naam|name|nom/i).fill('Testhuis')
  await page.getByRole('button', { name: /start|commencer/i }).click()

  await page.goto('/settings/household')
  await expect(page.getByText(/owner/i)).toBeVisible()
})
```

Neem `signIn` en `waitForHydration` mee in de bestaande import uit `./helpers`.

- [ ] **Step 7: De tests draaien**

Run: `npm run test:e2e -- onboarding`

Expected: PASS, inclusief de nieuwe test. Faalt de nieuwe test op de badge, controleer dan of `loadMembers` de rij wel ophaalt — de SELECT-policy op `household_member` staat op `is_household_member`, dus de eigenaar ziet zichzelf.

- [ ] **Step 8: Lint en typecontrole**

Run: `npm run lint && npm run typecheck`

Expected: beide schoon. Draai `npx nuxt prepare` als de gegenereerde types de nieuwe join nog niet kennen.

- [ ] **Step 9: Commit**

```bash
git add app/components/HouseholdMembers.vue app/composables/useHousehold.ts app/pages/settings/household.vue i18n/locales/en.json i18n/locales/nl.json i18n/locales/fr.json e2e/onboarding.spec.ts
git commit -m "feat: ledenlijst in de huishoudinstellingen"
```

---

### Task 2: Promoveren tot eigenaar

Spec §4: *"Een huishouden heeft altijd minstens één `owner`; de laatste kan zichzelf niet verwijderen zonder eerst iemand anders te promoveren."* Die tweede helft bestaat nog niet, waardoor de laatste eigenaar vastzit.

`household_member` heeft bewust geen UPDATE-policy. Dat houden we zo: een `security definer`-RPC bewaakt zelf wie hem mag aanroepen, net als `create_household` en `create_invite`. De trigger `prevent_last_owner_removal` vuurt sinds plan 1 ook op UPDATE en blokkeert het degraderen van de laatste eigenaar — die invariant hoeft deze taak niet opnieuw te regelen, wel te bewijzen dat ze nog geldt.

**Files:**
- Create: `supabase/migrations/<timestamp>_set_member_role.sql`
- Create: `test/db/member-role.test.ts`
- Modify: `app/composables/useHousehold.ts`
- Modify: `app/components/HouseholdMembers.vue`
- Modify: `i18n/locales/en.json`, `i18n/locales/nl.json`, `i18n/locales/fr.json`

**Interfaces:**
- Consumes: `is_household_owner(uuid)` (bestaand, `security definer`, `stable`); `Member` en `loadMembers` uit taak 1.
- Produces: SQL `set_member_role(target_household uuid, target_user uuid, new_role text) returns void`, en `useHousehold().setRole(householdId: string, userId: string, role: 'owner' | 'member'): Promise<void>`.

- [ ] **Step 1: De falende tests schrijven**

Create `test/db/member-role.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('rollen wijzigen', () => {
  beforeEach(resetDb)

  it('een eigenaar kan een lid tot eigenaar promoveren', async () => {
    const owner = await createUser('promo-eigenaar@example.com')
    const member = await createUser('promo-lid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${member})`

      await enableRls(tx)
      await tx`select set_member_role(${id}::uuid, ${member}::uuid, 'owner')`

      await tx`reset role`
      const [row] = await tx<{ role: string }[]>`
        select role from household_member where household_id = ${id} and user_id = ${member}
      `
      expect(row!.role).toBe('owner')
    })
  })

  it('een gewoon lid kan zichzelf niet promoveren', async () => {
    const owner = await createUser('geen-promo-eigenaar@example.com')
    const member = await createUser('geen-promo-lid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${member})`

      await actAs(tx, member)
      await enableRls(tx)
      // Savepoint isoleert de mislukte oproep: zie create-household.test.ts.
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${member}::uuid, 'owner')`),
      ).rejects.toThrow()
    })
  })

  it('een buitenstaander kan niemand promoveren', async () => {
    const owner = await createUser('vreemde-eigenaar@example.com')
    const outsider = await createUser('vreemde@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household

      await actAs(tx, outsider)
      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${outsider}::uuid, 'owner')`),
      ).rejects.toThrow()
    })
  })

  it('weigert een onbekende rol', async () => {
    const owner = await createUser('rol-eigenaar@example.com')
    const member = await createUser('rol-lid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${member})`

      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${member}::uuid, 'moderator')`),
      ).rejects.toThrow()
    })
  })

  it('weigert iemand die geen lid is', async () => {
    const owner = await createUser('nietlid-eigenaar@example.com')
    const stranger = await createUser('nietlid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household

      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${stranger}::uuid, 'owner')`),
      ).rejects.toThrow()
    })
  })

  it('de laatste eigenaar blijft beschermd tegen degraderen', async () => {
    const owner = await createUser('laatste-degradatie@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household

      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${owner}::uuid, 'member')`),
      ).rejects.toThrow()
    })
  })

  // Dit is de eigenlijke belofte uit spec §4: de laatste eigenaar zit niet
  // vast, maar moet eerst iemand anders promoveren.
  it('een eigenaar kan vertrekken nadat hij iemand anders heeft gepromoveerd', async () => {
    const first = await createUser('vertrek-eerste@example.com')
    const second = await createUser('vertrek-tweede@example.com')

    await withTx(async (tx) => {
      await actAs(tx, first)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${second})`

      await enableRls(tx)
      await tx`select set_member_role(${id}::uuid, ${second}::uuid, 'owner')`

      const left = await tx`
        delete from household_member where household_id = ${id} and user_id = ${first} returning user_id
      `
      expect(left.length).toBe(1)

      await tx`reset role`
      const [count] = await tx<{ n: number }[]>`
        select count(*)::int as n from household_member where household_id = ${id} and role = 'owner'
      `
      expect(count!.n).toBe(1)
    })
  })

  it('anon mag set_member_role niet aanroepen', async () => {
    await withTx(async (tx) => {
      await enableRls(tx, 'anon')
      await expect(
        tx.savepoint(
          (sp) => sp`select set_member_role(gen_random_uuid(), gen_random_uuid(), 'owner')`,
        ),
      ).rejects.toThrow()
    })
  })
})
```

- [ ] **Step 2: De tests draaien en zien dat ze falen**

Run: `npm run test:db -- member-role`

Expected: FAIL — alle acht, met `function set_member_role(uuid, uuid, text) does not exist`. Faalt er één met een andere melding, lees die eerst: dan klopt de testopzet niet, en niet de ontbrekende functie.

- [ ] **Step 3: De migratie schrijven**

Bepaal eerst de timestamp: `ls supabase/migrations | tail -1` en kies een latere in het formaat `YYYYMMDDHHMMSS`.

Create `supabase/migrations/<timestamp>_set_member_role.sql`:

```sql
-- Spec §4: een huishouden houdt altijd minstens één eigenaar, en de laatste
-- eigenaar kan pas weg nadat hij iemand anders heeft gepromoveerd. Die tweede
-- helft ontbrak, waardoor de laatste eigenaar vastzat in zijn huishouden.
--
-- Bewust een RPC en geen UPDATE-policy op household_member. Een policy zou de
-- tabel voor elke ingelogde gebruiker schrijfbaar maken en de bewaking over
-- twee plaatsen verdelen; deze functie houdt de regel op één plek. Dezelfde
-- vorm als create_household(), create_invite() en accept_invite().
--
-- security definer is hier nodig: er is geen UPDATE-policy, dus een
-- invoker-functie zou nul rijen raken en stil slagen.
create function set_member_role(target_household uuid, target_user uuid, new_role text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'niet ingelogd';
  end if;

  if new_role not in ('owner', 'member') then
    raise exception 'onbekende rol';
  end if;

  if not is_household_owner(target_household) then
    raise exception 'alleen een eigenaar mag rollen wijzigen';
  end if;

  update household_member
     set role = new_role
   where household_id = target_household and user_id = target_user;

  -- Zonder deze controle slaagt een oproep op iemand die geen lid is stil.
  -- De trigger prevent_last_owner_removal bewaakt het andere uiteinde: het
  -- degraderen van de laatste eigenaar wordt daar geweigerd.
  if not found then
    raise exception 'die persoon is geen lid van dit huishouden';
  end if;
end;
$$;

-- Supabase geeft nieuwe functies een execute-grant aan anon via de
-- PUBLIC-pseudorol én rechtstreeks. `revoke ... from public` alleen laat die
-- directe grant intact, dus anon moet expliciet genoemd worden.
revoke all on function set_member_role(uuid, uuid, text) from public, anon;
grant execute on function set_member_role(uuid, uuid, text) to authenticated;
```

- [ ] **Step 4: De database opnieuw opbouwen en de tests draaien**

Run: `npx supabase db reset && npm run test:db -- member-role`

Expected: PASS, acht tests.

- [ ] **Step 5: Committen wat er nu staat**

Committen gebeurt vóór de falsificatie, niet erna. De volgende stap haalt tijdelijk regels uit het migratiebestand en zet ze daarna terug met `git checkout` — en dat werkt alleen op een bestand dat git al kent. Zou je pas na de falsificatie committen, dan is het bestand op dat moment nog untracked en faalt het herstel.

```bash
git add supabase/migrations/<timestamp>_set_member_role.sql test/db/member-role.test.ts
git commit -m "feat: set_member_role om iemand tot eigenaar te promoveren"
```

- [ ] **Step 6: De bescherming falsifiëren**

Dit is verplicht (zie Global Constraints). Haal de eigenaarscontrole tijdelijk weg en stel vast dat de suite dat merkt.

Verwijder in het migratiebestand deze drie regels:

```sql
  if not is_household_owner(target_household) then
    raise exception 'alleen een eigenaar mag rollen wijzigen';
  end if;
```

Dan:

```bash
npx supabase db reset
npm run test:db -- member-role
```

Expected: FAIL op `een gewoon lid kan zichzelf niet promoveren` én `een buitenstaander kan niemand promoveren`. Blijft één van die twee groen, dan test hij niet wat hij beweert — repareer de test vóór je verdergaat, en commit die reparatie.

Herstellen:

```bash
git checkout supabase/migrations/<timestamp>_set_member_role.sql
npx supabase db reset
npm run test:db
```

Doe hetzelfde nog een keer voor de `not found`-controle: haal die drie regels weg, draai de tests, stel vast dat `weigert iemand die geen lid is` rood wordt, en herstel op dezelfde manier.

Controleer daarna met `git status` dat de werkboom schoon is: de falsificatie mag geen spoor achterlaten.

Noteer in het taakrapport welke tests bij welke verwijdering rood werden.

- [ ] **Step 7: De vertaalsleutels toevoegen**

In `householdSettings` van `i18n/locales/en.json`:

```json
    "makeOwner": "Make owner"
```

`nl.json`:

```json
    "makeOwner": "Tot eigenaar maken"
```

`fr.json`:

```json
    "makeOwner": "Nommer propriétaire"
```

- [ ] **Step 8: De composable uitbreiden**

In `app/composables/useHousehold.ts`, naast `loadMembers`:

```ts
  async function setRole(householdId: string, userId: string, role: Member['role']): Promise<void> {
    const { error } = await supabase.rpc('set_member_role', {
      target_household: householdId,
      target_user: userId,
      new_role: role,
    })
    if (error) throw error
    await loadMembers(householdId)
  }
```

En voeg `setRole` toe aan de `return`.

- [ ] **Step 9: De knop in het component**

In `app/components/HouseholdMembers.vue`, vervang de regel `const { members, loadMembers } = useHousehold()` door:

```ts
const { members, loadMembers, setRole } = useHousehold()

const busy = ref('')

const amOwner = computed(() =>
  members.value.some((m) => m.userId === user.value?.sub && m.role === 'owner'),
)

async function changeRole(userId: string, role: 'owner' | 'member') {
  busy.value = userId
  try {
    await setRole(props.householdId, userId, role)
    error.value = ''
  } catch {
    error.value = t('householdSettings.error')
  } finally {
    busy.value = ''
  }
}
```

En in de `<li>`, ná de `UBadge`:

```vue
        <UButton
          v-if="amOwner && member.role === 'member'"
          size="xs"
          variant="ghost"
          :loading="busy === member.userId"
          @click="changeRole(member.userId, 'owner')"
        >
          {{ t('householdSettings.makeOwner') }}
        </UButton>
```

- [ ] **Step 10: Controles draaien**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:e2e -- onboarding`

Expected: alles groen.

- [ ] **Step 11: Commit**

```bash
git add app/composables/useHousehold.ts app/components/HouseholdMembers.vue i18n/locales/en.json i18n/locales/nl.json i18n/locales/fr.json
git commit -m "feat: een eigenaar kan een lid tot eigenaar promoveren"
```

---

### Task 3: Een lid uit het huishouden verwijderen

Spec §4: een `owner` mag *"leden verwijderen"*. De DELETE-policy bestaat al sinds plan 1 (`eigenaars mogen leden verwijderen`, `using (is_household_owner(household_id) or user_id = auth.uid())`) en `test/db/household.test.ts` dekt al dat een gewoon lid dat niet mag. Wat ontbreekt is de knop. Geen migratie nodig.

**Files:**
- Modify: `app/composables/useHousehold.ts`
- Modify: `app/components/HouseholdMembers.vue`
- Modify: `i18n/locales/en.json`, `i18n/locales/nl.json`, `i18n/locales/fr.json`
- Test: `test/db/member-role.test.ts`

**Interfaces:**
- Consumes: `Member`, `loadMembers`, `setRole` uit taken 1 en 2.
- Produces: `useHousehold().removeMember(householdId: string, userId: string): Promise<void>`.

- [ ] **Step 1: De falende test schrijven**

Voeg aan `test/db/member-role.test.ts` toe, binnen hetzelfde `describe`:

```ts
  it('een eigenaar kan een lid verwijderen', async () => {
    const owner = await createUser('verwijder-eigenaar@example.com')
    const member = await createUser('verwijder-lid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${member})`

      await enableRls(tx)
      const removed = await tx`
        delete from household_member
        where household_id = ${id} and user_id = ${member}
        returning user_id
      `
      expect(removed.length).toBe(1)
    })
  })
```

- [ ] **Step 2: De test draaien**

Run: `npm run test:db -- member-role`

Expected: PASS. Deze test dekt bestaande werking die nog niet was afgedekt — hij hoort meteen groen te zijn. Faalt hij, dan klopt de DELETE-policy niet en stop je hier.

- [ ] **Step 3: De bescherming falsifiëren**

Een test die nooit rood kan worden, bewijst niets. Haal de DELETE-policy tijdelijk weg en stel vast dat deze test het merkt.

Zet in `supabase/migrations/20260922105658_household.sql` deze policy in commentaar door `-- ` voor elke regel te zetten:

```sql
create policy "eigenaars mogen leden verwijderen"
  on household_member for delete
  using (is_household_owner(household_id) or user_id = auth.uid());
```

Dan:

```bash
npx supabase db reset
npm run test:db -- member-role
```

Expected: FAIL op `een eigenaar kan een lid verwijderen` — nul rijen verwijderd in plaats van één. Andere tests die op deze policy steunen vallen mee om; dat hoort erbij en laat zien hoeveel eraan hangt.

Herstellen:

```bash
git checkout supabase/migrations/20260922105658_household.sql
npx supabase db reset
npm run test:db
```

Dit is de enige situatie waarin een bestaand migratiebestand aangeraakt wordt. De wijziging wordt nooit gecommit; `git checkout` zet hem terug. Controleer met `git status` dat de map schoon is voordat je verdergaat.

- [ ] **Step 4: De vertaalsleutels toevoegen**

In `householdSettings` van `i18n/locales/en.json`:

```json
    "removeMember": "Remove",
    "cannotRemoveLastOwner": "A household needs at least one owner. Make someone else owner first."
```

`nl.json`:

```json
    "removeMember": "Verwijderen",
    "cannotRemoveLastOwner": "Een huishouden heeft minstens één eigenaar nodig. Maak eerst iemand anders eigenaar."
```

`fr.json`:

```json
    "removeMember": "Retirer",
    "cannotRemoveLastOwner": "Un ménage doit garder au moins un propriétaire. Nommez d'abord quelqu'un d'autre."
```

- [ ] **Step 5: De composable uitbreiden**

In `app/composables/useHousehold.ts`, naast `setRole`:

```ts
  async function removeMember(householdId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('household_member')
      .delete()
      .eq('household_id', householdId)
      .eq('user_id', userId)
    if (error) throw error
    await loadMembers(householdId)
  }
```

En voeg `removeMember` toe aan de `return`.

- [ ] **Step 6: De knop in het component**

In `app/components/HouseholdMembers.vue`, breid de destructurering uit naar
`const { members, loadMembers, setRole, removeMember } = useHousehold()` en voeg toe:

```ts
async function remove(userId: string) {
  busy.value = userId
  try {
    await removeMember(props.householdId, userId)
    error.value = ''
  } catch (cause) {
    // De trigger prevent_last_owner_removal weigert het verwijderen van de
    // laatste eigenaar. Dat is geen storing maar een regel, dus die krijgt
    // een eigen melding in plaats van de algemene foutmelding.
    const message = cause instanceof Error ? cause.message : ''
    error.value = message.includes('minstens één eigenaar')
      ? t('householdSettings.cannotRemoveLastOwner')
      : t('householdSettings.error')
  } finally {
    busy.value = ''
  }
}
```

En in de `<li>`, ná de promoveerknop:

```vue
        <UButton
          v-if="amOwner"
          size="xs"
          color="error"
          variant="ghost"
          :loading="busy === member.userId"
          @click="remove(member.userId)"
        >
          {{ t('householdSettings.removeMember') }}
        </UButton>
```

- [ ] **Step 7: Controleren dat de foutmelding echt aankomt**

De melding uit de trigger moet de client bereiken als `error.message`. Controleer dat met de hand: log in, maak een huishouden, ga naar `/settings/household` en klik op Verwijderen bij jezelf als enige eigenaar. Verwacht: de zin uit `cannotRemoveLastOwner`, niet de algemene foutmelding.

Komt de algemene melding tevoorschijn, dan staat de tekst van de trigger elders in het foutobject (bijvoorbeeld in `details` of `hint`). Log in dat geval het volledige object één keer, stel de juiste eigenschap vast, en pas de controle daarop aan. Raad niet.

- [ ] **Step 8: Controles draaien**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:db`

Expected: alles groen.

- [ ] **Step 9: Commit**

```bash
git add app/composables/useHousehold.ts app/components/HouseholdMembers.vue i18n/locales/en.json i18n/locales/nl.json i18n/locales/fr.json test/db/member-role.test.ts
git commit -m "feat: een eigenaar kan een lid uit het huishouden verwijderen"
```

---

### Task 4: De gelijktijdigheidstest op de uitnodigingsteller

`accept_invite()` leest de uitnodiging met `select ... for update` en verhoogt daarna `uses`. Die vergrendeling is nooit getest: plan 1 bevestigde de logica door inspectie. Deze taak test wat er gebeurt als twee mensen tegelijk de laatste plek van een uitnodiging pakken.

Dat kan niet binnen één transactie — twee gelijktijdige transacties hebben elk hun eigen verbinding nodig.

**Files:**
- Modify: `test/db/helpers.ts`
- Modify: `test/db/household-invite.test.ts`

**Interfaces:**
- Consumes: bestaande `withDb`, `createUser`, `resetDb` uit `test/db/helpers.ts`; SQL `accept_invite(text)` en `create_invite(uuid, int, int)`.
- Produces: `withTwoConnections(fn: (a: Sql, b: Sql) => Promise<void>): Promise<void>` in `test/db/helpers.ts`.

- [ ] **Step 1: De helper schrijven**

Voeg onderaan `test/db/helpers.ts` toe:

```ts
/**
 * Draait fn met twee losse verbindingen.
 *
 * Gelijktijdigheid is binnen één verbinding niet na te bootsen: postgres.js
 * stuurt queries op dezelfde verbinding na elkaar, en twee transacties die
 * elkaar moeten blokkeren hebben per definitie twee sessies nodig.
 */
export async function withTwoConnections(
  fn: (a: Sql, b: Sql) => Promise<void>,
): Promise<void> {
  const a = postgres(url!, { max: 1 })
  const b = postgres(url!, { max: 1 })
  try {
    await fn(a, b)
  } finally {
    await a.end()
    await b.end()
  }
}
```

- [ ] **Step 2: De falende test schrijven**

Voeg aan `test/db/household-invite.test.ts` toe, binnen het bestaande `describe`. Breid eerst de import uit met `withDb` en `withTwoConnections`:

```ts
  // De uitnodiging heeft nog één plek. Twee mensen accepteren tegelijk; de
  // `select ... for update` in accept_invite hoort ervoor te zorgen dat er
  // precies één binnenkomt. Dat is tot nu toe alleen door inspectie
  // vastgesteld, nooit gemeten.
  it('twee gelijktijdige acceptaties gebruiken de laatste plek maar één keer', async () => {
    const owner = await createUser('gelijktijdig-eigenaar@example.com')
    const first = await createUser('gelijktijdig-een@example.com')
    const second = await createUser('gelijktijdig-twee@example.com')

    let token = ''
    let householdId = ''
    await withDb(async (sql) => {
      await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claim.sub', ${owner}, true)`
        const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
        householdId = hh!.create_household
        const [inv] = await tx<{ create_invite: string }[]>`
          select create_invite(${householdId}::uuid, 7, 1)
        `
        token = inv!.create_invite
      })
    })

    await withTwoConnections(async (a, b) => {
      let bRun: Promise<unknown> | undefined

      await a.begin(async (txA) => {
        await txA`select set_config('request.jwt.claim.sub', ${first}, true)`
        await txA`select accept_invite(${token})`

        // A houdt nu de rijvergrendeling uit accept_invite's `for update`.
        // B start hier en moet blijven hangen tot A commit.
        bRun = b.begin(async (txB) => {
          await txB`select set_config('request.jwt.claim.sub', ${second}, true)`
          await txB`select accept_invite(${token})`
        })

        // Zonder deze pauze begint B pas ná de commit van A en meet de test
        // geen gelijktijdigheid meer — dan zou hij ook groen zijn met een
        // accept_invite zonder vergrendeling.
        await new Promise((resolve) => setTimeout(resolve, 200))
      })

      const [outcome] = await Promise.allSettled([bRun!])
      expect(outcome!.status).toBe('rejected')
    })

    await withDb(async (sql) => {
      const [invite] = await sql<{ uses: number }[]>`
        select uses from household_invite where token = ${token}
      `
      expect(invite!.uses).toBe(1)

      const [members] = await sql<{ n: number }[]>`
        select count(*)::int as n from household_member where household_id = ${householdId}
      `
      // de eigenaar plus precies één van de twee gelijktijdige gebruikers
      expect(members!.n).toBe(2)
    })
  })
```

- [ ] **Step 3: De test draaien**

Run: `npm run test:db -- invite`

Expected: PASS. De vergrendeling bestaat al, dus deze test hoort meteen groen te zijn.

Loopt hij vast in plaats van te falen, dan blokkeert B op de vergrendeling terwijl A nooit commit — controleer dan of de `a.begin`-callback wel terugkeert (de commit gebeurt pas als de callback klaar is).

- [ ] **Step 4: De vergrendeling falsifiëren**

Verwijder tijdelijk de vergrendeling. In `supabase/migrations/20260922115723_household_invite.sql` staat in `accept_invite()` deze regel:

```sql
  select * into inv from household_invite where token = invite_token for update;
```

Haal daar `for update` weg, zodat er staat:

```sql
  select * into inv from household_invite where token = invite_token;
```

Dan:

```bash
npx supabase db reset
npm run test:db -- invite
```

Expected: FAIL. Zonder de vergrendeling leest B de uitnodiging met `uses = 0` uit zijn eigen snapshot, komt langs de controle, en voegt zichzelf ook toe: `uses` wordt 2 en het huishouden heeft drie leden.

Blijft de test groen, dan meet hij geen gelijktijdigheid — verhoog de pauze in stap 2 en probeer opnieuw voordat je concludeert dat alles in orde is.

Herstellen:

```bash
git checkout supabase/migrations/20260922115723_household_invite.sql
npx supabase db reset
npm run test:db
```

- [ ] **Step 5: Commit**

```bash
git add test/db/helpers.ts test/db/household-invite.test.ts
git commit -m "test: gelijktijdige acceptatie van de laatste uitnodigingsplek"
```

---

### Task 5: De inlogflow onder /nl en /fr

Drietaligheid is een kernbelofte, maar alleen `/en` wordt end-to-end gelopen. De `signIn`-helper gebruikt bovendien regex-selectors (`getByLabel(/email/i)`, `getByRole('button', { name: /link/i })`) die alleen werken doordat de Engelse teksten toevallig die woorden bevatten — onder `/nl` matcht `/email/i` de Nederlandse tekst "E-mailadres" niet eens, want daar staat een koppelteken tussen.

De oplossing is niet een ruimere regex maar de echte vertaling: de helper leest dezelfde JSON-bestanden als de app. Daarmee test de suite meteen dat de vertalingen ook werkelijk op het scherm staan.

**Files:**
- Modify: `e2e/helpers.ts`
- Create: `e2e/locales.spec.ts`

**Interfaces:**
- Consumes: `i18n/locales/{en,nl,fr}.json`.
- Produces: `type Locale = 'en' | 'nl' | 'fr'`, `prefix(locale: Locale): string`, en `signIn(page, email, locale?: Locale)` — de bestaande aanroepen met twee argumenten blijven werken doordat `locale` standaard `'en'` is.

- [ ] **Step 1: De helper taalonafhankelijk maken**

Bovenaan `e2e/helpers.ts`, onder de bestaande import:

```ts
import en from '../i18n/locales/en.json'
import nl from '../i18n/locales/nl.json'
import fr from '../i18n/locales/fr.json'

const bundles = { en, nl, fr }

export type Locale = keyof typeof bundles

// nuxt.config.ts gebruikt strategy 'prefix_except_default' met defaultLocale
// 'en': /login voor Engels, /nl/login en /fr/login voor de rest.
export function prefix(locale: Locale): string {
  return locale === 'en' ? '' : `/${locale}`
}
```

Vervang daarna de body van `signIn`:

```ts
export async function signIn(
  page: import('@playwright/test').Page,
  email: string,
  locale: Locale = 'en',
) {
  const t = bundles[locale]

  await page.goto(`${prefix(locale)}/login`)
  await waitForHydration(page)
  // De echte vertaling in plaats van een regex: zo breekt deze helper niet
  // stil op een taal waarin het woord "email" er anders uitziet, en toont
  // hij meteen aan dat de vertaling ook werkelijk gerenderd wordt.
  await page.getByLabel(t.auth.email).fill(email)
  await page.getByRole('button', { name: t.auth.sendLink }).click()
  await expect(page.getByText(t.auth.linkSent)).toBeVisible()

  const link = await readLatestMagicLink(email)
  await page.goto(link)
  // confirm.vue stuurt pas door zodra de Supabase-client de sessie herkent.
  // `includes` en niet `startsWith`: onder /nl en /fr staat de taalprefix
  // vóór /confirm.
  await page.waitForURL((current) => !current.pathname.includes('/confirm'))
}
```

- [ ] **Step 2: Controleren dat de bestaande specs blijven werken**

Run: `npm run test:e2e`

Expected: alle bestaande tests groen. `locale` heeft een standaardwaarde, dus de aanroepen met twee argumenten in `onboarding.spec.ts` en `invite.spec.ts` blijven kloppen.

Klaagt TypeScript over het importeren van JSON, zet dan `"resolveJsonModule": true` in `tsconfig.json` — Nuxt zet dat normaal al voor je.

- [ ] **Step 3: De nieuwe spec schrijven**

Create `e2e/locales.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { signIn, prefix, type Locale } from './helpers'

// De drie talen zijn een kernbelofte van de app, maar tot nu toe liep alleen
// /en end-to-end. Deze twee tests lopen dezelfde flow onder de andere twee.
const locales: Locale[] = ['nl', 'fr']

for (const locale of locales) {
  test(`de inlogflow werkt onder /${locale}`, async ({ page }) => {
    const email = `${locale}-${Date.now()}@example.com`

    await signIn(page, email, locale)

    // Na het inloggen zonder huishouden komt de gebruiker op onboarding uit,
    // en de taalprefix hoort onderweg niet verloren te gaan.
    await expect(page).toHaveURL(new RegExp(`${prefix(locale)}/`))
    await expect(page).not.toHaveURL(/\/confirm/)
  })
}
```

- [ ] **Step 4: De nieuwe spec draaien**

Run: `npm run test:e2e -- locales`

Expected: twee tests groen.

Faalt er een op `getByLabel`, controleer dan of de vertaalsleutel in dat taalbestand echt de tekst is die het label toont — `t.auth.email` moet letterlijk overeenkomen met wat `login.vue` rendert.

- [ ] **Step 5: De taalprefix falsifiëren**

Controleer dat deze tests echt iets bewaken. Verander in `e2e/helpers.ts` de functie `prefix` tijdelijk in `return ''` (altijd Engels):

Run: `npm run test:e2e -- locales`

Expected: FAIL — beide tests. Ze vallen om op `getByLabel`: zonder prefix rendert de app in het Engels, en het Nederlandse respectievelijk Franse label staat er dan niet. De URL-assertie merkt het niet, want met `prefix()` leeg wordt de reguliere expressie `/` en die matcht alles. Blijft een test groen, dan controleert hij de taal helemaal niet en moet de assertie scherper.

Herstellen: zet `prefix` met de hand terug op de vorm uit stap 1. Niet `git checkout` gebruiken — de rest van stap 1 staat nog niet in git en zou daarmee verdwijnen.

- [ ] **Step 6: Commit**

```bash
git add e2e/helpers.ts e2e/locales.spec.ts
git commit -m "test: inlogflow onder /nl en /fr, met vertalingen als selector"
```

---

### Task 6: De hydratiewacht eerlijk maken

`waitForHydration` in `e2e/helpers.ts` wacht tot `'__vueParentComponent' in button`. Twee bezwaren uit de bevindingenlijst: het commentaar erboven beschrijft het hydratiemechanisme onjuist, en `__vueParentComponent` is een ongedocumenteerde Vue-interne die bij een majorupgrade stil kan verdwijnen.

Er is geen publieke API die dit vervangt. De eerlijke oplossing is dus niet doen alsof, maar: het commentaar kloppend maken op basis van waarneming, en de wacht luid laten falen met een melding die de volgende lezer meteen naar de oorzaak wijst.

**Files:**
- Modify: `e2e/helpers.ts`

**Interfaces:**
- Consumes: niets nieuws.
- Produces: ongewijzigde signatuur `waitForHydration(page): Promise<void>`.

- [ ] **Step 1: Vaststellen wat er echt gebeurt**

Niet redeneren maar meten. Vervang de body van `waitForHydration` tijdelijk door `return` (geen wacht), en draai:

Run: `npm run test:e2e -- onboarding`

Noteer letterlijk wat er misgaat: de foutmelding, en of de browser naar een URL met de formuliervelden als querystring springt. Dat laatste is het teken van een kale HTML-submit omdat `@submit.prevent` nog niet is aangesloten.

Zet de body daarna terug.

- [ ] **Step 2: Controleren of de interne er nog is**

Run:

```bash
node --input-type=module -e "console.log(Object.keys(await import('vue')).filter((k) => k.toLowerCase().includes('hydrat')))"
```

Dit laat zien welke hydratie-gerelateerde exports Vue publiek aanbiedt. Is er niets bruikbaars — en dat is vandaag zo — dan blijft de interne de enige optie, en dat hoort het commentaar te zeggen.

- [ ] **Step 3: De helper herschrijven**

Vervang in `e2e/helpers.ts` het commentaar en de functie `waitForHydration` door:

```ts
// Nuxt dev serveert ongebundeld, dus Vue hydrateert merkbaar later dan
// 'load'. Klik je daarvóór op een submit-knop, dan is @submit.prevent nog
// niet aangesloten en doet de browser een kale HTML-submit: de pagina laadt
// opnieuw met de velden in de querystring, en de test loopt vast op een
// scherm dat er bijna goed uitziet.
//
// Er is geen publieke API die zegt "deze knop is gehydrateerd".
// __vueParentComponent is een ongedocumenteerde Vue-interne: runtime-dom
// hangt hem aan een element zodra de component eraan gekoppeld is. Dat is
// bewust een koppeling aan een implementatiedetail, omdat het alternatief
// (een vaste pauze) traag én onbetrouwbaar is.
//
// Verdwijnt de eigenschap bij een Vue-majorupgrade, dan valt deze functie om
// in een timeout. De melding hieronder zorgt dat de volgende lezer niet gaat
// zoeken in de applicatie maar hier uitkomt.
export async function waitForHydration(page: import('@playwright/test').Page) {
  try {
    await page.waitForFunction(() => {
      const button = document.querySelector('button[type="submit"]')
      return !!button && '__vueParentComponent' in button
    })
  } catch (cause) {
    throw new Error(
      'Hydratie niet waargenomen binnen de timeout. Deze wacht steunt op de ' +
        'Vue-interne __vueParentComponent; is Vue geüpgraded, controleer dan ' +
        'of die eigenschap nog bestaat (zie e2e/helpers.ts).',
      { cause },
    )
  }
}
```

- [ ] **Step 4: De tests draaien**

Run: `npm run test:e2e`

Expected: alles groen, negen bestaande tests plus wat taken 1 en 5 hebben toegevoegd.

- [ ] **Step 5: De melding controleren**

Verander de gezochte eigenschap tijdelijk in `'__ditBestaatNiet' in button` en draai `npm run test:e2e -- login`.

Expected: de test faalt met de nieuwe melding over `__vueParentComponent`, niet met een kale Playwright-timeout. Zet de eigenschap daarna terug.

- [ ] **Step 6: Commit**

```bash
git add e2e/helpers.ts
git commit -m "test: hydratiewacht eerlijk documenteren en luid laten falen"
```

---

### Task 7: De laatste kleine bevindingen

Drie losse punten uit `docs/superpowers/open-bevindingen.md` die geen eigen taak verdienen, plus het bijwerken van die lijst zelf.

**Files:**
- Modify: `test/db/helpers.ts`
- Create: `app/composables/useRedirectWhenSignedIn.ts`
- Modify: `app/pages/index.vue`, `app/pages/confirm.vue`
- Modify: `README.md`
- Modify: `docs/superpowers/open-bevindingen.md`

**Interfaces:**
- Produces: `useRedirectWhenSignedIn(target: MaybeRefOrGetter<string>): void`.

- [ ] **Step 1: Het stille .env-probleem wegnemen**

In `test/db/helpers.ts` staat bovenaan een lege `catch` rond `process.loadEnvFile()`. Die maakt geen onderscheid tussen "er is geen `.env`" (legitiem in CI, waar de variabelen uit de omgeving komen) en "er is er wel een maar hij is stuk". Vervang het blok door:

```ts
try {
  process.loadEnvFile()
} catch (cause) {
  // ENOENT betekent: er is geen .env. Dat is normaal in CI, waar de
  // variabelen rechtstreeks in de omgeving staan. Elke andere fout betekent
  // dat er wél een bestand is maar dat het niet te lezen valt — dat stil
  // inslikken kost later uren zoeken naar een variabele die er wel lijkt te
  // staan.
  if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw new Error('.env bestaat maar is niet te lezen', { cause })
  }
}
```

Doe dezelfde vervanging in `playwright.config.ts`, waar hetzelfde patroon staat.

- [ ] **Step 2: Controleren dat CI-gedrag ongewijzigd blijft**

Hernoem `.env` tijdelijk en draai de databasetests:

```bash
mv .env .env.tmp
npm run test:db
mv .env.tmp .env
```

Expected: de suite faalt met de duidelijke melding `DATABASE_URL ontbreekt; kopieer .env.example naar .env` — niet met een fout over een onleesbaar bestand. Dat bewijst dat het ontbrekende bestand nog steeds de zachte weg volgt.

Zet `.env` gegarandeerd terug, ook als het commando faalt.

- [ ] **Step 3: De gedeelde composable schrijven**

`app/pages/index.vue` en `app/pages/confirm.vue` hebben allebei dezelfde `watch(user, ...)` met `{ immediate: true }`. Create `app/composables/useRedirectWhenSignedIn.ts`:

```ts
/**
 * Stuurt een ingelogde bezoeker weg van een pagina die alleen voor
 * uitgelogde bezoekers zin heeft.
 *
 * `immediate: true` is essentieel: useSupabaseUser() heeft bij het opzetten
 * van de watcher meestal al een waarde, en zonder deze vlag vuurt de watcher
 * dan nooit.
 */
export function useRedirectWhenSignedIn(target: MaybeRefOrGetter<string>): void {
  const user = useSupabaseUser()

  watch(
    user,
    (value) => {
      if (value) navigateTo(toValue(target))
    },
    { immediate: true },
  )
}
```

- [ ] **Step 4: Beide pagina's erop zetten**

Vervang in `app/pages/index.vue` het `<script setup>`-blok door:

```ts
const { t } = useI18n()
const localePath = useLocalePath()

// Dagelijkse gebruikers horen de uitlegpagina niet elke keer te zien.
useRedirectWhenSignedIn(localePath('/app'))
```

Vervang in `app/pages/confirm.vue` het `<script setup>`-blok door:

```ts
const route = useRoute()
const localePath = useLocalePath()

// Zelfde controle als in login.vue (app/utils/safe-redirect.ts): een
// query-parameter is invoer van buiten, ook als hij van onze eigen
// inlogpagina lijkt te komen.
const target = computed(() => safeInternalPath(route.query.redirect) ?? localePath('/app'))

useRedirectWhenSignedIn(target)
```

- [ ] **Step 5: De tests draaien**

Run: `npm run test:e2e`

Expected: alles groen. `e2e/invite.spec.ts` bevat al een test dat een externe redirect genegeerd wordt — die dekt het gedrag dat hier verhuist en moet dus blijven werken.

- [ ] **Step 6: De versievariabele documenteren**

De gedeployde worker rapporteert versie `dev` omdat `NUXT_PUBLIC_APP_VERSION` in productie niet gezet is. `nuxt.config.ts` heeft de fallback al. Wat ontbreekt is dat iemand weet dat hij de variabele moet zetten.

Voeg in `README.md`, in de sectie over de deploy-variabelen, toe:

```markdown
`NUXT_PUBLIC_APP_VERSION` is optioneel maar hoort bij een echte deploy gezet te
worden, bijvoorbeeld op de commit-SHA. Zonder die variabele valt
`nuxt.config.ts` terug op de letterlijke waarde `dev`, en dan rapporteert
`/api/health` versie `dev` in productie — misleidend zodra er meer dan één
versie tegelijk draait.
```

- [ ] **Step 7: De bevindingenlijst bijwerken**

Haal uit `docs/superpowers/open-bevindingen.md` de regels weg die dit plan heeft opgelost: de promoveer-route, de e2e-dekking onder `/nl` en `/fr`, de gelijktijdigheidstest, de `signIn`-selectors, de `waitForFunction`-toelichting, de `__vueParentComponent`-koppeling, de lege `catch` rond `loadEnvFile`, de gedupliceerde watch, en `NUXT_PUBLIC_APP_VERSION`.

Wat blijft staan: de Workers-validatie (geblokkeerd tot er een gehost Supabase-project is), accountverwijdering voor enige eigenaars (plan 8), en `unrs-resolver` in `allowScripts` (een keuze van de eigenaar).

Werk ook de regel `Laatst gecontroleerd tegen de code op ...` bij naar de datum van vandaag.

- [ ] **Step 8: Alle controles draaien**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:db && npm run test:e2e`

Expected: vijf keer groen.

- [ ] **Step 9: Commit**

```bash
git add test/db/helpers.ts playwright.config.ts app/composables/useRedirectWhenSignedIn.ts app/pages/index.vue app/pages/confirm.vue README.md docs/superpowers/open-bevindingen.md
git commit -m "chore: laatste kleine bevindingen uit plan 1 opruimen"
```

---

## Na afloop

Het fundament is dan af in de zin dat spec §4 volledig is geïmplementeerd en elke bewaking een test heeft die aantoonbaar kan falen. Wat daarna nog openstaat is niet klein maar geblokkeerd of bewust uitgesteld:

- **De Workers-runtime is sinds taak 1 van plan 1 niet meer gevalideerd.** Dat kan pas als er een gehost Supabase-project in Frankfurt staat; nu deployen levert een worker op die naar een laptop wijst.
- **Accountverwijdering voor enige eigenaars** hoort bij de AVG-flow van plan 8, die het huishouden eerst opheft.

Daarna is de catalogus (`product` en `product_alias`) aan de beurt: het hart van de gedeelde inspanning, en de voorwaarde voor bonnen en voorraad.
