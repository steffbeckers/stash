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
