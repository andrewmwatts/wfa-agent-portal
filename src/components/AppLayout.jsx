import { useState, useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useAgencyLogo } from '../context/AgencyContext'
import Sidebar from './Sidebar'
import ViewingBanner from './ViewingBanner'
import UserMenu from './UserMenu'
import { registerPushSubscription } from '../utils/pushNotifications'

// Header height as a shared constant so sidebar top offset stays in sync
export const HEADER_H = 'h-14'
export const HEADER_TOP = 'top-14'

export default function AppLayout() {
  const { userProfile, signOut, session } = useAuth()
  const navigate                          = useNavigate()
  const [sidebarOpen, setSidebarOpen]     = useState(false)
  const [sysMessages, setSysMessages]     = useState([])
  const [dismissed,   setDismissed]       = useState([]) // ids dismissed this session

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  // Re-sync push subscription to DB on every app load so a server-side row
  // deletion (e.g. DB migration) doesn't silently drop notifications.
  useEffect(() => {
    if (!userProfile?.id || !userProfile?.sfg_id) return
    const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
    if (!supported || Notification.permission !== 'granted') return
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => {
        if (sub) registerPushSubscription(userProfile.id, userProfile.sfg_id).catch(() => {})
      })
      .catch(() => {})
  }, [userProfile?.id, userProfile?.sfg_id])

  // Fetch active system messages on mount and on each page load
  useEffect(() => {
    if (!session?.access_token) return
    fetch('/api/admin?action=system-messages', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.messages) return
        // Client-side audience filter
        const role    = userProfile?.role ?? 'agent'
        const ownerId = userProfile?.agency_owner ?? null
        const visible = d.messages.filter(m => {
          if (m.audience === 'all') return true
          if (m.audience === `role:${role}`) return true
          if (ownerId && m.audience === `owner:${ownerId}`) return true
          return false
        })
        setSysMessages(visible)
      })
      .catch(() => {})
  }, [session?.access_token, userProfile?.role, userProfile?.agency_owner])

  const visibleMessages = sysMessages.filter(m =>
    m.priority === 'Critical' || !dismissed.includes(m.id)
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-secondary">

      {/* Header spans full width above everything */}
      <Header
        userProfile={userProfile}
        onSignOut={handleSignOut}
        onMenuClick={() => setSidebarOpen(true)}
      />

      {/* Sidebar sits below the header */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content: pushed down by header, pushed right by sidebar on desktop */}
      <div className="pt-14 lg:pl-56 flex flex-col min-h-screen">
        <ViewingBanner />

        {/* System message banners */}
        {visibleMessages.map(m => {
          const cls = m.priority === 'Critical'
            ? 'bg-red-600 text-white border-red-700'
            : m.priority === 'Warning'
            ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20'
            : 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20'
          return (
            <div key={m.id} className={`flex items-center justify-between gap-4 px-4 sm:px-6 py-2.5 border-b text-sm ${cls}`}>
              <p><span className="font-semibold mr-2">{m.priority}:</span>{m.message}</p>
              {m.priority !== 'Critical' && (
                <button onClick={() => setDismissed(d => [...d, m.id])}
                  className="shrink-0 opacity-70 hover:opacity-100 text-lg leading-none">✕</button>
              )}
            </div>
          )
        })}

        <main className="flex-1">
          <Outlet />
        </main>
      </div>

    </div>
  )
}

// ── Header ─────────────────────────────────────────────────────────────────────

function Header({ userProfile, onSignOut, onMenuClick }) {
  const { theme, toggleTheme } = useTheme()
  const logoUrl                = useAgencyLogo()

  return (
    <header className={`fixed top-0 inset-x-0 z-30 ${HEADER_H} bg-primary/[0.09] border-b border-primary/20 dark:bg-primary dark:border-white/10 px-4 sm:px-6 flex items-center justify-between`}>

      {/* Left: hamburger (mobile/tablet only) + agency logo */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          aria-label="Open menu"
          className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-white/50 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {logoUrl && (
          <img
            src={logoUrl}
            alt="Agency logo"
            className="h-8 w-auto object-contain max-w-[160px]"
          />
        )}
      </div>

      {/* Right: agent resources link + theme toggle + user menu */}
      <div className="flex items-center gap-1 sm:gap-2">
        <a
          href="/"
          className="hidden sm:inline-flex items-center text-xs font-medium text-gray-500 dark:text-white/40 hover:text-gray-800 dark:hover:text-white/80 transition-colors px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 mr-1"
        >
          Agent Resources
        </a>
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-primary/10 dark:text-white/40 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
        >
          {theme === 'dark' ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1"  x2="12" y2="3"  />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22"  y1="4.22"  x2="5.64"  y2="5.64"  />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1"  y1="12" x2="3"  y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36" />
              <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"  />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          )}
        </button>

        <UserMenu userProfile={userProfile} onSignOut={onSignOut} />
      </div>
    </header>
  )
}

