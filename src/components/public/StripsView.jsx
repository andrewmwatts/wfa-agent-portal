import { useMemo } from 'react'
import SeriesStrip from './SeriesStrip'
import { STRIP_ORDER, SHOW_ALL_FLAT } from './publicConstants'

export default function StripsView({ videos, onSeriesSelect, onVideoClick }) {
  const { bySlug, additional } = useMemo(() => {
    const namedSet = new Set(STRIP_ORDER)
    const bySlug = {}
    const additional = []

    for (const v of videos) {
      if (v.series_slug && namedSet.has(v.series_slug)) {
        ;(bySlug[v.series_slug] ??= []).push(v)
      } else {
        additional.push(v)
      }
    }
    return { bySlug, additional }
  }, [videos])

  const strips = STRIP_ORDER.filter(slug => (bySlug[slug]?.length ?? 0) > 0)
  const totalStrips = strips.length + (additional.length > 0 ? 1 : 0)

  return (
    <div style={{ background: 'var(--pub-bg-page)', padding: '24px 0 40px' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 28px', display: 'flex', flexDirection: 'column', gap: 32 }}>
        {strips.map((slug, i) => (
          <SeriesStrip
            key={slug}
            slug={slug}
            videos={bySlug[slug] ?? []}
            totalCount={bySlug[slug]?.length ?? 0}
            onSeeAll={() => onSeriesSelect(slug)}
            onVideoClick={onVideoClick}
            isLast={i === totalStrips - 1}
          />
        ))}

        {additional.length > 0 && (
          <SeriesStrip
            key="__additional__"
            slug="__additional__"
            videos={additional}
            totalCount={additional.length}
            onSeeAll={() => onSeriesSelect(SHOW_ALL_FLAT)}
            onVideoClick={onVideoClick}
            isLast={true}
          />
        )}
      </div>
    </div>
  )
}
