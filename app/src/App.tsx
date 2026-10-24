import { useEffect, useState } from 'react'
import { useAppState } from './ui/app-context'
import { pushBack } from './ui/back'
import { Icon, Toasts } from './ui/components'
import { CreateAccount } from './ui/CreateAccount'
import { Home } from './ui/Home'
import { Login } from './ui/Login'
import { SchedulePage } from './ui/SchedulePage'
import { Settings } from './ui/Settings'
import { ZoneSheet } from './ui/ZoneSheet'

type Tab = 'home' | 'schedule' | 'settings'

export function App({ nativeAvailable }: { nativeAvailable: boolean }) {
  const s = useAppState()
  const [tab, setTab] = useState<Tab>('home')
  const [zone, setZone] = useState<number | null>(null)
  const [scheduleZone, setScheduleZone] = useState<number>()
  const [creating, setCreating] = useState(false)

  // Every new session starts on the main screen.
  useEffect(() => {
    if (s.phase !== 'ready') setTab('home')
  }, [s.phase])

  // Back from another tab or from the sign-up wizard returns to the main screen.
  useEffect(() => (tab !== 'home' && s.phase === 'ready' ? pushBack(() => setTab('home')) : undefined), [tab, s.phase])
  useEffect(() => (creating && s.phase !== 'ready' ? pushBack(() => setCreating(false)) : undefined), [creating, s.phase])

  if (s.phase === 'boot') return <div className="app" aria-busy="true" />

  if (s.phase !== 'ready') {
    return (
      <div className="app">
        {creating ? (
          <CreateAccount demo={!nativeAvailable} onExit={() => setCreating(false)} />
        ) : (
          <Login nativeAvailable={nativeAvailable} onCreateAccount={() => setCreating(true)} />
        )}
        <Toasts />
      </div>
    )
  }

  const tabs: { id: Tab; label: string; icon: 'home' | 'calendar' | 'settings' }[] = [
    { id: 'home', label: 'Casa', icon: 'home' },
    { id: 'schedule', label: 'Horario', icon: 'calendar' },
    { id: 'settings', label: 'Ajustes', icon: 'settings' },
  ]

  return (
    <div className="app">
      {tab === 'home' && <Home onOpenZone={setZone} />}
      {tab === 'schedule' && <SchedulePage initialZone={scheduleZone} />}
      {tab === 'settings' && <Settings />}
      {zone !== null && (
        <ZoneSheet
          zone={zone}
          onClose={() => setZone(null)}
          onEditSchedule={() => {
            setScheduleZone(zone)
            setZone(null)
            setTab('schedule')
          }}
        />
      )}
      <Toasts />
      <div className="tabbar">
        <nav aria-label="Secciones">
          {tabs.map((t) => (
            <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} />
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
