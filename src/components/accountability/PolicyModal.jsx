import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'

function fmtDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${m}/${day}/${y.slice(2)}`
}

function fmtAPV(v) {
  if (!v) return '—'
  if (v >= 1000) return `$${Math.round(v / 1000)}k`
  return `$${Math.round(v)}`
}

const OPEN_STATUSES = new Set(['Pending', 'Incomplete'])

function StatusBadge({ status }) {
  if (!status) {
    return <span className="text-[10px] px-1.5 py-px rounded-full font-medium bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">No status</span>
  }
  const colors = {
    Pending:    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    Incomplete: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    Issued:     'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    Submitted:  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  }
  const cls = colors[status] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
  return <span className={`text-[10px] px-1.5 py-px rounded-full font-medium ${cls}`}>{status}</span>
}

function PolicyTable({ rows, emptyMsg }) {
  if (!rows.length) {
    return <p className="text-[11px] text-gray-400 dark:text-gray-500 py-2">{emptyMsg}</p>
  }
  return (
    <table className="w-full text-[11px] border-collapse">
      <thead>
        <tr>
          {['Applicant', 'Carrier / Policy', 'Status', 'Submit', 'APV', 'Notes'].map(h => (
            <th key={h} className="text-left pb-1.5 pr-3 text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium whitespace-nowrap">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(p => (
          <tr key={p.id} className="border-t border-gray-100 dark:border-gray-700">
            <td className="py-1.5 pr-3 text-gray-800 dark:text-gray-200 whitespace-nowrap">{p.applicant || '—'}</td>
            <td className="py-1.5 pr-3">
              <div className="text-gray-800 dark:text-gray-200">{p.carrier || '—'}</div>
              {p.policy_name && <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[160px]">{p.policy_name}</div>}
            </td>
            <td className="py-1.5 pr-3 whitespace-nowrap"><StatusBadge status={p.status} /></td>
            <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-400 whitespace-nowrap tabular-nums">{fmtDate(p.submit_date)}</td>
            <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-400 whitespace-nowrap tabular-nums">{fmtAPV(p.submitted_apv)}</td>
            <td className="py-1.5 text-gray-500 dark:text-gray-400 max-w-[200px]">
              {p.application_notes || p.policy_notes || <span className="text-gray-300 dark:text-gray-600">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function PolicyModal({ agentName, sfgId, ownerSfgId, onClose }) {
  const { session } = useAuth()
  const [policies, setPolicies] = useState(null)
  const [error, setError]       = useState(null)
  const backdropRef = useRef(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          `/api/accountability-policies?owner_sfg_id=${encodeURIComponent(ownerSfgId)}&sfg_id=${encodeURIComponent(sfgId)}`,
          { headers: { Authorization: `Bearer ${session?.access_token}` } },
        )
        if (!res.ok) {
          const { error: msg } = await res.json().catch(() => ({}))
          throw new Error(msg || `HTTP ${res.status}`)
        }
        const { policies: rows } = await res.json()
        setPolicies(rows)
      } catch (e) {
        setError(e.message)
      }
    }
    load()
  }, [sfgId, ownerSfgId, session])

  // Close on backdrop click
  function handleBackdrop(e) {
    if (e.target === backdropRef.current) onClose()
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openPolicies   = (policies ?? []).filter(p => OPEN_STATUSES.has(p.status) || p.status == null)
  const since28YMD     = (() => { const d = new Date(); d.setDate(d.getDate() - 28); return d.toISOString().slice(0, 10) })()
  const recentPolicies = (policies ?? []).filter(p => p.submit_date >= since28YMD && !OPEN_STATUSES.has(p.status) && p.status != null)

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div>
            <h2 className="text-[14px] font-semibold text-gray-900 dark:text-white">Policy details</h2>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{agentName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-6">
          {error && (
            <div className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              Failed to load policies: {error}
            </div>
          )}

          {policies === null && !error && (
            <div className="text-[11px] text-gray-400 dark:text-gray-500 py-4 text-center">Loading…</div>
          )}

          {policies !== null && (
            <>
              {/* Needs attention */}
              <div>
                <div className="text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium pb-2 border-b border-gray-200 dark:border-gray-700 mb-3">
                  Needs attention — Pending / Incomplete / No status
                </div>
                <PolicyTable rows={openPolicies} emptyMsg="No open policies." />
              </div>

              {/* Recent submissions */}
              <div>
                <div className="text-[9px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium pb-2 border-b border-gray-200 dark:border-gray-700 mb-3">
                  Submitted in last 28 days
                </div>
                <PolicyTable rows={recentPolicies} emptyMsg="No recent submissions." />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
