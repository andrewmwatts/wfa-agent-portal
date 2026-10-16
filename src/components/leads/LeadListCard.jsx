import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import CalendarEventModal from '../CalendarEventModal'
import { fmtDateTime } from '../../utils/format'
import { typeCfg, getLeadTZ, fmtWhen, fmtDay, attemptTotals } from './leadHelpers'
import Icon from './icons'

// One row in the Leads list (sales leads). Larger type than the shared LeadCard, and it
// surfaces the working signals: status, attempts, last attempt, and when status last changed.
//
// Styling stays inside the agency's primary / secondary / accent. Status is shown by the
// weight of the pill and the edge bar rather than by a hue per status:
//   new    → accent (needs a first touch)
//   active → primary tint (being worked)
//   sold   → solid primary with a check
//   dead   → dashed, muted

const TIERS = {
  new:    { pill: 'bg-accent/10 text-gray-900 dark:text-white border-accent/60',                                                                   bar: 'bg-accent' },
  active: { pill: 'bg-primary/10 text-primary border-primary/25 dark:bg-white/10 dark:text-white dark:border-white/25',            bar: 'bg-primary dark:bg-white/55' },
  won:    { pill: 'bg-primary text-white border-primary dark:bg-white dark:text-primary dark:border-white',                         bar: 'bg-primary dark:bg-white' },
  dead:   { pill: 'bg-transparent text-gray-500 border-dashed border-gray-300 dark:text-white/45 dark:border-white/25',            bar: 'bg-gray-300 dark:bg-white/15' },
}
const TIER_OF = { new: 'new', sold: 'won', notint: 'dead', dnc: 'dead', bad: 'dead', ghost: 'dead' }

// stacked: the list column is narrow (docked pane open on iPad landscape), so the call / text /
// calendar buttons drop to their own full-width row instead of sitting beside the name.
export default function LeadListCard({ lead: l, onClick, selected, statuses, stacked = false }) {
  const { userProfile } = useAuth()
  const calConnected = userProfile?.google_calendar_connected ?? false
  const [showCalModal, setShowCalModal] = useState(false)

  const s    = statuses.find(x => x.key === l.status) ?? statuses[0]
  const tier = TIERS[TIER_OF[s.key] ?? 'active']
  const tc   = typeCfg(l.lead_type)
  const tz   = getLeadTZ(l.state)
  const now  = new Date()
  const cb   = l.callback_at ? new Date(l.callback_at) : null
  const cbOverdue = cb && cb < now
  const cbToday   = cb && !cbOverdue && cb <= new Date(new Date().setHours(23, 59, 59))
  const { calls, texts, total } = attemptTotals(l)
  const digits = (l.phone || '').replace(/[^0-9]/g, '')

  const details = [
    l.phone,
    l.state,
    l.age != null && l.age !== '' && `Age ${l.age}`,
  ].filter(Boolean)

  const actions = (
    <div className={stacked ? 'grid grid-cols-[1.3fr_1fr_1fr] gap-2 mt-3' : 'flex gap-2 shrink-0'} onClick={e => e.stopPropagation()}>
              {digits && (
                <a href={`tel:+1${digits}`} aria-label="Call"
                  className={`${stacked ? 'h-11' : 'w-12 h-12'} flex items-center justify-center rounded-xl bg-primary text-white dark:bg-white dark:text-primary hover:opacity-90 active:opacity-80 transition-opacity shadow-sm`}>
                  <Icon name="phone" className="w-6 h-6" />
                </a>
              )}
              {digits && (
                <a href={`sms:+1${digits}`} aria-label="Text"
                  className={`${stacked ? 'h-11' : 'w-12 h-12'} flex items-center justify-center rounded-xl border-2 border-primary text-primary dark:border-white/70 dark:text-white hover:bg-primary/10 dark:hover:bg-white/10 transition-colors`}>
                  <Icon name="chat" className="w-6 h-6" />
                </a>
              )}
              {calConnected && (
                <button onClick={() => setShowCalModal(true)} aria-label="Schedule appointment"
                  className={`${stacked ? 'h-11' : 'w-12 h-12'} flex items-center justify-center rounded-xl bg-primary/10 text-primary dark:bg-white/10 dark:text-white hover:bg-primary/20 dark:hover:bg-white/20 transition-colors`}>
                  <Icon name="calendar" className="w-6 h-6" />
                </button>
              )}
            </div>
  )

  return (
    <>
      {showCalModal && <CalendarEventModal lead={l} onClose={() => setShowCalModal(false)} />}
      <div
        onClick={() => onClick(l)}
        className={`relative bg-white dark:bg-primary/30 border rounded-2xl cursor-pointer transition-all overflow-hidden ${
          selected
            ? 'border-accent/70 shadow-md ring-2 ring-accent/30'
            : 'border-gray-200 dark:border-white/10 shadow-sm hover:border-accent/40 hover:shadow-md'
        }`}
      >
        <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${tier.bar}`} />

        <div className="pl-5 pr-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xl font-bold text-gray-900 dark:text-white leading-tight">{l.name}</span>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary dark:bg-white/10 dark:text-white/80">{tc.label}</span>
                {l.medical && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-accent/10 text-gray-900 dark:text-white border border-accent/50">Med Hx</span>}
                {l.smoker  && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-accent/10 text-gray-900 dark:text-white border border-accent/50">Smoker</span>}
              </div>
              {(details.length > 0 || tz) && (
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
                  {details.map((d, i) => <span key={i} className="text-base text-gray-600 dark:text-white/65">{d}</span>)}
                  {tz && (
                    <span className={`text-base font-semibold ${tz.goodTime ? 'text-gray-800 dark:text-white/85' : 'text-red-600 dark:text-red-300'}`}>
                      {tz.label} {tz.timeStr}{!tz.goodTime ? ' ⛔' : ''}
                    </span>
                  )}
                </div>
              )}
            </div>

            {!stacked && actions}
          </div>
          {stacked && actions}

          <div className="flex items-center flex-wrap gap-x-3 gap-y-2 mt-3">
            <span className={`inline-flex items-center gap-1 text-sm font-bold px-3 py-1 rounded-full border ${tier.pill}`}>
              {TIER_OF[s.key] === 'won' && <Icon name="check" className="w-3.5 h-3.5" />}{s.label}
            </span>
            <span className="text-sm text-gray-600 dark:text-white/65">
              {total === 0
                ? 'No attempts yet'
                : <><strong className="text-gray-900 dark:text-white">{total}</strong> attempt{total !== 1 ? 's' : ''}{calls > 0 && texts > 0 ? ` (${calls} call${calls !== 1 ? 's' : ''}, ${texts} text${texts !== 1 ? 's' : ''})` : ''} · last {l.last_attempt_type === 'text' ? 'text' : 'call'} {fmtWhen(l.last_attempt_at)}</>}
            </span>
            {cb && (
              <span className={`inline-flex items-center gap-1.5 text-sm font-bold px-2.5 py-1 rounded-lg border ${
                cbOverdue ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-200 dark:border-red-400/30'
                : cbToday ? 'bg-accent/10 text-gray-900 dark:text-white border-accent/60'
                : 'bg-primary/5 text-primary border-primary/20 dark:bg-white/5 dark:text-white/80 dark:border-white/20'
              }`}>
                <Icon name="calendar" className="w-4 h-4" />{cbOverdue ? 'Overdue' : cbToday ? 'Today' : fmtDateTime(l.callback_at)}
              </span>
            )}
          </div>

          {l.last_dispositioned_at && (
            <p className="mt-2 text-sm text-gray-500 dark:text-white/50">Status changed {fmtDay(l.last_dispositioned_at)}</p>
          )}
        </div>
      </div>
    </>
  )
}
