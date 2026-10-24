import { useState, type FormEvent } from 'react'
import { DEMO_PASSWORD, DEMO_USER } from '../demo/demoBridge'
import { useAppState, useController } from './app-context'
import appIcon from '../assets/brand/app-icon.svg'
import { Field } from './components'
import { ForgotPassword } from './CreateAccount'

export function Login({ onCreateAccount, nativeAvailable }: { onCreateAccount: () => void; nativeAvailable: boolean }) {
  const s = useAppState()
  const c = useController()
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [forgot, setForgot] = useState(false)
  const busy = s.phase === 'signingIn'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!user.trim() || !password) return
    void c.signIn({ user, password })
  }

  return (
    <main className="page" style={{ paddingBottom: 32 }}>
      <img className="app-icon" src={appIcon} alt="" width={128} height={128} />
      <div className="stack center">
        <h1 style={{ fontSize: '1.8rem' }}>TermoZona</h1>
        <p className="muted">Controla la calefacción de tu casa, zona a zona.</p>
      </div>

      {!nativeAvailable && (
        <div className="notice info">
          En el navegador solo funciona el modo demostración. Para tu calefacción real instala la app en Android.
        </div>
      )}

      <form className="card stack" onSubmit={submit} noValidate>
        <Field label="Usuario" value={user} onChange={setUser} autoComplete="username" hint="El mismo que usas en la app de Orkli." />
        <Field label="Contraseña" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {s.loginError && (
          <div className="notice error" role="alert">
            {s.loginError}
          </div>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !nativeAvailable || !user.trim() || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <button type="button" className="btn-link" onClick={() => setForgot(!forgot)} aria-expanded={forgot}>
          ¿Has olvidado la contraseña?
        </button>
        {forgot && <ForgotPassword />}
      </form>

      <div className="stack">
        <button type="button" className="btn btn-block" onClick={onCreateAccount}>
          Es mi primera vez: crear cuenta
        </button>
        <button type="button" className="btn-link" disabled={busy} onClick={() => void c.signIn({ user: DEMO_USER, password: DEMO_PASSWORD }, true)}>
          Probar sin cuenta (modo demostración)
        </button>
      </div>
      <p className="small muted center">App no oficial. No está hecha ni respaldada por Orkli.</p>
    </main>
  )
}
