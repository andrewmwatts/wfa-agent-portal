import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const LEADER_ROLES = new Set(['leader', 'owner', 'director', 'super_admin'])
const OWNER_ROLES  = new Set(['owner', 'super_admin'])

const NAV_SECTIONS = [
  {
    items: [
      { path: '/dashboard', label: 'Dashboard' },
    ],
  },
  {
    label: 'Business',
    items: [
      { path: '/policies', label: 'Policies'              },
      { path: '/lapse',    label: 'Lapse / Pending Lapse' },
      { path: '/activity', label: 'Activity Tracking'     },
      { path: '/leads',    label: 'Leads'                 },
    ],
  },
  {
    label: 'Owner',
    items: [
      { path: '/monthly-agent-totals', label: 'Monthly Agent Totals', roles: LEADER_ROLES },
      { path: '/contracting',           label: 'Contracting',          roles: LEADER_ROLES },
      { path: '/accountability',        label: 'Accountability',       roles: LEADER_ROLES },
      { path: '/coaching',             label: 'Coaching',             roles: LEADER_ROLES },
      { path: '/snapshot',              label: 'Snapshot',             roles: LEADER_ROLES },
      { path: '/agents',               label: 'Agents',               roles: OWNER_ROLES  },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { path: '/monthly-metrics',  label: 'Monthly Metrics'  },
      { path: '/weekly-metrics',   label: 'Weekly Metrics'   },
      { path: '/carrier-metrics',  label: 'Carrier Metrics'  },
    ],
  },
  {
    label: 'Admin',
    items: [
      { path: '/admin-tools', label: 'Admin Tools', roles: ADMIN_ROLES },
    ],
  },
]

export default function NavMenu() {
  const [open, setOpen] = useState(false)
  const location        = useLocation()
  const navigate        = useNavigate()
  const ref             = useRef(null)
  const { userProfile } = useAuth()

  const role = userProfile?.role ?? 'agent'

  const allVisible = NAV_SECTIONS.flatMap(s =>
    s.items.filter(item => !item.roles || item.roles.has(role))
  )

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const active = allVisible.find(i => i.path === location.pathname) ?? allVisible[0]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 dark:text-white/80 dark:hover:text-white dark:hover:bg-white/10 transition-colors px-3 py-1.5 rounded-lg"
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <span>{active?.label}</span>
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 mt-1.5 w-52 bg-white border border-gray-200 dark:bg-primary dark:border-white/15 rounded-xl shadow-2xl z-50 overflow-hidden py-1">
          {NAV_SECTIONS.map((section, si) => {
            const visibleItems = section.items.filter(item => !item.roles || item.roles.has(role))
            if (!visibleItems.length) return null
            return (
              <div key={si} className={si > 0 ? 'mt-1' : ''}>
                {section.label && (
                  <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">
                    {section.label}
                  </p>
                )}
                {visibleItems.map(item => (
                  <button
                    key={item.path}
                    onClick={() => { navigate(item.path); setOpen(false) }}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors
                      ${location.pathname === item.path
                        ? 'text-accent bg-accent/10 font-medium'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-white/75 dark:hover:text-white dark:hover:bg-white/10'
                      }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
