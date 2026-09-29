import PublicLayout from '../../components/public/PublicLayout'

const EFFECTIVE_DATE = 'September 29, 2026'

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{
        fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: 18, fontWeight: 500, color: '#003539',
        margin: '0 0 10px',
      }}>
        {title}
      </h2>
      <div style={{ fontSize: 14, color: '#4A6568', fontFamily: 'Inter, sans-serif', lineHeight: 1.7 }}>
        {children}
      </div>
    </div>
  )
}

export default function TermsOfService() {
  return (
    <PublicLayout>
      <div style={{ background: '#fff', minHeight: 'calc(100vh - 52px)', padding: '36px clamp(16px, 4vw, 28px) 60px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>

          <p style={{ fontSize: 11, color: '#7A9499', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px', fontFamily: 'Inter, sans-serif' }}>
            Legal
          </p>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 500, color: '#003539', margin: '0 0 8px' }}>
            Terms of Service
          </h1>
          <p style={{ fontSize: 13, color: '#7A9499', margin: '0 0 32px', fontFamily: 'Inter, sans-serif' }}>
            Effective {EFFECTIVE_DATE}
          </p>

          <Section title="Acceptance of terms">
            <p>
              These Terms of Service govern your use of the WFA Agent Portal at agents.wattsfamilyagency.com (the
              &quot;Portal&quot;), operated by Watts Family Agency (&quot;WFA,&quot; &quot;we,&quot; &quot;us,&quot;
              or &quot;our&quot;). By logging into or using the Portal, you agree to these terms.
            </p>
          </Section>

          <Section title="Eligibility">
            <p>
              The Portal is for agents and staff affiliated with WFA. Accounts are provisioned by WFA
              administrators or created through the Portal&apos;s registration flow, which validates a prospective
              user against WFA&apos;s active agent roster before an account can be created.
            </p>
          </Section>

          <Section title="Your account">
            <p>
              You are responsible for keeping your login credentials confidential and for all activity under your
              account. Notify us promptly if you suspect unauthorized access.
            </p>
          </Section>

          <Section title="Acceptable use">
            <p>
              The Portal is provided for legitimate business use by WFA-affiliated agents and staff. You agree not
              to access data belonging to other agents beyond what your role permits, attempt to circumvent the
              Portal&apos;s access controls, or use the Portal in any way that violates applicable law.
            </p>
          </Section>

          <Section title="Google Calendar integration">
            <p>
              Connecting Google Calendar is optional. If you connect it, you authorize the Portal to create
              calendar events on your behalf for appointments you schedule through the Portal. The Portal does not
              read, modify, or delete any other events on your calendar. You can disconnect this integration at any
              time from your profile menu; see our{' '}
              <a href="/privacy" style={{ color: '#EE2666' }}>Privacy Policy</a> for details.
            </p>
          </Section>

          <Section title="Data ownership">
            <p>
              Business, policy, and performance data displayed in the Portal belongs to WFA. Nothing in these terms
              transfers ownership of that data to you.
            </p>
          </Section>

          <Section title="Availability">
            <p>
              The Portal is provided &quot;as is&quot; and &quot;as available.&quot; We do not guarantee
              uninterrupted or error-free operation and may modify, suspend, or discontinue any part of the Portal
              at any time.
            </p>
          </Section>

          <Section title="Termination">
            <p>
              We may suspend or terminate your access to the Portal if you violate these terms, if your affiliation
              with WFA ends, or at our discretion for the security or integrity of the Portal.
            </p>
          </Section>

          <Section title="Limitation of liability">
            <p>
              To the fullest extent permitted by law, WFA is not liable for any indirect, incidental, or
              consequential damages arising from your use of the Portal.
            </p>
          </Section>

          <Section title="Changes to these terms">
            <p>
              We may update these terms from time to time. Material changes will be reflected by an updated
              effective date at the top of this page.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about these terms can be sent to{' '}
              <a href="mailto:andrew@wattsfamilyagency.com" style={{ color: '#EE2666' }}>andrew@wattsfamilyagency.com</a>.
            </p>
          </Section>

        </div>
      </div>
    </PublicLayout>
  )
}
