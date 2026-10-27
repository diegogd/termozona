// chronos.data: the schedule the Orkli cloud runs for the installation.
//
// Format (one record = 4 lines, after an optional "TZ:<zone>" line):
//   days      bit 0 = enabled, bits 1..7 = Monday..Sunday
//   date      epoch seconds; only the local hour and minute matter
//   zones     bit (z + 1) = zone z (0-based)
//   setpoint  °C, e.g. "21.5"
// The original app always keeps 30 records; unused ones are "0 0 0 18.0".

export const SCHEDULE_SLOTS = 30
export const DAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const
export const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const

export interface ScheduleEvent {
  id: string
  enabled: boolean
  /** Monday..Sunday */
  days: boolean[]
  /** Minutes since local midnight. */
  minute: number
  /** 0-based zone indexes. */
  zones: number[]
  setpoint: number
}

export interface Schedule {
  timeZone: string
  events: ScheduleEvent[]
}

let nextId = 0
export const newEventId = (): string => `ev${Date.now().toString(36)}${(nextId++).toString(36)}`

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid'
}

/** Hour and minute of an epoch in a given IANA time zone. */
function minuteOfDay(epochSeconds: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochSeconds * 1000))
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

/** Epoch seconds for today at the given minute of day in the given time zone. */
function epochForMinute(minute: number, timeZone: string, now = new Date()): number {
  // Start from UTC midnight of today and correct by the zone offset at that moment.
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, minute)
  const offsetMin = minuteOfDay(base / 1000, timeZone) - minute
  let epoch = base / 1000 - offsetMin * 60
  // Offsets near midnight can wrap a day; one correction pass is enough.
  const check = minuteOfDay(epoch, timeZone)
  if (check !== minute) epoch -= (check - minute) * 60
  return Math.round(epoch)
}

export function parseSchedule(text: string): Schedule {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  let timeZone = localTimeZone()
  let i = 0
  if (lines[0]?.startsWith('TZ:')) {
    timeZone = lines[0].slice(3) || timeZone
    i = 1
  }
  const events: ScheduleEvent[] = []
  for (; i + 3 < lines.length; i += 4) {
    const days = Number.parseInt(lines[i], 10)
    const date = Number.parseInt(lines[i + 1], 10)
    const zoneMask = Number.parseInt(lines[i + 2], 10)
    const setpoint = Number.parseFloat(lines[i + 3])
    if ([days, date, zoneMask, setpoint].some(Number.isNaN)) break
    // Unused slots: no days and no zones.
    if ((days & 0xfe) === 0 && zoneMask === 0) continue
    const zones: number[] = []
    for (let z = 0; z < 62; z++) if (Math.floor(zoneMask / 2 ** (z + 1)) % 2 === 1) zones.push(z)
    events.push({
      id: newEventId(),
      enabled: (days & 1) === 1,
      days: DAY_LABELS.map((_, d) => ((days >> (d + 1)) & 1) === 1),
      minute: minuteOfDay(date, timeZone),
      zones,
      setpoint,
    })
  }
  return { timeZone, events }
}

export function serializeSchedule(schedule: Schedule, now = new Date()): string {
  if (schedule.events.length > SCHEDULE_SLOTS) {
    throw new Error(`Máximo ${SCHEDULE_SLOTS} cambios programados`)
  }
  const tz = schedule.timeZone || localTimeZone()
  let out = `TZ:${tz}\n`
  for (const ev of schedule.events) {
    const days = ev.days.reduce((acc, on, d) => (on ? acc | (1 << (d + 1)) : acc), ev.enabled ? 1 : 0)
    const zoneMask = ev.zones.reduce((acc, z) => acc + 2 ** (z + 1), 0)
    const setpoint = Number.isInteger(ev.setpoint) ? ev.setpoint.toFixed(1) : String(ev.setpoint)
    out += `${days}\n${epochForMinute(ev.minute, tz, now)}\n${zoneMask}\n${setpoint}\n`
  }
  for (let i = schedule.events.length; i < SCHEDULE_SLOTS; i++) out += '0\n0\n0\n18.0\n'
  return out
}

// ---- helpers for the UI ----------------------------------------------------

export const formatMinute = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** Monday = 0 … Sunday = 6 */
export const weekday = (d: Date): number => (d.getDay() + 6) % 7

export function describeDays(days: boolean[]): string {
  const n = days.filter(Boolean).length
  if (n === 7) return 'Todos los días'
  if (n === 0) return 'Ningún día'
  if (n === 5 && days.slice(0, 5).every(Boolean)) return 'De lunes a viernes'
  if (n === 2 && days[5] && days[6]) return 'Fines de semana'
  const names = DAY_NAMES.filter((_, i) => days[i])
  if (n <= 2) return names.join(' y ')
  return names.map((d) => d.slice(0, 3).toLowerCase()).join(', ')
}

/** Changes before this time belong to the night of the previous day (bedtime after midnight). */
export const SMALL_HOURS = 5 * 60

/** The days an event "belongs" to: a 00:30 change on Saturday is Friday night. */
export function logicalDays(ev: Pick<ScheduleEvent, 'days' | 'minute'>): boolean[] {
  return ev.minute < SMALL_HOURS ? shiftDays(ev.days, -1) : ev.days
}

export interface Transition {
  day: number
  minute: number
  setpoint: number
  event: ScheduleEvent
}

/** Enabled changes affecting one zone, sorted through the week (Mon 00:00 first). */
export function zoneTransitions(events: ScheduleEvent[], zone: number): Transition[] {
  const out: Transition[] = []
  for (const ev of events) {
    if (!ev.enabled || !ev.zones.includes(zone)) continue
    ev.days.forEach((on, day) => on && out.push({ day, minute: ev.minute, setpoint: ev.setpoint, event: ev }))
  }
  return out.sort((a, b) => a.day * 1440 + a.minute - (b.day * 1440 + b.minute))
}

/** Next scheduled change for a zone after `now`, looking up to a week ahead. */
export function nextTransition(events: ScheduleEvent[], zone: number, now = new Date()): (Transition & { inMinutes: number }) | undefined {
  const t = zoneTransitions(events, zone)
  if (!t.length) return undefined
  const nowWeek = weekday(now) * 1440 + now.getHours() * 60 + now.getMinutes()
  let best: (Transition & { inMinutes: number }) | undefined
  for (const tr of t) {
    let delta = tr.day * 1440 + tr.minute - nowWeek
    if (delta <= 0) delta += 7 * 1440
    if (!best || delta < best.inMinutes) best = { ...tr, inMinutes: delta }
  }
  return best
}

/** "hoy", "mañana", "el lunes"… for a transition `inMinutes` from now. */
export function whenLabel(inMinutes: number, now = new Date()): string {
  const at = new Date(now.getTime() + inMinutes * 60_000)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000)
  if (days === 0) return 'hoy'
  if (days === 1) return 'mañana'
  return `el ${DAY_NAMES[weekday(at)].toLowerCase()}`
}

/** Setpoint in force for a zone at a given week minute, according to the schedule only. */
export function scheduledSetpointAt(transitions: Transition[], weekMinute: number): number | undefined {
  if (!transitions.length) return undefined
  let current = transitions[transitions.length - 1].setpoint // wraps from the previous week
  for (const tr of transitions) {
    if (tr.day * 1440 + tr.minute <= weekMinute) current = tr.setpoint
    else break
  }
  return current
}

/** What the schedule set last for a zone (and so what it "says" now), if it has any change. */
export function scheduledSetpointNow(events: ScheduleEvent[], zone: number, now = new Date()): number | undefined {
  return scheduledSetpointAt(zoneTransitions(events, zone), weekday(now) * 1440 + now.getHours() * 60 + now.getMinutes())
}

/**
 * True when the zone is not at what the schedule set: changed by hand, or the
 * schedule was edited in the middle of a period. The thermostat only applies a
 * change at its time, so it stays like this until the next one.
 */
export function differsFromSchedule(setpoint: number | undefined, scheduled: number | undefined): boolean {
  return setpoint !== undefined && scheduled !== undefined && Math.abs(setpoint - scheduled) >= 0.25
}

export interface Conflict {
  zone: number
  day: number
  minute: number
  events: ScheduleEvent[]
}

/** Enabled events that set different temperatures for the same zone, day and time. */
export function findConflicts(events: ScheduleEvent[]): Conflict[] {
  const map = new Map<string, ScheduleEvent[]>()
  for (const ev of events) {
    if (!ev.enabled) continue
    for (const z of ev.zones)
      ev.days.forEach((on, d) => {
        if (!on) return
        const key = `${z}:${d}:${ev.minute}`
        map.set(key, [...(map.get(key) ?? []), ev])
      })
  }
  const out: Conflict[] = []
  for (const [key, evs] of map) {
    if (evs.length < 2 || new Set(evs.map((e) => e.setpoint)).size < 2) continue
    const [zone, day, minute] = key.split(':').map(Number)
    out.push({ zone, day, minute, events: evs })
  }
  return out
}

export interface ConflictGroup {
  zone: number
  minute: number
  days: boolean[]
  events: ScheduleEvent[]
  setpoints: number[]
}

/** Conflicts grouped by zone, time and the events involved, for messages people can read. */
export function groupConflicts(events: ScheduleEvent[]): ConflictGroup[] {
  const groups = new Map<string, ConflictGroup>()
  for (const c of findConflicts(events)) {
    const key = `${c.zone}:${c.minute}:${c.events.map((e) => e.id).sort().join(',')}`
    const g = groups.get(key) ?? {
      zone: c.zone,
      minute: c.minute,
      days: Array(7).fill(false),
      events: c.events,
      setpoints: [...new Set(c.events.map((e) => e.setpoint))].sort((a, b) => b - a),
    }
    g.days[c.day] = true
    groups.set(key, g)
  }
  return [...groups.values()]
}

export interface RoutineInput {
  zones: number[]
  days: boolean[]
  wake: number
  sleep: number
  comfort: number
  eco: number
  /** Optional away block (leave, back) in minutes of day. */
  away?: { leave: number; back: number }
}

/** Builds the events for a simple daily routine (comfort while awake, eco otherwise). */
export function routineEvents(r: RoutineInput): ScheduleEvent[] {
  const base = { enabled: true, days: [...r.days], zones: [...r.zones] }
  const evs: ScheduleEvent[] = [{ ...base, id: newEventId(), minute: r.wake, setpoint: r.comfort }]
  if (r.away) {
    evs.push({ ...base, id: newEventId(), minute: r.away.leave, setpoint: r.eco })
    evs.push({ ...base, id: newEventId(), minute: r.away.back, setpoint: r.comfort })
  }
  // Going to bed after midnight happens on the following day.
  const sleepDays = sleepsAfterMidnight(r) ? shiftDays(r.days, 1) : [...r.days]
  evs.push({ ...base, days: sleepDays, id: newEventId(), minute: r.sleep, setpoint: r.eco })
  return evs
}

/** Bedtime earlier than wake-up time means the small hours of the next day. */
export const sleepsAfterMidnight = (r: Pick<RoutineInput, 'wake' | 'sleep'>): boolean => r.sleep < r.wake

/** Moves each selected day `n` days later (Sunday wraps to Monday). */
export function shiftDays(days: boolean[], n: number): boolean[] {
  return days.map((_, i) => days[(i - n + 7 * 7) % 7])
}

// ---- scoped edits ---------------------------------------------------------------
//
// An event can cover several zones (that is how "copy to other zones" saves
// slots). Editing it from one zone's tab must not change the others unless the
// user asks for it, so these helpers split the event when needed.

export type EditScope = 'zone' | 'all'

/** Replaces `original` with `edited`, only for `zone` when scope is 'zone'. */
export function applyEdit(events: ScheduleEvent[], original: ScheduleEvent, edited: ScheduleEvent, zone: number, scope: EditScope): ScheduleEvent[] {
  if (scope === 'all' || original.zones.length < 2 || !original.zones.includes(zone)) {
    return events.map((e) => (e.id === original.id ? edited : e))
  }
  const rest = { ...original, zones: original.zones.filter((z) => z !== zone) }
  const mine = { ...edited, id: newEventId(), zones: [zone] }
  return events.flatMap((e) => (e.id === original.id ? [rest, mine] : [e]))
}

/** Deletes `ev`, or only removes `zone` from it when scope is 'zone'. */
export function applyDelete(events: ScheduleEvent[], ev: ScheduleEvent, zone: number, scope: EditScope): ScheduleEvent[] {
  if (scope === 'all' || ev.zones.length < 2) return events.filter((e) => e.id !== ev.id)
  return events.map((e) => (e.id === ev.id ? { ...e, zones: e.zones.filter((z) => z !== zone) } : e))
}

/**
 * Removes the given zones on the given days from every event, splitting events
 * that also cover other zones or days so those keep working as before.
 */
export function removeCoverage(events: ScheduleEvent[], zones: number[], days: boolean[]): ScheduleEvent[] {
  const out: ScheduleEvent[] = []
  for (const ev of events) {
    // `days` are logical days: a small-hours change on day d+1 belongs to day d.
    const evDays = ev.minute < SMALL_HOURS ? shiftDays(days, 1) : days
    const hitZones = ev.zones.filter((z) => zones.includes(z))
    const hitDays = ev.days.some((d, i) => d && evDays[i])
    if (!hitZones.length || !hitDays) {
      out.push(ev)
      continue
    }
    const otherZones = ev.zones.filter((z) => !zones.includes(z))
    if (otherZones.length) out.push({ ...ev, zones: otherZones })
    const otherDays = ev.days.map((d, i) => d && !evDays[i])
    if (otherDays.some(Boolean)) out.push({ ...ev, id: newEventId(), zones: hitZones, days: otherDays })
  }
  return out
}

/** Makes `targets` follow exactly the schedule of `source`, without using new slots. */
export function copyZoneSchedule(events: ScheduleEvent[], source: number, targets: number[]): ScheduleEvent[] {
  const others = targets.filter((t) => t !== source)
  const cleared = removeCoverage(events, others, Array(7).fill(true))
  return cleared.map((ev) =>
    ev.zones.includes(source) ? { ...ev, zones: [...new Set([...ev.zones, ...others])].sort((a, b) => a - b) } : ev,
  )
}

/** Drops events that no longer do anything (no zones or no days). */
/**
 * Drops events that do nothing (no zones or no days) and merges events of the
 * same zones that only differ in their days. Events of different zones are only
 * merged when needed to fit in the 30 slots, because merged zones show up as
 * linked ("También en …") and people did not ask for that.
 */
export function compact(events: ScheduleEvent[]): ScheduleEvent[] {
  const live = events.filter((e) => e.zones.length && e.days.some(Boolean))
  const merge = (list: ScheduleEvent[], key: (e: ScheduleEvent) => string, join: (a: ScheduleEvent, b: ScheduleEvent) => ScheduleEvent) => {
    const out: ScheduleEvent[] = []
    const byKey = new Map<string, number>()
    for (const e of list) {
      const k = key(e)
      const at = byKey.get(k)
      if (at === undefined) {
        byKey.set(k, out.length)
        out.push(e)
      } else out[at] = join(out[at], e)
    }
    return out
  }
  const base = (e: ScheduleEvent) => `${e.minute}|${e.setpoint}|${e.enabled}`
  const sameZones = merge(live, (e) => `${base(e)}|${e.zones.join(',')}`, (a, b) => ({ ...a, days: a.days.map((d, i) => d || b.days[i]) }))
  if (sameZones.length <= SCHEDULE_SLOTS) return sameZones
  const sameDays = merge(sameZones, (e) => `${base(e)}|${e.days.map(Number).join('')}`, (a, b) => ({
    ...a,
    zones: [...new Set([...a.zones, ...b.zones])].sort((x, y) => x - y),
  }))
  return merge(sameDays, (e) => `${base(e)}|${e.zones.join(',')}`, (a, b) => ({ ...a, days: a.days.map((d, i) => d || b.days[i]) }))
}
