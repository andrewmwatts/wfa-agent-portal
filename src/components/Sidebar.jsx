import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useViewing } from '../context/ViewingContext'
import { HEADER_TOP } from './AppLayout'
import { NAV_SECTIONS } from '../config/navSections'

// ── Shared nav + branding content ─────────────────────────────────────────────

function NavContent({ onNav }) {
  const location                   = useLocation()
  const { userProfile }            = useAuth()
  const { activeSubject, isSelf }  = useViewing()
  // When viewing as a delegate, show nav items appropriate to the subject's role
  const role = (isSelf ? userProfile?.role : activeSubject?.role) ?? userProfile?.role ?? 'agent'

  return (
    <div className="flex flex-col h-full">

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {NAV_SECTIONS.map((section, si) => {
          const visibleItems = section.items.filter(item => !item.roles || item.roles.has(role))
          if (!visibleItems.length) return null
          return (
            <div key={si} className={si > 0 ? 'mt-4' : ''}>
              {section.label && (
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {visibleItems.map(item => (
                  <button
                    key={item.path}
                    onClick={() => onNav(item.path)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors
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
          )
        })}
      </nav>

      {/* WFA branding */}
      <div className="px-4 py-4 border-t border-gray-200 dark:border-white/10 flex-shrink-0">
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

// ── Shell styling shared between desktop and drawer ────────────────────────────
const SHELL = 'flex flex-col w-56 bg-primary/[0.09] dark:bg-primary border-r border-primary/20 dark:border-white/10'

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
      {/* ── Desktop: fixed sidebar, starts below header ───────────────────── */}
      <aside className={`hidden lg:flex flex-col fixed ${HEADER_TOP} left-0 bottom-0 z-20 ${SHELL}`}>
        <NavContent onNav={handleNav} />
      </aside>

      {/* ── Mobile / tablet: overlay drawer ────────────────────────────────── */}
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
            {/* Close button */}
            <div className="flex items-center justify-end px-3 pt-3 flex-shrink-0">
              <button
                onClick={onClose}
                aria-label="Close menu"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:text-white/40 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
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
