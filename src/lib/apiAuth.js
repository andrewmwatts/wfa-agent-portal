// Global API auth: attach the current Supabase session token to every
// same-origin /api/* request. Centralizing this here means individual fetch
// call sites don't each need to wire up the Authorization header (and can't
// accidentally omit it). Requests that already set Authorization are left as-is.
//
// Imported once for its side effects from main.jsx, before the app renders.

import { supabase } from './supabaseClient'

let accessToken = null

supabase.auth.getSession().then(({ data }) => {
  accessToken = data?.session?.access_token ?? null
})
supabase.auth.onAuthStateChange((_event, session) => {
  accessToken = session?.access_token ?? null
})

function isSameOriginApi(url) {
  try {
    if (typeof url === 'string') {
      if (url.startsWith('/api/')) return true
      const u = new URL(url, window.location.origin)
      return u.origin === window.location.origin && u.pathname.startsWith('/api/')
    }
    if (url instanceof URL) {
      return url.origin === window.location.origin && url.pathname.startsWith('/api/')
    }
  } catch { /* fall through */ }
  return false
}

if (typeof window !== 'undefined' && !window.__wfaFetchPatched) {
  const originalFetch = window.fetch.bind(window)

  window.fetch = (input, init = {}) => {
    const urlForCheck =
      typeof input === 'string' || input instanceof URL ? input
      : (input && input.url) ? input.url
      : null

    if (accessToken && isSameOriginApi(urlForCheck)) {
      const headers = new Headers(
        init.headers || (input instanceof Request ? input.headers : undefined)
      )
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${accessToken}`)
        init = { ...init, headers }
      }
    }
    return originalFetch(input, init)
  }

  window.__wfaFetchPatched = true
}
