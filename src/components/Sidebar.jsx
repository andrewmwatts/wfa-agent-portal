import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useViewing } from '../context/ViewingContext'
import { HEADER_TOP } from './AppLayout'
import { NAV_SECTIONS } from '../config/navSections'
import NavIcon from '../config/navIcons'

// ── Shared role filter ────────────────────────────────────────────────────────

// Nav sections with the items this user's (or the viewed subject's) role may see.
function useVisibleSections() {
  const { userProfile }           = useAuth()
  const { activeSubject, isSelf } = useViewing()
  // When viewing as a delegate, show nav items appropriate to the subject's role
  const role = (isSelf ? userProfile?.role : activeSubject?.role) ?? userProfile?.role ?? 'agent'

  return NAV_SECTIONS
    .map(section => ({ ...section, items: section.items.filter(item => !item.roles || item.roles.has(role)) }))
    .filter(section => section.items.length > 0)
}

// ── Shared nav + branding content ─────────────────────────────────────────────

function NavContent({ onNav }) {
  const location = useLocation()
  const sections = useVisibleSections()

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {sections.map((section, si) => (
          <div key={si} className={si > 0 ? 'mt-4' : ''}>
            {section.label && (
              <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-white/50">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map(item => (
                <button
                  key={item.path}
                  onClick={() => onNav(item.path)}
                  className={`w-full text-left px-3 py-2.5 max-lg:py-3 rounded-lg text-sm transition-colors
                    ${location.pathname === item.path
                      ? 'bg-accent/10 text-accent font-semibold'
                      : 'text-gray-600 dark:text-white/70 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10'
                    }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* WFA branding — padded past the iPhone home indicator when it is a drawer */}
      <div className="px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-gray-200 dark:border-white/10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg
            className="w-3.5 h-3.5 fill-accent flex-shrink-0"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span className="text-xs font-semibold tracking-widest uppercase text-gray-400 dark:text-white/40">
            WFA Agent Portal
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Icon rail (iPad landscape) ────────────────────────────────────────────────
// Between 1024px and 1279px the full 224px sidebar costs too much of the screen,
// so navigation collapses to a 64px column of icons. Labels live in the tooltip
// and the accessible name; the full sidebar returns at 1280px.

function NavRail({ onNav }) {
  const location = useLocation()
  const sections = useVisibleSections()

  return (
    <nav aria-label="Main" className="flex-1 min-h-0 overflow-y-auto py-3 flex flex-col items-center">
      {sections.map((section, si) => (
        <div
          key={si}
          className={`flex flex-col items-center gap-1 ${si > 0 ? 'mt-2 pt-2 border-t border-primary/15 dark:border-white/10 w-9' : ''}`}
        >
          {section.items.map(item => {
            const active = location.pathname === item.path
            return (
              <button
                key={item.path}
                onClick={() => onNav(item.path)}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={`relative w-11 h-11 shrink-0 flex items-center justify-center rounded-xl transition-colors
                  ${active
                    ? 'bg-primary/10 dark:bg-white/15 text-gray-900 dark:text-white before:content-[""] before:absolute before:-left-[10px] before:top-2.5 before:bottom-2.5 before:w-[3px] before:rounded-full before:bg-accent'
                    : 'text-gray-500 dark:text-white/60 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10'
                  }`}
              >
                <NavIcon path={item.path} />
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

// ── Shell styling shared between desktop and drawer ────────────────────────────
const SHELL_BASE = 'flex flex-col bg-primary/[0.09] dark:bg-primary border-r border-primary/20 dark:border-white/10'
const SHELL = `${SHELL_BASE} w-56`

// ── Sidebar ────────────────────────────────────────────────────────────────────

export default function Sidebar({ open, onClose }) {
  const navigate = useNavigate()

  function handleNav(path) {
    navigate(path)
    onClose()
  }

  // Close overlay on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      {/* ── Wide desktop (1280px+): full sidebar, starts below header ────────── */}
      <aside className={`hidden xl:flex flex-col fixed ${HEADER_TOP} left-0 bottom-0 z-20 ${SHELL}`}>
        <NavContent onNav={handleNav} />
      </aside>

      {/* ── iPad landscape / small laptop (1024–1279px): icon rail ───────────── */}
      <aside className={`hidden lg:flex xl:hidden fixed ${HEADER_TOP} left-0 bottom-0 z-20 w-16 ${SHELL_BASE}`}>
        <NavRail onNav={handleNav} />
      </aside>

      {/* ── Mobile / tablet portrait: overlay drawer ───────────────────────────── */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Drawer */}
          <aside className={`relative ${SHELL} h-full shadow-2xl`}>
            {/* Close button — clears the status bar / notch */}
            <div className="flex items-center justify-end px-3 pt-[max(0.75rem,env(safe-area-inset-top))] flex-shrink-0">
              <button
                onClick={onClose}
                aria-label="Close menu"
                className="w-11 h-11 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:text-white/40 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <NavContent onNav={handleNav} />
          </aside>
        </div>
      )}
    </>
  )
}
