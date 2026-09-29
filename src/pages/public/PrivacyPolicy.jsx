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

export default function PrivacyPolicy() {
  return (
    <PublicLayout>
      <div style={{ background: '#fff', minHeight: 'calc(100vh - 52px)', padding: '36px clamp(16px, 4vw, 28px) 60px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>

          <p style={{ fontSize: 11, color: '#7A9499', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px', fontFamily: 'Inter, sans-serif' }}>
            Legal
          </p>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 500, color: '#003539', margin: '0 0 8px' }}>
            Privacy Policy
          </h1>
          <p style={{ fontSize: 13, color: '#7A9499', margin: '0 0 32px', fontFamily: 'Inter, sans-serif' }}>
            Effective {EFFECTIVE_DATE}
          </p>

          <Section title="Who we are">
            <p>
              Watts Family Agency (&quot;WFA,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates the
              WFA Agent Portal at agents.wattsfamilyagency.com (the &quot;Portal&quot;), an internal tool for agents
              and staff affiliated with WFA. This policy explains what information the Portal collects, how it is
              used, and the choices you have.
            </p>
          </Section>

          <Section title="Information we collect">
            <p style={{ margin: '0 0 10px' }}>
              <strong style={{ color: '#1A2B2E' }}>Account information</strong> — your name, email address, SFG ID,
              and role, collected when your account is provisioned or when you register with a valid SFG ID.
            </p>
            <p style={{ margin: '0 0 10px' }}>
              <strong style={{ color: '#1A2B2E' }}>Business and performance data</strong> — onboarding progress,
              policy and commission activity, recruiting activity, and related metrics tied to your SFG ID. This
              data comes from WFA&apos;s internal systems and is not something you submit directly through the
              Portal.
            </p>
            <p style={{ margin: 0 }}>
              <strong style={{ color: '#1A2B2E' }}>Google Calendar data (optional)</strong> — if you choose to
              connect your Google account from your profile menu, the Portal requests permission to create calendar
              events on your behalf (the <code style={{ fontSize: 12.5 }}>calendar.app.created</code> scope). This
              lets the Portal add appointments to your calendar when you schedule them through the app. The Portal
              cannot see, list, modify, or delete any other events on your calendar — only events it created itself.
            </p>
          </Section>

          <Section title="How we use information">
            <p>
              We use this information to operate and administer the Portal: authenticating your login, displaying
              your onboarding and performance data, and — if you&apos;ve connected Google Calendar — creating
              calendar events for appointments you schedule through the Portal. We do not use your data for
              advertising and do not sell it.
            </p>
          </Section>

          <Section title="Google user data">
            <p style={{ margin: '0 0 10px' }}>
              WFA Agent Portal&apos;s use and transfer to any other app of information received from Google APIs
              will adhere to the{' '}
              <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" style={{ color: '#EE2666' }}>
                Google API Services User Data Policy
              </a>, including the Limited Use requirements.
            </p>
            <p style={{ margin: 0 }}>
              You can revoke the Portal&apos;s access to your Google account at any time by disconnecting it from
              your profile menu in the Portal, or directly from{' '}
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" style={{ color: '#EE2666' }}>
                Google Account permissions
              </a>.
            </p>
          </Section>

          <Section title="AI and machine learning">
            <p>
              Google Workspace API data (including data accessed through the Google Calendar integration) is not
              used to develop, improve, or train any generalized or non-personalized artificial intelligence or
              machine learning models.
            </p>
          </Section>

          <Section title="Data sharing">
            <p>
              We do not sell your information. We share it only with the service providers that run the Portal —
              Supabase (database and authentication), Vercel (hosting), and Google (Calendar integration, if you
              connect it) — solely to provide the Portal&apos;s functionality, and with WFA staff who administer
              the Portal.
            </p>
          </Section>

          <Section title="Data retention">
            <p>
              Account and business data is retained while your Portal account is active. If you disconnect Google
              Calendar, or your account is deactivated, your stored Google refresh token is deleted immediately and
              the Portal can no longer create events on your calendar.
            </p>
          </Section>

          <Section title="Data security">
            <p>
              Data is stored in Supabase with row-level access controls and transmitted over encrypted connections.
              Access to agent data within the Portal is scoped by role and account permissions.
            </p>
          </Section>

          <Section title="Your choices">
            <p>
              You can disconnect Google Calendar at any time from your profile menu. To request a copy of your data
              or ask that your account be deleted, contact us at the email below.
            </p>
          </Section>

          <Section title="Changes to this policy">
            <p>
              We may update this policy from time to time. Material changes will be reflected by an updated
              effective date at the top of this page.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about this policy or your data can be sent to{' '}
              <a href="mailto:andrew@wattsfamilyagency.com" style={{ color: '#EE2666' }}>andrew@wattsfamilyagency.com</a>.
            </p>
          </Section>

        </div>
      </div>
    </PublicLayout>
  )
}
