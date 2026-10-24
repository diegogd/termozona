import { App as CapApp } from '@capacitor/app'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Controller } from './core/controller'
import { preferencesStore } from './core/storage'
import { createDemoBridge } from './demo/demoBridge'
import { capacitorBridge, isNativePlatform } from './native/capacitorBridge'
import { ControllerContext } from './ui/app-context'
import { handleBack } from './ui/back'
import './index.css'

const native = isNativePlatform()
// Outside Android there is no way to reach the cloud yet (needs the proxy), so only demo works.
const controller = new Controller((demo) => (demo || !native ? createDemoBridge() : capacitorBridge), preferencesStore)
void controller.boot()
void controller.checkUpdates(__APP_VERSION__)

if (native) {
  void CapApp.addListener('backButton', () => {
    if (!handleBack()) void CapApp.exitApp()
  })
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') controller.resume()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ControllerContext.Provider value={controller}>
      <App nativeAvailable={native} />
    </ControllerContext.Provider>
  </StrictMode>,
)
