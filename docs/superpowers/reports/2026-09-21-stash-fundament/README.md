# Uitvoeringsrapporten — plan 1: fundament

Deze map bewaart wat de elf taken van plan 1 hebben opgeleverd aan
*redenering*: waarom de code is zoals hij is, welke vallen onderweg zijn
gevonden, en welk bewijs er per taak is geleverd dat de tests echt dragend zijn.

De code zelf staat in git; dit is het geheugen eromheen.

## Wat hier staat

| Bestand | Inhoud |
| --- | --- |
| `progress.md` | Het grootboek: 24 uitspraken (rulings) die tijdens de uitvoering zijn vastgelegd, plus de afronding per taak. |
| `task-N-report.md` | Per taak: wat er is gebouwd, het RED/GREEN-bewijs, afwijkingen van de brief en de motivatie ervoor. |
| `final-fix-report.md` | De acht punten die de eindreview over de hele branch vond, en hoe ze zijn verholpen. |

## Wat hier bewust niet staat

De taakbriefs en de review-diffs. Die zijn afleidbaar: de briefs uit
[het plan](../../plans/2026-09-21-stash-fundament.md), de diffs uit de
git-geschiedenis van `plan-1-fundament` (samengevoegd in `4c174c2`).

Ook de lijst met doorgeschoven bevindingen staat hier niet meer. Elf van de
29 bleken bij controle al verholpen, wat hem als werklijst onbruikbaar maakte
en als logboek misleidend. Wat er nog openstaat leeft in
[open-bevindingen.md](../../open-bevindingen.md).

## De rode draad

Vier keer tijdens dit plan bleek een test groen terwijl de eigenschap die hij
zou bewaken volledig onbewezen was. Daaruit komt uitspraak 12 in `progress.md`:
een beveiligingstest telt pas mee als is aangetoond dat hij rood wordt zodra de
bescherming wordt weggehaald. Dat is de belangrijkste gewoonte die dit plan
heeft opgeleverd.

Het bleef niet bij die vier. Bij het opruimen erna dook het een vijfde keer op,
en dat geval is leerzamer dan de eerste vier: twee negatieve RLS-tests werden
groen gehouden door de *lees*policy, terwijl ze de *schrijf*policy beloofden te
bewaken. PostgreSQL past `SELECT`-policies namelijk ook toe op een `UPDATE` of
`DELETE` die kolommen leest. Geen review had dat gezien — het kwam boven door
elke schrijfpolicy in de suite op `using (true)` te zetten en te kijken wie er
níet rood werd.
