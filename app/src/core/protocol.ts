// TermoWifi register protocol over the Orkli / Ingenium cloud socket.
// See PROTOCOL.md in the Home Assistant integration for the register map.

export const TERMOWIFI_ADDR = 0x01
export const APP_ADDR = 0xfe
export const CMD_WRITE = 0x04
export const CMD_ACK = 0x01
export const MAX_ZONES = 8

export const REG_FULL_DUMP = 0x23
export const REG_DEW_ALARM = 0x32
export const REG_AVAILABLE_MODES = 0x35
export const REG_HUMIDITY_BASE = 0x64

export const SETPOINT_MIN = 15
export const SETPOINT_MAX = 35

export interface Frame {
  dst: number
  org: number
  cmd: number
  d1: number
  d2: number
}

/** Mode nibble (bits 0..3 of register r=1). Odd = cooling, even = heating. */
export type ModeNumber = 1 | 2 | 3 | 4 | 5 | 6

export const MODE_LABELS: Record<ModeNumber, string> = {
  1: 'Frío por aire',
  2: 'Calor por suelo',
  3: 'Frío por suelo',
  4: 'Calor por aire',
  5: 'Frío suelo + aire',
  6: 'Calor suelo + aire',
}

export function isCoolingMode(mode: number): boolean {
  return mode % 2 === 1
}

export interface ZoneState {
  index: number
  /** Raw state register, kept so bit 1 survives on/off writes. */
  rawState?: number
  /** Raw mode register, kept so the fan speed nibble survives mode writes. */
  rawMode?: number
  on?: boolean
  mode?: number
  setpoint?: number
  ambient?: number
  humidity?: number
  updatedAt?: number
}

export interface DeviceState {
  zones: Record<number, ZoneState>
  availableModes: ModeNumber[]
  dewAlarm: number
}

export function emptyDeviceState(): DeviceState {
  return { zones: {}, availableModes: [], dewAlarm: 0 }
}

// ---- value encoding -------------------------------------------------------

export const decodeSetpoint = (v: number): number | undefined => (v ? v / 2 : undefined)
export const encodeSetpoint = (c: number): number =>
  Math.round(Math.min(SETPOINT_MAX, Math.max(SETPOINT_MIN, c)) * 2)

export const decodeAmbient = (v: number): number | undefined => (v >= 62 ? (162 - v) / 2 : undefined)

export const decodeHumidity = (v: number): number | undefined =>
  v === 0 || v === 255 ? undefined : Math.round((v / 2.55) * 10) / 10

export function decodeModes(mask: number): ModeNumber[] {
  const modes: ModeNumber[] = []
  for (let m = 1; m <= 6; m++) if (mask & (1 << m)) modes.push(m as ModeNumber)
  return modes
}

export const zoneRegister = (zone: number, r: 0 | 1 | 2 | 3): number => zone * 4 + r

// ---- frames ---------------------------------------------------------------

/** Bytes for one command on the cloud socket: identifier frame + 9-byte telegram. */
export function cloudCommand(ident: string, cmd: number, d1: number, d2: number, dst = TERMOWIFI_ADDR): Uint8Array[] {
  const id = new Uint8Array(9)
  id[0] = 0xee
  id[1] = 0xee
  const idBytes = new TextEncoder().encode(ident).slice(0, 7)
  id.set(idBytes, 2)
  const telegram = Uint8Array.of(0xff, 0xff, dst >> 8, dst & 0xff, APP_ADDR, APP_ADDR, cmd, d1 & 0xff, d2 & 0xff)
  return [id, telegram]
}

/** Splits the incoming byte stream into 9-byte frames, resyncing on the FE FE header. */
export class FrameParser {
  private buf = new Uint8Array(0)

  push(chunk: Uint8Array): Frame[] {
    const merged = new Uint8Array(this.buf.length + chunk.length)
    merged.set(this.buf)
    merged.set(chunk, this.buf.length)
    let pos = 0
    const frames: Frame[] = []
    while (merged.length - pos >= 9) {
      if (merged[pos] !== 0xfe || merged[pos + 1] !== 0xfe) {
        pos++
        continue
      }
      const b = merged.subarray(pos, pos + 9)
      frames.push({ dst: (b[2] << 8) | b[3], org: (b[4] << 8) | b[5], cmd: b[6], d1: b[7], d2: b[8] })
      pos += 9
    }
    this.buf = merged.slice(pos)
    return frames
  }
}

/** A TermoWifi status report has DST == ORG == the TermoWifi address. */
export function isStatusReport(f: Frame): boolean {
  return f.cmd === CMD_WRITE && f.dst === TERMOWIFI_ADDR && f.org === TERMOWIFI_ADDR
}

/** Applies a status report to the device state. Returns the zone touched, if any. */
export function applyReport(state: DeviceState, f: Frame, now = Date.now()): number | undefined {
  if (!isStatusReport(f)) return undefined
  const { d1, d2 } = f
  if (d1 < MAX_ZONES * 4) {
    const index = Math.floor(d1 / 4)
    const zone = (state.zones[index] ??= { index })
    switch (d1 % 4) {
      case 0:
        zone.rawState = d2
        zone.on = (d2 & 1) === 1
        break
      case 1:
        zone.rawMode = d2
        zone.mode = d2 & 0x0f
        break
      case 2:
        zone.setpoint = decodeSetpoint(d2)
        break
      case 3:
        zone.ambient = decodeAmbient(d2)
        break
    }
    zone.updatedAt = now
    return index
  }
  if (d1 >= REG_HUMIDITY_BASE && d1 < REG_HUMIDITY_BASE + MAX_ZONES) {
    const index = d1 - REG_HUMIDITY_BASE
    const zone = (state.zones[index] ??= { index })
    zone.humidity = decodeHumidity(d2)
    zone.updatedAt = now
    return index
  }
  if (d1 === REG_AVAILABLE_MODES) state.availableModes = decodeModes(d2)
  else if (d1 === REG_DEW_ALARM) state.dewAlarm = d2
  return undefined
}

/** Value to write to the state register to turn a zone on or off (mirrors the app). */
export function stateValue(raw: number | undefined, on: boolean): number {
  const v = raw ?? 0
  return on ? v | 3 : v & 2
}

/** Value to write to the mode register, keeping the fan speed nibble. */
export function modeValue(raw: number | undefined, mode: ModeNumber): number {
  return ((raw ?? 0) & 0xf0) | mode
}

/** True when the zone is on and actively asking for heat or cold. */
export function isDemanding(z: ZoneState): boolean {
  if (!z.on || z.setpoint === undefined || z.ambient === undefined || z.mode === undefined) return false
  return isCoolingMode(z.mode) ? z.ambient > z.setpoint : z.ambient < z.setpoint
}
