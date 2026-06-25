import VideoCard from './VideoCard'
import { SERIES_META } from './publicConstants'

function ArrowRightIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  )
}

export default function SeriesStrip({ slug, videos, totalCount, onSeeAll, onVideoClick, isLast }) {
  const meta = SERIES_META[slug]
  const name = meta?.name ?? slug
  const host = meta?.host

  const metaText = slug === '__additional__'
    ? `Live Dialing, Getting Unstuck, and other sessions · ${totalCount}+ videos`
    : host
    ? `${host} & guests · ${totalCount}+ videos`
    : `${totalCount}+ videos`

  return (
    <div>
      {/* Strip header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 500, color: '#1A2B2E', margin: 0, fontFamily: 'Inter, sans-serif' }}>{name}</h2>
          <p style={{ fontSize: 12, color: '#7A9499', margin: '1px 0 0', fontFamily: 'Inter, sans-serif' }}>{metaText}</p>
        </div>
        <button onClick={onSeeAll}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12, color: '#EE2666', display: 'flex', alignItems: 'center', gap: 3,
            padding: 0, fontFamily: 'Inter, sans-serif', flexShrink: 0,
          }}>
          See all <ArrowRightIcon />
        </button>
      </div>

      {/* 4-column card grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {videos.slice(0, 4).map(v => (
          <VideoCard key={v.id} video={v} onClick={() => onVideoClick(v)} />
        ))}
      </div>

      {!isLast && (
        <hr style={{ border: 'none', borderTop: '0.5px solid #DDE6E8', margin: '32px 0 0' }} />
      )}
    </div>
  )
}
