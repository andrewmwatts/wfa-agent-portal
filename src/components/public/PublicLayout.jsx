import PublicNav from './PublicNav'
import PublicFooter from './PublicFooter'

export default function PublicLayout({ children }) {
  return (
    <div style={{ background: 'var(--pub-bg-page)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <PublicNav />
      <main style={{ flex: 1 }}>{children}</main>
      <PublicFooter />
    </div>
  )
}
