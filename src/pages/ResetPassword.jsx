import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

// Possible states for this page
// verifying → waiting for Supabase to validate the recovery token in the URL
// ready     → token valid, show the new-password form
// success   → password updated, prompt user to sign in
// invalid   → token expired or not present

export default function ResetPassword() {
  const { updatePassword } = useAuth()
  const navigate = useNavigate()

  const [status, setStatus] = useState('verifying')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Supabase processes the URL hash automatically and fires PASSWORD_RECOVERY
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStatus('ready')
    })

    // If the page loads after the event already fired (e.g. HMR), check for an active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setStatus('ready')
    })

    // No token at all after a short grace period → show invalid state
    const timeout = setTimeout(() => {
      setStatus(s => s === 'verifying' ? 'invalid' : s)
    }, 3000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await updatePassword(password)
      await supabase.auth.signOut()
      setStatus('success')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Success ──────────────────────────────────────────────────────────────
  if (status === 'success') {
    return (
      <Shell>
        <CardHeader title="Password updated" subtitle="Your new password is set." />
        <div className="px-8 py-6 text-center">
          <p className="text-gray-400 dark:text-white/50 text-sm mb-6">You can now sign in with your new password.</p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="w-full bg-accent hover:bg-accent-dark text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
          >
            Go to login
          </button>
        </div>
      </Shell>
    )
  }

  // ── Invalid / expired ────────────────────────────────────────────────────
  if (status === 'invalid') {
    return (
      <Shell>
        <CardHeader title="Link expired" subtitle="This reset link is no longer valid." />
        <div className="px-8 py-6 text-center">
          <p className="text-gray-400 dark:text-white/50 text-sm mb-6">
            Reset links expire after 1 hour. Request a new one from the login page.
          </p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="w-full bg-accent hover:bg-accent-dark text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
          >
            Back to login
          </button>
        </div>
      </Shell>
    )
  }

  // ── Verifying ────────────────────────────────────────────────────────────
  if (status === 'verifying') {
    return (
      <Shell>
        <CardHeader title="Verifying link…" subtitle="Just a moment." />
        <div className="px-8 py-6 flex justify-center">
          <span className="text-gray-400 dark:text-white/30 text-sm">Checking your reset token…</span>
        </div>
      </Shell>
    )
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  return (
    <Shell>
      <CardHeader title="New password" subtitle="Choose a strong password for your account." />

      <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">
        <Field label="New password">
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            className={inputCls}
            autoFocus
          />
        </Field>

        <Field label="Confirm password">
          <input
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="••••••••"
            className={inputCls}
          />
        </Field>

        {error && (
          <div className="flex items-start gap-2 bg-accent/10 border border-accent/30 rounded-lg px-3 py-2">
            <span className="text-accent mt-0.5">!</span>
            <p className="text-accent text-sm">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors mt-1"
        >
          {loading ? 'Updating…' : 'Set new password'}
        </button>
      </form>

      <div className="border-t border-gray-200 dark:border-white/10 px-8 py-4 text-center">
        <button
          onClick={() => navigate('/login', { replace: true })}
          className="text-sm text-gray-300 hover:text-gray-500 dark:text-white/40 dark:hover:text-white/70 transition-colors"
        >
          ← Back to login
        </button>
      </div>
    </Shell>
  )
}

// ── Shared layout helpers ────────────────────────────────────────────────────

function Shell({ children }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-primary">
      <div className="bg-white dark:bg-secondary rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        {children}
      </div>
    </div>
  )
}

function CardHeader({ title, subtitle }) {
  return (
    <div className="bg-white dark:bg-secondary px-8 pt-8 pb-6">
      <div className="flex items-center gap-2 mb-1">
        <svg className="w-4 h-4 fill-accent" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <span className="text-xs font-semibold tracking-widest uppercase text-gray-400 dark:text-white/50">WFA</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">{title}</h1>
      <p className="text-gray-400 dark:text-white/50 text-sm mt-1">{subtitle}</p>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-white/60 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

const inputCls = [
  'w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900',
  'placeholder:text-gray-400',
  'dark:bg-primary dark:border-white/10 dark:text-white dark:placeholder:text-white/30',
  'focus:outline-none focus:ring-2 focus:ring-accent/60 focus:border-accent/60',
  'transition-colors',
].join(' ')
