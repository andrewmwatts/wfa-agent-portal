import { useEffect, useState } from 'react'
import { useViewing } from '../context/ViewingContext'
import MetricsSection from '../components/sections/MetricsSection'
import NewAgentStatusSection from '../components/sections/NewAgentStatusSection'
import PendingBusinessSection from '../components/sections/PendingBusinessSection'

// Fetch apps-policies for a given personnel list; returns raw JSON (does not set state).
async function fetchAppsData(prs) {
  const sfgIds = prs.map(p => p.sfg_id)
  if (!sfgIds.length) return { pending: [], incomplete: [], lapse: [], metrics: null, detail: null }
  const res = await fetch(`/api/policies?type=apps&sfg_ids=${sfgIds.join(',')}`)
  return res.ok ? await res.json() : {}
}

export default function Dashboard() {
  const { activeSubject, permissions, loading: viewLoading } = useViewing()

  // Mode-togglable — drives MetricsSection only
  const [personnel,  setPersonnel]  = useState([])
  const [appsData,   setAppsData]   = useState(null)

  // Always baseshop — drives NewAgentStatus + PendingBusiness/Lapse
  const [baseshopPersonnel, setBaseshopPersonnel] = useState([])
  const [baseshopAppsData,  setBaseshopAppsData]  = useState(null)

  const [mode, setMode] = useState('baseshop')

  // Director = role-based; drives master/baseshop toggle + parallel data fetching
  const isDirector = ['director', 'super_admin'].includes(activeSubject?.role)
  const [loading,    setLoading]    = useState(false)

  // ── Initial load: runs whenever the viewed subject changes ─────────────────
  useEffect(() => {
    if (!activeSubject?.sfg_id) return
    setLoading(true)
    setMode('baseshop')
    initLoad(activeSubject.sfg_id, activeSubject.role)
  }, [activeSubject?.sfg_id])  // eslint-disable-line react-hooks/exhaustive-deps

  async function initLoad(sfgId, role) {
    const isDir = ['director', 'super_admin'].includes(role)
    try {
      if (isDir) {
        const [masterRes, baseshopRes] = await Promise.all([
          fetch(`/api/personnel?root=${encodeURIComponent(sfgId)}&mode=master`),
          fetch(`/api/personnel?root=${encodeURIComponent(sfgId)}`),
        ])
        const masterPrs   = masterRes.ok   ? await masterRes.json()   : []
        const baseshopPrs = baseshopRes.ok ? await baseshopRes.json() : []

        setPersonnel(masterPrs)
        setMode('master')
        setBaseshopPersonnel(baseshopPrs)

        const [masterApps, baseshopApps] = await Promise.all([
          fetchAppsData(masterPrs),
          fetchAppsData(baseshopPrs),
        ])
        setAppsData(masterApps)
        setBaseshopAppsData(baseshopApps)
      } else {
        const res = await fetch(`/api/personnel?root=${encodeURIComponent(sfgId)}`)
        const prs = res.ok ? await res.json() : []
        setPersonnel(prs)
        setBaseshopPersonnel(prs)
        const apps = await fetchAppsData(prs)
        setAppsData(apps)
        setBaseshopAppsData(apps)
      }
    } catch (err) {
      console.error('[Dashboard] initLoad', err)
    } finally {
      setLoading(false)
    }
  }

  // ── Mode toggle — only updates MetricsSection data ────────────────────────
  async function handleModeChange(newMode) {
    if (!activeSubject?.sfg_id || newMode === mode) return
    setMode(newMode)
    setLoading(true)
    try {
      const modeParam = newMode === 'master' ? '&mode=master' : ''
      const res = await fetch(`/api/personnel?root=${encodeURIComponent(activeSubject.sfg_id)}${modeParam}`)
      const prs = res.ok ? await res.json() : []
      setPersonnel(prs)
      const apps = await fetchAppsData(prs)
      setAppsData(apps)
      // baseshopPersonnel + baseshopAppsData intentionally unchanged
    } catch (err) {
      console.error('[Dashboard] handleModeChange', err)
    } finally {
      setLoading(false)
    }
  }

  if (viewLoading) return (
    <div className="flex items-center justify-center py-24">
      <span className="text-gray-400 dark:text-white/30 text-sm">Loading…</span>
    </div>
  )

  if (!activeSubject) return (
    <div className="flex items-center justify-center py-24">
      <p className="text-gray-400 dark:text-white/30 text-sm">Please sign in to view your dashboard.</p>
    </div>
  )

  return (
    <main className="max-w-4xl mx-auto px-6 py-8 space-y-5">
      {permissions.metrics.read && (
        <MetricsSection
          subject={activeSubject}
          canWrite={permissions.metrics.write}
          appsData={appsData}
          isDirector={isDirector}
          mode={mode}
          loading={loading}
          onModeChange={handleModeChange}
        />
      )}
      {permissions.team.read && (
        <NewAgentStatusSection
          subject={activeSubject}
          canWrite={permissions.team.write}
          personnel={baseshopPersonnel}
          loading={loading}
        />
      )}
      {permissions.appsAndPolicies.read && (
        <PendingBusinessSection
          subject={activeSubject}
          canWrite={permissions.appsAndPolicies.write}
          pending={[...(baseshopAppsData?.pending ?? []), ...(baseshopAppsData?.incomplete ?? [])]}
          lapse={baseshopAppsData?.lapse ?? []}
          loading={loading}
        />
      )}
    </main>
  )
}
