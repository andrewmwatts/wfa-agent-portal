import PublicLayout from '../../components/public/PublicLayout'

const TERM = [
  { carrier: 'Banner',       product: 'BeyondTerm',                instant: true  },
  { carrier: 'SBLI',         product: 'EasyTrak',                  instant: true  },
  { carrier: 'Americo',      product: 'Home Mortgage Series',       instant: true  },
  { carrier: 'AmAm',         product: 'Home Certainty',             instant: false },
  { carrier: 'MOO',          product: 'Term Life Express',          instant: false },
  { carrier: 'Foresters',    product: 'Strong Foundation',          instant: false },
]

const WHOLE_LIFE = [
  { carrier: 'Americo',      product: 'Eagle',                      instant: true  },
  { carrier: 'AmAm',         product: 'QSFP',                       instant: true  },
  { carrier: 'UHL',          product: 'QSFC',                       instant: true  },
  { carrier: 'TransAmerica', product: 'FE Express',                 instant: true  },
  { carrier: 'UHL',          product: 'Express Issue Whole Life',   instant: false },
  { carrier: 'MOO',          product: 'Living Promise',             instant: false },
]

function ProductList({ items }) {
  return (
    <ol style={{ margin: 0, padding: '0 0 0 0', listStyle: 'none' }}>
      {items.map(({ carrier, product, instant }, i) => (
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
            {instant && (
              <span style={{ color: '#005365', fontWeight: 600 }}>†</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Section({ title, children }) {
  return (
    <div style={{
      background: '#fff', border: '0.5px solid #DDE6E8', borderRadius: 10,
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

export default function UnderwritingPage() {
  return (
    <PublicLayout>
      <div style={{ background: '#fff', minHeight: 'calc(100vh - 52px)', padding: '36px 28px 60px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>

          {/* Header */}
          <p style={{ fontSize: 11, color: '#7A9499', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px', fontFamily: 'Inter, sans-serif' }}>
            Underwriting Guidelines
          </p>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 500, color: '#003539', margin: '0 0 8px' }}>
            Carrier Preference Order
          </h1>
          <p style={{ fontSize: 14, color: '#4A6568', margin: '0 0 32px', fontFamily: 'Inter, sans-serif', lineHeight: 1.6, maxWidth: 640 }}>
            This is our recommended order of preference for each policy type. Start at the top and work down based on the client's health and eligibility.
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

          {/* IUL section */}
          <div style={{
            background: '#F5F9FA', border: '0.5px solid #DDE6E8', borderRadius: 10,
            padding: '20px 24px', marginBottom: 24,
          }}>
            <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 500, color: '#003539', margin: '0 0 8px' }}>
              IUL
            </h2>
            <p style={{ fontSize: 14, color: '#4A6568', margin: 0, fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
              IUL placement varies significantly by client profile and carrier appetite. We recommend consulting your{' '}
              <strong style={{ color: '#1A2B2E', fontWeight: 600 }}>mentor</strong> or a{' '}
              <strong style={{ color: '#1A2B2E', fontWeight: 600 }}>subject matter expert (SME)</strong> before placing IUL business.
            </p>
          </div>

          {/* Dagger note */}
          <p style={{ fontSize: 12, color: '#7A9499', fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
            <span style={{ color: '#005365', fontWeight: 700 }}>†</span> Instant issue product — decision rendered at point of sale with no additional underwriting required.
          </p>

        </div>
      </div>
    </PublicLayout>
  )
}
