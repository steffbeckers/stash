-- Gevonden door de beveiligingsadviseur van Supabase bij de eerste echte
-- deploy, niet door onze testsuite.
--
-- handle_new_user(), prevent_last_owner_removal() en
-- protect_profile_privileges() zijn triggerfuncties: ze bestaan alleen om
-- door een trigger aangeroepen te worden. Toch hadden ze de standaard
-- EXECUTE-grant aan PUBLIC (en daarmee aan anon en authenticated) nog staan.
--
-- Uitbuitbaar is het niet, en dat is nagegaan in plaats van aangenomen:
-- PostgREST publiceert geen functies die `trigger` teruggeven, dus op het
-- gehoste project geven ze PGRST202 ("function not found") en geen 401.
-- Buiten triggercontext zouden ze bovendien meteen falen, want `new` en `old`
-- bestaan dan niet.
--
-- Het is dus verdediging in de diepte, precies zoals in
-- 20260923055349_fix_last_owner_trigger_and_anon_grants.sql: "niet
-- uitbuitbaar, maar functies van dezelfde vorm horen consistent afgesloten te
-- zijn". Die migratie sloot is_household_member en is_household_owner af en
-- sloeg deze drie over.
--
-- Anders dan bij de RPC's krijgt authenticated hier niets terug: er is geen
-- legitieme rechtstreekse aanroeper. Het intrekken van EXECUTE raakt het
-- afvuren van de triggers niet — PostgreSQL controleert dat recht bij CREATE
-- TRIGGER, niet bij elke DML die de trigger laat afgaan.
revoke all on function handle_new_user() from public, anon, authenticated;
revoke all on function prevent_last_owner_removal() from public, anon, authenticated;
revoke all on function protect_profile_privileges() from public, anon, authenticated;
