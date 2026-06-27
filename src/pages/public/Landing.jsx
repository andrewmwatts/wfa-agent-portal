import { Link } from 'react-router-dom'
import PublicLayout from '../../components/public/PublicLayout'

function VideoIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#005365" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M10 8l6 4-6 4V8z"/>
    </svg>
  )
}

function FileIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#005365" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#005365" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}

function BookIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#005365" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
    </svg>
  )
}

const QUICK_LINKS = [
  {
    icon: <VideoIcon />,
    title: 'Video library',
    body: '440+ training calls across WFH, Reset Room, BABB, TPC, S+U, and more.',
    link: { label: 'Browse videos →', to: '/videos', active: true },
  },
  {
    icon: <FileIcon />,
    title: 'Documents & guides',
    body: 'Admin guides, scripts, carrier resources, and reference materials.',
    link: { label: 'Coming soon', active: false },
  },
  {
    icon: <CalendarIcon />,
    title: 'Agency calendar',
    body: 'Business month calendars, MACC Room schedule, and promotion rules.',
    link: { label: 'View calendar →', to: '/calendar', active: true },
  },
  {
    icon: <BookIcon />,
    title: 'Underwriting guidelines',
    body: 'Carrier-specific underwriting criteria, health classifications, and eligibility guides.',
    link: { label: 'View guidelines →', to: '/guidelines', active: true },
  },
]

export default function Landing() {
  return (
    <PublicLayout>
      {/* Hero banner */}
      <div style={{ background: '#003539', padding: '48px 28px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px', fontFamily: 'Inter, sans-serif' }}>
            WATTS FAMILY AGENCY
          </p>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 32, fontWeight: 500, color: '#fff', margin: 0, lineHeight: 1.25 }}>
            Training resources for the field.
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', maxWidth: 480, margin: '10px 0 0', lineHeight: 1.6, fontFamily: 'Inter, sans-serif' }}>
            Videos, guides, and tools for agents across the Symmetry network.
          </p>
        </div>
      </div>

      {/* Quick links */}
      <div style={{ background: '#fff', padding: '32px 28px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {QUICK_LINKS.map(card => (
              <div key={card.title}
                style={{ background: '#fff', border: '0.5px solid #DDE6E8', borderRadius: 10, padding: '20px 20px 16px' }}>
                {card.icon}
                <h3 style={{ fontSize: 15, fontWeight: 500, color: '#1A2B2E', margin: '10px 0 6px', fontFamily: 'Inter, sans-serif' }}>
                  {card.title}
                </h3>
                <p style={{ fontSize: 13, color: '#4A6568', margin: '0 0 14px', lineHeight: 1.5, fontFamily: 'Inter, sans-serif' }}>
                  {card.body}
                </p>
                {card.link.active ? (
                  <Link to={card.link.to}
                    style={{ fontSize: 13, color: '#EE2666', textDecoration: 'none', fontFamily: 'Inter, sans-serif' }}>
                    {card.link.label}
                  </Link>
                ) : (
                  <span style={{ fontSize: 13, color: '#7A9499', fontFamily: 'Inter, sans-serif' }}>
                    {card.link.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </PublicLayout>
  )
}
