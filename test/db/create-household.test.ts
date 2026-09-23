import { describe, it, expect, beforeEach } from 'vitest'
import { withTx, actAs, enableRls, createUser, resetDb } from './helpers'

describe('create_household', () => {
  beforeEach(resetDb)

  it('maakt het huishouden en het eigenaarslidmaatschap samen aan', async () => {
    const userId = await createUser('starter@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      const [row] = await tx<{ create_household: string }[]>`
        select create_household('Thuis')
      `
      const id = row!.create_household

      const members = await tx<{ role: string }[]>`
        select role from household_member where household_id = ${id} and user_id = ${userId}
      `
      expect(members[0]!.role).toBe('owner')
    })
  })

  it('weigert een lege naam', async () => {
    const userId = await createUser('leeg@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      // In een savepoint, niet rechtstreeks op tx: postgres.js registreert op
      // elke query binnen een begin()-blok een eigen .catch() om de transactie
      // te bewaken. Die registratie gebeurt ook als expect().rejects de
      // afwijzing hier al afhandelt, en zou na deze test de hele withTx laten
      // mislukken met exact deze fout - ook al is er niets meer fout. Een
      // savepoint isoleert dat: de mislukking rolt terug tot het savepoint,
      // niet tot het begin van de transactie.
      await expect(tx.savepoint((sp) => sp`select create_household('   ')`)).rejects.toThrow()
    })
  })

  // De twee tests hieronder vullen een gat uit taak 6: daar was de isolatie van
  // household UPDATE/DELETE en household_member SELECT alleen door analyse
  // vastgesteld, niet door een test. Hier kan het wel, want create_household
  // geeft een tweede huishouden met lidmaatschap in een paar regels.

  it('verbergt de ledenlijst van een ander huishouden', async () => {
    const mine = await createUser('mijn-leden@example.com')
    const theirs = await createUser('hun-leden@example.com')

    await withTx(async (tx) => {
      await actAs(tx, theirs)
      await tx`select create_household('Hun huis')`

      await actAs(tx, mine)
      await enableRls(tx)
      const rows = await tx`select user_id from household_member`
      expect(rows.length).toBe(0)
    })
  })

  it('laat een buitenstaander een huishouden niet hernoemen of verwijderen', async () => {
    const outsider = await createUser('buitenstaander@example.com')
    const owner = await createUser('eigenaar7@example.com')

    await withTx(async (tx) => {
      await actAs(tx, owner)
      const [hh] = await tx<{ create_household: string }[]>`select create_household('Hun huis')`
      const id = hh!.create_household

      await actAs(tx, outsider)
      await enableRls(tx)

      // RLS geeft geen fout maar raakt nul rijen; dat is het bewijs.
      //
      // Bewust zonder WHERE: PostgreSQL past de SELECT-policy óók toe op een
      // UPDATE of DELETE die kolommen leest. Met een `where id = ...` erbij
      // blijft deze test groen als de schrijfpolicy op using(true) staat -
      // dan houdt de leespolicy de buitenstaander tegen en bewijst de test
      // niets over de policy die hij zou moeten bewaken. Nagegaan, niet
      // aangenomen: zie de toelichting in storage-place.test.ts.
      const updated = await tx`update household set name = 'gekaapt'`
      expect(updated.count).toBe(0)

      const deleted = await tx`delete from household`
      expect(deleted.count).toBe(0)

      await tx`reset role`
      const [row] = await tx<{ name: string }[]>`select name from household where id = ${id}`
      expect(row!.name).toBe('Hun huis')
    })
  })

  // Bevinding 3 van de eindreview: er bestond een INSERT-policy die elke
  // ingelogde gebruiker rechtstreeks een household-rij liet aanmaken, buiten
  // create_household() om — zonder lidmaatschap, dus onbereikbare rommel na
  // aanmaak. Die policy is ingetrokken; deze test bewijst dat de directe weg
  // nu dicht is terwijl create_household() zelf (hierboven) gewoon werkt.
  it('weigert een rechtstreekse insert buiten create_household() om', async () => {
    const userId = await createUser('directe-insert@example.com')
    await withTx(async (tx) => {
      await actAs(tx, userId)
      await enableRls(tx)
      await expect(
        tx.savepoint((sp) => sp`insert into household (name) values ('Stiekem huis')`),
      ).rejects.toThrow()
    })
  })

  it('weigert een oproep zonder ingelogde gebruiker', async () => {
    await withTx(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub', '', true)`
      // Zelfde reden als hierboven: savepoint isoleert de mislukte oproep van
      // de rest van de transactie.
      await expect(tx.savepoint((sp) => sp`select create_household('Thuis')`)).rejects.toThrow()
    })
  })
})
