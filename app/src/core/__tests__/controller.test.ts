import { describe, expect, it } from 'vitest'
import { DEMO_PASSWORD, DEMO_USER, createDemoBridge } from '../../demo/demoBridge'
import { AccountError, createAccount, login } from '../cloud'
import { Controller } from '../controller'
import { parseSchedule, routineEvents } from '../schedule'
import { discoverZones } from '../setup'
import { memoryStore } from '../storage'

const until = async (cond: () => boolean, ms = 3000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('controller against the demo cloud', () => {
  it('signs in, shows zones and confirms a setpoint change', async () => {
    const bridge = createDemoBridge({ latency: 1 })
    const c = new Controller(() => bridge, memoryStore())
    await c.boot()
    expect(c.getState().phase).toBe('signedOut')
    expect(await c.signIn({ user: DEMO_USER, password: DEMO_PASSWORD }, true)).toBe(true)
    await until(() => c.getState().link === 'online' && Object.keys(c.getState().device.zones).length === 3)
    expect(c.getState().zones.map((z) => z.name)).toEqual(['Salón', 'Despacho', 'Dormitorio'])
    expect(c.getState().device.zones[0].setpoint).toBe(21)

    c.setSetpoint(0, 22.5)
    expect(c.getState().pending[0]).toHaveLength(1)
    await until(() => c.getState().device.zones[0].setpoint === 22.5 && !c.getState().pending[0]?.length, 4000)
  })

  it('reports wrong passwords clearly', async () => {
    const c = new Controller(() => createDemoBridge({ latency: 1 }), memoryStore())
    await c.boot()
    expect(await c.signIn({ user: DEMO_USER, password: 'mala' }, true)).toBe(false)
    expect(c.getState().loginError).toMatch(/incorrectos/)
  })

  it('saves the schedule to the cloud and reads it back after a new login', async () => {
    const bridge = createDemoBridge({ latency: 1 })
    const c = new Controller(() => bridge, memoryStore())
    await c.boot()
    await c.signIn({ user: DEMO_USER, password: DEMO_PASSWORD }, true)
    await until(() => c.getState().link === 'online')
    const evs = routineEvents({ zones: [1], days: [true, true, true, true, true, false, false], wake: 480, sleep: 1320, comfort: 22, eco: 17 })
    expect(await c.saveSchedule(evs)).toBe(true)
    const again = await login(bridge, { user: DEMO_USER, password: DEMO_PASSWORD })
    const saved = parseSchedule(new TextDecoder().decode(again.project['chronos.data']))
    expect(saved.events.map((e) => [e.minute, e.setpoint, e.zones, e.enabled])).toEqual([
      [480, 22, [1], true],
      [1320, 17, [1], true],
    ])
  })

  it('handles "user already exists" and lets the owner resume setup', async () => {
    const bridge = createDemoBridge({ latency: 1 })
    await expect(createAccount(bridge, { user: 'vecino', password: 'secreto1' }, 'WA1B2C3')).rejects.toMatchObject({ code: 'exists' })
    const { token } = await createAccount(bridge, { user: 'nueva.vecina', password: 'secreto1' }, 'WA1B2C3')
    const zones = await discoverZones(bridge, 'WA1B2C3', token, { stepMs: 5 })
    expect(zones).toEqual([0, 1, 2])
    // Creating it again says it exists, and logging in with the same password works.
    const err = await createAccount(bridge, { user: 'nueva.vecina', password: 'secreto1' }, 'WA1B2C3').catch((e) => e)
    expect(err).toBeInstanceOf(AccountError)
    expect((await login(bridge, { user: 'nueva.vecina', password: 'secreto1' })).session.ident).toBe('WA1B2C3')
  }, 20_000)
})

describe('login errors', () => {
  it('says when the user does not exist instead of hanging on s3', async () => {
    const c = new Controller(() => createDemoBridge({ latency: 1 }), memoryStore())
    await c.boot()
    expect(await c.signIn({ user: 'no.existo', password: 'loquesea' }, true)).toBe(false)
    expect(c.getState().loginError).toMatch(/No existe ninguna cuenta/)
  })
})

describe('away mode', () => {
  it('survives signing out and restores the schedule on return (N-03)', async () => {
    const bridge = createDemoBridge({ latency: 1 })
    const c = new Controller(() => bridge, memoryStore())
    await c.boot()
    await c.signIn({ user: DEMO_USER, password: DEMO_PASSWORD }, true)
    await until(() => c.getState().link === 'online' && c.getState().device.zones[0]?.setpoint !== undefined)
    const before = c.getState().schedule!.events.filter((e) => e.enabled).length
    expect(before).toBeGreaterThan(0)

    expect(await c.startAway(16)).toBe(true)
    expect(c.getState().schedule!.events.every((e) => !e.enabled)).toBe(true)
    await c.signOut()

    // Another phone (fresh storage) sees it too.
    const other = new Controller(() => bridge, memoryStore())
    await other.boot()
    await other.signIn({ user: DEMO_USER, password: DEMO_PASSWORD }, true)
    expect(other.getState().away?.temp).toBe(16)
    await until(() => other.getState().link === 'online')
    expect(await other.endAway()).toBe(true)
    expect(other.getState().away).toBeUndefined()
    expect(other.getState().schedule!.events.filter((e) => e.enabled)).toHaveLength(before)
  }, 20_000)
})

describe('connection resets', () => {
  it('resends a setpoint lost in a connection reset (seen on the real cloud)', async () => {
    // Writes on the first socket: hello, then dump + 3 zone reads (8 frames) = 9; the 10th is our command.
    const bridge = createDemoBridge({ latency: 1, resetOnWrite: [10] })
    let opens = 0
    const open = bridge.openSocket.bind(bridge)
    bridge.openSocket = (...a) => (opens++, open(...a))
    const c = new Controller(() => bridge, memoryStore())
    await c.boot()
    await c.signIn({ user: DEMO_USER, password: DEMO_PASSWORD }, true)
    await until(() => c.getState().link === 'online' && c.getState().device.zones[2]?.setpoint !== undefined, 5000)
    await new Promise((r) => setTimeout(r, 3500)) // let the initial reads go out
    c.setSetpoint(2, 20.5)
    await until(() => c.getState().device.zones[2].setpoint === 20.5 && !c.getState().pending[2]?.length, 12_000)
    expect(c.getState().toasts.filter((t) => t.kind === 'error')).toHaveLength(0)
    expect(opens).toBe(2) // the reset really happened and we reconnected once
  }, 20_000)
})
