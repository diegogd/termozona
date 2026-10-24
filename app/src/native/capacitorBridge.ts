import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { NetworkError, type Bridge, type SocketHandle, type SocketListener } from '../core/bridge'

// Java side: android/app/src/main/java/es/termozona/app/OrkliNetPlugin.java
interface OrkliNetPlugin {
  httpGet(o: { url: string; headers: Record<string, string> }): Promise<{
    status: number
    headers: Record<string, string>
    body: string
  }>
  socketOpen(o: { host: string; port: number }): Promise<{ id: string }>
  socketWrite(o: { id: string; data: string }): Promise<void>
  socketClose(o: { id: string }): Promise<void>
  ftpStore(o: { host: string; user: string; password: string; files: { name: string; data: string }[] }): Promise<void>
  ftpRetrieve(o: { host: string; user: string; password: string; name: string }): Promise<{ data: string | null }>
  scanWifi(): Promise<{ networks: { ssid: string; level: number; frequency: number }[] }>
  provisionWifi(o: { ssid: string; password: string }): Promise<void>
  currentWifi(): Promise<{ ssid: string | null }>
  joinDeviceWifi(o: { ssid?: string }): Promise<{ ssid: string | null }>
  leaveDeviceWifi(): Promise<void>
  openWifiSettings(): Promise<void>
  addListener(
    event: 'socketData',
    fn: (e: { id: string; data: string }) => void,
  ): Promise<PluginListenerHandle>
  addListener(event: 'socketClosed', fn: (e: { id: string; reason?: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'provisionProgress', fn: (e: { percent: number }) => void): Promise<PluginListenerHandle>
  addListener(event: 'updateProgress', fn: (e: { percent: number }) => void): Promise<PluginListenerHandle>
  installUpdate(o: { url: string }): Promise<void>
  openUrl(o: { url: string }): Promise<void>
}

const OrkliNet = registerPlugin<OrkliNetPlugin>('OrkliNet')

export const toB64 = (b: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

export const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

function wrap(e: unknown): NetworkError {
  const msg = e instanceof Error ? e.message : String(e)
  const code = /timeout/i.test(msg)
    ? 'timeout'
    : /ssl|certificate|handshake/i.test(msg)
      ? 'tls'
      : /refused/i.test(msg)
        ? 'refused'
        : /unknownhost|unreachable|network/i.test(msg)
          ? 'offline'
          : 'unknown'
  return new NetworkError(msg, code)
}

const listeners = new Map<string, SocketListener>()
let wired = false

async function wire(): Promise<void> {
  if (wired) return
  wired = true
  await OrkliNet.addListener('socketData', (e) => listeners.get(e.id)?.onData(fromB64(e.data)))
  await OrkliNet.addListener('socketClosed', (e) => {
    const l = listeners.get(e.id)
    listeners.delete(e.id)
    l?.onClose(e.reason)
  })
}

export const isNativePlatform = (): boolean => Capacitor.isNativePlatform()

export const capacitorBridge: Bridge = {
  kind: 'native',

  async httpGet(url, headers = {}) {
    try {
      const r = await OrkliNet.httpGet({ url, headers })
      const lower: Record<string, string> = {}
      for (const [k, v] of Object.entries(r.headers)) lower[k.toLowerCase()] = v
      return { status: r.status, headers: lower, body: fromB64(r.body) }
    } catch (e) {
      throw wrap(e)
    }
  },

  async openSocket(host, port, listener): Promise<SocketHandle> {
    await wire()
    let id: string
    try {
      id = (await OrkliNet.socketOpen({ host, port })).id
    } catch (e) {
      throw wrap(e)
    }
    listeners.set(id, listener)
    return {
      write: async (data) => {
        try {
          await OrkliNet.socketWrite({ id, data: toB64(data) })
        } catch (e) {
          throw wrap(e)
        }
      },
      close: async () => {
        listeners.delete(id)
        await OrkliNet.socketClose({ id }).catch(() => undefined)
      },
    }
  },

  async ftpStore(host, user, password, files) {
    try {
      await OrkliNet.ftpStore({ host, user, password, files: files.map((f) => ({ name: f.name, data: toB64(f.data) })) })
    } catch (e) {
      throw wrap(e)
    }
  },

  async ftpRetrieve(host, user, password, name) {
    try {
      const { data } = await OrkliNet.ftpRetrieve({ host, user, password, name })
      return data === null ? null : fromB64(data)
    } catch (e) {
      throw wrap(e)
    }
  },

  async scanWifi() {
    const { networks } = await OrkliNet.scanWifi()
    return networks
  },

  async provisionWifi(ssid, password, onProgress) {
    const h = await OrkliNet.addListener('provisionProgress', (e) => onProgress(e.percent))
    try {
      await OrkliNet.provisionWifi({ ssid, password })
    } finally {
      await h.remove()
    }
  },

  async currentWifi() {
    try {
      return (await OrkliNet.currentWifi()).ssid
    } catch {
      return null
    }
  },

  async joinDeviceWifi(ssid) {
    try {
      const r = await OrkliNet.joinDeviceWifi({ ssid })
      return { ok: true, ssid: r.ssid ?? ssid }
    } catch (e) {
      return { ok: false, reason: (e as { code?: string }).code === 'UNSUPPORTED' ? 'unsupported' : 'unavailable' }
    }
  },

  async leaveDeviceWifi() {
    await OrkliNet.leaveDeviceWifi().catch(() => undefined)
  },

  async openWifiSettings() {
    await OrkliNet.openWifiSettings()
  },
}

/** Opens a link in the phone's browser; in the web build, a new tab. */
export async function openUrl(url: string): Promise<void> {
  if (!isNativePlatform()) {
    window.open(url, '_blank')
    return
  }
  await OrkliNet.openUrl({ url })
}

export type InstallResult = 'started' | 'permission' | 'error'

/** Downloads an APK and opens the system installer. */
export async function installUpdate(url: string, onProgress: (pct: number) => void): Promise<InstallResult> {
  const h = await OrkliNet.addListener('updateProgress', (e) => onProgress(e.percent))
  try {
    await OrkliNet.installUpdate({ url })
    return 'started'
  } catch (e) {
    return (e as { code?: string }).code === 'INSTALL_PERMISSION' ? 'permission' : 'error'
  } finally {
    await h.remove()
  }
}
