// New-account setup: find the zones of a TermoWifi and upload its project,
// as ConfigureTermowifiUserActivity does, but resumable step by step.

import type { Bridge, FtpFile } from './bridge'
import { DEFAULT_DOMAIN, SOCKET_PORT, socketHello, uploadProject, type Credentials } from './cloud'
import { buildInstal, type ZoneInfo } from './installation'
import { FrameParser, MAX_ZONES, cloudCommand, decodeAmbient, isStatusReport, zoneRegister } from './protocol'

export interface DiscoveryOptions {
  /** Called every time a new zone answers. */
  onZone?: (zone: number) => void
  /** Room temperature reported by a zone, to help people tell zones apart. */
  onAmbient?: (zone: number, celsius: number) => void
  onProgress?: (pct: number) => void
  /** Wait per request, like the 3 s of the official app. */
  stepMs?: number
  passes?: number
  signal?: AbortSignal
}

/**
 * Asks every zone for its values (two passes) and returns the zones that
 * answered with a non-zero setpoint.
 */
export async function discoverZones(
  bridge: Bridge,
  ident: string,
  token: string,
  opts: DiscoveryOptions = {},
  host = DEFAULT_DOMAIN,
): Promise<number[]> {
  const stepMs = opts.stepMs ?? 3000
  const passes = opts.passes ?? 2
  const found = new Set<number>()
  const parser = new FrameParser()
  let closed = false
  const sock = await bridge.openSocket(host, SOCKET_PORT, {
    onData: (d) => {
      for (const f of parser.push(d)) {
        if (isStatusReport(f) && f.d1 < MAX_ZONES * 4 && f.d1 % 4 === 3) {
          const c = decodeAmbient(f.d2)
          if (c !== undefined) opts.onAmbient?.(Math.floor(f.d1 / 4), c)
        }
        if (!isStatusReport(f) || f.d1 >= MAX_ZONES * 4 || f.d1 % 4 !== 2 || f.d2 === 0) continue
        const z = Math.floor(f.d1 / 4)
        if (!found.has(z)) {
          found.add(z)
          opts.onZone?.(z)
        }
      }
    },
    onClose: () => (closed = true),
  })
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  try {
    await sock.write(socketHello(token, 'generate termowifi instal'))
    await sleep(1000)
    const total = passes * MAX_ZONES
    let done = 0
    for (let pass = 0; pass < passes; pass++) {
      for (let z = 0; z < MAX_ZONES; z++) {
        done++
        if (found.has(z)) continue
        if (opts.signal?.aborted || closed) break
        for (const part of cloudCommand(ident, 4, zoneRegister(z, 3), 0)) {
          await sock.write(part)
          await sleep(300)
        }
        await sleep(stepMs)
        opts.onProgress?.(Math.round((done / total) * 100))
      }
      // Everything answered in the first pass: no need for a second one.
      if (found.size === MAX_ZONES) break
    }
    opts.onProgress?.(100)
  } finally {
    await sock.close()
  }
  if (closed && !found.size) throw new Error('La conexión con la nube se ha cortado durante la búsqueda.')
  return [...found].sort((a, b) => a - b)
}

async function compatFiles(): Promise<FtpFile[]> {
  // The official app expects these next to Instal.dat, so accounts created here
  // can also be opened from Orkli iDomus. They are blank placeholders with the
  // official dimensions (see public/compat/README.md).
  const out: FtpFile[] = []
  for (const name of ['Plano0.jpg', 'iconos_t0.png']) {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}compat/${name}`)
      if (res.ok) out.push({ name, data: new Uint8Array(await res.arrayBuffer()) })
    } catch {
      // not fatal: the new app does not need them
    }
  }
  return out
}

export async function uploadSetup(bridge: Bridge, ftpHost: string, creds: Credentials, zones: ZoneInfo[]): Promise<void> {
  await uploadProject(bridge, ftpHost, creds, buildInstal(zones), await compatFiles())
}

export const ROOM_SUGGESTIONS = ['Salón', 'Cocina', 'Dormitorio', 'Habitación niños', 'Despacho', 'Baño', 'Entrada', 'Buhardilla']
