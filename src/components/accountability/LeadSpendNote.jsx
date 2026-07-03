export default function LeadSpendNote({ leadSpend, dials }) {
  if (leadSpend > 0) {
    return (
      <div className="flex items-center gap-1.5 text-gray-400 dark:text-gray-500">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <span className="text-[10px]">
          ${leadSpend.toLocaleString()} lead spend · {dials} dials this period — volume sufficient
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span className="text-[10px]">
        No lead spend in 7 days against {dials} dials — lead supply at risk
      </span>
    </div>
  )
}
