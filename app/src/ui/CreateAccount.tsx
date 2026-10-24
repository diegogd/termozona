import { useEffect, useMemo, useRef, useState } from 'react'
import type { Bridge, WifiNetwork } from '../core/bridge'
import {
  AccountError,
  DEFAULT_SERVER_IP,
  LoginError,
  createAccount,
  login,
  loginMessage,
  userExists,
  validatePassword,
  validateUsername,
  type Credentials,
} from '../core/cloud'
import { deviceIdFromInput, type ZoneInfo } from '../core/installation'
import { ROOM_SUGGESTIONS, discoverZones, uploadSetup } from '../core/setup'
import { useController } from './app-context'
import { Field, Illustration } from './components'

type Step = 'intro' | 'wifi' | 'device' | 'account' | 'creating' | 'exists' | 'zones' | 'upload' | 'done'

const STEP_ORDER: Step[] = ['intro', 'device', 'account', 'zones', 'done']

interface Ready {
  token: string
  ident: string
  ftpHost: string
  socketHost?: string
}

export function CreateAccount({ onExit, demo }: { onExit: () => void; demo: boolean }) {
  const c = useController()
  const bridge: Bridge = useMemo(() => c.setupBridge(demo), [c, demo])
  const [step, setStep] = useState<Step>('intro')
  const [error, setError] = useState<string>()

  // device
  const [deviceInput, setDeviceInput] = useState('')
  const [networks, setNetworks] = useState<WifiNetwork[] | null>(null)
  const [scanning, setScanning] = useState(false)
  // wifi provisioning
  const [ssid, setSsid] = useState('')
  const [wifiPass, setWifiPass] = useState('')
  const [wifiProgress, setWifiProgress] = useState<number | null>(null)
  // account
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [touched, setTouched] = useState(false)
  // setup
  const [ready, setReady] = useState<Ready>()
  const [progress, setProgress] = useState(0)
  const [found, setFound] = useState<number[]>([])
  const [names, setNames] = useState<Record<number, string>>({})
  const [ambient, setAmbient] = useState<Record<number, number>>({})
  const [resumePass, setResumePass] = useState('')
  const [forgot, setForgot] = useState(false)
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const [taken, setTaken] = useState<boolean | undefined>()
  useEffect(() => {
    setTaken(undefined)
    const name = user.trim()
    if (validateUsername(name)) return
    let live = true
    const t = setTimeout(() => void userExists(bridge, name).then((v) => live && setTaken(v)), 600)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [user, bridge])

  const ident = deviceIdFromInput(deviceInput)
  const creds: Credentials = { user: user.trim(), password }
  const userError = touched ? validateUsername(creds.user) : undefined
  const passError = touched ? validatePassword(password) : undefined
  const pass2Error = touched && password2 !== password ? 'Las dos contraseñas no coinciden.' : undefined

  const go = (s: Step) => {
    setError(undefined)
    setStep(s)
  }

  const scan = async () => {
    if (!bridge.scanWifi) return
    setScanning(true)
    setError(undefined)
    try {
      setNetworks(await bridge.scanWifi())
    } catch {
      setError('No se ha podido buscar redes. Escribe el nombre a mano.')
    } finally {
      setScanning(false)
    }
  }

  const provision = async () => {
    if (!bridge.provisionWifi) return
    setError(undefined)
    setWifiProgress(0)
    try {
      await bridge.provisionWifi(ssid, wifiPass, setWifiProgress)
      setWifiProgress(100)
    } catch {
      setWifiProgress(null)
      setError(
        'No se han podido enviar los datos. Comprueba que el móvil está conectado a la red Wi-Fi del TermoWifi (Ing_…) y vuelve a intentarlo.',
      )
    }
  }

  const startDiscovery = async (r: Ready) => {
    setReady(r)
    go('zones')
    setFound([])
    setProgress(0)
    setBusy(true)
    abort.current = new AbortController()
    try {
      const zones = await discoverZones(
        bridge,
        r.ident,
        r.token,
        {
          stepMs: demo ? 300 : 1500,
          signal: abort.current.signal,
          onZone: (z) => setFound((f) => [...new Set([...f, z])].sort((a, b) => a - b)),
          onAmbient: (z, c) => setAmbient((a) => ({ ...a, [z]: c })),
          onProgress: setProgress,
        },
        r.socketHost,
      )
      if (!zones.length) {
        setError(
          'No hemos encontrado ninguna zona. Comprueba que el TermoWifi tiene la luz de conexión encendida y que está conectado a tu Wi-Fi, y vuelve a buscar.',
        )
      }
    } catch {
      setError('Se ha cortado la conexión mientras buscábamos las zonas. Vuelve a intentarlo.')
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    setTouched(true)
    if (!ident || validateUsername(creds.user) || validatePassword(password) || password2 !== password) return
    if (taken === true) {
      setResumePass(password)
      return go('exists')
    }
    go('creating')
    try {
      const { token } = await createAccount(bridge, creds, ident)
      await startDiscovery({ token, ident, ftpHost: DEFAULT_SERVER_IP })
    } catch (e) {
      if (e instanceof AccountError && e.code === 'exists') {
        setResumePass(password)
        return go('exists')
      }
      setStep('account')
      setError(e instanceof Error ? e.message : 'No se ha podido crear la cuenta.')
    }
  }

  /** The name exists: maybe it is this neighbour's half-finished account. */
  const resume = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const { session } = await login(bridge, { user: creds.user, password: resumePass })
      setPassword(resumePass)
      setPassword2(resumePass)
      if (ident && session.ident && session.ident !== ident) {
        setError(`Esa cuenta existe, pero está unida a otro TermoWifi (${session.ident.replace(/^W/, 'Ing_')}). Elige otro nombre de usuario.`)
        return
      }
      await startDiscovery({ token: session.token, ident: session.ident || ident!, ftpHost: session.ftpHost, socketHost: session.socketHost })
    } catch (e) {
      if (e instanceof LoginError && e.code === 'credentials') {
        setError('La contraseña no coincide con la de esa cuenta. Prueba otra vez con la que pusiste la primera vez.')
      } else {
        setError(e instanceof LoginError ? loginMessage(e.code) : 'No se ha podido comprobar la cuenta.')
      }
    } finally {
      setBusy(false)
    }
  }

  const upload = async () => {
    if (!ready) return
    setBusy(true)
    setError(undefined)
    go('upload')
    const zones: ZoneInfo[] = found.map((z) => ({ index: z, name: names[z]?.trim() || `Zona ${z + 1}` }))
    try {
      await uploadSetup(bridge, ready.ftpHost, creds, zones)
      go('done')
    } catch {
      setStep('zones')
      setError('No se ha podido guardar la configuración en la nube. Tu cuenta ya está creada: pulsa "Guardar" otra vez para reintentarlo.')
    } finally {
      setBusy(false)
    }
  }

  const stepIndex = Math.max(0, STEP_ORDER.indexOf(step === 'wifi' ? 'intro' : step === 'creating' || step === 'exists' ? 'account' : step === 'upload' ? 'zones' : step))

  return (
    <main className="page" style={{ paddingBottom: 32 }}>
      <header className="page-header">
        <button type="button" className="btn-link" onClick={() => (abort.current?.abort(), onExit())}>
          ← Salir
        </button>
        <span className="small muted">
          Paso {stepIndex + 1} de {STEP_ORDER.length}
        </span>
      </header>
      <div className="steps" aria-hidden="true">
        {STEP_ORDER.map((s, i) => (
          <i key={s} className={i <= stepIndex ? 'done' : ''} />
        ))}
      </div>
      {demo && <div className="notice info">Modo demostración: no se crea ninguna cuenta real.</div>}

      {step === 'intro' && (
        <section className="stack">
          <h1>Vamos a dar de alta tu calefacción</h1>
          <p>Necesitas:</p>
          <ul style={{ margin: 0, paddingLeft: 22 }}>
            <li>Estar en casa, cerca del TermoWifi.</li>
            <li>El nombre y la contraseña de tu Wi-Fi.</li>
            <li>Unos 5 minutos.</li>
          </ul>
          <h2 style={{ fontSize: '1.15rem', marginTop: 8 }}>¿Tu TermoWifi ya está conectado a la Wi-Fi de casa?</h2>
          <button type="button" className="btn btn-primary btn-block" onClick={() => go('device')}>
            Sí, ya está conectado
          </button>
          <button type="button" className="btn btn-block" onClick={() => go('wifi')}>
            No, o no lo sé
          </button>
        </section>
      )}

      {step === 'wifi' && (
        <section className="stack">
          <h1>Conecta el TermoWifi a tu Wi-Fi</h1>
          <ol style={{ margin: 0, paddingLeft: 22 }} className="stack">
            <li>Pon el TermoWifi en modo configuración (consulta su manual: normalmente se mantiene pulsado su botón hasta que parpadea).</li>
            <li>
              En los ajustes de Wi-Fi del móvil, conéctate a la red que empieza por <b>Ing_</b>. Apunta ese nombre: lo necesitarás después.
            </li>
            <li>Vuelve aquí y escribe los datos de la Wi-Fi de tu casa.</li>
          </ol>
          <Field label="Nombre de tu Wi-Fi" value={ssid} onChange={setSsid} hint="Tal cual aparece en el móvil, con mayúsculas." />
          <Field label="Contraseña de tu Wi-Fi" type="password" value={wifiPass} onChange={setWifiPass} />
          {wifiProgress !== null && wifiProgress < 100 && (
            <div className="progress" role="progressbar" aria-valuenow={wifiProgress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${wifiProgress}%` }} />
            </div>
          )}
          {wifiProgress === 100 ? (
            <>
              <div className="notice ok">TermoWifi configurado. Vuelve a conectar el móvil a la Wi-Fi de tu casa y continúa.</div>
              <button type="button" className="btn btn-primary btn-block" onClick={() => go('device')}>
                Continuar
              </button>
            </>
          ) : bridge.provisionWifi ? (
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={!ssid.trim() || wifiProgress !== null}
              onClick={() => void provision()}
            >
              {wifiProgress !== null ? `Enviando… ${wifiProgress} %` : 'Enviar al TermoWifi'}
            </button>
          ) : (
            <div className="notice warn">Este paso solo se puede hacer desde la app de Android.</div>
          )}
          <button type="button" className="btn-link" onClick={() => go('device')}>
            Ya está conectado, saltar este paso
          </button>
        </section>
      )}

      {step === 'device' && (
        <section className="stack">
          <h1>¿Cuál es tu TermoWifi?</h1>
          <p className="muted">
            Cada TermoWifi tiene un nombre que empieza por <b>Ing_</b> seguido de 6 letras o números. Aparece en la lista de redes Wi-Fi del móvil
            cuando estás cerca de él.
          </p>
          {bridge.scanWifi && (
            <button type="button" className="btn btn-block" disabled={scanning} onClick={() => void scan()}>
              {scanning ? 'Buscando…' : 'Buscar TermoWifi cercanos'}
            </button>
          )}
          {networks && (
            <div className="list" role="list">
              {networks.filter((n) => n.ssid.startsWith('Ing_')).length === 0 && <div>No hemos encontrado ninguno. Escríbelo a mano.</div>}
              {networks
                .filter((n) => n.ssid.startsWith('Ing_'))
                .map((n) => (
                  <button key={n.ssid} type="button" role="listitem" onClick={() => setDeviceInput(n.ssid)} aria-pressed={deviceInput === n.ssid}>
                    <b>{n.ssid}</b>
                    {deviceInput === n.ssid ? <span aria-hidden="true">✓</span> : <span className="muted small">Elegir</span>}
                  </button>
                ))}
            </div>
          )}
          <Field
            label="Nombre del TermoWifi"
            value={deviceInput}
            onChange={setDeviceInput}
            placeholder="Ing_A1B2C3"
            error={deviceInput && !ident ? 'Debe ser Ing_ seguido de 6 letras o números, por ejemplo Ing_A1B2C3.' : undefined}
          />
          {error && <div className="notice error">{error}</div>}
          <button type="button" className="btn btn-primary btn-block" disabled={!ident} onClick={() => go('account')}>
            Continuar
          </button>
        </section>
      )}

      {(step === 'account' || step === 'creating') && (
        <section className="stack">
          <h1>Elige tu usuario</h1>
          <p className="muted">Con estos datos entrarás en esta app y también en la app oficial de Orkli. Apúntalos en un sitio seguro.</p>
          <Field
            label="Usuario"
            value={user}
            onChange={setUser}
            autoComplete="username"
            error={userError}
            hint={
              taken === true
                ? 'Este nombre ya existe. Si es tuyo de un intento anterior, pulsa «Crear cuenta» y te ayudamos a continuar.'
                : taken === false
                  ? '✓ Nombre disponible'
                  : 'Por ejemplo: maria.garcia o casa12b'
            }
          />
          <Field label="Contraseña" type="password" value={password} onChange={setPassword} autoComplete="new-password" error={passError} hint="Al menos 6 caracteres, sin espacios ni tildes." />
          <Field label="Repite la contraseña" type="password" value={password2} onChange={setPassword2} autoComplete="new-password" error={pass2Error} />
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <button type="button" className="btn btn-heat btn-block" disabled={step === 'creating'} onClick={() => void create()}>
            {step === 'creating' ? 'Creando la cuenta…' : 'Crear cuenta'}
          </button>
        </section>
      )}

      {step === 'exists' && (
        <section className="stack">
          <h1>El usuario «{creds.user}» ya existe</h1>
          <p>Puede pasar por dos motivos:</p>
          <div className="card stack">
            <b>Lo creaste tú antes y la configuración no terminó</b>
            <p className="small muted">Pasa a menudo con la app oficial. Escribe la contraseña que pusiste entonces y seguimos donde se quedó.</p>
            <Field label="Contraseña de esa cuenta" type="password" value={resumePass} onChange={setResumePass} autoComplete="current-password" />
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <button type="button" className="btn btn-primary btn-block" disabled={busy || !resumePass} onClick={() => void resume()}>
              {busy ? 'Comprobando…' : 'Es mío, continuar'}
            </button>
            <button type="button" className="btn-link" onClick={() => setForgot(!forgot)} aria-expanded={forgot}>
              No recuerdo la contraseña
            </button>
            {forgot && <ForgotPassword />}
          </div>
          <div className="card stack">
            <b>Lo usa otra persona</b>
            <button
              type="button"
              className="btn btn-block"
              onClick={() => {
                setUser('')
                go('account')
              }}
            >
              Elegir otro nombre
            </button>
          </div>
        </section>
      )}

      {(step === 'zones' || step === 'upload') && (
        <section className="stack">
          <h1>Tus zonas</h1>
          {busy && step === 'zones' ? (
            <>
              <p className="muted">Estamos preguntando a tu TermoWifi qué zonas tiene. Tarda menos de un minuto.</p>
              <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${progress}%` }} />
              </div>
            </>
          ) : (
            found.length > 0 && (
              <p className="muted">
                Hemos encontrado {found.length === 1 ? '1 zona' : `${found.length} zonas`}. Para saber cuál es cuál, compara la temperatura con la que
                marca la pantalla de cada termostato. Podrás cambiar los nombres más adelante.
              </p>
            )
          )}
          {found.map((z) => (
            <div key={z} className="card stack">
              <Field
                label={`Zona ${z + 1}${ambient[z] !== undefined ? ` · ahora marca ${ambient[z].toLocaleString('es-ES', { minimumFractionDigits: 1 })}°` : ''}`}
                value={names[z] ?? ''} onChange={(v) => setNames({ ...names, [z]: v })} placeholder={`Zona ${z + 1}`} />
              <div className="chips">
                {ROOM_SUGGESTIONS.filter((r) => !Object.values(names).includes(r))
                  .slice(0, 5)
                  .map((r) => (
                    <button key={r} type="button" className="chip" onClick={() => setNames({ ...names, [z]: r })}>
                      {r}
                    </button>
                  ))}
              </div>
            </div>
          ))}
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {!busy && ready && !found.length && (
            <button type="button" className="btn btn-primary btn-block" onClick={() => void startDiscovery(ready)}>
              Buscar otra vez
            </button>
          )}
          {!busy && found.length > 0 && (
            <button type="button" className="btn btn-heat btn-block" onClick={() => void upload()}>
              Guardar y terminar
            </button>
          )}
          {step === 'upload' && <p className="center muted">Guardando la configuración…</p>}
        </section>
      )}

      {step === 'done' && (
        <section className="stack center">
          <Illustration name="accountCreated" />
          <h1>¡Listo!</h1>
          <p>
            Tu cuenta <b>{creds.user}</b> está creada y tu calefacción configurada.
          </p>
          <button type="button" className="btn btn-heat btn-block" onClick={() => void c.signIn(creds, demo)}>
            Entrar
          </button>
        </section>
      )}
    </main>
  )
}

export function ForgotPassword() {
  return (
    <div className="notice info small" style={{ display: 'block' }}>
      Ni esta app ni la oficial de Orkli pueden recuperar una contraseña olvidada.
      <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
        <li>Lo mejor es pedir ayuda al servicio técnico de Orkli o a tu instalador.</li>
        <li>
          Si no es posible, puedes probar a crear una cuenta nueva con otro nombre para el mismo TermoWifi. Ten en cuenta que la cuenta antigua
          seguirá existiendo y quien la conozca podrá seguir usándola.
        </li>
      </ul>
    </div>
  )
}
