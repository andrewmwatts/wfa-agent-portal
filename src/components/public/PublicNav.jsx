import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import useIsMobile from '../../hooks/useIsMobile'

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2"/>
      <path d="M7 11V7a5 5 0 0110 0v4"/>
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

const NAV_LINKS = [
  { label: 'Videos',      path: '/videos'      },
  { label: 'Documents',   path: '/resources'   },
  { label: 'Calendar',    path: '/calendar'    },
  { label: 'Guidelines',  path: '/guidelines'  },
]

export default function PublicNav() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile(720)
  const location = useLocation()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
  }, [])

  // Close the drawer on navigation and whenever we grow back to desktop
  useEffect(() => { setOpen(false) }, [location.pathname])
  useEffect(() => { if (!isMobile) setOpen(false) }, [isMobile])

  const portalHref  = session ? '/portal/dashboard' : '/login?redirect=%2Fportal%2Fdashboard'
  const portalLabel = session ? 'My portal' : 'Agent portal'

  const portalCta = (
    <a href={portalHref}
      style={{
        background: '#EE2666', color: '#fff', fontSize: 12, fontWeight: 500,
        borderRadius: 6, padding: '6px 12px',
        display: 'inline-flex', alignItems: 'center', gap: 5,
        textDecoration: 'none', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap',
      }}>
      <LockIcon />
      {portalLabel}
    </a>
  )

  // ── Mobile: wordmark · portal CTA · hamburger; links live in a drawer ──────
  if (isMobile) {
    return (
      <nav style={{ background: '#003539', position: 'sticky', top: 0, zIndex: 40, flexShrink: 0 }}>
        <div style={{ height: 52, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', boxSizing: 'border-box' }}>
          {/* Wordmark — shrinks/truncates first so the bar never overflows */}
          <Link to="/" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
            <span style={{
              color: '#fff', fontSize: 15, fontWeight: 500, fontFamily: 'Inter, sans-serif', lineHeight: 1,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              Watts Family Agency
            </span>
          </Link>

          {/* Portal CTA stays in the bar, left of the menu — always one tap away */}
          <div style={{ visibility: session === undefined ? 'hidden' : 'visible', flexShrink: 0 }}>
            {portalCta}
          </div>

          <button
            onClick={() => setOpen(o => !o)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            style={{ flexShrink: 0, background: 'none', border: 'none', color: '#fff', padding: 4, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>

        {open && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, background: '#003539',
            borderTop: '0.5px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 20px rgba(0,0,0,0.25)', paddingBottom: 6,
          }}>
            {NAV_LINKS.map(({ label, path }) => {
              const active = location.pathname === path
              return (
                <Link key={label} to={path}
                  style={{
                    display: 'block', padding: '13px 18px', fontSize: 15, fontFamily: 'Inter, sans-serif',
                    textDecoration: 'none', color: active ? '#fff' : 'rgba(255,255,255,0.7)',
                    borderBottom: '0.5px solid rgba(255,255,255,0.06)',
                  }}>
                  {label}
                </Link>
              )
            })}
          </div>
        )}
      </nav>
    )
  }

  // ── Desktop: wordmark · centered links · portal CTA ────────────────────────
  return (
    <nav style={{ background: '#003539', height: 52, position: 'sticky', top: 0, zIndex: 40, flexShrink: 0 }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 28px', height: '100%', display: 'flex', alignItems: 'center', gap: 32 }}>
        {/* Wordmark */}
        <Link to="/" style={{ display: 'flex', alignItems: 'baseline', gap: 4, textDecoration: 'none', flexShrink: 0 }}>
          <span style={{ color: '#fff', fontSize: 18, fontWeight: 500, fontFamily: 'Inter, sans-serif', lineHeight: 1 }}>Watts Family Agency</span>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'Inter, sans-serif' }}>
            Agent Resources
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
          {portalCta}
        </div>
      </div>
    </nav>
  )
}
