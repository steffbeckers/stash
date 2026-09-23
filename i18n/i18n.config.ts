// Auto-gedetecteerd door @nuxtjs/i18n (scant naar i18n.config.{ts,js,mjs} in
// de i18n-map, zie de `restructureDir`-optie van de module) — geen
// wijziging in nuxt.config.ts nodig om dit bestand te laten meetellen.
//
// datetimeFormats.short is nodig voor HouseholdInvites.vue's
// `d(new Date(invite.expires_at), 'short')`: zonder een geregistreerd
// formaat voor die sleutel had vue-i18n niets om op terug te vallen en
// rendert de vervaldatum leeg, in alle drie de talen.
export default defineI18nConfig(() => ({
  datetimeFormats: {
    en: {
      short: { year: 'numeric', month: 'short', day: 'numeric' },
    },
    nl: {
      short: { year: 'numeric', month: 'short', day: 'numeric' },
    },
    fr: {
      short: { year: 'numeric', month: 'short', day: 'numeric' },
    },
  },
}))
