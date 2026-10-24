import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { accountCrc, validatePassword, validateUsername } from '../cloud'
import { deviceIdFromInput, parseInstal } from '../installation'
import {
  FrameParser,
  applyReport,
  cloudCommand,
  emptyDeviceState,
  isDemanding,
  modeValue,
  stateValue,
} from '../protocol'
import {
  findConflicts,
  nextTransition,
  parseSchedule,
  routineEvents,
  serializeSchedule,
  zoneTransitions,
  removeCoverage,
  copyZoneSchedule,
  compact,
  applyDelete,
  applyEdit,
  groupConflicts,
  shiftDays,
  whenLabel,
  logicalDays,
  describeDays,
} from '../schedule'

const fixture = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
const hex = (s: string) => Uint8Array.from(s.split(' ').map((b) => Number.parseInt(b, 16)))

describe('protocol', () => {
  it('builds the identifier and telegram frames like the app', () => {
    const [id, tg] = cloudCommand('WA1B2C3', 4, 0x23, 0)
    expect([...id]).toEqual([0xee, 0xee, ...new TextEncoder().encode('WA1B2C3')])
    expect([...tg]).toEqual([0xff, 0xff, 0x00, 0x01, 0xfe, 0xfe, 0x04, 0x23, 0x00])
  })

  it('decodes a captured dump, split across chunks', () => {
    // Real frames from the cloud socket (2026-10-24).
    const captured = [
      'fe fe 00 01 00 fe 04 23 00', // echo of our command
      'fe fe 00 fe 00 01 01 00 00', // ack
      'fe fe 00 01 00 01 04 35 8d', // available modes
      'fe fe 00 01 00 01 04 00 02', // zone 1 off
      'fe fe 00 01 00 01 04 01 02', // heat floor
      'fe fe 00 01 00 01 04 02 26', // setpoint 19
      'fe fe 00 01 00 01 04 03 79', // ambient 20.5
      'fe fe 00 01 00 01 04 66 7e', // zone 3 humidity
    ]
    const bytes = hex(captured.join(' '))
    const parser = new FrameParser()
    const frames = [...parser.push(bytes.subarray(0, 13)), ...parser.push(bytes.subarray(13))]
    expect(frames).toHaveLength(captured.length)
    const st = emptyDeviceState()
    frames.forEach((f) => applyReport(st, f))
    expect(st.zones[0]).toMatchObject({ on: false, mode: 2, setpoint: 19, ambient: 20.5 })
    expect(st.zones[2].humidity).toBeCloseTo(49.4, 1)
    expect(st.availableModes).toEqual([2, 3])
  })

  it('resyncs after garbage', () => {
    const parser = new FrameParser()
    const frames = parser.push(hex('00 13 fe fe 00 01 00 01 04 02 2a'))
    expect(frames).toEqual([{ dst: 1, org: 1, cmd: 4, d1: 2, d2: 0x2a }])
  })

  it('keeps unknown bits on writes', () => {
    expect(stateValue(2, true)).toBe(3)
    expect(stateValue(3, false)).toBe(2)
    expect(modeValue(0x22, 3)).toBe(0x23)
  })

  it('knows when a zone is calling for heat or cold', () => {
    expect(isDemanding({ index: 0, on: true, mode: 2, setpoint: 21, ambient: 20 })).toBe(true)
    expect(isDemanding({ index: 0, on: true, mode: 3, setpoint: 21, ambient: 20 })).toBe(false)
    expect(isDemanding({ index: 0, on: false, mode: 2, setpoint: 21, ambient: 20 })).toBe(false)
  })
})

describe('installation', () => {
  it('reads zone names from Instal.dat', () => {
    expect(parseInstal(fixture('fixture-Instal.dat'))).toEqual([
      { index: 0, name: 'casa' },
      { index: 1, name: 'despacho' },
      { index: 2, name: 'habitación' },
    ])
  })

  it('normalises the device id from the Wi-Fi name', () => {
    expect(deviceIdFromInput('Ing_A1B2C3')).toBe('WA1B2C3')
    expect(deviceIdFromInput(' a1b2c3 ')).toBe('WA1B2C3')
    expect(deviceIdFromInput('WA1B2C3')).toBe('WA1B2C3')
    expect(deviceIdFromInput('Ing_123')).toBeUndefined()
  })
})

describe('schedule', () => {
  it('parses the real chronos.data and drops empty slots', () => {
    const s = parseSchedule(fixture('fixture-chronos.data'))
    expect(s.timeZone).toBe('Europe/Madrid')
    expect(s.events).toHaveLength(1)
    expect(s.events[0]).toMatchObject({ enabled: false, zones: [], setpoint: 22 })
    expect(s.events[0].days).toEqual([true, false, false, false, false, false, false])
  })

  it('round-trips through the 30-slot file format', () => {
    const events = routineEvents({
      zones: [0, 2],
      days: [true, true, true, true, true, false, false],
      wake: 6 * 60 + 30,
      sleep: 22 * 60 + 45,
      comfort: 21.5,
      eco: 18,
      away: { leave: 8 * 60, back: 17 * 60 },
    })
    const text = serializeSchedule({ timeZone: 'Europe/Madrid', events })
    const lines = text.trim().split('\n')
    expect(lines[0]).toBe('TZ:Europe/Madrid')
    expect(lines).toHaveLength(1 + 30 * 4)
    // enabled + Mon..Fri = 0b111111 ; zones 0 and 2 = bits 1 and 3
    expect(lines.slice(1, 5)).toEqual(['63', expect.any(String), '10', '21.5'])
    const back = parseSchedule(text)
    expect(back.events.map((e) => [e.minute, e.setpoint, e.zones])).toEqual([
      [390, 21.5, [0, 2]],
      [480, 18, [0, 2]],
      [1020, 21.5, [0, 2]],
      [1365, 18, [0, 2]],
    ])
  })

  it('keeps the minute of day across DST in the file time zone', () => {
    const ev = routineEvents({ zones: [0], days: Array(7).fill(true), wake: 0, sleep: 23 * 60 + 59, comfort: 20, eco: 18 })
    for (const now of [new Date('2026-03-29T12:00:00Z'), new Date('2026-10-25T12:00:00Z'), new Date('2026-07-01T23:30:00Z')]) {
      const back = parseSchedule(serializeSchedule({ timeZone: 'Europe/Madrid', events: ev }, now))
      expect(back.events.map((e) => e.minute)).toEqual([0, 1439])
    }
  })

  it('refuses more than 30 changes', () => {
    const many = Array.from({ length: 31 }, (_, i) => ({
      id: String(i),
      enabled: true,
      days: Array(7).fill(true),
      minute: i,
      zones: [0],
      setpoint: 20,
    }))
    expect(() => serializeSchedule({ timeZone: 'Europe/Madrid', events: many })).toThrow(/30/)
  })

  it('finds the next change and conflicts', () => {
    const evs = routineEvents({ zones: [1], days: [true, true, true, true, true, false, false], wake: 420, sleep: 1380, comfort: 21, eco: 18 })
    // Friday 23:30 -> next change is Monday 07:00
    const next = nextTransition(evs, 1, new Date(2026, 9, 23, 23, 30))
    expect(next).toMatchObject({ day: 0, minute: 420, setpoint: 21 })
    expect(next!.inMinutes).toBe(2 * 1440 + 30 + 420)
    expect(zoneTransitions(evs, 0)).toHaveLength(0)
    const clash = [...evs, { ...evs[0], id: 'x', setpoint: 23 }]
    expect(findConflicts(clash)).toHaveLength(5)
  })
})

describe('account', () => {
  it('computes the pass_ident check like the app', () => {
    // Recomputed by hand from getCrcAlta(): ((u ^ p ^ id) & 119) | 65
    const u = 'vecino', p = 'secreto1', id = 'WA1B2C3'
    let want = ''
    for (let i = 0; i < 7; i++)
      want += i >= u.length ? 'A' : String.fromCharCode(((u.charCodeAt(i) ^ p.charCodeAt(i) ^ id.charCodeAt(i)) & 119) | 65)
    expect(accountCrc(u, p, id)).toBe(want)
    expect(accountCrc(u, p, id)).toHaveLength(7)
    expect(accountCrc(u, p, id).endsWith('A')).toBe(true)
  })

  it('validates user names and passwords before talking to the server', () => {
    expect(validateUsername('juan.perez')).toBeUndefined()
    expect(validateUsername('juan pérez')).toBeDefined()
    expect(validateUsername('ab')).toBeDefined()
    expect(validatePassword('abc')).toBeDefined()
    expect(validatePassword('con espacio')).toBeDefined()
    expect(validatePassword('S3gura&2026')).toBeUndefined()
  })
})

describe('schedule editing', () => {
  const wd = [true, true, true, true, true, false, false]
  const all = Array(7).fill(true)

  it('replaces a routine only for the chosen zones and days', () => {
    const base = routineEvents({ zones: [0, 1], days: all, wake: 420, sleep: 1380, comfort: 21, eco: 18 })
    const out = removeCoverage(base, [0], wd)
    // Zone 1 keeps every day; zone 0 keeps only the weekend.
    expect(zoneTransitions(out, 1)).toHaveLength(14)
    const z0 = zoneTransitions(out, 0)
    expect(z0).toHaveLength(4)
    expect(new Set(z0.map((t) => t.day))).toEqual(new Set([5, 6]))
    expect(out.length).toBeLessThanOrEqual(4)
  })

  it('copies a zone schedule without new slots', () => {
    const a = routineEvents({ zones: [0], days: wd, wake: 420, sleep: 1380, comfort: 21, eco: 18 })
    const b = routineEvents({ zones: [2], days: all, wake: 600, sleep: 1320, comfort: 22, eco: 17 })
    const out = compact(copyZoneSchedule([...a, ...b], 0, [2]))
    expect(out).toHaveLength(2)
    expect(zoneTransitions(out, 2).map((t) => [t.day, t.minute])).toEqual(zoneTransitions(out, 0).map((t) => [t.day, t.minute]))
  })
})

describe('review fixes', () => {
  const wd = [true, true, true, true, true, false, false]

  it('puts a bedtime after midnight on the next day', () => {
    const evs = routineEvents({ zones: [0], days: wd, wake: 420, sleep: 30, comfort: 21, eco: 18 })
    const sleep = evs.find((e) => e.minute === 30)!
    expect(sleep.days).toEqual([false, true, true, true, true, true, false]) // Tue..Sat
    expect(shiftDays([false, false, false, false, false, false, true], 1)).toEqual([true, false, false, false, false, false, false])
  })

  it('edits a shared event only for the current zone', () => {
    const [ev] = routineEvents({ zones: [0, 2], days: wd, wake: 420, sleep: 1380, comfort: 21, eco: 18 })
    const edited = { ...ev, setpoint: 23 }
    const out = applyEdit([ev], ev, edited, 2, 'zone')
    expect(out.map((e) => [e.zones, e.setpoint])).toEqual([
      [[0], 21],
      [[2], 23],
    ])
    expect(applyEdit([ev], ev, edited, 2, 'all').map((e) => [e.zones, e.setpoint])).toEqual([[[0, 2], 23]])
    expect(applyDelete([ev], ev, 2, 'zone').map((e) => e.zones)).toEqual([[0]])
    expect(applyDelete([ev], ev, 2, 'all')).toEqual([])
  })

  it('groups conflicts into readable messages', () => {
    const base = routineEvents({ zones: [0], days: wd, wake: 420, sleep: 1380, comfort: 22, eco: 18 })
    const clash = { ...base[0], id: 'x', days: Array(7).fill(true), setpoint: 20.5 }
    const groups = groupConflicts([...base, clash])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ zone: 0, minute: 420, setpoints: [22, 20.5] })
    expect(groups[0].days).toEqual(wd)
  })

  it('names the real day of the next change', () => {
    const sat = new Date(2026, 9, 24, 11, 16) // Saturday
    expect(whenLabel(60, sat)).toBe('hoy')
    expect(whenLabel(20 * 60, sat)).toBe('mañana')
    expect(whenLabel(44 * 60, sat)).toBe('el lunes')
  })
})

describe('second review fixes', () => {
  const wd = [true, true, true, true, true, false, false]
  const we = [false, false, false, false, false, true, true]

  it('keeps Friday night when adding a weekend routine (N-01)', () => {
    const weekdays = routineEvents({ zones: [1], days: wd, wake: 420, sleep: 30, comfort: 21, eco: 18 })
    const weekend = routineEvents({ zones: [1], days: we, wake: 570, sleep: 30, comfort: 21, eco: 18 })
    const out = compact([...removeCoverage(weekdays, [1], we), ...weekend])
    // Saturday 00:30 (Friday night) must still drop to 18°.
    const sat = zoneTransitions(out, 1).filter((t) => t.day === 5)
    expect(sat.map((t) => [t.minute, t.setpoint])).toEqual([
      [30, 18],
      [570, 21],
    ])
    // And redoing weekdays does not touch the weekend nights.
    const redo = compact([...removeCoverage(out, [1], wd), ...weekdays])
    expect(zoneTransitions(redo, 1).filter((t) => t.day === 6).map((t) => t.minute)).toEqual([30, 570])
  })

  it('attributes small-hours changes to the previous day', () => {
    expect(logicalDays({ minute: 30, days: [false, true, true, true, true, true, false] })).toEqual(wd)
    expect(logicalDays({ minute: 420, days: wd })).toEqual(wd)
  })

  it('merges events only as much as needed (N-06)', () => {
    const [ev] = routineEvents({ zones: [0, 2], days: wd, wake: 420, sleep: 1380, comfort: 21, eco: 18 })
    const off = compact(applyEdit([ev], ev, { ...ev, enabled: false }, 0, 'zone'))
    const zone0 = off.find((e) => e.zones[0] === 0 && !e.enabled)!
    // Below the limit, re-enabling leaves two independent changes.
    expect(compact(applyEdit(off, zone0, { ...zone0, enabled: true }, 0, 'zone'))).toHaveLength(2)
    // Same zone, different days: always one change.
    const split = [{ ...ev, id: 'a', zones: [1], days: wd }, { ...ev, id: 'b', zones: [1], days: [false, false, false, false, false, true, true] }]
    expect(compact(split)).toHaveLength(1)
    // Over the limit, identical changes of different zones are joined to fit.
    const many = Array.from({ length: 31 }, (_, i) => ({ ...ev, id: `m${i}`, zones: [i % 8], minute: i < 16 ? 420 : 600 + i }))
    expect(compact(many).length).toBeLessThanOrEqual(30)
  })

  it('describes one or two days with full names', () => {
    expect(describeDays([false, false, false, false, false, true, false])).toBe('Sábado')
    expect(describeDays([true, false, false, false, false, false, true])).toBe('Lunes y Domingo')
  })
})

describe('updates', () => {
  it('compares versions', async () => {
    const { isNewer } = await import('../updates')
    expect(isNewer('v1.2.0', '1.1.9')).toBe(true)
    expect(isNewer('1.10.0', '1.9.3')).toBe(true)
    expect(isNewer('v1.0.0', '1.0.0')).toBe(false)
    expect(isNewer('0.9.0', '1.0.0')).toBe(false)
  })
})
