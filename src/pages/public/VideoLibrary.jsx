import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PublicLayout from '../../components/public/PublicLayout'
import SearchBar from '../../components/public/SearchBar'
import ChipRow from '../../components/public/ChipRow'
import StripsView from '../../components/public/StripsView'
import FlatView from '../../components/public/FlatView'
import VideoModal from '../../components/public/VideoModal'
import { supabase } from '../../lib/supabaseClient'

export default function VideoLibrary() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [allVideos,     setAllVideos]     = useState([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  const [activeSeries,  setActiveSeries]  = useState(() => searchParams.get('series') ?? null)
  const [searchQuery,   setSearchQuery]   = useState(() => searchParams.get('q') ?? '')
  const [selectedVideo, setSelectedVideo] = useState(null)

  // Measure filter bar height so FlatView's ListHeader stacks below it
  const filterBarRef = useRef(null)
  const [filterBarH, setFilterBarH] = useState(0)
  useEffect(() => {
    const el = filterBarRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => setFilterBarH(entries[0].contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Load all published resources once
  useEffect(() => {
    supabase
      .from('resources')
      .select('id, title, video_date, series_slug, speakers, topics, url, thumbnail_url, platform, vimeo_id, source_series, is_huddle')
      .eq('is_published', true)
      .order('video_date', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setAllVideos(data ?? [])
        setLoading(false)
      })
  }, [])

  // Keep URL in sync with filter state
  useEffect(() => {
    const params = new URLSearchParams()
    if (activeSeries) params.set('series', activeSeries)
    if (searchQuery)  params.set('q', searchQuery)
    const qs = params.toString()
    navigate(`/videos${qs ? `?${qs}` : ''}`, { replace: true })
  }, [activeSeries, searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Client-side filtering — all-time data is already sorted newest first
  const filteredVideos = useMemo(() => {
    let list = allVideos
    if (activeSeries) {
      list = list.filter(v => v.series_slug === activeSeries)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(v =>
        v.title?.toLowerCase().includes(q) ||
        v.speakers?.toLowerCase().includes(q) ||
        (v.topics ?? []).some(t => t.toLowerCase().includes(q))
      )
    }
    return list
  }, [allVideos, activeSeries, searchQuery])

  const isFlatView = !!activeSeries || !!searchQuery.trim()

  function handleSeriesSelect(slug) {
    setActiveSeries(slug)
    setSearchQuery('')
  }

  function handleSearchChange(q) {
    setSearchQuery(q)
    if (q.trim()) setActiveSeries(null)
  }

  function handleBack() {
    setActiveSeries(null)
    setSearchQuery('')
  }

  const videoCount = allVideos.length || 440

  return (
    <PublicLayout>
      {/* Page title — not sticky */}
      <div style={{ background: '#fff', padding: '28px 28px 0' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 24, fontWeight: 500, color: '#003539', margin: '0 0 6px' }}>
            Training video library
          </h1>
          <p style={{ fontSize: 13, color: '#4A6568', margin: 0, maxWidth: 560, fontFamily: 'Inter, sans-serif' }}>
            {videoCount}+ videos across all calls and series. Search by topic, speaker, or browse below.
          </p>
        </div>
      </div>

      {/* Filter bar — sticky so chips stay reachable while scrolling */}
      <div ref={filterBarRef} style={{
        background: '#fff', borderBottom: '0.5px solid #DDE6E8',
        padding: '14px 28px 16px', position: 'sticky', top: 52, zIndex: 30,
      }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <SearchBar value={searchQuery} onChange={handleSearchChange} />
          <ChipRow activeSeries={activeSeries} onSelect={handleSeriesSelect} />
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <p style={{ textAlign: 'center', padding: 48, color: '#7A9499', fontSize: 14, fontFamily: 'Inter, sans-serif' }}>
          Loading…
        </p>
      )}

      {/* Error */}
      {!loading && error && (
        <p style={{ textAlign: 'center', padding: 48, color: '#EE2666', fontSize: 14, fontFamily: 'Inter, sans-serif' }}>
          Failed to load videos: {error}
        </p>
      )}

      {/* Content */}
      {!loading && !error && (
        isFlatView ? (
          <FlatView
            videos={filteredVideos}
            activeSeries={activeSeries}
            searchQuery={searchQuery}
            onVideoClick={setSelectedVideo}
            onBack={handleBack}
            listHeaderTop={52 + filterBarH}
          />
        ) : (
          <StripsView
            videos={allVideos}
            onSeriesSelect={handleSeriesSelect}
            onVideoClick={setSelectedVideo}
          />
        )
      )}

      {/* Video modal */}
      {selectedVideo && (
        <VideoModal video={selectedVideo} onClose={() => setSelectedVideo(null)} />
      )}
    </PublicLayout>
  )
}
