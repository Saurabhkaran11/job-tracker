// Vitest setup: runs before the suite, then before each test.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { queryClient } from './queryClient'

// The jsdom build used here does not expose window.localStorage, but the app persists
// everything through it, so the suite supplies a spec-compatible in-memory Storage.
// It keeps the real semantics the app depends on: keys and values are coerced to
// strings, a missing key reads back as null, and `length`/`key(i)` reflect insertion.
// Example: localStorage.setItem('k', 1); localStorage.getItem('k') === '1'
function createMemoryStorage() {
  let map = new Map()
  return {
    get length() { return map.size },
    key(i) { return [...map.keys()][i] ?? null },
    getItem(k) { return map.has(String(k)) ? map.get(String(k)) : null },
    setItem(k, v) { map.set(String(k), String(v)) },
    removeItem(k) { map.delete(String(k)) },
    clear() { map = new Map() },
  }
}

function installStorage(name) {
  if (typeof globalThis[name] !== 'undefined') return
  const storage = createMemoryStorage()
  Object.defineProperty(globalThis, name, { value: storage, configurable: true })
  if (globalThis.window) {
    Object.defineProperty(globalThis.window, name, { value: storage, configurable: true })
  }
}

// The PIN gate remembers an unlock in sessionStorage, which this jsdom build omits for
// the same reason it omits localStorage.
installStorage('localStorage')
installStorage('sessionStorage')

beforeEach(() => {
  // Every test starts from an empty tracker, so one test's companies can never leak
  // into the next. App.jsx reads this key on mount.
  localStorage.clear()
  // The theme writes a class onto <html> and a key to storage, both of which outlive
  // a React unmount, so they are reset explicitly or a dark-mode test would leak.
  document.documentElement.classList.remove('dark')
  // The app's QueryClient is module-level with staleTime: Infinity, so without this a
  // cached company list from one test would be served to every later test.
  queryClient.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
})
