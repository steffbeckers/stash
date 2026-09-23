-- Bevinding 5 van de eindreview van plan 1.
--
-- Geen gedragswijziging. prevent_last_owner_removal() (uit
-- 20260923055349_fix_last_owner_trigger_and_anon_grants.sql) blokkeert het
-- verwijderen van een auth.users-rij zolang die gebruiker de laatste
-- eigenaar van een huishouden is. Elke gebruiker die onboardt wordt
-- eigenaar van een huishouden, dus accountverwijdering loopt vandaag voor
-- vrijwel iedereen tegen deze trigger aan.
--
-- Dat is de bewuste, verdedigbare toestand voor plan 1 — spec §8 zegt dat
-- het huishouden mee moet gaan met de laatste eigenaar — maar het hoort bij
-- plan 8's accountverwijderingsflow, die het huishouden eerst moet
-- verwijderen vóór het account, niet tegen deze trigger moet aanlopen. De
-- toegepaste migratie hierboven blijft ongewijzigd (append-only); deze
-- migratie voegt alleen een echte, opvraagbare databasecomment toe zodat een
-- toekomstige lezer van de trigger — of van test/db/permissions.test.ts —
-- er niet uit concludeert dat blokkeren het einddoel is.
comment on function prevent_last_owner_removal() is
  'Blokkeert het verwijderen van de laatste eigenaar van een huishouden, ook via de cascade vanuit auth.users. Dit is bewust maar tijdelijk voor plan 1: elke onboardende gebruiker wordt eigenaar, dus accountverwijdering loopt hier vandaag voor bijna iedereen op vast. Plan 8''s accountverwijderingsflow moet het huishouden verwijderen vóór het account, niet op deze trigger botsen. Zie ontwerp-spec §8.';
