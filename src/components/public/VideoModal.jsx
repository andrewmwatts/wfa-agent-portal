import { useEffect } from 'react'
import { getSeriesName, formatSpeakers, getSeriesChipStyle, NEUTRAL_CHIP, getEmbedUrl } from './publicConstants'

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

export default function VideoModal({ video, onClose }) {
  const embedUrl = video ? getEmbedUrl(video) : null

  // Non-embeddable platforms: open in new tab immediately
  useEffect(() => {
    if (video && !embedUrl) {
      window.open(video.url, '_blank', 'noopener')
      onClose()
    }
  }, [video, embedUrl, onClose])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!video || !embedUrl) return null

  const chip   = getSeriesChipStyle(video.series_slug)
  const topics = video.topics ?? []

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#003539', borderRadius: 12, maxWidth: 860, width: '90vw', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: '#fff', lineHeight: 1.4, margin: 0 }}>{video.title}</p>
            {video.speakers && (
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', margin: '2px 0 0', fontFamily: 'Inter, sans-serif' }}>
                {formatSpeakers(video.speakers)}
              </p>
            )}
          </div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 2, flexShrink: 0, display: 'flex' }}>
            <CloseIcon />
          </button>
        </div>

        {/* Embed */}
        <div style={{ aspectRatio: '16/9', background: '#000' }}>
          <iframe
            src={embedUrl}
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            title={video.title}
          />
        </div>

        {/* Tags */}
        <div style={{ padding: '12px 20px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {video.series_slug && (
            <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 99, background: chip.bg, color: chip.text }}>
              {getSeriesName(video.series_slug)}
            </span>
          )}
          {topics.map(t => (
            <span key={t} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 99, background: NEUTRAL_CHIP.bg, color: NEUTRAL_CHIP.text }}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
