// In-memory Orkli cloud + TermoWifi used by "Modo demostración", the browser
// dev server and the tests. It speaks the same bytes as the real cloud.

import { strToU8, zipSync } from 'fflate'
import type { Bridge, FtpFile, HttpResponse, SocketHandle, SocketListener } from '../core/bridge'
import { buildInstal } from '../core/installation'
import { routineEvents, serializeSchedule } from '../core/schedule'

const enc = new TextEncoder()
const STORE_KEY = 'termozona.demo.files'

export const DEMO_USER = 'demo'
export const DEMO_PASSWORD = 'demo1234'
/** Account names that already exist, to exercise the "user already exists" path. */
export const DEMO_TAKEN_USERS = ['vecino', 'demo']

const DEMO_ZONES = [
  { index: 0, name: 'Salón' },
  { index: 1, name: 'Despacho' },
  { index: 2, name: 'Dormitorio' },
]

interface Zone {
  state: number
  mode: number
  setpoint: number // raw (°C * 2)
  ambient: number // °C
  humidity: number // raw
}

function loadFiles(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveFiles(files: Record<string, string>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(files))
  } catch {
    // private mode: keep it in memory only
  }
}

export interface DemoOptions {
  /** Milliseconds of simulated network latency. */
  latency?: number
  /** Fail the next socket opens (to test reconnection). */
  failSockets?: number
  /** Reset the connection on the Nth write of each listed socket (1-based), like the real cloud did once. */
  resetOnWrite?: number[]
}

export function createDemoBridge(opts: DemoOptions = {}): Bridge {
  const latency = opts.latency ?? 250
  let failSockets = opts.failSockets ?? 0
  const resets = [...(opts.resetOnWrite ?? [])]
  const files = loadFiles()
  files['Instal.dat'] ??= buildInstal(DEMO_ZONES)
  files['chronos.data'] ??= serializeSchedule({
    timeZone: 'Europe/Madrid',
    events: routineEvents({
      zones: [0],
      days: [true, true, true, true, true, false, false],
      wake: 7 * 60,
      sleep: 23 * 60,
      comfort: 21,
      eco: 18,
    }),
  })
  const zones: Zone[] = [
    { state: 3, mode: 2, setpoint: 42, ambient: 20.5, humidity: 0 },
    { state: 2, mode: 2, setpoint: 38, ambient: 19.0, humidity: 0 },
    { state: 3, mode: 2, setpoint: 40, ambient: 19.5, humidity: 125 },
  ]
  const wait = (ms = latency) => new Promise((r) => setTimeout(r, ms))
  /** Device network the simulated phone joined during Wi-Fi setup. */
  let joined: string | null = null

  const zip = () => {
    const entries: Record<string, Uint8Array> = {}
    for (const [k, v] of Object.entries(files)) entries[k] = strToU8(v)
    return zipSync(entries)
  }

  return {
    kind: 'demo',

    async httpGet(url, headers = {}): Promise<HttpResponse> {
      await wait()
      const u = new URL(url)
      if (u.pathname === '/api/locate_ethbus') {
        const user = u.searchParams.get('user') ?? ''
        const accounts = JSON.parse(files['accounts.json'] ?? '{}') as Record<string, string>
        const known = user === DEMO_USER || DEMO_TAKEN_USERS.includes(user) || user in accounts
        return known ? { status: 200, headers: {}, body: enc.encode('s2.ingeniumsl.com') } : { status: 404, headers: {}, body: new Uint8Array() }
      }
      if (u.pathname === '/login') {
        const auth = atob((headers.Authorization ?? '').replace('Basic ', ''))
        const [user, pass] = [auth.slice(0, auth.indexOf(':')), auth.slice(auth.indexOf(':') + 1)]
        const accounts = JSON.parse(files['accounts.json'] ?? '{}') as Record<string, string>
        const ok = (user === DEMO_USER && pass === DEMO_PASSWORD) || accounts[user] === pass
        if (!ok) return { status: 401, headers: {}, body: new Uint8Array() }
        const idents = JSON.parse(files['idents.json'] ?? '{}') as Record<string, string>
        return {
          status: 200,
          headers: {
            'x-ident': idents[user] ?? 'WDEMO01',
            'x-token': 'demo-token',
            'x-server-ip': '127.0.0.1',
            'x-server': 'demo.local',
            'last-modified': new Date().toUTCString(),
          },
          body: zip(),
        }
      }
      if (u.pathname.endsWith('add_filezilla_user.php')) {
        const user = u.searchParams.get('user_name') ?? ''
        const pass = u.searchParams.get('user_password') ?? ''
        const accounts = JSON.parse(files['accounts.json'] ?? '{}') as Record<string, string>
        if (DEMO_TAKEN_USERS.includes(user.toLowerCase()) || accounts[user]) {
          return { status: 200, headers: {}, body: enc.encode('Error(-2)') }
        }
        accounts[user] = pass
        files['accounts.json'] = JSON.stringify(accounts)
        const idents = JSON.parse(files['idents.json'] ?? '{}') as Record<string, string>
        idents[user] = u.searchParams.get('user_ident') ?? 'WDEMO01'
        files['idents.json'] = JSON.stringify(idents)
        saveFiles(files)
        return { status: 200, headers: { 'x-token': 'demo-token' }, body: enc.encode('OK') }
      }
      return { status: 404, headers: {}, body: new Uint8Array() }
    },

    async openSocket(_host, _port, listener: SocketListener): Promise<SocketHandle> {
      await wait()
      if (failSockets > 0) {
        failSockets--
        throw new Error('demo: connection refused')
      }
      let open = true
      let buf = new Uint8Array(0)
      let helloSeen = false
      let writes = 0
      const resetAt = resets.shift()

      const emit = (dst: number, org: number, cmd: number, d1: number, d2: number) => {
        if (!open) return
        setTimeout(() => open && listener.onData(Uint8Array.of(0xfe, 0xfe, 0, dst, 0, org, cmd, d1, d2)), latency)
      }
      const reportZone = (z: number) => {
        const zone = zones[z]
        if (!zone) return
        emit(1, 1, 4, z * 4, zone.state)
        emit(1, 1, 4, z * 4 + 1, zone.mode)
        emit(1, 1, 4, z * 4 + 2, zone.setpoint)
        emit(1, 1, 4, z * 4 + 3, Math.round(162 - zone.ambient * 2))
        if (zone.humidity) emit(1, 1, 4, 0x64 + z, zone.humidity)
      }
      // Like the real TermoWifi: 0x23 only reports global registers.
      const dump = () => {
        emit(1, 1, 4, 0x32, 0)
        emit(1, 1, 4, 0x35, 0b1100)
      }
      const handle = (d1: number, d2: number) => {
        emit(254, 1, 1, d1, 0) // ACK
        if (d1 === 0x23) return dump()
        const z = Math.floor(d1 / 4)
        const zone = zones[z]
        if (!zone || d1 >= 32) return
        switch (d1 % 4) {
          case 0:
            zone.state = d2
            break
          case 1:
            // Mode is shared by the whole installation.
            zones.forEach((other) => (other.mode = (other.mode & 0xf0) | (d2 & 0x0f)))
            zones.forEach((_, i) => emit(1, 1, 4, i * 4 + 1, zones[i].mode))
            return
          case 2:
            zone.setpoint = d2
            break
          case 3:
            return reportZone(z)
        }
        emit(1, 1, 4, d1, d2)
      }

      // Rooms drift toward the setpoint when their zone is on.
      const sim = setInterval(() => {
        zones.forEach((zone, z) => {
          const target = zone.state & 1 ? zone.setpoint / 2 : 17
          const diff = target - zone.ambient
          if (Math.abs(diff) < 0.25) return
          zone.ambient += Math.sign(diff) * 0.5
          emit(1, 1, 4, z * 4 + 3, Math.round(162 - zone.ambient * 2))
        })
      }, 15_000)

      return {
        async write(data) {
          if (!open) throw new Error('socket closed')
          if (++writes === resetAt) {
            open = false
            clearInterval(sim)
            setTimeout(() => listener.onClose('Connection reset'), 0)
            throw new Error('Connection reset')
          }
          if (!helloSeen && data[0] === 0x19 && data[1] === 0xfa) {
            helloSeen = true
            return
          }
          const merged = new Uint8Array(buf.length + data.length)
          merged.set(buf)
          merged.set(data, buf.length)
          let pos = 0
          while (merged.length - pos >= 9) {
            const f = merged.subarray(pos, pos + 9)
            pos += 9
            if (f[0] === 0xff && f[1] === 0xff && f[6] === 4) {
              emit(1, 254, 4, f[7], f[8]) // the cloud echoes app commands
              handle(f[7], f[8])
            }
          }
          buf = merged.slice(pos)
        },
        async close() {
          open = false
          clearInterval(sim)
        },
      }
    },

    async ftpStore(_host, user, password, list: FtpFile[]) {
      await wait(latency * 3)
      const accounts = JSON.parse(files['accounts.json'] ?? '{}') as Record<string, string>
      const ok = (user === DEMO_USER && password === DEMO_PASSWORD) || accounts[user] === password
      if (!ok) throw new Error('530 Login incorrect')
      const dec = new TextDecoder()
      for (const f of list) if (f.name !== 'sync') files[f.name] = dec.decode(f.data)
      saveFiles(files)
    },

    async ftpRetrieve(_host, _user, _password, name) {
      await wait()
      return files[name] === undefined ? null : enc.encode(files[name])
    },

    async scanWifi() {
      await wait(800)
      return [
        { ssid: 'Ing_A1B2C3', level: -48, frequency: 2437 },
        { ssid: 'MiFibra-7F2A', level: -60, frequency: 2412 },
        { ssid: 'MiFibra-7F2A_5G', level: -63, frequency: 5180 },
        { ssid: 'Vecino_5G', level: -82, frequency: 5500 },
      ]
    },

    async provisionWifi(_ssid, _password, onProgress) {
      for (let p = 0; p <= 100; p += 10) {
        onProgress(p)
        await wait(120)
      }
      joined = null
    },

    async currentWifi() {
      return joined ?? 'MiFibra-7F2A'
    },

    async joinDeviceWifi(ssid) {
      await wait(1200)
      joined = ssid ?? 'Ing_A1B2C3'
      return { ok: true, ssid: joined }
    },

    async leaveDeviceWifi() {
      joined = null
    },
  }
}

export function resetDemo(): void {
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    // ignore
  }
}
