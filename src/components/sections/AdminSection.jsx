import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { SectionShell } from './MyInfoSection'

export default function AdminSection({ subject, canWrite }) {
  const { userProfile } = useAuth()
  const [syncState, setSyncState] = useState('idle') // idle | loading | done | error
  const [syncResult, setSyncResult] = useState(null)

  async function handleSync() {
    setSyncState('loading')
    setSyncResult(null)
    try {
      const res = await fetch('/api/users?action=sync-hidden', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userProfile.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Sync failed')
      const parts = [`Contracting: ${data.hidden} hidden`]
      if (data.hidden2 != null) parts.push(`Launch: ${data.hidden2} hidden`)
      setSyncResult(`Done — ${parts.join(' · ')}`)
      setSyncState('done')
    } catch (err) {
      setSyncResult(err.message)
      setSyncState('error')
    }
  }

  return (
    <SectionShell title="Administration" canWrite={canWrite}>
      <div className="space-y-6">

        {/* Hidden agent sync */}
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Sync Hidden Agents</p>
          <p className="text-xs text-gray-400 dark:text-white/40 mb-3">
            Reads the <span className="text-gray-600 dark:text-white/60">Filter</span> and <span className="text-gray-600 dark:text-white/60">Filter 2</span> columns
            from the Onboarding sheet. Filter=TRUE agents are saved to your Contracting hidden list;
            Filter 2=TRUE agents are saved to your Launch hidden list.
            Run this any time the sheet changes.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSync}
              disabled={syncState === 'loading'}
              className="text-sm font-medium px-4 py-2 rounded-lg bg-accent/80 hover:bg-accent text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {syncState === 'loading' ? 'Syncing…' : 'Sync from Sheet'}
            </button>
            {syncResult && (
              <p className={`text-xs ${syncState === 'error' ? 'text-accent' : 'text-green-500 dark:text-green-400'}`}>
                {syncResult}
              </p>
            )}
          </div>
        </div>

      </div>
    </SectionShell>
  )
}
