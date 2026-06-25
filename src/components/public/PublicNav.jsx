import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2"/>
      <path d="M7 11V7a5 5 0 0110 0v4"/>
    </svg>
  )
}

const NAV_LINKS = [
  { label: 'Videos',    path: '/videos'    },
  { label: 'Resources', path: '/resources' },
  { label: 'Calendar',  path: '/calendar'  },
]

export default function PublicNav() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const location = useLocation()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
  }, [])

  const portalHref  = session ? '/portal/dashboard' : '/login?redirect=%2Fportal%2Fdashboard'
  const portalLabel = session ? 'My portal' : 'Agent portal'

  return (
    <nav style={{ background: '#003539', height: 52, position: 'sticky', top: 0, zIndex: 40, flexShrink: 0 }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 28px', height: '100%', display: 'flex', alignItems: 'center', gap: 32 }}>
        {/* Wordmark */}
        <Link to="/" style={{ display: 'flex', alignItems: 'baseline', gap: 4, textDecoration: 'none', flexShrink: 0 }}>
          <span style={{ color: '#fff', fontSize: 18, fontWeight: 500, fontFamily: 'Inter, sans-serif', lineHeight: 1 }}>Watts/</span>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'Inter, sans-serif' }}>
            Resource library
          </span>
        </Link>

        {/* Center links */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 28 }}>
          {NAV_LINKS.map(({ label, path }) => {
            const active = location.pathname === path
            return (
              <Link key={label} to={path}
                style={{
                  fontSize: 13, fontFamily: 'Inter, sans-serif', textDecoration: 'none',
                  color: active ? '#fff' : 'rgba(255,255,255,0.6)',
                  transition: 'color 0.15s',
                }}>
                {label}
              </Link>
            )
          })}
        </div>

        {/* Portal CTA — invisible while loading to prevent layout shift */}
        <div style={{ visibility: session === undefined ? 'hidden' : 'visible' }}>
          <a href={portalHref}
            style={{
              background: '#EE2666', color: '#fff', fontSize: 12, fontWeight: 500,
              borderRadius: 6, padding: '6px 12px',
              display: 'inline-flex', alignItems: 'center', gap: 5,
              textDecoration: 'none', fontFamily: 'Inter, sans-serif',
            }}>
            <LockIcon />
            {portalLabel}
          </a>
        </div>
      </div>
    </nav>
  )
}
