// Lead / Scripts / CQF tab bar for the docked lead pane (iPad landscape, 1024–1279px).
// Below 1024 the lead opens full width and Scripts / CQF are overlays; from 1280 up the
// script pane sits beside the card, so this bar only appears in the docked range.

const TABS = [
  { key: 'lead',    label: 'Lead' },
  { key: 'scripts', label: 'Scripts' },
  { key: 'cqf',     label: 'CQF' },
]

export default function PaneTabs({ value, onChange, onClose }) {
  return (
    <div role="tablist" aria-label="Lead pane" className="flex gap-1 px-4 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-primary/40 shrink-0">
      {TABS.map(t => {
        const on = value === t.key
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`h-12 px-5 text-base font-semibold border-b-[3px] transition-colors ${
              on
                ? 'border-accent text-gray-900 dark:text-white'
                : 'border-transparent text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white'
            }`}
          >{t.label}</button>
        )
      })}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close lead"
          className="ml-auto self-center w-11 h-11 -mr-2 flex items-center justify-center rounded-lg text-gray-600 dark:text-white/60 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
        >✕</button>
      )}
    </div>
  )
}
