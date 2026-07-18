import { Link } from 'react-router-dom'
import PublicLayout from '../../components/public/PublicLayout'

const TERM = [
  { carrier: 'NLG', product: 'Term' },
]

const WHOLE_LIFE = [
  { carrier: 'TransAmerica', product: 'Immediate Solution, 10-Pay Solution, and Easy Solution' },
]

const ACCIDENTAL = [
  { carrier: 'MOO', product: 'Guaranteed ADvantage' },
]

const CRITICAL_ILLNESS = [
  { carrier: 'MOO', product: 'Critical Advantage' },
]

const IUL = [
  { carrier: 'TransAmerica', product: 'FFIUL (not FFIUL II)' },
]

function ArrowLeftIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
  )
}

function ProductList({ items }) {
  return (
    <ol style={{ margin: 0, padding: '0 0 0 0', listStyle: 'none' }}>
      {items.map(({ carrier, product }, i) => (
        <li key={i} style={{
          display: 'flex', alignItems: 'baseline', gap: 8,
          padding: '10px 0',
          borderBottom: i < items.length - 1 ? '0.5px solid #EEF3F4' : 'none',
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700, color: '#9BB3B8',
            fontFamily: 'Inter, sans-serif', minWidth: 18, lineHeight: 1,
          }}>
            {i + 1}
          </span>
          <span style={{ fontSize: 14, color: '#1A2B2E', fontFamily: 'Inter, sans-serif', lineHeight: 1.4 }}>
            <span style={{ fontWeight: 600 }}>{carrier}</span>
            {' – '}
            {product}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Section({ title, children, shade }) {
  return (
    <div style={{
      background: shade ? '#F5F9FA' : '#fff',
      border: '0.5px solid #DDE6E8', borderRadius: 10,
      padding: '20px 24px',
    }}>
      <h2 style={{
        fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: 20, fontWeight: 500, color: '#003539',
        margin: '0 0 16px',
      }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

export default function NewYorkOptionsPage() {
  return (
    <PublicLayout>
      <div style={{ background: '#fff', minHeight: 'calc(100vh - 52px)', padding: '36px 28px 60px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>

          {/* Back link */}
          <Link to="/guidelines" style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12, color: '#4A6568', display: 'inline-flex', alignItems: 'center', gap: 4,
            fontFamily: 'Inter, sans-serif', padding: '6px 0', marginBottom: 12,
            textDecoration: 'none',
          }}>
            <ArrowLeftIcon /> Back to Guidelines
          </Link>

          {/* Header */}
          <p style={{ fontSize: 11, color: '#7A9499', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px', fontFamily: 'Inter, sans-serif' }}>
            Underwriting Guidelines
          </p>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 500, color: '#003539', margin: '0 0 8px' }}>
            New York Options
          </h1>
          <p style={{ fontSize: 14, color: '#4A6568', margin: '0 0 32px', fontFamily: 'Inter, sans-serif', lineHeight: 1.6, maxWidth: 640 }}>
            New York is very limited in available carriers and products due to state requirements and restrictions. We highly recommend getting a health license if you live in and intend to sell in NY because the MOO products may be an important part of your portfolio.
          </p>

          {/* Two-column: Term + Whole Life */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <Section title="Term">
              <ProductList items={TERM} />
            </Section>
            <Section title="Whole Life">
              <ProductList items={WHOLE_LIFE} />
            </Section>
          </div>

          {/* Two-column: Accidental + Critical Illness */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <Section title="Accidental" shade>
              <ProductList items={ACCIDENTAL} />
            </Section>
            <Section title="Critical Illness" shade>
              <ProductList items={CRITICAL_ILLNESS} />
            </Section>
          </div>

          {/* IUL section */}
          <div style={{
            background: '#F5F9FA', border: '0.5px solid #DDE6E8', borderRadius: 10,
            padding: '20px 24px', marginBottom: 32,
          }}>
            <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 500, color: '#003539', margin: '0 0 16px' }}>
              IUL
            </h2>
            <ProductList items={IUL} />
          </div>

          {/* Footnotes */}
          <ul style={{ margin: 0, padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              'All NY resident agents should receive an NLG contract as part of their onboarding',
              'NY resident agents are not eligible to be contracted with AmAm/Occidental, even if they hold non-resident licenses in other states',
            ].map((note, i) => (
              <li key={i} style={{ fontSize: 12, color: '#7A9499', fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
                {note}
              </li>
            ))}
          </ul>

        </div>
      </div>
    </PublicLayout>
  )
}
