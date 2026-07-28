import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { supabase } from '../../lib/supabaseClient'
import { useTheme } from '../../context/ThemeContext'

// Status values mirror STATUS_COLORS in AgentsPage
const STATUSES = ['Active', 'Stalled', 'Lapsed', 'Terminated']
const NO_STATUS = 'No status'

const STATUS_HEX = {
  Active:     '#22c55e',
  Stalled:    '#facc15',
  Lapsed:     '#f59e0b',
  Terminated: '#ef4444',
  [NO_STATUS]: '#9ca3af',
}

// USPS ZIP+4 and stray whitespace are common in imported records
function normalizeZip(raw) {
  const m = String(raw ?? '').trim().match(/^(\d{5})/)
  return m ? m[1] : null
}

// Only real personnel plot — guest/dummy and any other off-format records
// (SFG-GUEST-001, SFG-DUMMY-002, …) are excluded from the map and its tallies.
const SFG_ID_RE = /^SFG\d{7}$/
function isRealAgent(p) {
  return SFG_ID_RE.test((p.sfg_id ?? '').trim())
}

function statusOf(p) {
  return STATUSES.includes(p.status) ? p.status : NO_STATUS
}

// A ZIP's pin takes the color of its highest-priority status, not the most
// common one: Active > Stalled > Lapsed > Terminated > No status. So one active
// agent turns the whole pin green, and it only goes red if everyone's terminated.
const STATUS_PRIORITY = ['Active', 'Stalled', 'Lapsed', 'Terminated', NO_STATUS]
function pinStatus(agents) {
  const present = new Set(agents.map(statusOf))
  return STATUS_PRIORITY.find(s => present.has(s)) ?? NO_STATUS
}

export default function AgentMap({ personnel, loading }) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const mapEl   = useRef(null)
  const mapRef  = useRef(null)
  const clusterRef = useRef(null)

  const [centroids, setCentroids] = useState(null)   // zip → {lat,lng}
  const [centroidErr, setCentroidErr] = useState(null)
  const [enabled, setEnabled] = useState(() => new Set([...STATUSES, NO_STATUS]))
  const [selected, setSelected] = useState(null)     // { zip?, agents, cluster? }

  // Real agents only — drops guest/dummy and any non-SFG####### records
  const roster = useMemo(() => personnel.filter(isRealAgent), [personnel])

  // ── Status counts across the full (unfiltered) roster ────────────────────
  const statusCounts = useMemo(() => {
    const c = {}
    for (const p of roster) c[statusOf(p)] = (c[statusOf(p)] ?? 0) + 1
    return c
  }, [roster])

  // ── Agents passing the status filter, with a usable ZIP ──────────────────
  const { byZip, unmappable } = useMemo(() => {
    const groups = {}
    let unmappable = 0
    for (const p of roster) {
      if (!enabled.has(statusOf(p))) continue
      const zip = normalizeZip(p.zip)
      if (!zip) { unmappable++; continue }
      ;(groups[zip] ??= []).push(p)
    }
    return { byZip: groups, unmappable }
  }, [roster, enabled])

  // ── Load centroids for the ZIPs actually in use ──────────────────────────
  useEffect(() => {
    const zips = [...new Set(
      roster.map(p => normalizeZip(p.zip)).filter(Boolean)
    )]
    if (!zips.length) { setCentroids({}); return }

    let cancelled = false
    ;(async () => {
      const out = {}
      // Chunked to keep the .in() filter well under URL length limits
      for (let i = 0; i < zips.length; i += 400) {
        const { data, error } = await supabase
          .from('zip_centroids')
          .select('zip, lat, lng')
          .in('zip', zips.slice(i, i + 400))
        if (error) { if (!cancelled) setCentroidErr(error.message); return }
        for (const r of data ?? []) out[r.zip] = { lat: r.lat, lng: r.lng }
      }
      if (!cancelled) { setCentroids(out); setCentroidErr(null) }
    })()
    return () => { cancelled = true }
  }, [roster])

  // ── Init map once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !mapEl.current) return
    const map = L.map(mapEl.current, { scrollWheelZoom: true, attributionControl: true })
      .setView([39.5, -98.35], 4)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null; clusterRef.current = null }
  }, [])

  // ── Render markers whenever data or filters change ───────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !centroids) return

    if (clusterRef.current) { map.removeLayer(clusterRef.current); clusterRef.current = null }

    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      // Clicking a cluster opens its combined roster instead of zooming/splitting
      zoomToBoundsOnClick: false,
      spiderfyOnMaxZoom: false,
      maxClusterRadius: 55,
      // Cluster label counts AGENTS, not ZIPs
      iconCreateFunction(c) {
        const total = c.getAllChildMarkers().reduce((s, m) => s + (m.options.agentCount ?? 0), 0)
        const d = Math.round(34 + Math.min(total, 60) * 0.45)
        return L.divIcon({
          html: `<div style="width:${d}px;height:${d}px;border-radius:50%;background:#7f77dd;color:#fff;
                 display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;
                 border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 4px rgba(0,0,0,.3)">${total}</div>`,
          className: '',
          iconSize: [d, d],
        })
      },
    })

    const entries = Object.entries(byZip)
    for (const [zip, agents] of entries) {
      const c = centroids[zip]
      if (!c) continue
      const n = agents.length
      const d = Math.round(26 + Math.min(n, 20) * 0.9)
      const color = STATUS_HEX[pinStatus(agents)]
      const marker = L.marker([c.lat, c.lng], {
        agentCount: n,
        agents,
        icon: L.divIcon({
          html: `<div style="width:${d}px;height:${d}px;border-radius:50%;background:${color};color:#fff;
                 display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;
                 border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 4px rgba(0,0,0,.3)">${n}</div>`,
          className: '',
          iconSize: [d, d],
        }),
      })
      marker.on('click', () => setSelected({ zip, agents }))
      cluster.addLayer(marker)
    }

    // A cluster represents several ZIPs — show everyone it rolls up
    cluster.on('clusterclick', (e) => {
      const agents = e.layer.getAllChildMarkers().flatMap(m => m.options.agents ?? [])
      setSelected({ agents, cluster: true })
    })

    map.addLayer(cluster)
    clusterRef.current = cluster

    const plotted = entries.filter(([z]) => centroids[z])
    if (plotted.length) {
      map.fitBounds(
        L.latLngBounds(plotted.map(([z]) => [centroids[z].lat, centroids[z].lng])),
        { padding: [40, 40], maxZoom: 10 },
      )
    }
  }, [byZip, centroids])

  // Keep the panel in sync when filters change the underlying data
  useEffect(() => {
    if (!selected) return
    // Cluster rollups are rebuilt on every filter change — just close the panel
    if (selected.cluster) { setSelected(null); return }
    if (!byZip[selected.zip]) setSelected(null)
    else setSelected(s => ({ ...s, agents: byZip[s.zip] }))
  }, [byZip]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(status) {
    setEnabled(prev => {
      const next = new Set(prev)
      next.has(status) ? next.delete(status) : next.add(status)
      return next
    })
  }

  const mappedZips = Object.keys(byZip).filter(z => centroids?.[z]).length
  const missingCentroid = Object.entries(byZip)
    .filter(([z]) => centroids && !centroids[z])
    .reduce((s, [, a]) => s + a.length, 0)
  const shown = Object.entries(byZip)
    .filter(([z]) => centroids?.[z])
    .reduce((s, [, a]) => s + a.length, 0)

  return (
    <div className="space-y-4">
      <style>{`
        .leaflet-container { background: ${isDark ? '#0f1f22' : '#e8eef0'}; font: inherit; }
        ${isDark ? '.leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(.95) contrast(.9); }' : ''}
      `}</style>

      {/* Status filters */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {[...STATUSES, NO_STATUS].map(s => (
          <label key={s} className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-white/70 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enabled.has(s)}
              onChange={() => toggle(s)}
              className="rounded border-gray-300 dark:border-white/20 text-accent focus:ring-accent/60"
            />
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: STATUS_HEX[s] }} />
            {s}
            <span className="text-gray-400 dark:text-white/30">({statusCounts[s] ?? 0})</span>
          </label>
        ))}
        <span className="ml-auto text-xs text-gray-400 dark:text-white/30">
          {shown} agent{shown !== 1 ? 's' : ''} across {mappedZips} ZIP{mappedZips !== 1 ? 's' : ''}
        </span>
      </div>

      {centroidErr && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-[12px] text-amber-800 dark:text-amber-300">
          <strong>ZIP lookup unavailable:</strong> {centroidErr}. If this is the first run, apply{' '}
          <code>scripts/migration-zip-centroids.sql</code> and seed it with{' '}
          <code>scripts/seed-zip-centroids.mjs</code>.
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Map */}
        <div className="flex-1 rounded-2xl overflow-hidden border border-gray-200 dark:border-white/10">
          <div ref={mapEl} style={{ height: 560, width: '100%' }} />
        </div>

        {/* Roster panel */}
        <div className="lg:w-72 flex-shrink-0">
          {selected ? (
            <div className="bg-white dark:bg-primary/30 border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-white/10 flex items-start gap-2">
                <div className="min-w-0">
                  {selected.cluster ? (
                    <>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {selected.agents.length} agent{selected.agents.length !== 1 ? 's' : ''} in this area
                      </p>
                      <p className="text-xs text-gray-400 dark:text-white/40">
                        {new Set(selected.agents.map(a => normalizeZip(a.zip))).size} ZIP codes
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {selected.agents[0]?.city || 'ZIP'} {selected.agents[0]?.state || ''}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-white/40 font-mono">{selected.zip}</p>
                    </>
                  )}
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="ml-auto p-1 text-gray-400 hover:text-gray-700 dark:hover:text-white/80"
                  aria-label="Close"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="max-h-[480px] overflow-y-auto divide-y divide-gray-50 dark:divide-white/5">
                {[...selected.agents]
                  .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
                  .map(a => (
                    <div key={a.sfg_id} className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_HEX[statusOf(a)] }} />
                        <span className="text-sm text-gray-800 dark:text-white/80 truncate">{a.name}</span>
                        {a.commission_contract?.level != null && (
                          <span className="ml-auto text-xs text-gray-500 dark:text-white/50">
                            {a.commission_contract.level}%
                          </span>
                        )}
                      </div>
                      {selected.cluster
                        ? (a.city || a.state) && (
                            <p className="text-[11px] text-gray-400 dark:text-white/30 mt-0.5 ml-3.5 truncate">
                              {[a.city, a.state].filter(Boolean).join(', ')}
                            </p>
                          )
                        : a.upline_name && (
                            <p className="text-[11px] text-gray-400 dark:text-white/30 mt-0.5 ml-3.5 truncate">
                              ↑ {a.upline_name}
                            </p>
                          )}
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 dark:bg-white/5 border border-dashed border-gray-200 dark:border-white/10 rounded-2xl px-4 py-8 text-center">
              <p className="text-sm text-gray-500 dark:text-white/40">
                {loading ? 'Loading agents…' : 'Click a pin to see who lives there.'}
              </p>
            </div>
          )}

          {(unmappable > 0 || missingCentroid > 0) && (
            <p className="mt-3 text-[11px] text-gray-400 dark:text-white/30 leading-relaxed">
              {unmappable > 0 && <>{unmappable} agent{unmappable !== 1 ? 's' : ''} without a ZIP on file. </>}
              {missingCentroid > 0 && <>{missingCentroid} in a ZIP with no known centroid.</>}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
