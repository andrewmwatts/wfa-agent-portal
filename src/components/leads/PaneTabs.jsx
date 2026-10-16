// Lead / CQF tab bar for the docked lead pane (iPad landscape, 1024–1279px), with a Scripts
// toggle beside it. Scripts is not a tab: it opens as its own pane to the left of the lead pane,
// which narrows to make room, so the card and the script can be used together. Below 1024 the
// lead opens full width and CQF is an overlay; from 1280 up the card is a 520px side pane and
// this bar does not appear.

import Icon from './icons'

const TABS = [
  { key: 'lead', label: 'Lead' },
  { key: 'cqf',  label: 'CQF' },
]

export default function PaneTabs({ value, onChange, onClose, scriptsOpen = false, onToggleScripts }) {
  return (
    <div className="flex items-center gap-1 pl-4 pr-2 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-primary/40 shrink-0">
      <div role="tablist" aria-label="Lead pane" className="flex gap-1 min-w-0">
        {TABS.map(t => {
          const on = value === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.key)}
              className={`h-12 px-4 text-base font-semibold border-b-[3px] transition-colors ${
                on
                  ? 'border-accent text-gray-900 dark:text-white'
                  : 'border-transparent text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white'
              }`}
            >{t.label}</button>
          )
        })}
      </div>
      <div className="ml-auto flex items-center gap-1">
        {onToggleScripts && (
          <button
            type="button"
            onClick={onToggleScripts}
            aria-pressed={scriptsOpen}
            className={`flex items-center gap-1.5 h-10 px-3 rounded-lg text-sm font-semibold border transition-colors ${
              scriptsOpen
                ? 'bg-primary text-white border-primary dark:bg-white dark:text-primary dark:border-white'
                : 'border-primary/30 dark:border-white/25 text-primary dark:text-white hover:bg-primary/5 dark:hover:bg-white/10'
            }`}
          ><Icon name="script" className="w-4 h-4" />{scriptsOpen ? 'Hide scripts' : 'Scripts'}</button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close lead"
            className="w-11 h-11 flex items-center justify-center rounded-lg text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          >✕</button>
        )}
      </div>
    </div>
  )
}
