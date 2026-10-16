import useQuickLog, { QUICK_METRICS } from '../../hooks/useQuickLog'

// The bar across the top of Dial Mode: today's five Quick Log counters (the same ones, and the
// same row, as Activity Tracking) and the way back out. It is exactly as tall as the app header it
// replaces, so the panes pinned under `--header-h` sit right below it.

export default function DialStrip({ sfgId, canLog = true, onExit }) {
  const { log, ready, error, adjust } = useQuickLog(sfgId)
  const off = !ready || !canLog

  return (
    <div className="shrink-0 h-[var(--header-h)] pt-[env(safe-area-inset-top)] pad-safe-x px-3 sm:px-4 flex items-center gap-3 bg-primary/[0.09] border-b border-primary/20 dark:bg-primary dark:border-white/10">
      <div role="group" aria-label="Quick log, today" className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {QUICK_METRICS.map(m => (
          <div key={m.key} className="shrink-0 flex items-center gap-1 rounded-xl border border-gray-200 dark:border-white/15 bg-white dark:bg-white/[0.06] p-0.5">
            <button
              type="button"
              aria-label={`Decrease ${m.label}`}
              disabled={off}
              onClick={() => adjust(m.key, -1)}
              className="w-11 h-11 rounded-lg text-2xl leading-none text-gray-700 dark:text-white/80 hover:bg-gray-100 dark:hover:bg-white/10 active:scale-95 disabled:opacity-40 transition"
            >−</button>
            <div className="min-w-[4.75rem] text-center leading-tight">
              <div className="text-xs font-semibold text-gray-600 dark:text-white/65 whitespace-nowrap">{m.label}</div>
              <div className="text-xl font-extrabold tabular-nums text-gray-900 dark:text-white">{Number(log?.[m.key]) || 0}</div>
            </div>
            <button
              type="button"
              aria-label={`Increase ${m.label}`}
              disabled={off}
              onClick={() => adjust(m.key, 1)}
              className="w-11 h-11 rounded-lg border border-accent bg-primary text-white dark:bg-white dark:text-primary text-2xl leading-none hover:bg-primary/85 dark:hover:bg-white/90 active:scale-95 disabled:opacity-40 transition"
            >+</button>
          </div>
        ))}
      </div>
      {error && <span role="alert" className="shrink-0 text-xs font-semibold text-red-600 dark:text-red-300 max-w-[10rem] leading-tight">{error}</span>}
      <button
        type="button"
        onClick={onExit}
        className="shrink-0 h-11 px-4 rounded-xl border border-primary/30 dark:border-white/30 text-sm font-semibold text-primary dark:text-white hover:bg-primary/5 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
      ><span className="max-sm:hidden">Exit Dial Mode</span><span className="sm:hidden">Exit</span></button>
    </div>
  )
}
