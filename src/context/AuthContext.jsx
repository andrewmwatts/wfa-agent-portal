import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession]           = useState(undefined) // undefined = loading
  const [userProfile, setUserProfile]   = useState(null)
  const [pendingInvite, setPendingInvite] = useState(false)

  async function fetchUserProfile(userId) {
    const { data, error } = await supabase
      .from('users')
      .select('id, sfg_id, role, full_name, email, is_assistant, is_active, upline_sfg_id, owner_since, agency_owner, leads_email')
      .eq('id', userId)
      .single()

    if (error) {
      // PGRST116 = no rows returned — user exists in auth but not in public.users
      if (error.code !== 'PGRST116') {
        console.error('Failed to fetch user profile:', error.message)
      }
      return null
    }
    return data
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        const profile = await fetchUserProfile(session.user.id)
        setUserProfile(profile)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        if (session?.user) {
          // Fire-and-forget — do NOT await here. Supabase awaits this callback
          // before resolving signUp/signIn, so any async work inside would
          // deadlock those calls if the DB query is slow.
          fetchUserProfile(session.user.id).then(profile => {
            if (!profile && session.user.user_metadata?.is_delegate) {
              setPendingInvite(true)
            } else {
              setUserProfile(profile)
              setPendingInvite(false)
            }
          })
        } else {
          setUserProfile(null)
          setPendingInvite(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

    let profile = await fetchUserProfile(data.user.id)

    if (!profile) {
      // No public.users row yet — try to auto-provision using metadata stored
      // during registration (handles email-confirmation delay race condition).
      const meta = data.user.user_metadata ?? {}
      if (meta.sfg_id) {
        const res = await fetch('/api/provision-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id:   data.user.id,
            email:     data.user.email,
            sfg_id:    meta.sfg_id,
            full_name: meta.full_name ?? '',
          }),
        })
        if (res.ok) {
          profile = await fetchUserProfile(data.user.id)
        }
      }
    }

    if (!profile) {
      // Still no profile — auth account exists but was never registered via the portal
      await supabase.auth.signOut()
      throw new Error('No portal account found. Contact your administrator.')
    }

    setUserProfile(profile)
    return data
  }

  async function signUp(email, password, sfgId, fullName) {
    // 1. Create the Supabase auth account
    //    Store sfg_id + full_name in user_metadata so we can provision on first
    //    sign-in even if email confirmation delays the provision-user call.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { sfg_id: sfgId, full_name: fullName } },
    })
    if (error) throw error

    if (!data.user) {
      return data
    }
    // 2. Create the public.users row via service-role endpoint
    //    (user_id is available immediately even before email confirmation)
    const res = await fetch('/api/provision-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id:   data.user.id,
        email,
        sfg_id:    sfgId,
        full_name: fullName,
      }),
    })

    if (!res.ok) {
      let errMsg = 'Failed to create portal account'
      try { errMsg = (await res.json()).error ?? errMsg } catch { /* ignore */ }
      // Roll back: delete the auth account so they can retry cleanly
      await supabase.auth.signOut()
      throw new Error(errMsg)
    }

    // Return a flag so the caller knows whether to redirect immediately
    // (session present = email confirmation is off) or show "check your email"
    return { requiresConfirmation: !data.session }
  }

  async function updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
  }

  async function resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function fetchAndSetProfile(userId) {
    const profile = await fetchUserProfile(userId)
    setUserProfile(profile)
    return profile
  }

  const role = userProfile?.role ?? null
  const loading = session === undefined

  return (
    <AuthContext.Provider value={{ session, userProfile, role, loading, pendingInvite, setPendingInvite, fetchAndSetProfile, signIn, signUp, signOut, resetPassword, updatePassword }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
