import { createContext, useContext, useSyncExternalStore } from 'react'
import type { AppState, Controller } from '../core/controller'

export const ControllerContext = createContext<Controller | null>(null)

export function useController(): Controller {
  const c = useContext(ControllerContext)
  if (!c) throw new Error('ControllerContext missing')
  return c
}

export function useAppState(): AppState {
  const c = useController()
  return useSyncExternalStore(c.subscribe, c.getState)
}
