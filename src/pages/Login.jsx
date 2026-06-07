import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'


export default function Login() {
  const { signIn, signUp, resetPassword } = useAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState('login') // 'login' | 'register' | 'forgot'
  const [forgotSent, setForgotSent] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [sfgId, setSfgId] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [registerSuccess, setRegisterSuccess] = useState(false)
  const [identityConflict, setIdentityConflict] = useState(false)

  const REGISTER_ERRORS = {
    sfg_not_found:          'SFG ID not found. Contact your administrator.',
    sfg_already_registered: 'An account already exists for this SFG ID.',
    email_already_registered: 'An account already exists for this email address.',
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (mode === 'login') {
        await signIn(email, password)
        navigate('/dashboard', { replace: true })
      } else if (mode === 'register') {
        // Step 1: validate SFG ID against Personnel sheet
        const validation = await fetch('/api/users?action=validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sfg_id: sfgId, email }),
        })
        const result = await validation.json()

        if (!result.valid) {
          setError(REGISTER_ERRORS[result.reason] ?? 'Validation failed. Contact your administrator.')
          return
        }

        // Step 2: create auth account + public.users row (full_name comes from sheet)
        const result2 = await signUp(email, password, sfgId, result.full_name)
        if (result2?.identityConflict) {
          setIdentityConflict(true)
        } else if (result2?.requiresConfirmation) {
          setRegisterSuccess(true)
        } else {
          navigate('/dashboard', { replace: true })
        }
      } else if (mode === 'forgot') {
        await resetPassword(email)
        setForgotSent(true)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (registerSuccess) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-primary">
        <div className="bg-white dark:bg-secondary rounded-2xl shadow-xl p-8 max-w-sm w-full">
          {/* Email icon */}
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0l-9.75 6.75L2.25 6.75" />
              </svg>
            </div>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3 text-center">
            Thanks for registering!
          </h2>
          <p className="text-gray-600 dark:text-white/70 text-sm leading-relaxed mb-2">
            Please check your email at{' '}
            <strong className="text-gray-900 dark:text-white">{email}</strong>{' '}
            for a confirmation link. You&apos;ll need to click it before you can log in.
          </p>
          <p className="text-gray-500 dark:text-white/50 text-sm leading-relaxed">
            If you don&apos;t see it within a few minutes, check your spam folder.
          </p>
          <button
            onClick={() => { setMode('login'); setRegisterSuccess(false) }}
            className="mt-6 w-full text-sm text-center text-accent hover:text-accent/80 transition-colors font-medium"
          >
            Back to login
          </button>
        </div>
      </div>
    )
  }

  if (identityConflict) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-primary">
        <div className="bg-white dark:bg-secondary rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
            Account already exists
          </h2>
          <p className="text-gray-600 dark:text-white/70 text-sm leading-relaxed mb-5">
            An account with this email already exists. Please log in instead.
          </p>
          <button
            onClick={() => { setMode('login'); setIdentityConflict(false); setPassword('') }}
            className="w-full bg-accent hover:bg-accent/90 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
          >
            Go to login
          </button>
        </div>
      </div>
    )
  }

  if (forgotSent) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-primary">
        <div className="bg-white dark:bg-secondary rounded-2xl shadow-xl p-8 max-w-sm w-full text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Check your email</h2>
          <p className="text-gray-400 dark:text-white/50 text-sm">
            If <strong className="text-gray-900 dark:text-white">{email}</strong> has a portal account, a reset link is on its way.
          </p>
          <button
            onClick={() => { setMode('login'); setForgotSent(false); setEmail('') }}
            className="mt-6 text-sm text-accent hover:text-accent-light transition-colors"
          >
            Back to login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-primary">
      {/* Card */}
      <div className="bg-white dark:bg-secondary rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        {/* Header band */}
        <div className="bg-white dark:bg-secondary px-8 pt-8 pb-6">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-accent fill-accent" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            <span className="text-xs font-semibold tracking-widest uppercase text-gray-400 dark:text-white/50">
              WFA
            </span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">Agent Portal</h1>
          <p className="text-gray-400 dark:text-white/50 text-sm mt-1">
            {mode === 'login' ? 'Sign in to your account'
              : mode === 'register' ? 'Create a new account'
              : 'Reset your password'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">
          <Field label="Email">
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={inputCls}
            />
          </Field>

          {mode !== 'forgot' && (
            <Field label="Password">
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className={inputCls}
              />
            </Field>
          )}

          {mode === 'register' && (
            <Field label="SFG ID">
              <input
                type="text"
                required
                value={sfgId}
                onChange={e => setSfgId(e.target.value)}
                placeholder="SFG-XXXXX"
                className={inputCls}
              />
            </Field>
          )}

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
            {loading ? 'Please wait…'
              : mode === 'login' ? 'Sign in'
              : mode === 'register' ? 'Create account'
              : 'Send reset link'}
          </button>
        </form>

        {/* Footer toggle */}
        <div className="border-t border-gray-200 dark:border-white/10 px-8 py-4 text-center space-y-2">
          {mode === 'login' && (
            <>
              <p className="text-sm text-gray-400 dark:text-white/50">
                Don&apos;t have an account?{' '}
                <button onClick={() => { setMode('register'); setError(null) }} className="text-accent hover:text-accent-light transition-colors font-medium">
                  Register
                </button>
              </p>
              <p className="text-sm text-gray-400 dark:text-white/50">
                <button onClick={() => { setMode('forgot'); setError(null) }} className="text-gray-300 hover:text-gray-500 dark:text-white/40 dark:hover:text-white/70 transition-colors">
                  Forgot password?
                </button>
              </p>
            </>
          )}
          {mode === 'register' && (
            <p className="text-sm text-gray-400 dark:text-white/50">
              Already have an account?{' '}
              <button onClick={() => { setMode('login'); setError(null) }} className="text-accent hover:text-accent-light transition-colors font-medium">
                Sign in
              </button>
            </p>
          )}
          {mode === 'forgot' && (
            <p className="text-sm text-gray-400 dark:text-white/50">
              <button onClick={() => { setMode('login'); setError(null) }} className="text-accent hover:text-accent-light transition-colors font-medium">
                ← Back to login
              </button>
            </p>
          )}
        </div>
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
