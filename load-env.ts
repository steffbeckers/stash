// De testrunner laadt .env niet vanzelf (zelfde reden als in
// test/db/helpers.ts). Een ontbrekend bestand negeren we; de tests falen dan
// alsnog met een duidelijke melding over de ontbrekende variabele.
//
// Dit staat apart omdat zowel playwright.config.ts als
// playwright.pwa.config.ts het nodig heeft, en een tweede kopie op termijn
// uit elkaar loopt met de eerste.
export function loadEnv(): void {
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
}
