// Single source of truth for the navigation structure.
// Imported by both Sidebar.jsx and NavMenu.jsx — edit here only.

export const LEADER_ROLES = new Set(['leader', 'owner', 'director', 'super_admin'])
export const OWNER_ROLES  = new Set(['owner', 'director', 'super_admin'])
export const ADMIN_ROLES  = new Set(['super_admin'])

export const NAV_SECTIONS = [
  {
    items: [
      { path: '/dashboard', label: 'Dashboard' },
    ],
  },
  {
    label: 'Business',
    items: [
      { path: '/policies',   label: 'Policies'              },
      { path: '/lapse',      label: 'Lapse / Pending Lapse' },
      { path: '/activity',   label: 'Activity Tracking'     },
      { path: '/leads',      label: 'Leads'                 },
      { path: '/recruiting', label: 'Recruiting'            },
    ],
  },
  {
    label: 'Owner',
    items: [
      { path: '/monthly-agent-totals', label: 'Monthly Agent Totals', roles: LEADER_ROLES },
      { path: '/contracting',          label: 'Contracting',          roles: LEADER_ROLES },
      { path: '/accountability',       label: 'Accountability',       roles: OWNER_ROLES  },
      { path: '/coaching',             label: 'Coaching',             roles: LEADER_ROLES },
      { path: '/snapshot',             label: 'Snapshot',             roles: OWNER_ROLES  },
      { path: '/agents',               label: 'Agents',               roles: LEADER_ROLES },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { path: '/income',          label: 'Income / Expenses' },
      { path: '/monthly-metrics', label: 'Monthly Metrics'   },
      { path: '/weekly-metrics',  label: 'Weekly Metrics'    },
      { path: '/carrier-metrics', label: 'Carrier Metrics'   },
    ],
  },
  {
    label: 'Admin',
    items: [
      { path: '/admin-tools', label: 'Admin Tools', roles: ADMIN_ROLES },
    ],
  },
]
