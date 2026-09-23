import { describe, it, expect, beforeEach } from 'vitest'
import { withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('rechten', () => {
  beforeEach(resetDb)

  it('een gebruiker kan zichzelf geen moderator maken', async () => {
    const userId = await createUser('sluw@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      // Savepoint isoleert de mislukte update van de rest van de transactie:
      // zie create-household.test.ts voor de volledige uitleg.
      await expect(
        tx.savepoint(
          (sp) => sp`update user_profile set role = 'moderator' where user_id = ${userId}`,
        ),
      ).rejects.toThrow()
    })
  })

  it('een gebruiker kan zijn eigen vertrouwensniveau niet verhogen', async () => {
    const userId = await createUser('gretig@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      // Zelfde reden als hierboven: savepoint isoleert de mislukte update.
      await expect(
        tx.savepoint((sp) => sp`update user_profile set trust_level = 3 where user_id = ${userId}`),
      ).rejects.toThrow()
    })
  })

  it('een gebruiker mag wel zijn weergavenaam wijzigen', async () => {
    const userId = await createUser('naam@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await tx`update user_profile set display_name = 'Steff' where user_id = ${userId}`

      const [row] = await tx<{ display_name: string }[]>`
        select display_name from user_profile where user_id = ${userId}
      `
      expect(row!.display_name).toBe('Steff')
    })
  })

  it('de laatste eigenaar kan het huishouden niet verlaten', async () => {
    const userId = await createUser('laatste@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      // Bevinding 2 van de eindreview: deze test draaide als superuser en gaf
      // dus nooit dekking aan de DELETE-policy op household_member. Onder RLS
      // is deze delete wel toegestaan (user_id = auth.uid(), zelf verlaten
      // mag altijd) — de trigger blokkeert hem daarna alsnog, wat hier bewezen
      // wordt.
      await enableRls(tx)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`

      // Zelfde reden als hierboven: savepoint isoleert de mislukte delete.
      await expect(
        tx.savepoint(
          (sp) => sp`
            delete from household_member
            where household_id = ${hh!.create_household} and user_id = ${userId}
          `,
        ),
      ).rejects.toThrow()
    })
  })

  // Regressietest voor een gat dat `pg_trigger_depth() = 0` openliet: die
  // clausule kan een cascade vanuit het opheffen van het huishouden zelf niet
  // onderscheiden van een cascade vanuit het verwijderen van de account van de
  // enige eigenaar (auth.users on delete cascade -> household_member). Beide
  // zijn geneste cascades op dezelfde diepte. Dit pad is vandaag al bereikbaar
  // via Supabase Studio's "Delete user" of auth.admin.deleteUser(), zonder
  // app-code.
  //
  // Bevinding 5 van de eindreview van plan 1: dit blokkeren is een bewuste
  // maar TIJDELIJKE toestand, geen einddoel. Elke onboardende gebruiker
  // wordt eigenaar van een huishouden, dus accountverwijdering loopt hier
  // vandaag voor vrijwel iedereen op vast. Plan 8's accountverwijderingsflow
  // moet het huishouden verwijderen vóór het account, niet tegen deze
  // trigger aanlopen — zie de databasecomment op prevent_last_owner_removal
  // (toegevoegd in 20260923062000_document_last_owner_block_as_interim.sql)
  // en spec §8. Een toekomstige lezer mag uit deze testnaam niet concluderen
  // dat blokkeren het gewenste eindgedrag is.
  it('het verwijderen van de account van de enige eigenaar wordt tijdelijk geblokkeerd (plan 8 moet eerst het huishouden verwijderen)', async () => {
    const userId = await createUser('enige-eigenaar@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Solo')`

      // Savepoint isoleert de mislukte delete van de rest van de transactie.
      await expect(
        tx.savepoint((sp) => sp`delete from auth.users where id = ${userId}`),
      ).rejects.toThrow()

      const rows = await tx<{ role: string }[]>`
        select role from household_member where household_id = ${hh!.create_household}
      `
      expect(rows.length).toBe(1)
      expect(rows[0]!.role).toBe('owner')
    })
  })

  it('een eigenaar kan wel weg als er een tweede eigenaar is', async () => {
    const first = await createUser('een@example.com')
    const second = await createUser('twee@example.com')

    await withTx(async (tx) => {
      await actAs(tx, first)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const id = hh!.create_household

      // Rechtstreeks als superuser: er is geen INSERT-policy op
      // household_member (bevinding 2), dus een tweede eigenaar toevoegen kan
      // sowieso niet via de app. Dit is opzet, geen deel van wat hieronder
      // bewezen wordt — vandaar vóór enableRls.
      await tx`
        insert into household_member (household_id, user_id, role)
        values (${id}, ${second}, 'owner')
      `

      // Vanaf hier onder RLS: dit is de operatie die de test bewijst. Zonder
      // enableRls draaide dit als superuser en gaf de test nooit dekking aan
      // de DELETE-policy op household_member.
      await enableRls(tx)
      const deleted = await tx`delete from household_member where household_id = ${id} and user_id = ${first}`
      expect(deleted.count).toBe(1)

      await tx`reset role`
      const rows = await tx`select 1 from household_member where household_id = ${id}`
      expect(rows.length).toBe(1)
    })
  })

  // Dekt alle functies van dit vlak, niet alleen create_household: de vorige
  // versie van deze test controleerde alleen create_household terwijl de naam
  // "geen enkele" beloofde. is_household_member/is_household_owner (taak 6)
  // en create_invite/accept_invite (taak 8, daar al gefixt) staan er nu ook in.
  const householdFunctions = [
    'create_household(text)',
    'is_household_member(uuid)',
    'is_household_owner(uuid)',
    'create_invite(uuid, int, int)',
    'accept_invite(text)',
  ]

  // De trigger dekte alleen DELETE. Een UPDATE die de rol van de laatste
  // eigenaar op 'member' zet laat exact hetzelfde onbestuurbare huishouden
  // achter. Vandaag is dat pad niet bereikbaar, maar alleen omdat
  // household_member geen UPDATE-policy heeft - bescherming door afwezigheid,
  // die stil verdwijnt zodra de promoveer-route uit de spec er komt.
  //
  // Deze test meet daarom de trigger en niet de policy: hij draait zonder
  // enableRls, zodat RLS de rij niet wegfiltert en de invariant zelf aan het
  // woord komt.
  it('de laatste eigenaar kan niet via een update gedegradeerd worden', async () => {
    const userId = await createUser('degradatie@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`

      // Savepoint isoleert de mislukte update: zie create-household.test.ts.
      await expect(
        tx.savepoint(
          (sp) => sp`
            update household_member set role = 'member'
            where household_id = ${hh!.create_household} and user_id = ${userId}
          `,
        ),
      ).rejects.toThrow()
    })
  })

  // De tegenhanger: degraderen mag wel zodra er een tweede eigenaar is.
  // Zonder deze test zou een trigger die simpelweg elke roldaling weigert
  // ook groen zijn, en dan blokkeert hij straks de promoveer-route.
  it('een eigenaar mag wel gedegradeerd worden als er een tweede eigenaar is', async () => {
    const first = await createUser('eerste-eigenaar@example.com')
    const second = await createUser('tweede-eigenaar@example.com')

    await withTx(async (tx) => {
      await actAs(tx, first)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Thuis')`
      const householdId = hh!.create_household

      await tx`
        insert into household_member (household_id, user_id, role)
        values (${householdId}, ${second}, 'owner')
      `

      const changed = await tx`
        update household_member set role = 'member'
        where household_id = ${householdId} and user_id = ${first}
        returning user_id
      `
      expect(changed.length).toBe(1)
    })
  })

  it('anon mag geen enkele huishoudfunctie aanroepen', async () => {
    await withTx(async (tx) => {
      for (const fn of householdFunctions) {
        const [row] = await tx<{ anon: boolean; auth: boolean }[]>`
          select
            has_function_privilege('anon', ${fn}, 'execute') as anon,
            has_function_privilege('authenticated', ${fn}, 'execute') as auth
        `
        expect(row!.anon, `anon op ${fn}`).toBe(false)
        expect(row!.auth, `authenticated op ${fn}`).toBe(true)
      }
    })
  })

  it('een huishouden opheffen werkt ondanks de eigenaarstrigger', async () => {
    const userId = await createUser('opheffen@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      // Bevinding 2 van de eindreview: zonder enableRls draaide dit als
      // superuser. Onder RLS moet zowel de DELETE-policy op household
      // (eigenaar) als die op household_member (cascade) deze operatie
      // toelaten — dat wordt hier nu ook echt bewezen, niet alleen aangenomen.
      await enableRls(tx)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Weg')`

      await tx`delete from household where id = ${hh!.create_household}`

      const rows = await tx`select 1 from household_member where household_id = ${hh!.create_household}`
      expect(rows.length).toBe(0)
    })
  })
})
