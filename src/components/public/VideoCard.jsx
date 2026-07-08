import { getSeriesName, formatDate, formatSpeakers, getSeriesChipStyle, NEUTRAL_CHIP } from './publicConstants'

function PlayIcon({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z"/>
    </svg>
  )
}

function Thumb({ url, overlaySize }) {
  const overlay = (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: overlaySize, height: overlaySize, borderRadius: '50%',
        background: 'rgba(0,53,57,0.65)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <PlayIcon size={Math.round(overlaySize * 0.43)} />
      </div>
    </div>
  )

  if (url) {
    return (
      <div style={{ position: 'relative', aspectRatio: '16/9', overflow: 'hidden' }}>
        <img src={url} alt="" loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {overlay}
      </div>
    )
  }
  return (
    <div style={{
      aspectRatio: '16/9', background: '#E4EDEF', position: 'relative',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <span style={{ color: '#A8BFC2' }}><PlayIcon size={22} /></span>
      {overlay}
    </div>
  )
}

export default function VideoCard({ video, onClick }) {
  const chip   = getSeriesChipStyle(video.series_slug)
  const topics = (video.topics ?? []).slice(0, 2)

  return (
    <div onClick={onClick}
      style={{
        background: '#fff', border: '0.5px solid #DDE6E8', borderRadius: 10,
        overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#A8BFC2'}
      onMouseLeave={e => e.currentTarget.style.borderColor = '#DDE6E8'}
    >
      <Thumb url={video.thumbnail_url} overlaySize={28} />
      <div style={{ padding: '9px 10px 11px' }}>
        <p style={{
          fontSize: 12, fontWeight: 500, color: '#1A2B2E', lineHeight: 1.4, margin: '0 0 4px',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {video.title}
        </p>
        <p style={{ fontSize: 11, color: '#7A9499', margin: '0 0 6px' }}>
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
