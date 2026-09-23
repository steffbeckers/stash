-- Bevinding 7 van de eindreview van plan 1.
--
-- 20260922054325_extensions.sql liet `with schema extensions` weg voor
-- pg_trgm, dus de ~25 trigramfuncties (waaronder similarity()) staan in
-- public — uitvoerbaar door anon, en inconsistent met elke andere extensie
-- op deze stack, die wel in extensions staat. Niets hangt hier nog van af
-- (plan 2 voegt pas trigram-indexen toe op een gevulde catalogus), dus
-- verplaatsen is nu goedkoop; na plan 2 wordt het een gecoördineerde
-- rebuild.
alter extension pg_trgm set schema extensions;
