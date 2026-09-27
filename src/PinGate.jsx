'use client'

// React is imported explicitly because the test runner transforms JSX with the
// classic runtime, the same reason src/App.jsx imports it.
import React, { useState, useEffect, useCallback } from 'react'

const UNLOCK_KEY = 'job-tracker-unlocked'

/**
 * The PIN this build accepts.
 *
 * Read from NEXT_PUBLIC_APP_PIN so it can be changed without touching code: set it in
 * Vercel's environment variables, or in a local .env.local, and redeploy. The fallback
 * is a placeholder, not a secret.
 *
 * IMPORTANT, and not a limitation that can be engineered away here: this is a client
 * -side check in a client-side app. Anything NEXT_PUBLIC_ is compiled into the
 * JavaScript the browser downloads, so the PIN is readable by anyone who opens devtools
 * or reads the bundle -- and in a public repository, by anyone who reads the source.
 * The tracked data lives in localStorage, which is readable in devtools whether or not
 * this gate is passed.
 *
 * So this keeps the dashboard from being shown to someone glancing at the screen. It is
 * not access control. Real protection needs the check to happen somewhere the visitor
 * cannot see -- Vercel's own password protection, or an auth provider in front of the
 * app.
 *
 * Example: NEXT_PUBLIC_APP_PIN=8123 in Vercel -> that build accepts 8123.
 */
const PIN = process.env.NEXT_PUBLIC_APP_PIN || '1234'

/**
 * Was this session already unlocked? Wrapped because storage can throw in a private
 * window, where it simply behaves as locked.
 * Example: after a successful unlock in this tab -> true
 */
function readUnlocked() {
  try { return sessionStorage.getItem(UNLOCK_KEY) === 'yes' } catch { return false }
}

/**
 * Gates its children behind a PIN entry screen.
 *
 * Unlocking is remembered in sessionStorage, so it asks once per browser session and
 * again after the tab is closed. localStorage would remember it forever, which defeats
 * the point of asking.
 *
 * Example: <PinGate><HomePage /></PinGate>
 */
export default function PinGate({ children }) {
  // Starts locked and unaware, so the server-rendered markup and the first client
  // render agree; the session is read after mount, as with the theme.
  const [state, setState] = useState({ unlocked: false, checked: false })
  const [entry, setEntry] = useState('')
  const [error, setError] = useState('')

  // The extra render is intended: the first render must match what the server sent,
  // and only then can the session be read. It happens once, on mount.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setState({ unlocked: readUnlocked(), checked: true })
  }, [])

  const submit = useCallback((e) => {
    e.preventDefault()
    if (entry.trim() !== PIN) {
      setError('That PIN is not right')
      setEntry('')
      return
    }
    try { sessionStorage.setItem(UNLOCK_KEY, 'yes') } catch { /* storage unavailable */ }
    setError('')
    setState({ unlocked: true, checked: true })
  }, [entry])

  // Nothing is painted until the session has been read, so the dashboard never flashes
  // into view before the gate decides.
  if (!state.checked) return <div className="min-h-screen page-bg page-dashboard" />

  if (state.unlocked) return children

  return (
    <div className="min-h-screen page-bg page-dashboard flex items-center justify-center px-4" data-testid="pin-gate">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-[var(--surface-1)] border border-[var(--border)] rounded-xl p-6"
      >
        <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Job Tracker</h1>
        <p className="text-sm text-[var(--text-secondary)] mb-5">Enter your PIN to continue.</p>

        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          aria-label="PIN"
          value={entry}
          onChange={(e) => { setEntry(e.target.value); setError('') }}
          className="w-full h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)] text-sm outline-none focus:border-[var(--accent)]"
        />

        {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}

        <button
          type="submit"
          className="mt-4 w-full h-9 rounded-lg bg-[var(--accent)] text-[var(--on-accent)] text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors"
        >
          Unlock
        </button>
      </form>
    </div>
  )
}
