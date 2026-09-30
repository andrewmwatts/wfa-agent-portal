import { STATUSES, NO_STATUS, STATUS_HEX } from './agentStatus'

// Status checkboxes shared by the List, Map, and Birthdays tabs on AgentsPage.
export default function StatusFilterBar({ counts, enabled, onToggle }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {[...STATUSES, NO_STATUS].map(s => (
        <label key={s} className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-white/70 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled.has(s)}
            onChange={() => onToggle(s)}
            className="rounded border-gray-300 dark:border-white/20 text-accent focus:ring-accent/60"
          />
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: STATUS_HEX[s] }} />
          {s}
          <span className="text-gray-400 dark:text-white/30">({counts[s] ?? 0})</span>
        </label>
      ))}
    </div>
  )
}
