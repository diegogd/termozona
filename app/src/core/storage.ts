import { Preferences } from '@capacitor/preferences'

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
}

/** Capacitor Preferences (SharedPreferences on Android, localStorage on the web). */
export const preferencesStore: KeyValueStore = {
  async get<T>(key: string) {
    try {
      const { value } = await Preferences.get({ key })
      return value ? (JSON.parse(value) as T) : undefined
    } catch {
      return undefined
    }
  },
  async set<T>(key: string, value: T) {
    await Preferences.set({ key, value: JSON.stringify(value) })
  },
  async remove(key: string) {
    await Preferences.remove({ key })
  },
}

export function memoryStore(): KeyValueStore {
  const m = new Map<string, string>()
  return {
    async get<T>(key: string) {
      const v = m.get(key)
      return v ? (JSON.parse(v) as T) : undefined
    },
    async set<T>(key: string, value: T) {
      m.set(key, JSON.stringify(value))
    },
    async remove(key: string) {
      m.delete(key)
    },
  }
}
