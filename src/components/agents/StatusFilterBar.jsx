import { STATUSES, NO_STATUS, STATUS_HEX } from './agentStatus'

// Status checkboxes shared by the List, Map, and Birthdays tabs on AgentsPage.
export default function StatusFilterBar({ counts, enabled, onToggle }) {
  return (
    <div className="max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-3 sm:flex sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
      {[...STATUSES, NO_STATUS].map(s => (
        <label key={s} className="inline-flex items-center gap-2 sm:gap-1.5 max-sm:min-h-11 touch:min-h-11 text-sm text-gray-700 dark:text-white/70 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled.has(s)}
            onChange={() => onToggle(s)}
            className="rounded border-gray-300 dark:border-white/20 text-accent focus:ring-accent/60 max-sm:w-5 max-sm:h-5 touch:w-5 touch:h-5"
          />
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: STATUS_HEX[s] }} />
          {s}
          <span className="text-gray-500 dark:text-white/50">({counts[s] ?? 0})</span>
        </label>
      ))}
    </div>
  )
}
