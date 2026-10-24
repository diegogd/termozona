// App state and the live connection to the TermoWifi through the cloud.

import type { Bridge, SocketHandle } from './bridge'
import {
  LoginError,
  SOCKET_PORT,
  login,
  loginMessage,
  socketHello,
  uploadSchedule,
  type CloudSession,
  type Credentials,
} from './cloud'
import { cleanZoneName, parseInstal, renameInInstal, type ZoneInfo } from './installation'
import {
  CMD_WRITE,
  FrameParser,
  MAX_ZONES,
  REG_FULL_DUMP,
  applyReport,
  cloudCommand,
  emptyDeviceState,
  encodeSetpoint,
  modeValue,
  stateValue,
  zoneRegister,
  type DeviceState,
  type ModeNumber,
} from './protocol'
import {
  SCHEDULE_SLOTS,
  parseSchedule,
  scheduledSetpointAt,
  serializeSchedule,
  weekday,
  zoneTransitions,
  type Schedule,
  type ScheduleEvent,
} from './schedule'
import type { KeyValueStore } from './storage'
import { checkForUpdate, isNewer, type UpdateInfo } from './updates'

export type Phase = 'boot' | 'signedOut' | 'signingIn' | 'ready'
export type Link = 'connecting' | 'online' | 'reconnecting' | 'offline'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

export interface PendingWrite {
  /** Field shown to the user until the device confirms it. */
  field: 'setpoint' | 'on' | 'mode'
  value: number | boolean
  expires: number
}

export interface AppState {
  phase: Phase
  link: Link
  user?: string
  ident?: string
  zones: ZoneInfo[]
  device: DeviceState
  /** zone index -> pending writes */
  pending: Record<number, PendingWrite[]>
  schedule: Schedule | null
  scheduleSaving: boolean
  lastUpdate?: number
  loginError?: string
  toasts: Toast[]
  demo: boolean
  /** "Me voy unos días" mode, if active. */
  away?: AwayState
  /** Schedule uploaded but the cloud has not been told to reload it yet. */
  scheduleSyncPending?: boolean
  /** A newer APK published on GitHub, if any. */
  update?: UpdateInfo
}

export interface AwayState {
  since: number
  temp: number
  /** Signatures of the events that were enabled before leaving. */
  enabled: string[]
  /** Setpoint of each zone before leaving. */
  setpoints: Record<number, number>
}

interface Persisted {
  creds: Credentials
  session: CloudSession
  zones: ZoneInfo[]
  device: DeviceState
  schedule: Schedule | null
  lastUpdate?: number
  instal?: string
  away?: AwayState
  scheduleSyncPending?: boolean
}

const STORAGE_KEY = 'termozona.session.v1'
const UPDATE_KEY = 'termozona.update-check.v1'
const UPDATE_EVERY_MS = 24 * 3600_000
/** Away state is kept in the cloud too, so other phones and new sessions see it. */
const AWAY_FILE = 'termozona-away.json'
const ALIAS_KEY = 'termozona.aliases.v1'
const PENDING_MS = 12_000
const POLL_MS = 90_000
const SEND_GAP_MS = 300
const RESEND_WAIT_MS = 8_000
const BACKOFF_MS = [2_000, 5_000, 10_000, 30_000]

export class Controller {
  private state: AppState = {
    phase: 'boot',
    link: 'offline',
    zones: [],
    device: emptyDeviceState(),
    pending: {},
    schedule: null,
    scheduleSaving: false,
    toasts: [],
    demo: false,
  }
  private listeners = new Set<() => void>()
  private bridge: Bridge
  private readonly store: KeyValueStore
  private readonly bridgeFactory: (demo: boolean) => Bridge
  private creds?: Credentials
  private session?: CloudSession
  private socket?: SocketHandle
  private parser = new FrameParser()
  private queue: Promise<void> = Promise.resolve()
  private retry = 0
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private pollTimer?: ReturnType<typeof setInterval>
  private debounce = new Map<string, ReturnType<typeof setTimeout>>()
  private toastId = 0
  private aliases: Record<number, string> = {}
  private socketGeneration = 0
  private instal?: string

  constructor(bridgeFactory: (demo: boolean) => Bridge, store: KeyValueStore) {
    this.bridgeFactory = bridgeFactory
    this.store = store
    this.bridge = bridgeFactory(false)
  }

  /** Looks for a newer version on GitHub, at most once a day. */
  async checkUpdates(current: string, force = false): Promise<void> {
    const last = await this.store.get<{ at: number; update?: UpdateInfo }>(UPDATE_KEY)
    if (!force && last && Date.now() - last.at < UPDATE_EVERY_MS) {
      if (last.update && isNewer(last.update.version, current)) this.set({ update: last.update })
      return
    }
    const update = await checkForUpdate(this.bridgeFactory(false), current)
    await this.store.set(UPDATE_KEY, { at: Date.now(), update })
    this.set({ update })
  }

  /** A bridge for flows that run before there is a session (account setup). */
  setupBridge(demo: boolean): Bridge {
    return this.bridgeFactory(demo)
  }

  // ---- store plumbing -------------------------------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getState = (): AppState => this.state

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  toast(kind: Toast['kind'], text: string, ms = kind === 'error' ? 10_000 : 6000): void {
    if (this.state.toasts.some((t) => t.text === text)) return
    const t = { id: ++this.toastId, kind, text }
    this.set({ toasts: [...this.state.toasts, t] })
    setTimeout(() => this.dismissToast(t.id), ms)
  }

  dismissToast(id: number): void {
    this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) })
  }

  // ---- session ---------------------------------------------------------------

  async boot(): Promise<void> {
    this.aliases = (await this.store.get<Record<number, string>>(ALIAS_KEY)) ?? {}
    const saved = await this.store.get<Persisted & { demo?: boolean }>(STORAGE_KEY)
    if (!saved) return this.set({ phase: 'signedOut' })
    this.creds = saved.creds
    this.session = saved.session
    this.instal = saved.instal
    this.bridge = this.bridgeFactory(!!saved.demo)
    // Show the last known state right away, then refresh in the background.
    this.set({
      phase: 'ready',
      demo: !!saved.demo,
      user: saved.session.user,
      ident: saved.session.ident,
      zones: this.withAliases(saved.zones),
      device: saved.device,
      schedule: saved.schedule,
      lastUpdate: saved.lastUpdate,
      away: saved.away,
      scheduleSyncPending: saved.scheduleSyncPending,
      link: 'connecting',
    })
    void this.refreshSession()
  }

  async signIn(creds: Credentials, demo = false): Promise<boolean> {
    this.set({ phase: 'signingIn', loginError: undefined })
    this.bridge = this.bridgeFactory(demo)
    try {
      const { session, project } = await login(this.bridge, creds)
      this.creds = { user: creds.user.trim(), password: creds.password }
      this.session = session
      this.set({ away: undefined })
      this.applyProject(project)
      await this.loadAwayFromCloud(project)
      this.set({ phase: 'ready', demo, user: session.user, ident: session.ident, device: emptyDeviceState(), pending: {} })
      await this.persist()
      void this.connect()
      return true
    } catch (e) {
      const msg = e instanceof LoginError ? loginMessage(e.code) : 'No se ha podido entrar. Inténtalo de nuevo.'
      this.set({ phase: 'signedOut', loginError: msg })
      return false
    }
  }

  async signOut(): Promise<void> {
    this.disconnect()
    this.creds = undefined
    this.session = undefined
    await this.store.remove(STORAGE_KEY)
    this.set({
      phase: 'signedOut',
      link: 'offline',
      user: undefined,
      ident: undefined,
      zones: [],
      device: emptyDeviceState(),
      pending: {},
      schedule: null,
      loginError: undefined,
      demo: false,
      away: undefined,
      scheduleSyncPending: false,
    })
    this.instal = undefined
  }

  /** Re-login (to refresh the token and project) and reconnect the socket. */
  async refreshSession(): Promise<void> {
    if (!this.creds) return
    this.set({ link: this.state.link === 'online' ? 'online' : 'connecting' })
    try {
      const { session, project } = await login(this.bridge, this.creds)
      this.session = session
      this.applyProject(project)
      await this.loadAwayFromCloud(project)
      await this.persist()
      this.disconnect()
      await this.connect()
    } catch (e) {
      if (e instanceof LoginError && (e.code === 'credentials' || e.code === 'unknown-user')) {
        await this.signOut()
        this.set({ loginError: 'La contraseña ha cambiado. Vuelve a entrar.' })
        return
      }
      const msg = e instanceof LoginError ? loginMessage(e.code) : 'Sin conexión con la nube.'
      this.set({ link: 'offline' })
      this.toast('error', msg, 6000)
      this.scheduleReconnect()
    }
  }

  private applyProject(project: Record<string, Uint8Array>): void {
    const dec = new TextDecoder()
    if (project['Instal.dat']) {
      this.instal = dec.decode(project['Instal.dat'])
      this.set({ zones: this.withAliases(parseInstal(this.instal)) })
    }
    if (project[AWAY_FILE]) this.set({ away: parseAway(dec.decode(project[AWAY_FILE])) })
    if (project['chronos.data']) this.set({ schedule: parseSchedule(dec.decode(project['chronos.data'])) })
    else if (Object.keys(project).length && !this.state.schedule) this.set({ schedule: { timeZone: '', events: [] } })
  }

  private async persist(): Promise<void> {
    if (!this.creds || !this.session) return
    const data: Persisted & { demo: boolean } = {
      creds: this.creds,
      session: this.session,
      zones: this.state.zones,
      device: this.state.device,
      schedule: this.state.schedule,
      lastUpdate: this.state.lastUpdate,
      demo: this.state.demo,
      instal: this.instal,
      away: this.state.away,
      scheduleSyncPending: this.state.scheduleSyncPending,
    }
    await this.store.set(STORAGE_KEY, data)
  }

  // ---- zone names ------------------------------------------------------------
  //
  // Names live in Instal.dat in the cloud, so every phone (and the official app)
  // sees them. If the upload fails the name is kept only on this phone.

  private withAliases(zones: ZoneInfo[]): ZoneInfo[] {
    return zones.map((z) => ({ ...z, name: this.aliases[z.index] || z.name }))
  }

  /** Returns 'cloud' when every phone will see the new name, 'local' otherwise. */
  async renameZone(index: number, name: string): Promise<'cloud' | 'local'> {
    const clean = cleanZoneName(name)
    if (!clean) return 'local'
    const patched = this.instal && renameInInstal(this.instal, index, clean)
    let where: 'cloud' | 'local' = 'local'
    if (patched && this.session && this.creds) {
      try {
        await this.bridge.ftpStore(this.session.ftpHost, this.creds.user, this.creds.password, [
          { name: 'Instal.dat', data: new TextEncoder().encode(patched) },
        ])
        this.instal = patched
        delete this.aliases[index]
        where = 'cloud'
      } catch {
        this.aliases[index] = clean
      }
    } else {
      this.aliases[index] = clean
    }
    await this.store.set(ALIAS_KEY, this.aliases)
    this.set({ zones: this.state.zones.map((z) => (z.index === index ? { ...z, name: clean } : z)) })
    await this.persist()
    return where
  }

  // ---- socket ----------------------------------------------------------------

  private async connect(): Promise<void> {
    if (!this.session) return
    const gen = ++this.socketGeneration
    const sockRef: { current?: SocketHandle } = {}
    this.parser = new FrameParser()
    this.set({ link: this.retry ? 'reconnecting' : 'connecting' })
    try {
      const sock = await this.bridge.openSocket(this.session.socketHost, SOCKET_PORT, {
        onData: (d) => gen === this.socketGeneration && this.onData(d),
        // A failed write may already have handled this socket's loss.
        onClose: () => gen === this.socketGeneration && this.socket === sockRef.current && this.onSocketClosed(),
      })
      if (gen !== this.socketGeneration) return void sock.close()
      this.socket = sockRef.current = sock
      await sock.write(socketHello(this.session.token))
      this.retry = 0
      this.set({ link: 'online' })
      this.requestDump()
      clearInterval(this.pollTimer)
      this.pollTimer = setInterval(() => this.requestDump(), POLL_MS)
      if (this.state.scheduleSyncPending) void this.syncSchedule().then((ok) => ok && this.toast('success', 'Tu horario ya está aplicado.'))
    } catch {
      if (gen === this.socketGeneration) this.onSocketClosed()
    }
  }

  private disconnect(): void {
    this.socketGeneration++
    clearInterval(this.pollTimer)
    clearTimeout(this.reconnectTimer)
    const s = this.socket
    this.socket = undefined
    void s?.close().catch(() => undefined)
  }

  private onSocketClosed(): void {
    this.socket = undefined
    clearInterval(this.pollTimer)
    this.set({ link: 'reconnecting' })
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    clearTimeout(this.reconnectTimer)
    if (!this.creds) return
    const wait = BACKOFF_MS[Math.min(this.retry, BACKOFF_MS.length - 1)]
    this.retry++
    // After a few socket failures the token may have expired: log in again.
    this.reconnectTimer = setTimeout(() => (this.retry > 2 ? this.refreshSession() : this.connect()), wait)
  }

  /** Called when the app comes back to the foreground. */
  resume(): void {
    if (this.state.phase !== 'ready') return
    if (this.socket) this.requestDump()
    else {
      this.retry = 0
      void this.refreshSession()
    }
  }

  private onData(chunk: Uint8Array): void {
    const frames = this.parser.push(chunk)
    if (!frames.length) return
    const device = structuredClone(this.state.device)
    const pending = { ...this.state.pending }
    let touched = false
    for (const f of frames) {
      const zone = applyReport(device, f)
      if (zone === undefined && f.cmd !== CMD_WRITE) continue
      touched = true
      if (zone !== undefined && pending[zone]) pending[zone] = this.confirmPending(pending[zone], device, zone)
    }
    if (!touched) return
    this.set({ device, pending, lastUpdate: Date.now(), link: 'online' })
    void this.persist()
  }

  private confirmPending(list: PendingWrite[], device: DeviceState, zone: number): PendingWrite[] {
    const z = device.zones[zone]
    return list.filter((p) => {
      if (p.field === 'setpoint') return z.setpoint !== p.value
      if (p.field === 'on') return z.on !== p.value
      return z.mode !== p.value
    })
  }

  /** Resolves true as soon as the socket is (re)connected, false after `ms`. */
  private waitOnline(ms: number): Promise<boolean> {
    if (this.socket) return Promise.resolve(true)
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer)
        unsubscribe()
        resolve(ok)
      }
      const timer = setTimeout(() => done(false), ms)
      const unsubscribe = this.subscribe(() => this.socket && done(true))
    })
  }

  /**
   * Sends one command. The cloud sometimes resets the connection right as we
   * write (seen on 2026-10-24: the identifier frame went out, the telegram did
   * not); in that case wait for the reconnection and send the whole command again.
   */
  private send(d1: number, d2: number, cmd = CMD_WRITE, dst?: number): Promise<void> {
    const attempt = async () => {
      const sock = this.socket
      if (!sock || !this.session) throw new Error('offline')
      try {
        for (const part of cloudCommand(this.session.ident, cmd, d1, d2, dst)) {
          await sock.write(part)
          await new Promise((r) => setTimeout(r, SEND_GAP_MS))
        }
      } catch (e) {
        if (this.socket === sock) this.onSocketClosed()
        throw e
      }
    }
    const job = async () => {
      try {
        await attempt()
      } catch {
        if (!(await this.waitOnline(RESEND_WAIT_MS))) throw new Error('offline')
        await attempt()
      }
    }
    const p = this.queue.then(job, job)
    this.queue = p.catch(() => undefined)
    return p
  }

  /**
   * Refreshes everything. 0x23 only returns the global registers, so each zone
   * is read on its own (z*4+3 = 0), like the official app's polling.
   */
  requestDump(): void {
    const known = new Set([...this.state.zones.map((z) => z.index), ...Object.keys(this.state.device.zones).map(Number)])
    const zones = known.size ? [...known] : [...Array(MAX_ZONES).keys()]
    void this.send(REG_FULL_DUMP, 0).catch(() => undefined)
    for (const z of zones) void this.send(zoneRegister(z, 3), 0).catch(() => undefined)
  }

  // ---- commands ----------------------------------------------------------------

  private addPending(zone: number, p: Omit<PendingWrite, 'expires'>): void {
    const list = (this.state.pending[zone] ?? []).filter((x) => x.field !== p.field)
    this.set({ pending: { ...this.state.pending, [zone]: [...list, { ...p, expires: Date.now() + PENDING_MS }] } })
    setTimeout(() => this.expirePending(zone, p.field), PENDING_MS + 100)
  }

  private expirePending(zone: number, field: PendingWrite['field']): void {
    const list = this.state.pending[zone]
    const stale = list?.find((p) => p.field === field && p.expires <= Date.now())
    if (!stale) return
    this.set({ pending: { ...this.state.pending, [zone]: list.filter((p) => p !== stale) } })
    const name = this.state.zones.find((z) => z.index === zone)?.name ?? `Zona ${zone + 1}`
    this.toast('error', `${name}: el termostato no ha confirmado el cambio. Comprueba la conexión.`, 6000)
  }

  private ensureOnline(): boolean {
    // While reconnecting, commands wait in the queue (see send()).
    if (this.socket || this.state.link === 'reconnecting' || this.state.link === 'connecting') return true
    this.toast('error', 'Sin conexión con tu calefacción. Reintentando…')
    this.resume()
    return false
  }

  setSetpoint(zone: number, celsius: number): void {
    if (!this.ensureOnline()) return
    const v = encodeSetpoint(celsius)
    this.addPending(zone, { field: 'setpoint', value: v / 2 })
    const key = `sp${zone}`
    clearTimeout(this.debounce.get(key))
    this.debounce.set(
      key,
      setTimeout(() => {
        void this.send(zoneRegister(zone, 2), v)
          .then(() => this.send(zoneRegister(zone, 3), 0))
          .catch(() => this.toast('error', 'No se ha podido enviar el cambio.'))
      }, 700),
    )
  }

  setPower(zone: number, on: boolean): void {
    if (!this.ensureOnline()) return
    const raw = this.state.device.zones[zone]?.rawState
    this.addPending(zone, { field: 'on', value: on })
    void this.send(zoneRegister(zone, 0), stateValue(raw, on))
      .then(() => this.send(zoneRegister(zone, 3), 0))
      .catch(() => this.toast('error', 'No se ha podido enviar el cambio.'))
  }

  /** Heating/cooling is shared by the whole installation; the TermoWifi propagates it. */
  setMode(mode: ModeNumber): void {
    if (!this.ensureOnline()) return
    const zones = Object.values(this.state.device.zones)
    const first = zones[0]?.index ?? 0
    const raw = this.state.device.zones[first]?.rawMode
    for (const z of zones) this.addPending(z.index, { field: 'mode', value: mode })
    const v = modeValue(raw, mode)
    // The app writes the mode twice, one second apart, on TermoWifi installations.
    void this.send(zoneRegister(first, 1), v)
      .then(() => new Promise((r) => setTimeout(r, 1000)))
      .then(() => this.send(zoneRegister(first, 1), v))
      .then(() => this.requestDump())
      .catch(() => this.toast('error', 'No se ha podido cambiar el modo.'))
  }

  // ---- schedule ------------------------------------------------------------------

  async saveSchedule(events: ScheduleEvent[]): Promise<boolean> {
    if (!this.session || !this.creds) return false
    const schedule: Schedule = { timeZone: this.state.schedule?.timeZone || '', events }
    let chronos: string
    try {
      chronos = serializeSchedule(schedule)
    } catch {
      this.toast('error', `No caben más de ${SCHEDULE_SLOTS} cambios en el horario. Borra alguno o aplica el cambio a todas las zonas.`)
      return false
    }
    this.set({ scheduleSaving: true })
    try {
      await uploadSchedule(this.bridge, this.session, this.creds.password, chronos)
    } catch {
      this.set({ scheduleSaving: false })
      this.toast('error', 'No se ha podido guardar el horario: no ha llegado a la nube. Tu horario anterior sigue igual. Vuelve a intentarlo en un momento.')
      return false
    }
    // Keep the edited events (and their ids) so open screens stay consistent.
    this.set({ schedule: { ...schedule, timeZone: parseSchedule(chronos).timeZone }, scheduleSaving: false, scheduleSyncPending: true })
    await this.persist()
    if (await this.syncSchedule()) this.toast('success', 'Horario guardado en la nube.')
    else this.toast('info', 'Horario guardado. Se aplicará en cuanto vuelva la conexión con tu calefacción.')
    return true
  }

  /** Tells the cloud to reload chronos.data (ChronothermostatsActivity.syncChronothermostats). */
  private async syncSchedule(): Promise<boolean> {
    if (!this.socket) return false
    try {
      await this.send(12, 0, 122, 254)
      await this.send(255, 255, 122, 254)
      this.set({ scheduleSyncPending: false })
      await this.persist()
      return true
    } catch {
      return false
    }
  }

  // ---- away mode ------------------------------------------------------------------

  /** The project zip may not carry our file; only ask the FTP when the schedule looks paused. */
  private async loadAwayFromCloud(project: Record<string, Uint8Array>): Promise<void> {
    if (project[AWAY_FILE] || !this.session || !this.creds) return
    const events = this.state.schedule?.events ?? []
    if (!events.length || events.some((e) => e.enabled)) return
    try {
      const data = await this.bridge.ftpRetrieve(this.session.ftpHost, this.creds.user, this.creds.password, AWAY_FILE)
      if (data) this.set({ away: parseAway(new TextDecoder().decode(data)) })
    } catch {
      // keep what we had
    }
  }

  private async storeAway(away: AwayState | undefined): Promise<void> {
    if (!this.session || !this.creds) return
    try {
      await this.bridge.ftpStore(this.session.ftpHost, this.creds.user, this.creds.password, [
        { name: AWAY_FILE, data: new TextEncoder().encode(JSON.stringify(away ?? {})) },
      ])
    } catch {
      // Local state still works on this phone; the paused-schedule notice covers the rest.
    }
  }

  /** Re-enables every change, for schedules paused elsewhere (e.g. by another phone). */
  async enableAllChanges(): Promise<boolean> {
    const events = this.state.schedule?.events ?? []
    return this.saveSchedule(events.map((e) => ({ ...e, enabled: true })))
  }

  /**
   * "Me voy unos días": keeps every zone at `temp` and pauses the schedule.
   * The cloud cannot undo it on a date, so the user ends it with endAway().
   */
  async startAway(temp: number): Promise<boolean> {
    const events = this.state.schedule?.events ?? []
    const setpoints: Record<number, number> = {}
    for (const z of Object.values(this.state.device.zones)) if (z.setpoint !== undefined) setpoints[z.index] = z.setpoint
    const away: AwayState = { since: Date.now(), temp, enabled: events.filter((e) => e.enabled).map(eventSignature), setpoints }
    if (events.some((e) => e.enabled) && !(await this.saveSchedule(events.map((e) => ({ ...e, enabled: false }))))) return false
    for (const z of Object.keys(setpoints).map(Number)) this.setSetpoint(z, temp)
    this.set({ away })
    await this.persist()
    await this.storeAway(away)
    return true
  }

  async endAway(): Promise<boolean> {
    const away = this.state.away
    if (!away) return true
    const events = this.state.schedule?.events ?? []
    const restored = events.map((e) => ({ ...e, enabled: e.enabled || away.enabled.includes(eventSignature(e)) }))
    if (away.enabled.length && !(await this.saveSchedule(restored))) return false
    // Use what the schedule says for right now; fall back to the temperature before leaving.
    const now = new Date()
    const weekMinute = weekday(now) * 1440 + now.getHours() * 60 + now.getMinutes()
    for (const [z, before] of Object.entries(away.setpoints)) {
      const scheduled = scheduledSetpointAt(zoneTransitions(restored, Number(z)), weekMinute)
      this.setSetpoint(Number(z), scheduled ?? before)
    }
    this.set({ away: undefined })
    await this.persist()
    await this.storeAway(undefined)
    return true
  }
}

function parseAway(text: string): AwayState | undefined {
  try {
    const a = JSON.parse(text) as Partial<AwayState>
    return typeof a.since === 'number' && typeof a.temp === 'number' && Array.isArray(a.enabled)
      ? { since: a.since, temp: a.temp, enabled: a.enabled, setpoints: a.setpoints ?? {} }
      : undefined
  } catch {
    return undefined
  }
}

const eventSignature = (e: ScheduleEvent): string => `${e.days.map(Number).join('')}|${e.minute}|${e.zones.join(',')}|${e.setpoint}`
