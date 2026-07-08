// Single source of truth for the navigation structure.
// Imported by both Sidebar.jsx and NavMenu.jsx — edit here only.

export const LEADER_ROLES = new Set(['leader', 'owner', 'director', 'super_admin'])
export const OWNER_ROLES  = new Set(['owner', 'director', 'super_admin'])
export const ADMIN_ROLES  = new Set(['super_admin'])
export const AGENT_ROLES  = new Set(['agent', 'super_admin'])

export const NAV_SECTIONS = [
  {
    items: [
      { path: '/portal/dashboard', label: 'Dashboard' },
    ],
  },
  {
    label: 'Business',
    items: [
      { path: '/portal/policies',   label: 'Policies'          },
      { path: '/portal/engagement', label: 'Client Engagement' },
      { path: '/portal/activity',   label: 'Activity Tracking' },
      { path: '/portal/leads',      label: 'Leads'             },
      { path: '/portal/recruiting',  label: 'Recruiting'        },
      { path: '/portal/project-100',     label: 'Project 100', roles: AGENT_ROLES },
      { path: '/portal/ninety-day-plan', label: '90-Day Plan', roles: AGENT_ROLES },
    ],
  },
  {
    label: 'Owner',
    items: [
      { path: '/portal/monthly-agent-totals', label: 'Monthly Agent Totals', roles: LEADER_ROLES },
      { path: '/portal/contracting',          label: 'Contracting',          roles: LEADER_ROLES },
      { path: '/portal/accountability',       label: 'Accountability',       roles: OWNER_ROLES  },
      { path: '/portal/coaching',             label: 'Coaching',             roles: LEADER_ROLES },
      { path: '/portal/promotions',           label: 'Promotions',           roles: OWNER_ROLES  },
      { path: '/portal/agents',               label: 'Agents',               roles: LEADER_ROLES },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { path: '/portal/income',          label: 'Income / Expenses' },
      { path: '/portal/monthly-metrics', label: 'Monthly Metrics'   },
      { path: '/portal/weekly-metrics',  label: 'Weekly Metrics'    },
      { path: '/portal/carrier-metrics', label: 'Carrier Metrics'   },
    ],
  },
  {
    label: 'Admin',
    items: [
      { path: '/portal/admin-tools', label: 'Admin Tools', roles: ADMIN_ROLES },
    ],
  },
]
