// Monochrome line icons for the collapsed sidebar rail (iPad landscape), keyed by
// nav path. 24x24, stroke-only, so they inherit the rail's text color.
// Paths mirror NAV_SECTIONS in navSections.js; an unknown path falls back to a dot.

const ICONS = {
  '/portal/dashboard': (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
    </>
  ),
  '/portal/policies': (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M10 12h5M10 16h5" />
    </>
  ),
  '/portal/engagement': <path d="M4 5h16v11H9l-5 4z" />,
  '/portal/activity': <path d="M3 12h4l3-8 4 16 3-8h4" />,
  '/portal/leads': (
    <path d="M6 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z" />
  ),
  '/portal/recruiting': (
    <>
      <circle cx="10" cy="8" r="4" />
      <path d="M3 20c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6" />
    </>
  ),
  '/portal/project-100': <path d="M5 21V4h11l-1.5 4 1.5 4H5" />,
  '/portal/ninety-day-plan': (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  '/portal/monthly-agent-totals': <path d="M5 20v-9M12 20V5M19 20v-9" />,
  '/portal/contracting': (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4h6v3H9zM9 14l2 2 4-4" />
    </>
  ),
  '/portal/accountability': (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" />
    </>
  ),
  '/portal/coaching': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  '/portal/promotions': <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  '/portal/agents': (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-5.5 6.5-5.5s6.5 1.9 6.5 5.5M16 5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.5 2.2 3.5 5.2" />
    </>
  ),
  '/portal/income': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9.2c-.4-1-1.4-1.5-2.5-1.5-1.5 0-2.6.8-2.6 2 0 3 5.2 1.5 5.2 4.3 0 1.2-1.1 2-2.6 2-1.2 0-2.3-.6-2.7-1.7M12 6v1.7M12 16.3V18" />
    </>
  ),
  '/portal/monthly-metrics': (
    <>
      <path d="M4 4v16h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </>
  ),
  '/portal/weekly-metrics': (
    <>
      <path d="M4 4v16h16" />
      <path d="M7 14l4-4 3 3 5-6" />
    </>
  ),
  '/portal/carrier-metrics': (
    <>
      <path d="M12 3a9 9 0 1 0 9 9h-9z" />
      <path d="M15 3.5A9 9 0 0 1 20.5 9H15z" />
    </>
  ),
  '/portal/admin-tools': (
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.5 17.3a2 2 0 0 0 2.8 2.8l5.8-5.8a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
  ),
}

export default function NavIcon({ path, className = 'w-[22px] h-[22px]' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[path] ?? <circle cx="12" cy="12" r="2" />}
    </svg>
  )
}
