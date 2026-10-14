import PublicLayout from '../../components/public/PublicLayout'

// The Watts guide is a standalone page hosted from /public/guides (its "Printable
// guide" button points at the PDF beside it). The Jonas guide lives on its own site.
const GUIDES = [
  {
    title: 'Watts Agency Onboarding Guide',
    body: 'From license to profitability: everything a new agent needs from the day they pass their exam to their first families protected.',
    href: '/guides/wfa-new-agent-guide.html',
    label: 'Open guide →',
  },
  {
    title: 'Jonas Agency Onboarding Guide',
    body: 'Everything you need from day one to your first sale.',
    href: 'https://thejonasagencyguide.tiiny.site/',
    label: 'Open guide →',
  },
]

export default function ResourcesPage() {
  return (
    <PublicLayout>
      {/* Hero banner */}
      <div style={{ background: '#003539', padding: 'clamp(32px, 6vw, 48px) clamp(16px, 4vw, 28px)' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px', fontFamily: 'Inter, sans-serif' }}>
            WATTS FAMILY AGENCY
          </p>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 'clamp(26px, 6vw, 32px)', fontWeight: 500, color: '#fff', margin: 0, lineHeight: 1.25 }}>
            Documents &amp; guides
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', maxWidth: 480, margin: '10px 0 0', lineHeight: 1.6, fontFamily: 'Inter, sans-serif' }}>
            Onboarding guides and reference materials for new agents.
          </p>
        </div>
      </div>

      {/* Guides */}
      <div style={{ background: '#fff', padding: '32px clamp(16px, 4vw, 28px)' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {GUIDES.map(g => (
              <div key={g.title}
                style={{ background: '#fff', border: '0.5px solid #DDE6E8', borderRadius: 10, padding: '20px 20px 16px' }}>
                <h3 style={{ fontSize: 15, fontWeight: 500, color: '#1A2B2E', margin: '0 0 6px', fontFamily: 'Inter, sans-serif' }}>
                  {g.title}
                </h3>
                <p style={{ fontSize: 13, color: '#4A6568', margin: '0 0 14px', lineHeight: 1.5, fontFamily: 'Inter, sans-serif' }}>
                  {g.body}
                </p>
                <a href={g.href}
                  style={{ fontSize: 13, color: '#EE2666', textDecoration: 'none', fontFamily: 'Inter, sans-serif' }}>
                  {g.label}
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PublicLayout>
  )
}
