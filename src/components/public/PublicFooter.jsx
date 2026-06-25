export default function PublicFooter() {
  return (
    <footer style={{
      background: '#003539', padding: '14px 28px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      flexShrink: 0,
    }}>
      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontFamily: 'Inter, sans-serif' }}>
        Watts Family Agency · Resource Library
      </span>
      <a href="/portal/dashboard"
        style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, textDecoration: 'none', fontFamily: 'Inter, sans-serif' }}>
        Agent portal →
      </a>
    </footer>
  )
}
