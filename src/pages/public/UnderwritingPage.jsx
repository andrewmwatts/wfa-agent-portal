import { Link } from 'react-router-dom'
import PublicLayout from '../../components/public/PublicLayout'

const TERM = [
  { carrier: 'Banner',       product: 'BeyondTerm',                        instant: true  },
  { carrier: 'SBLI',         product: 'EasyTrak',                          instant: true  },
  { carrier: 'Americo',      product: 'Instant Decision Term Series (HMS/CBO)', instant: true  },
  { carrier: 'AmAm',         product: 'Home Certainty',                    instant: false },
  { carrier: 'MOO',          product: 'Term Life Express',                 instant: false },
  { carrier: 'Foresters',    product: 'Strong Foundation',                 instant: false },
]

const WHOLE_LIFE = [
  { carrier: 'Americo',      product: 'Eagle',                      instant: true  },
  { carrier: 'AmAm',         product: 'QSFP',                       instant: true  },
  { carrier: 'UHL',          product: 'QSFC',                       instant: true  },
  { carrier: 'TransAmerica', product: 'FE Express',                 instant: true  },
  { carrier: 'UHL',          product: 'Express Issue Whole Life',   instant: false },
  { carrier: 'MOO',          product: 'Living Promise',             instant: false },
  { carrier: 'Foresters',    product: 'Plan Right',                 instant: false },
]

const GIWL = [
  { carrier: 'Corebridge',   product: 'GIWL',                       instant: true  },
  { carrier: 'UHL',          product: 'GIWL',                       instant: true  },
]

const ACCIDENTAL = [
  { carrier: 'MOO',          product: 'Guaranteed ADvantage',       instant: true  },
  { carrier: 'Foresters',    product: 'Prepared II',                instant: true  },
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

function Section({ title, descriptor, children, shade }) {
  return (
    <div style={{
      background: shade ? '#F5F9FA' : '#fff',
      border: '0.5px solid #DDE6E8', borderRadius: 10,
      padding: '20px 24px',
    }}>
      <h2 style={{
        fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: 20, fontWeight: 500, color: '#003539',
        margin: descriptor ? '0 0 4px' : '0 0 16px',
      }}>
        {title}
      </h2>
      {descriptor && (
        <p style={{ fontSize: 12, color: '#4A6568', fontFamily: 'Inter, sans-serif', lineHeight: 1.5, margin: '0 0 14px' }}>
          {descriptor}
        </p>
      )}
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
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, marginBottom: 32 }}>
            <div style={{ maxWidth: 640 }}>
              <p style={{ fontSize: 11, color: '#7A9499', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px', fontFamily: 'Inter, sans-serif' }}>
                Underwriting Guidelines
              </p>
              <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 500, color: '#003539', margin: '0 0 8px' }}>
                Carrier Preference Order
              </h1>
              <p style={{ fontSize: 14, color: '#4A6568', margin: 0, fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
                This is our recommended order of preference for each policy type. Start at the top and work down based on the client's health and eligibility. Additional products are available and may be required depending on client health, but these should be your first choices.
              </p>
            </div>
            <Link to="/guidelines/new-york" style={{
              background: '#EE2666', color: '#fff', fontSize: 13, fontWeight: 600,
              borderRadius: 8, padding: '11px 18px',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              textDecoration: 'none', fontFamily: 'Inter, sans-serif',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              New York Options →
            </Link>
          </div>

          {/* Two-column: Term + Whole Life */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <Section title="Term" descriptor="Most coverage for the premium, but only valid for a limited time. Target age: 20–60">
              <ProductList items={TERM} />
            </Section>
            <Section title="Whole Life / Final Expense" descriptor="Lower coverage, but good for life. Target age: 50–80">
              <ProductList items={WHOLE_LIFE} />
            </Section>
          </div>

          {/* Two-column: GIWL + Accidental */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <Section title="GIWL" descriptor="Extremely unhealthy clients. If insured dies within the first two years due to non-accidental causes, beneficiary receives premiums paid plus 10% rather than the full face value." shade>
              <ProductList items={GIWL} />
            </Section>
            <Section title="Accidental" descriptor="Accidents are the third leading cause of death in the U.S. Extremely affordable plans. Accidental policies are great add-ons to every policy type. MOO requires a health license; Foresters does not." shade>
              <ProductList items={ACCIDENTAL} />
            </Section>
          </div>

          {/* IUL section */}
          <div style={{
            background: '#F5F9FA', border: '0.5px solid #DDE6E8', borderRadius: 10,
            padding: '20px 24px', marginBottom: 20,
          }}>
            <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 500, color: '#003539', margin: '0 0 4px' }}>
              IUL
            </h2>
            <p style={{ fontSize: 12, color: '#4A6568', margin: '0 0 10px', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
              Extremely customizable whole life policies. Commonly used for growing cash value.
            </p>
            <p style={{ fontSize: 14, color: '#4A6568', margin: 0, fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
              IUL case design varies significantly by client needs. We recommend consulting your{' '}
              <strong style={{ color: '#1A2B2E', fontWeight: 600 }}>mentor</strong> or a{' '}
              <strong style={{ color: '#1A2B2E', fontWeight: 600 }}>subject matter expert (SME)</strong> before quoting an IUL.
            </p>
          </div>

          {/* Dagger note */}
          <p style={{ fontSize: 12, color: '#7A9499', fontFamily: 'Inter, sans-serif', lineHeight: 1.6, marginBottom: 0 }}>
            <span style={{ color: '#005365', fontWeight: 700 }}>†</span> Instant issue product — decision rendered at point of sale with no additional underwriting required.
          </p>

          {/* Basic Underwriting Steps */}
          <div style={{ marginTop: 56 }}>
            <p style={{ fontSize: 11, color: '#7A9499', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px', fontFamily: 'Inter, sans-serif' }}>
              Underwriting Guidelines
            </p>
            <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 500, color: '#003539', margin: '0 0 28px' }}>
              Basic Underwriting Steps
            </h1>

            <ol style={{ margin: '0 0 20px', padding: '0 0 0 0', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 0 }}>
              {[
                {
                  text: 'Use the Carrier Cheat Sheet to eliminate products based on age or coverage.',
                  links: [{ label: 'Carrier Cheat Sheet', href: 'https://docs.google.com/document/d/1nG36psMpVOvHtqJ1bmL4eAMk9lNPzTRi1WdEyH9Ok-U/edit?usp=sharing' }],
                },
                {
                  text: 'Use build charts to eliminate products based on height/weight.',
                  links: [{ label: 'Build Charts', href: 'https://docs.google.com/spreadsheets/d/1fbx_Mb4mk7vAD9WpxRjcBzipQ_-ccBCOEbZZxNcrlXU/edit?gid=11449507#gid=11449507' }],
                },
                {
                  text: 'Use the Matrix to eliminate products based on client health history.',
                  links: [{ label: 'Matrix', href: 'https://docs.google.com/spreadsheets/d/1vd7cjSb3wB6FlH--YrLfzVur3XOclbYSAp8hP_rhuNs/edit?gid=1294218144#gid=1294218144' }],
                },
                {
                  text: 'Use lookback guides for amplifying information.',
                  links: [
                    { label: 'Lookback Guide 1', href: 'https://acrobat.adobe.com/id/urn:aaid:sc:US:55eea2d3-a262-46d2-9f23-16fce572b173' },
                    { label: 'Lookback Guide 2', href: 'https://acrobat.adobe.com/id/urn:aaid:sc:US:1f329cd0-3e42-4a2a-90a0-20aa84e15bf1' },
                  ],
                },
                { text: 'Once you have eliminated knockout policies, call remaining carriers to risk assess.' },
                { text: "If RA hotline didn't give you a premium quote, run quotes." },
                { text: 'Post in #underwriting-help channel or message your mentor with your results for confirmation.' },
              ].map(({ text, links }, i) => (
                <li key={i} style={{
                  display: 'flex', gap: 16, padding: '14px 0',
                  borderBottom: i < 6 ? '0.5px solid #EEF3F4' : 'none',
                }}>
                  <span style={{
                    fontSize: 13, fontWeight: 700, color: '#005365',
                    fontFamily: 'Inter, sans-serif', minWidth: 20, lineHeight: 1.6, flexShrink: 0,
                  }}>
                    {i + 1}
                  </span>
                  <span style={{ fontSize: 14, color: '#1A2B2E', fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
                    {text}
                    {links && (
                      <span style={{ display: 'inline-flex', gap: 10, marginLeft: 8, flexWrap: 'wrap' }}>
                        {links.map(({ label, href }) => (
                          <a key={href} href={href} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#EE2666', textDecoration: 'none', fontSize: 13, fontWeight: 500 }}>
                            {label} →
                          </a>
                        ))}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>

            <div style={{
              background: '#F5F9FA', border: '0.5px solid #DDE6E8', borderRadius: 10,
              padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 16, lineHeight: 1.4, flexShrink: 0 }}>💡</span>
              <p style={{ fontSize: 13, color: '#4A6568', fontFamily: 'Inter, sans-serif', lineHeight: 1.6, margin: 0 }}>
                <strong style={{ color: '#1A2B2E' }}>Navigator</strong> is great at comparing multiple products quickly, but it doesn't have every product in it. If you get a potential product via Navigator it's probably a good option, but if not you will need to go through all of the steps here.
              </p>
            </div>
          </div>

        </div>
      </div>
    </PublicLayout>
  )
}
