# Uitvoeringsrapporten — plan 1: fundament

Deze map bewaart wat de elf taken van plan 1 hebben opgeleverd aan
*redenering*: waarom de code is zoals hij is, welke vallen onderweg zijn
gevonden, en welk bewijs er per taak is geleverd dat de tests echt dragend zijn.

De code zelf staat in git; dit is het geheugen eromheen.

## Wat hier staat

| Bestand | Inhoud |
| --- | --- |
| `progress.md` | Het grootboek: 24 uitspraken (rulings) die tijdens de uitvoering zijn vastgelegd, plus de afronding per taak. |
| `deferred-minors.md` | De 29 kleine bevindingen zoals ze tijdens plan 1 zijn doorgeschoven. Historisch: voor wat er *nu* nog openstaat, zie [open-bevindingen.md](../../open-bevindingen.md). |
| `task-N-report.md` | Per taak: wat er is gebouwd, het RED/GREEN-bewijs, afwijkingen van de brief en de motivatie ervoor. |
| `final-fix-report.md` | De acht punten die de eindreview over de hele branch vond, en hoe ze zijn verholpen. |

## Wat hier bewust niet staat

De taakbriefs en de review-diffs. Die zijn afleidbaar: de briefs uit
[het plan](../../plans/2026-09-21-stash-fundament.md), de diffs uit de
git-geschiedenis van `plan-1-fundament` (samengevoegd in `4c174c2`).

## De rode draad

Vier keer tijdens dit plan bleek een test groen terwijl de eigenschap die hij
zou bewaken volledig onbewezen was. Daaruit komt uitspraak 12 in `progress.md`:
een beveiligingstest telt pas mee als is aangetoond dat hij rood wordt zodra de
bescherming wordt weggehaald. Dat is de belangrijkste gewoonte die dit plan
heeft opgeleverd.
