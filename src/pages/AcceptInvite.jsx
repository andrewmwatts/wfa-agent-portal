import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

export default function AcceptInvite() {
  const { session, setPendingInvite, fetchAndSetProfile } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [error,    setError]    = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // If no session at all, redirect to login
  useEffect(() => {
    if (session === null) navigate('/login', { replace: true })
  }, [session, navigate])

  const inviteId = session?.user?.user_metadata?.invite_id

  if (!session || !inviteId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-primary">
        <div className="bg-white dark:bg-secondary rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Invalid Link</h2>
          <p className="text-gray-500 dark:text-white/60 text-sm mb-6">
            This invite link is invalid or has expired. Contact the person who invited you for a new link.
          </p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="text-sm text-accent hover:text-accent-dark transition-colors"
          >
            Go to login
          </button>
        </div>
      </div>
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      // 1. Set the password on the auth account
      const { error: pwErr } = await supabase.auth.updateUser({ password })
      if (pwErr) throw pwErr

      // 2. Provision the portal account and activate the delegation
      const res = await fetch('/api/accept-invite', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          invite_id: inviteId,
          user_id:   session.user.id,
          full_name: fullName.trim(),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to complete setup.')

      // 3. Fetch the newly-created profile and clear the pending-invite flag
      await fetchAndSetProfile(session.user.id)
      setPendingInvite(false)

      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-primary">
      <div className="bg-white dark:bg-secondary rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-6">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-accent fill-accent" viewBox="0 0 24 24">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            <span className="text-xs font-semibold tracking-widest uppercase text-gray-400 dark:text-white/50">WFA</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">Set up your account</h1>
          <p className="text-gray-400 dark:text-white/50 text-sm mt-1">
            You've been invited to access the Agent Portal.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">
          <Field label="Your Name">
            <input
              type="text"
              required
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="First and last name"
              className={inputCls}
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className={inputCls}
            />
          </Field>
          <Field label="Confirm Password">
            <input
              type="password"
              required
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Re-enter password"
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
            disabled={submitting}
            className="w-full bg-accent hover:bg-accent-dark disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors mt-1"
          >
            {submitting ? 'Setting up…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}

const inputCls = [
  'w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900',
  'placeholder:text-gray-400',
  'dark:bg-secondary dark:border-white/10 dark:text-white dark:placeholder:text-white/30',
  'focus:outline-none focus:ring-2 focus:ring-accent/60 focus:border-accent/60',
  'transition-colors',
].join(' ')

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
