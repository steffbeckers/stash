<script setup lang="ts">
import { localeCodes } from '~~/routes.config'

const { t, locale } = useI18n()
const route = useRoute()
const user = useSupabaseUser()
// Alias, niet `refresh`: die naam zou naast `haal()` hieronder (het product
// opnieuw ophalen) verwarrend zijn — het zijn twee verschillende dingen die
// allebei "opnieuw ophalen" betekenen.
const { profile, refresh: verversProfiel } = useProfile()
const { load, update, setTranslation, removeTranslation } = useProducts()

const product = ref<ProductDetail | null>(null)
const bezig = ref(false)
const saved = ref(false)
const error = ref('')
const nietGevonden = ref(false)

const merk = ref('')
const inhoud = ref<number | null>(null)
// string | undefined, niet | null: zelfde beperking als in
// app/pages/products/new.vue — USelect's v-model-type staat alleen
// `undefined` toe voor "niets gekozen". update() wil wél `string | null`;
// die vertaling en de bewaking van het paar gebeuren nu in
// valideerInhoudEenheid() (app/utils/eenheden.ts), aangeroepen vanuit
// bewaarGegevens() hieronder.
const eenheid = ref<string | undefined>(undefined)
const gtin = ref('')
const namen = ref<Record<string, string>>({})

// eenheidOpties()/valideerInhoudEenheid(): gedeeld met
// app/pages/products/new.vue via app/utils/eenheden.ts (fix 2 van de
// eindreview). Vóór die fix had `eenheden` hier geen lege optie, dus een
// eenmaal gekozen eenheid kon via deze pagina nooit meer verwijderd worden.
const eenheden = computed(() => eenheidOpties(t('products.noUnit')))

// Bewerken mag de maker en een moderator. product_revision en het terugdraaien
// zijn uitgesteld, dus zonder ongedaan maken is "iedereen mag alles" schade
// die niemand herstelt (spec §2). De database bewaakt dit ook; dit is alleen
// de UI die geen knoppen toont die toch zouden weigeren.
// `profile.role` bestaat sinds Taak 4, Step 3. Deze pagina haalt haar eigen
// profiel op (zie verversProfiel() hieronder) in plaats van te vertrouwen op
// AppHeader.vue: die ververst maar één keer, bij haar eigen mount, en dat
// mount kan vóór het inloggen liggen op het gewone magic-link-pad (confirm.vue
// navigeert client-side, ná hydratie — geen nieuwe SSR-render die AppHeader
// opnieuw laat opstarten). Zonder deze eigen ophaal zou een moderator die zo
// binnenkomt een sessie lang op een lege `profile` blijven vastzitten en de
// bewerkknoppen missen, zonder foutmelding.
//
// Directe vergelijkingen, geen .includes() op een array: `role` is sinds de
// eindreview een letterlijke unie ('user' | 'moderator' | 'admin'), niet
// meer string, maar dat typeert alleen mee als de aanroepplek er ook naar
// vergelijkt. Een array-literal zoals ['moderator', 'admin'] verbreedt naar
// string[] en zou een getypte 'modorator' niet vangen; == op de unie zelf
// wel — geverifieerd door dit zo te schrijven en typecheck te laten falen op
// een expres ingebouwde typefout.
const magBewerken = computed(() =>
  product.value?.createdBy === user.value?.sub
  || profile.value?.role === 'moderator'
  || profile.value?.role === 'admin',
)

function vul(p: ProductDetail) {
  merk.value = p.brand ?? ''
  inhoud.value = p.netContent
  // GEEN_EENHEID in plaats van undefined: de lege optie in `eenheden` (fix 2
  // van de eindreview) staat dan zichtbaar als "geen eenheid" geselecteerd,
  // in plaats van een lege placeholder die met geen enkel item overeenkomt.
  eenheid.value = p.unit ?? GEEN_EENHEID
  gtin.value = p.gtin ?? ''
  namen.value = Object.fromEntries(p.vertalingen.map((v) => [v.locale, v.name]))
}

async function haal() {
  try {
    const p = await load(route.params.id as string)
    if (!p) {
      nietGevonden.value = true
      return
    }
    product.value = p
    vul(p)
  } catch {
    error.value = t('householdSettings.error')
  }
}

// Vóór haal(): magBewerken heeft profile.value nodig zodra de pagina de
// eerste keer rendert. Een falende profielophaal mag deze pagina niet leeg
// laten — hooguit geen bewerkknoppen (magBewerken valt dan terug op de
// createdBy-vergelijking), niet "geen pagina". Zelfde aanpak als
// app/pages/onboarding.vue.
try {
  await verversProfiel()
} catch {
  // Stil, met opzet: zie de comment hierboven. De rest van de pagina blijft
  // werken zonder profiel; alleen de bewerkknoppen voor moderators/admins
  // blijven dan verborgen totdat een volgend bezoek het wél ophaalt.
}

await haal()

function bronLabel(source: string): string {
  if (source === 'off') return t('products.sourceOff')
  if (source === 'machine') return t('products.sourceMachine')
  return t('products.sourceUser')
}

async function bewaarGegevens() {
  if (!product.value) return

  // Content en unit gaan samen (check-constraint product_inhoud_en_eenheid).
  // Zonder deze voorcontrole kon het legen van alleen het inhoudveld — de
  // eenheid stond dan nog op de vorige waarde, want USelect had vóór fix 2
  // geen manier om hem ook leeg te maken — de RPC laten weigeren met de
  // generieke foutmelding.
  const paar = valideerInhoudEenheid(inhoud.value, eenheid.value)
  if (!paar) {
    error.value = t('products.contentUnitTogether')
    return
  }

  bezig.value = true
  error.value = ''
  saved.value = false
  try {
    await update(product.value.id, {
      gtin: gtin.value.trim() || null,
      brand: merk.value.trim() || null,
      netContent: paar.netContent,
      unit: paar.unit,
    })
    saved.value = true
    await haal()
  } catch {
    error.value = t('householdSettings.error')
  } finally {
    bezig.value = false
  }
}

// Zelfde constructie als app/components/HouseholdMembers.vue: een
// PostgREST-fout van supabase-js is hier geen Error-instantie.
// useProducts.ts doet `if (error) throw error` op het resultaat van de RPC-
// aanroep, en zonder .throwOnError() is dat kale object gewoon JSON.parse()
// van de HTTP-foutrespons — {code, details, hint, message} zonder
// prototype-keten naar Error. `cause instanceof Error` is dus altijd false
// voor deze foutmeldingen; vandaar deze structurele check op de vorm van
// het object in plaats van op zijn type.
function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const message = (cause as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return ''
}

async function bewaarNaam(taal: string) {
  if (!product.value) return
  bezig.value = true
  error.value = ''
  try {
    const waarde = (namen.value[taal] ?? '').trim()
    if (waarde) await setTranslation(product.value.id, taal, waarde)
    else await removeTranslation(product.value.id, taal)
    await haal()
  } catch (cause) {
    // De trigger prevent_last_translation_removal weigert het verwijderen
    // van de laatste naam van een product. Dat is geen storing maar een
    // regel, dus die krijgt een eigen melding in plaats van de algemene
    // (zelfde vorm als HouseholdMembers.vue's prevent_last_owner_removal-
    // geval).
    error.value = errorMessage(cause).includes('minstens één naam')
      ? t('products.lastName')
      : t('householdSettings.error')
    // v-model had het veld al geleegd vóórdat de weigering binnenkwam;
    // zonder dit zou een geweigerde verwijdering er identiek uitzien als
    // een geslaagde. product.value is hier nog de laatst bevestigde
    // servertoestand — de mislukte aanroep heeft hem niet gewijzigd — dus
    // dit zet het veld terug naar wat de database daadwerkelijk vasthoudt.
    vul(product.value)
  } finally {
    bezig.value = false
  }
}

const getoondeNaam = computed(() => {
  const v = product.value?.vertalingen ?? []
  return v.find((x) => x.locale === locale.value)
    ?? v.find((x) => x.locale === 'en')
    ?? v[0]
})
</script>

<template>
  <UContainer class="max-w-lg py-12">
    <UAlert v-if="nietGevonden" color="error" :description="t('products.notFound')" />

    <template v-else-if="product">
      <h1 class="text-2xl font-bold">{{ getoondeNaam?.name }}</h1>
      <p v-if="getoondeNaam && getoondeNaam.locale !== locale" class="mt-1 text-sm text-muted">
        {{ t('products.shownIn', { language: getoondeNaam.locale.toUpperCase() }) }}
      </p>
      <UBadge class="mt-2" variant="subtle">
        {{ t(`products.status${product.status.charAt(0).toUpperCase()}${product.status.slice(1)}`) }}
      </UBadge>

      <section class="mt-8">
        <h2 class="mb-3 font-semibold">{{ t('products.names') }}</h2>
        <!-- Alle drie de taalvakjes, ook de lege. Dat is hoe de catalogus
             meertalig wordt en de natuurlijkste plek om bij te dragen. -->
        <div class="space-y-3">
          <UFormField
            v-for="taal in localeCodes"
            :key="taal"
            :label="taal.toUpperCase()"
            :help="product.vertalingen.find((v) => v.locale === taal)
              ? bronLabel(product.vertalingen.find((v) => v.locale === taal)!.source)
              : undefined"
            :name="`naam-${taal}`"
          >
            <div class="flex flex-col gap-2 sm:flex-row">
              <UInput
                v-model="namen[taal]"
                :disabled="!magBewerken"
                :maxlength="200"
                class="w-full sm:flex-1"
              />
              <UButton
                v-if="magBewerken"
                :aria-label="`${t('products.save')} ${taal.toUpperCase()}`"
                size="sm"
                variant="subtle"
                :loading="bezig"
                @click="bewaarNaam(taal)"
              >
                {{ t('products.save') }}
              </UButton>
            </div>
          </UFormField>
        </div>
      </section>

      <section v-if="magBewerken" class="mt-8">
        <form class="space-y-4" @submit.prevent="bewaarGegevens">
          <UFormField :label="t('products.brand')" name="merk">
            <UInput v-model="merk" class="w-full" />
          </UFormField>

          <UFormField :label="t('products.netContent')" :help="t('products.contentHelp')" name="inhoud">
            <div class="flex flex-col gap-2 sm:flex-row">
              <UInput v-model.number="inhoud" type="number" min="0" class="w-full sm:flex-1" />
              <USelect
                v-model="eenheid"
                :items="eenheden"
                value-key="value"
                :aria-label="t('products.unit')"
                class="w-full sm:w-auto"
              />
            </div>
          </UFormField>

          <UFormField :label="t('products.gtin')" :help="t('products.gtinHelp')" name="gtin">
            <UInput v-model="gtin" :maxlength="14" class="w-full" />
          </UFormField>

          <UAlert v-if="error" color="error" :description="error" />
          <UAlert v-else-if="saved" color="success" :description="t('products.saved')" />

          <UButton type="submit" :loading="bezig">{{ t('products.save') }}</UButton>
        </form>
      </section>

      <UAlert v-else-if="error" class="mt-8" color="error" :description="error" />
    </template>

    <!-- Alleen bereikbaar als de eerste haal() al faalde, vóór product of
         nietGevonden ooit gezet werd — anders zou deze pagina in dat geval
         een lege container tonen: een melding die niemand ooit ziet. Fouten
         worden hier nooit stil ingeslikt. -->
    <UAlert v-else-if="error" color="error" :description="error" />
  </UContainer>
</template>
