-- Bevinding 1 van de eindreview van plan 1.
--
-- De select-policy op user_profile had geen `to authenticated`, dus de rol
-- was {public} en anon — de rol van de publieke anon-sleutel, die standaard
-- in de browserbundel zit — had via die policy tafelbrede leestoegang.
-- Bevestigd live: anon kon GET /rest/v1/user_profile?select=* doen en zo
-- user_id, display_name, trust_level en role van elke gebruiker uitlezen —
-- de hele gebruikersregistratie, inclusief wie moderator is.
--
-- De policy wordt herschapen met `to authenticated`. Het gedrag voor
-- ingelogde gebruikers blijft ongewijzigd: elk profiel blijft leesbaar
-- binnen de app, want weergavenamen zijn bewust publiek. Alleen anon
-- verliest toegang.
drop policy "iedereen mag publieke profielvelden lezen" on user_profile;

create policy "ingelogde gebruikers mogen profielvelden lezen"
  on user_profile for select
  to authenticated
  using (true);
