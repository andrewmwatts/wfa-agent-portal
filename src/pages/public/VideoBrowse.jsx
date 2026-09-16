import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PublicLayout from '../../components/public/PublicLayout'
import VideoModal from '../../components/public/VideoModal'
import { supabase } from '../../lib/supabaseClient'
import useIsMobile from '../../hooks/useIsMobile'

function ArrowLeftIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

const RESOURCE_COLS = 'id, title, video_date, series_slug, speakers, topics, url, thumbnail_url, platform, vimeo_id, source_series, is_huddle'

function splitItems(raw) {
  return [...new Set(raw.map(s => s.trim()).filter(Boolean))]
}

// One tag/speaker index: how many videos each name appears on, which pairs
// of names co-occur (and how often), and which videos back each name — all
// derived client-side from the same rows VideoLibrary already fetches, so
// there's nothing extra to keep in sync as new videos get tagged.
function buildIndex(videos, mode) {
  const freq = new Map(), co = new Map(), byItem = new Map()
  for (const v of videos) {
    const raw = mode === 'tags' ? (v.topics ?? []) : (v.speakers ?? '').split(',')
    const items = splitItems(raw)
    for (const it of items) {
      freq.set(it, (freq.get(it) ?? 0) + 1)
      if (!byItem.has(it)) byItem.set(it, [])
      byItem.get(it).push(v)
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const key = [items[i], items[j]].sort().join('|||')
        co.set(key, (co.get(key) ?? 0) + 1)
      }
    }
  }
  return { freq, co, byItem }
}

function relatedFor(name, co) {
  const out = []
  for (const [key, weight] of co) {
    const [a, b] = key.split('|||')
    if (a === name) out.push([b, weight])
    else if (b === name) out.push([a, weight])
  }
  return out.sort((a, b) => b[1] - a[1])
}

export default function VideoBrowse() {
  const isMobile = useIsMobile(720)

  const [allVideos, setAllVideos] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [mode,      setMode]      = useState('tags')
  const [selected,  setSelected]  = useState(null)
  const [playing,   setPlaying]   = useState(null)

  useEffect(() => {
    supabase
      .from('resources')
      .select(RESOURCE_COLS)
      .eq('is_published', true)
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setAllVideos(data ?? [])
        setLoading(false)
      })
  }, [])

  const tagsIndex     = useMemo(() => buildIndex(allVideos, 'tags'),     [allVideos])
  const speakersIndex = useMemo(() => buildIndex(allVideos, 'speakers'), [allVideos])
  const index  = mode === 'tags' ? tagsIndex : speakersIndex
  const sorted = useMemo(() => [...index.freq.entries()].sort((a, b) => b[1] - a[1]), [index])

  // Desktop: pre-select the top item so the panel demonstrates itself
  // without a required first click. Mobile: the panel is a full-screen
  // overlay, so it starts closed and the list is the whole page until
  // someone taps a row.
  useEffect(() => {
    if (loading) return
    setSelected(isMobile ? null : (sorted[0]?.[0] ?? null))
  }, [loading, mode, isMobile]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected || !isMobile) return
    function onKey(e) { if (e.key === 'Escape') setSelected(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected, isMobile])

  const selectedVideos = selected ? (index.byItem.get(selected) ?? []) : []
  const related = selected ? relatedFor(selected, index.co).slice(0, 8) : []

  function switchMode(next) {
    if (next !== mode) setMode(next)
  }

  const tabBtn = active => ({
    appearance: 'none', border: 'none', background: active ? '#003539' : 'transparent',
    color: active ? '#fff' : '#4A6568', fontSize: 13, fontWeight: 600,
    fontFamily: 'Inter, sans-serif', padding: '7px 14px', borderRadius: 7,
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
  })
  const countBadge = { fontSize: 10, fontWeight: 700, opacity: 0.65 }

  const panel = selected && (
    <div style={{
      width: isMobile ? '100%' : 300, flexShrink: 0,
      background: '#fff', padding: '20px 20px 28px',
      overflowY: 'auto', height: '100%',
      borderLeft: isMobile ? 'none' : '0.5px solid #DDE6E8',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 19, fontWeight: 500, color: '#003539', margin: 0 }}>
            {selected}
          </h2>
          <p style={{ fontSize: 12.5, color: '#4A6568', margin: '2px 0 0' }}>
            <strong style={{ color: '#005365' }}>{selectedVideos.length}</strong> video{selectedVideos.length === 1 ? '' : 's'}
          </p>
        </div>
        {isMobile && (
          <button onClick={() => setSelected(null)} aria-label="Close"
            style={{ appearance: 'none', border: 'none', background: '#F4F7F8', color: '#7A9499', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <CloseIcon />
          </button>
        )}
      </div>

      <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7A9499', margin: '20px 0 8px' }}>
        Related
      </p>
      {related.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {related.map(([name, weight]) => (
            <button key={name} onClick={() => setSelected(name)}
              style={{
                appearance: 'none', border: 'none', background: 'none', width: '100%',
                display: 'flex', justifyContent: 'space-between', gap: 8,
                padding: '6px 8px', margin: '0 -8px', borderRadius: 6,
                fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#1A2B2E',
                textAlign: 'left', cursor: 'pointer',
              }}>
              <span>{name}</span>
              <span style={{ fontSize: 11, color: '#7A9499' }}>{weight}</span>
            </button>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: '#7A9499' }}>No shared videos to show.</p>
      )}

      <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7A9499', margin: '20px 0 8px' }}>
        Videos
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {selectedVideos.slice(0, 8).map(v => (
          <button key={v.id} onClick={() => setPlaying(v)}
            style={{
              appearance: 'none', border: 'none', background: 'none', width: '100%',
              display: 'flex', alignItems: 'baseline', gap: 7,
              padding: '4px 8px', margin: '0 -8px', borderRadius: 6,
              fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: '#4A6568',
              textAlign: 'left', cursor: 'pointer', lineHeight: 1.4,
            }}>
            <span style={{ color: '#EE2666', flexShrink: 0, fontSize: 10 }}>&#9656;</span>
            {v.title}
          </button>
        ))}
        {selectedVideos.length > 8 && (
          <p style={{ fontSize: 12, color: '#7A9499', fontStyle: 'italic', margin: '4px 0 0 8px' }}>
            + {selectedVideos.length - 8} more
          </p>
        )}
      </div>
    </div>
  )

  return (
    <PublicLayout>
      <div style={{ background: '#fff', padding: '24px clamp(16px, 4vw, 28px) 16px', borderBottom: '0.5px solid #DDE6E8' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <Link to="/videos" style={{ fontSize: 12, fontWeight: 500, color: '#7A9499', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'Inter, sans-serif' }}>
            <ArrowLeftIcon /> Video Library
          </Link>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 24, fontWeight: 500, color: '#003539', margin: '10px 0 6px' }}>
            Browse tags &amp; speakers
          </h1>
          <p style={{ fontSize: 13, color: '#4A6568', margin: '0 0 16px', maxWidth: 560 }}>
            Ranked by number of videos — tap any {mode === 'tags' ? 'tag' : 'speaker'} to see how it connects to the rest of the library.
          </p>
          <div style={{ display: 'inline-flex', gap: 4, background: '#F4F7F8', border: '0.5px solid #C8D6D8', borderRadius: 10, padding: 3 }}>
            <button onClick={() => switchMode('tags')} style={tabBtn(mode === 'tags')}>
              Tags <span style={countBadge}>{tagsIndex.freq.size}</span>
            </button>
            <button onClick={() => switchMode('speakers')} style={tabBtn(mode === 'speakers')}>
              Speakers <span style={countBadge}>{speakersIndex.freq.size}</span>
            </button>
          </div>
        </div>
      </div>

      {loading && <p style={{ textAlign: 'center', padding: 48, color: '#7A9499', fontSize: 14, fontFamily: 'Inter, sans-serif' }}>Loading…</p>}
      {!loading && error && <p style={{ textAlign: 'center', padding: 48, color: '#EE2666', fontSize: 14, fontFamily: 'Inter, sans-serif' }}>Failed to load: {error}</p>}

      {!loading && !error && (
        <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', position: 'relative' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', padding: '8px clamp(16px, 4vw, 28px)',
              fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              color: '#7A9499', background: '#F4F7F8', borderBottom: '0.5px solid #DDE6E8',
            }}>
              <span>{mode === 'tags' ? 'Tag' : 'Speaker'}</span>
              <span>Videos</span>
            </div>
            {sorted.map(([name, count]) => (
              <div key={name} onClick={() => setSelected(name)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '9px clamp(16px, 4vw, 28px)', cursor: 'pointer',
                  borderBottom: '0.5px solid #EEF1F2',
                  background: name === selected ? '#FCE9EF' : 'transparent',
                }}>
                <span style={{
                  fontSize: 13.5, fontWeight: 600, fontFamily: 'Inter, sans-serif',
                  color: name === selected ? '#EE2666' : '#1A2B2E',
                }}>
                  {name}
                </span>
                <span style={{
                  fontSize: 12.5, fontWeight: 600, fontFamily: 'Inter, sans-serif',
                  color: name === selected ? '#EE2666' : '#4A6568',
                }}>
                  {count}
                </span>
              </div>
            ))}
          </div>

          {!isMobile && panel}
        </div>
      )}

      {isMobile && selected && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 45, display: 'flex' }}>
          <div onClick={() => setSelected(null)} style={{ flex: 1, background: 'rgba(0,53,57,0.35)' }} />
          <div style={{ width: 'min(88vw, 340px)', boxShadow: '-8px 0 24px rgba(0,53,57,0.15)' }}>
            {panel}
          </div>
        </div>
      )}

      {playing && <VideoModal video={playing} onClose={() => setPlaying(null)} />}
    </PublicLayout>
  )
}
