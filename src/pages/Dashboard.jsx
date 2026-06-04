import { useEffect, useState } from 'react'
import { useViewing } from '../context/ViewingContext'
import { useAuth } from '../context/AuthContext'
import MetricsSection from '../components/sections/MetricsSection'
import NewAgentStatusSection from '../components/sections/NewAgentStatusSection'
import PendingBusinessSection from '../components/sections/PendingBusinessSection'
import ActivitySummarySection from '../components/sections/ActivitySummarySection'


export default function Dashboard() {
  const { activeSubject, permissions, loading: viewLoading } = useViewing()
  const { userProfile } = useAuth()
  const isSuperAdmin = userProfile?.role === 'super_admin'

  // Mode-togglable — drives MetricsSection only
  const [personnel,  setPersonnel]  = useState([])
  const [appsData,   setAppsData]   = useState(null)

  // Always baseshop — drives NewAgentStatus + PendingBusiness/Lapse
  const [baseshopPersonnel, setBaseshopPersonnel] = useState([])
  const [baseshopAppsData,  setBaseshopAppsData]  = useState(null)

  const [mode, setMode] = useState('baseshop')

  // Director = role-based; drives master/baseshop toggle + parallel data fetching
  const isDirector = ['director', 'super_admin'].includes(activeSubject?.role)
  const showActivitySummary = ['agent', 'leader', 'super_admin'].includes(activeSubject?.role)
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
    const enc   = encodeURIComponent(sfgId)
    try {
      if (isDir) {
        // All 4 requests in one parallel batch — personnel and apps no longer sequential.
        // type=apps resolves the team tree internally so it doesn't wait for personnel.
        const [masterPrsRes, baseshopPrsRes, masterAppsRes, baseshopAppsRes] = await Promise.all([
          fetch(`/api/personnel?root=${enc}&mode=master`),
          fetch(`/api/personnel?root=${enc}`),
          fetch(`/api/policies?type=apps&root=${enc}&mode=master`),
          fetch(`/api/policies?type=apps&root=${enc}`),
        ])
        const masterPrs   = masterPrsRes.ok   ? await masterPrsRes.json()   : []
        const baseshopPrs = baseshopPrsRes.ok ? await baseshopPrsRes.json() : []
        const masterApps   = masterAppsRes.ok   ? await masterAppsRes.json()   : {}
        const baseshopApps = baseshopAppsRes.ok ? await baseshopAppsRes.json() : {}

        setPersonnel(masterPrs)
        setMode('master')
        setBaseshopPersonnel(baseshopPrs)
        setAppsData(masterApps)
        setBaseshopAppsData(baseshopApps)
      } else {
        // Both requests in parallel — apps resolves its own tree so no waterfall.
        const [prsRes, appsRes] = await Promise.all([
          fetch(`/api/personnel?root=${enc}`),
          fetch(`/api/policies?type=apps&root=${enc}`),
        ])
        const prs  = prsRes.ok  ? await prsRes.json()  : []
        const apps = appsRes.ok ? await appsRes.json() : {}
        setPersonnel(prs)
        setBaseshopPersonnel(prs)
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
    const enc      = encodeURIComponent(activeSubject.sfg_id)
    const modeParam = newMode === 'master' ? '&mode=master' : ''
    try {
      const [prsRes, appsRes] = await Promise.all([
        fetch(`/api/personnel?root=${enc}${modeParam}`),
        fetch(`/api/policies?type=apps&root=${enc}${modeParam}`),
      ])
      const prs  = prsRes.ok  ? await prsRes.json()  : []
      const apps = appsRes.ok ? await appsRes.json() : {}
      setPersonnel(prs)
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
          canBreakdown={isSuperAdmin}
        />
      )}
      {showActivitySummary && (
        <ActivitySummarySection
          subject={activeSubject}
          loading={loading}
        />
      )}
      {permissions.team.read && activeSubject?.role !== 'agent' && (
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
