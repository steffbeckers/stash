import { describe, it, expect, beforeEach } from 'vitest'
import { withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('rollen wijzigen', () => {
  beforeEach(resetDb)

  it('een eigenaar kan een lid tot eigenaar promoveren', async () => {
    const owner = await createUser('promo-eigenaar@example.com')
    const member = await createUser('promo-lid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${member})`

      await enableRls(tx)
      await tx`select set_member_role(${id}::uuid, ${member}::uuid, 'owner')`

      await tx`reset role`
      const [row] = await tx<{ role: string }[]>`
        select role from household_member where household_id = ${id} and user_id = ${member}
      `
      expect(row!.role).toBe('owner')
    })
  })

  it('een gewoon lid kan zichzelf niet promoveren', async () => {
    const owner = await createUser('geen-promo-eigenaar@example.com')
    const member = await createUser('geen-promo-lid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${member})`

      await actAs(tx, member)
      await enableRls(tx)
      // Savepoint isoleert de mislukte oproep: zie create-household.test.ts.
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${member}::uuid, 'owner')`),
      ).rejects.toThrow()
    })
  })

  it('een buitenstaander kan niemand promoveren', async () => {
    const owner = await createUser('vreemde-eigenaar@example.com')
    const member = await createUser('vreemde-lid@example.com')
    const outsider = await createUser('vreemde@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      // Doelwit moet een echt lid zijn: mikt de test op de buitenstaander
      // zelf (die geen lid is), dan vangt de "not found"-controle de
      // oproep af en zegt de test niets over de eigenaarscontrole.
      await tx`insert into household_member (household_id, user_id) values (${id}, ${member})`

      await actAs(tx, outsider)
      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${member}::uuid, 'owner')`),
      ).rejects.toThrow()
    })
  })

  it('weigert een onbekende rol', async () => {
    const owner = await createUser('rol-eigenaar@example.com')
    const member = await createUser('rol-lid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${member})`

      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${member}::uuid, 'moderator')`),
      ).rejects.toThrow('onbekende rol')
    })
  })

  it('weigert iemand die geen lid is', async () => {
    const owner = await createUser('nietlid-eigenaar@example.com')
    const stranger = await createUser('nietlid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household

      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${stranger}::uuid, 'owner')`),
      ).rejects.toThrow()
    })
  })

  it('de laatste eigenaar blijft beschermd tegen degraderen', async () => {
    const owner = await createUser('laatste-degradatie@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household

      await enableRls(tx)
      // Specifieke boodschap, geen kale .rejects.toThrow(): bevinding 8 van
      // de eindreview. De trigger prevent_last_owner_removal_trigger raadt
      // deze exacte tekst ('een huishouden moet minstens één eigenaar
      // houden', in 20260923230000_last_owner_trigger_on_update.sql), en
      // HouseholdMembers.vue matcht er zelf ook letterlijk op
      // (errorMessage(cause).includes('minstens één eigenaar')) om de
      // specifieke melding te tonen in plaats van de generieke. Herschrijft
      // iemand de trigger z'n boodschap zonder de component aan te passen,
      // dan degradeert de UI stil naar de generieke foutmelding — zonder
      // deze assertie zou geen enkele test daarvan iets merken.
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${owner}::uuid, 'member')`),
      ).rejects.toThrow('minstens één eigenaar')
    })
  })

  // Dit is de eigenlijke belofte uit spec §4: de laatste eigenaar zit niet
  // vast, maar moet eerst iemand anders promoveren.
  it('een eigenaar kan vertrekken nadat hij iemand anders heeft gepromoveerd', async () => {
    const first = await createUser('vertrek-eerste@example.com')
    const second = await createUser('vertrek-tweede@example.com')

    await withTx(async (tx) => {
      await actAs(tx, first)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${second})`

      await enableRls(tx)
      await tx`select set_member_role(${id}::uuid, ${second}::uuid, 'owner')`

      const left = await tx`
        delete from household_member where household_id = ${id} and user_id = ${first} returning user_id
      `
      expect(left.length).toBe(1)

      await tx`reset role`
      const [count] = await tx<{ n: number }[]>`
        select count(*)::int as n from household_member where household_id = ${id} and role = 'owner'
      `
      expect(count!.n).toBe(1)
    })
  })

  // Verving 'anon mag set_member_role niet aanroepen' (bevinding 2 van de
  // eindreview). Die test riep nooit actAs() aan, dus request.jwt.claim.sub
  // stond niet en auth.uid() was null — de eérste guard in set_member_role
  // ('niet ingelogd') vuurde dan, ongeacht of anon wel of niet de
  // execute-grant had. Verwijder je de `revoke ... from public, anon` uit
  // 20260924052500_set_member_role.sql, dan bleef die test groen: er werd
  // nog steeds ergens geweigerd, alleen niet om de reden die de testnaam
  // beloofde. De grant zelf wordt nu bewezen door de nieuwe regel in
  // permissions.test.ts (has_function_privilege leest de catalogus
  // rechtstreeks, los van sessiestatus). Deze test bewijst in plaats daarvan
  // de eigenaarscontrole zelf, met een signed-in niet-eigenaar en de
  // specifieke boodschap — dat kan wél nog stuk als iemand die guard ooit
  // per ongeluk weghaalt of verzwakt.
  it('een lid dat geen eigenaar is krijgt de specifieke foutmelding, niet zomaar een weigering', async () => {
    const owner = await createUser('boodschap-eigenaar@example.com')
    const first = await createUser('boodschap-een@example.com')
    const second = await createUser('boodschap-twee@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${first})`
      await tx`insert into household_member (household_id, user_id) values (${id}, ${second})`

      // first probeert second te promoveren: een signed-in, RLS-onderworpen
      // niet-eigenaar die een ánder lid raakt, niet zichzelf — een ander
      // geval dan 'een gewoon lid kan zichzelf niet promoveren' hierboven.
      await actAs(tx, first)
      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`select set_member_role(${id}::uuid, ${second}::uuid, 'owner')`),
      ).rejects.toThrow('alleen een eigenaar mag rollen wijzigen')
    })
  })

  it('een eigenaar kan een lid verwijderen', async () => {
    const owner = await createUser('verwijder-eigenaar@example.com')
    const member = await createUser('verwijder-lid@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Huis')`
      const id = hh!.create_household
      await tx`insert into household_member (household_id, user_id) values (${id}, ${member})`

      await enableRls(tx)
      const removed = await tx`
        delete from household_member
        where household_id = ${id} and user_id = ${member}
        returning user_id
      `
      expect(removed.length).toBe(1)
    })
  })
})
