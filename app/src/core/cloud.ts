// Orkli / Ingenium cloud API, as used by Orkli iDomus 3.5.001.

import { unzipSync } from 'fflate'
import { NetworkError, type Bridge, type FtpFile } from './bridge'

export const LOCATE_HOST = 's2.ingeniumsl.com'
export const DEFAULT_DOMAIN = 's2.ingeniumsl.com'
export const S3_DOMAIN = 's3.ingeniumsl.com'
export const S3_IP = '46.26.48.204'
export const DEFAULT_SERVER_IP = '85.152.52.212'
export const SOCKET_PORT = 2041
export const APP_VERSION = '3.5.001-440'
const ACCOUNT_URL = 'http://85.152.52.212:8080/WebServices/Altas/add_filezilla_user.php'

export interface Credentials {
  user: string
  password: string
}

export interface CloudSession {
  user: string
  domain: string
  /** Host name for the TLS socket (x-server, or the s3 IP). */
  socketHost: string
  /** FTP server (x-server-ip). */
  ftpHost: string
  ident: string
  token: string
  lastModified?: string
}

export interface LoginResult {
  session: CloudSession
  /** Files of project.zip; empty when the server answered 304. */
  project: Record<string, Uint8Array>
}

export type LoginErrorCode = 'unknown-user' | 'credentials' | 'banned' | 'schedule' | 'server' | 'device-offline' | 'network' | 'unknown'

export class LoginError extends Error {
  readonly code: LoginErrorCode

  constructor(code: LoginErrorCode, message: string) {
    super(message)
    this.name = 'LoginError'
    this.code = code
  }
}

const LOGIN_MESSAGES: Record<LoginErrorCode, string> = {
  'unknown-user': 'No existe ninguna cuenta con ese usuario. Revisa cómo lo escribiste (mayúsculas, puntos, espacios) o crea una cuenta nueva.',
  credentials: 'Usuario o contraseña incorrectos. Revisa mayúsculas y espacios.',
  banned: 'Esta cuenta está bloqueada temporalmente por demasiados intentos. Espera unos minutos.',
  schedule: 'Esta cuenta solo puede entrar en un horario concreto, y ahora está fuera de él.',
  server: 'El servidor de Orkli tiene un problema ahora mismo. Inténtalo más tarde.',
  'device-offline': 'Tu TermoWifi no está conectado a internet. Comprueba que está encendido y que tu Wi-Fi funciona.',
  network: 'No hay conexión a internet en el móvil.',
  unknown: 'No se ha podido entrar. Inténtalo de nuevo.',
}

export const loginMessage = (code: LoginErrorCode): string => LOGIN_MESSAGES[code]

export const basicAuth = (user: string, password: string): string =>
  `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${password}`)))}`

const text = (b: Uint8Array): string => new TextDecoder().decode(b)

/**
 * Finds which cloud server holds the account (MainActivity.locateEthbus()).
 * The official app falls back to s3 on any error, but s3 no longer answers
 * (checked 2026-10-24), so a typo in the user name hangs it. Here an unknown
 * user (404) is reported as such and other errors fall back to s2.
 */
export async function locate(bridge: Bridge, user: string): Promise<string> {
  let res
  try {
    res = await bridge.httpGet(`https://${LOCATE_HOST}:8877/api/locate_ethbus?user=${encodeURIComponent(user)}`, {
      Authorization: basicAuth('', ''),
    })
  } catch (e) {
    throw new LoginError('network', e instanceof Error ? e.message : String(e))
  }
  if (res.status === 404) throw new LoginError('unknown-user', LOGIN_MESSAGES['unknown-user'])
  if (res.status !== 200) return DEFAULT_DOMAIN
  return text(res.body).trim() || DEFAULT_DOMAIN
}

export async function login(bridge: Bridge, creds: Credentials, lastModified?: string): Promise<LoginResult> {
  const user = creds.user.trim()
  const domain = await locate(bridge, user)
  const host = domain === S3_DOMAIN ? S3_IP : domain
  const headers: Record<string, string> = { Authorization: basicAuth(user, creds.password) }
  if (lastModified) headers['If-Modified-Since'] = lastModified
  let res
  try {
    res = await bridge.httpGet(`https://${host}:8877/login`, headers)
  } catch (e) {
    throw new LoginError('network', e instanceof Error ? e.message : String(e))
  }
  const byStatus: Record<number, LoginErrorCode> = { 401: 'credentials', 403: 'banned', 423: 'schedule', 500: 'server' }
  if (res.status !== 200 && res.status !== 304) {
    const code = byStatus[res.status] ?? 'unknown'
    throw new LoginError(code, LOGIN_MESSAGES[code])
  }
  const h = res.headers
  if (!h['x-server-ip']) throw new LoginError('device-offline', LOGIN_MESSAGES['device-offline'])
  const session: CloudSession = {
    user,
    domain,
    socketHost: domain === S3_DOMAIN ? S3_IP : h['x-server'] || h['x-server-ip'],
    ftpHost: domain === S3_DOMAIN ? S3_IP : h['x-server-ip'],
    ident: h['x-ident'] ?? '',
    token: h['x-token'] ?? '',
    lastModified: h['last-modified'],
  }
  let project: Record<string, Uint8Array> = {}
  if (res.status === 200 && res.body.length) {
    try {
      project = unzipSync(res.body)
    } catch {
      project = {}
    }
  }
  return { session, project }
}

/** First message on the cloud socket: 19 FA <len16> <DeviceData JSON>. */
export function socketHello(token: string, info = 'start comunicacion'): Uint8Array {
  const json = new TextEncoder().encode(
    JSON.stringify({
      deviceName: 'TermoZona',
      info,
      osVersion: '34',
      token,
      brand: 'TermoZona',
      model: 'TermoZona',
      appVersion: APP_VERSION,
    }),
  )
  const out = new Uint8Array(json.length + 4)
  out.set([0x19, 0xfa, json.length >> 8, json.length & 0xff])
  out.set(json, 4)
  return out
}

// ---- account creation -------------------------------------------------------

export type AccountErrorCode = 'invalid' | 'exists' | 'server' | 'network' | 'unexpected'

export class AccountError extends Error {
  readonly code: AccountErrorCode

  constructor(code: AccountErrorCode, message: string) {
    super(message)
    this.name = 'AccountError'
    this.code = code
  }
}

export const USERNAME_RULES = 'Entre 4 y 30 caracteres: letras sin tildes, números, punto, guion o guion bajo.'
export const PASSWORD_RULES = 'Entre 6 y 30 caracteres. Sin espacios ni tildes.'

export function validateUsername(user: string): string | undefined {
  if (!/^[A-Za-z0-9._-]{4,30}$/.test(user)) return USERNAME_RULES
  return undefined
}

export function validatePassword(password: string): string | undefined {
  // The server stores it as an FTP password and it travels in a URL, so keep it to printable ASCII.
  if (!/^[\x21-\x7e]{6,30}$/.test(password)) return PASSWORD_RULES
  return undefined
}

/** pass_ident check value, from ConfigureTermowifiUserActivity.getCrcAlta(). */
export function accountCrc(user: string, password: string, ident: string): string {
  let out = ''
  for (let i = 0; i < 7; i++) {
    if (i >= user.length || i >= password.length) out += 'A'
    else out += String.fromCharCode(((user.charCodeAt(i) ^ password.charCodeAt(i) ^ ident.charCodeAt(i)) & 119) | 65)
  }
  return out
}

export interface CreatedAccount {
  token: string
}

export async function createAccount(bridge: Bridge, creds: Credentials, ident: string): Promise<CreatedAccount> {
  const q = new URLSearchParams({
    user_name: creds.user,
    user_password: creds.password,
    user_ident: ident,
    pass_ident: accountCrc(creds.user, creds.password, ident),
  })
  let res
  try {
    res = await bridge.httpGet(`${ACCOUNT_URL}?${q}`)
  } catch (e) {
    throw new AccountError('network', 'No hay conexión a internet. Comprueba la red y vuelve a intentarlo.')
  }
  const body = text(res.body)
  const code = /Error\((-?\d+)\)/.exec(body)?.[1]
  if (code === '-1') throw new AccountError('invalid', 'El servidor no acepta ese usuario o contraseña. ' + USERNAME_RULES)
  if (code === '-2') throw new AccountError('exists', 'Ese nombre de usuario ya existe.')
  if (code) throw new AccountError('server', `El servidor no ha podido crear la cuenta (código ${code}). Inténtalo más tarde.`)
  if (res.status !== 200) {
    throw new AccountError('server', `El servidor ha respondido con un error (${res.status}). Inténtalo más tarde.`)
  }
  return { token: res.headers['x-token'] ?? '' }
}

/** Uploads the files the official app expects for a TermoWifi project. */
export async function uploadProject(
  bridge: Bridge,
  host: string,
  creds: Credentials,
  instal: string,
  extra: FtpFile[] = [],
): Promise<void> {
  const enc = new TextEncoder()
  await bridge.ftpStore(host, creds.user, creds.password, [
    { name: 'Instal.dat', data: enc.encode(instal) },
    { name: 'termowifi.data', data: new Uint8Array(0) },
    ...extra,
  ])
}

export async function uploadSchedule(bridge: Bridge, session: CloudSession, password: string, chronos: string): Promise<void> {
  const enc = new TextEncoder()
  await bridge.ftpStore(session.ftpHost, session.user, password, [
    { name: 'chronos.data', data: enc.encode(chronos) },
    { name: 'sync', data: enc.encode('sync') },
  ])
}

export { NetworkError }

/** True if an account with that name exists, false if not, undefined if unknown (no network). */
export async function userExists(bridge: Bridge, user: string): Promise<boolean | undefined> {
  try {
    const res = await bridge.httpGet(`https://${LOCATE_HOST}:8877/api/locate_ethbus?user=${encodeURIComponent(user)}`, {
      Authorization: basicAuth('', ''),
    })
    if (res.status === 404) return false
    if (res.status === 200) return true
    return undefined
  } catch {
    return undefined
  }
}
