import { useEffect, useState } from 'react'
import VideoRow from './VideoRow'

const PAGE_SIZE = 25

export default function FlatView({ videos, onVideoClick }) {
  const [showing, setShowing] = useState(PAGE_SIZE)

  // Reset pagination when video list changes
  useEffect(() => { setShowing(PAGE_SIZE) }, [videos])

  const visible = videos.slice(0, showing)

  return (
    <div style={{ background: 'var(--pub-bg-page)', paddingBottom: 40 }}>
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
