import { useState } from 'react'
import { getSeriesName, formatDate, formatSpeakers, getSeriesChipStyle, NEUTRAL_CHIP } from './publicConstants'

function PlayIcon({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z"/>
    </svg>
  )
}

export default function VideoRow({ video, onClick }) {
  const [hovered, setHovered] = useState(false)
  const chip   = getSeriesChipStyle(video.series_slug)
  // Series chip + up to 3 topics (4 total max)
  const topics = (video.topics ?? []).slice(0, video.series_slug ? 3 : 4)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: hovered ? '11px 8px' : '11px 0',
        margin: hovered ? '0 -8px' : '0',
        borderBottom: hovered ? 'none' : '0.5px solid var(--pub-border)',
        background: hovered ? '#F0F5F6' : 'transparent',
        borderRadius: hovered ? 8 : 0,
        cursor: 'pointer',
        transition: 'background 0.1s',
      }}
    >
      {/* Thumbnail */}
      <div style={{ width: 88, flexShrink: 0, borderRadius: 8, overflow: 'hidden', position: 'relative', aspectRatio: '16/9' }}>
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt="" loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: '#E4EDEF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#A8BFC2' }}><PlayIcon size={16} /></span>
          </div>
        )}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,53,57,0.65)',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <PlayIcon size={10} />
          </div>
        </div>
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 13, fontWeight: 500, color: '#1A2B2E', margin: '0 0 2px',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {video.title}
        </p>
        <p style={{ fontSize: 11, color: '#7A9499', margin: '0 0 5px' }}>
          {formatDate(video.video_date)}
          {video.speakers ? ` · ${formatSpeakers(video.speakers)}` : ''}
        </p>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {video.series_slug && (
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: chip.bg, color: chip.text }}>
              {getSeriesName(video.series_slug)}
            </span>
          )}
          {topics.map(t => (
            <span key={t} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: NEUTRAL_CHIP.bg, color: NEUTRAL_CHIP.text }}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
