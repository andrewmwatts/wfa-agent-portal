import { useEffect, useState } from 'react'
import VideoRow from './VideoRow'
import { getSeriesName } from './publicConstants'

function ArrowLeftIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
  )
}

const PAGE_SIZE = 25

export default function FlatView({ videos, activeSeries, searchQuery, onVideoClick, onBack, listHeaderTop = 52 }) {
  const [showing, setShowing] = useState(PAGE_SIZE)

  // Reset pagination when filter changes
  useEffect(() => { setShowing(PAGE_SIZE) }, [activeSeries, searchQuery])

  const title = activeSeries
    ? getSeriesName(activeSeries)
    : searchQuery.trim()
    ? 'Search results'
    : 'All videos'

  const visible = videos.slice(0, showing)

  return (
    <div style={{ background: 'var(--pub-bg-page)', paddingBottom: 40 }}>
      {/* Sticky list header */}
      <div style={{
        position: 'sticky', top: listHeaderTop, zIndex: 30,
        background: '#fff', borderBottom: '0.5px solid var(--pub-border)',
        padding: '12px 28px',
      }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 500, color: '#1A2B2E', margin: 0, fontFamily: 'Inter, sans-serif' }}>{title}</p>
            <p style={{ fontSize: 12, color: '#7A9499', margin: '1px 0 0', fontFamily: 'Inter, sans-serif' }}>
              {videos.length} video{videos.length !== 1 ? 's' : ''} · newest first
            </p>
          </div>
          <button onClick={onBack}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, color: '#4A6568', display: 'flex', alignItems: 'center', gap: 4,
              fontFamily: 'Inter, sans-serif', padding: '6px 0',
            }}>
            <ArrowLeftIcon /> All series
          </button>
        </div>
      </div>

      {/* Video list */}
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 28px' }}>
        {videos.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '48px 0', color: '#7A9499', fontSize: 14, fontFamily: 'Inter, sans-serif' }}>
            No videos found.
          </p>
        ) : (
          <>
            {visible.map(v => (
              <VideoRow key={v.id} video={v} onClick={() => onVideoClick(v)} />
            ))}
            {showing < videos.length && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <button
                  onClick={() => setShowing(s => s + PAGE_SIZE)}
                  style={{
                    border: '0.5px solid var(--pub-border)', background: 'transparent',
                    fontSize: 13, color: '#4A6568', padding: '8px 20px',
                    borderRadius: 8, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                  }}>
                  Load more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
