import { fmtDate } from '../../utils/format'

// Where a recruiting lead who has been hired stands in contracting — shown on the lead's list card
// and on its card in the Recruiting page.

export default function ContractingStatus({ contracting: c, isStub }) {
  const hasIssue    = !!c.profile_issues
  const isComplete  = !!c.contracting_complete
  const hasContracts = c.contract_count > 0
  const wasSent     = !!c.contracting_to_producer
  const eandoOk     = !c.no_eando  // no_eando=true means E&O is missing

  const { status, statusCls } = hasIssue
    ? { status: `⚠ ${c.profile_issues}`, statusCls: 'text-red-600 dark:text-red-400' }
    : isComplete
    ? { status: 'Contracting complete', statusCls: 'text-green-700 dark:text-green-400' }
    : hasContracts
    ? { status: `${c.contract_count} of ${c.total_carriers}`, statusCls: 'text-amber-700 dark:text-amber-400' }
    : wasSent
    ? { status: `Sent ${fmtDate(c.contracting_to_producer)}`, statusCls: 'text-orange-600 dark:text-orange-400' }
    : { status: 'Not started', statusCls: 'text-gray-400 dark:text-white/30' }

  const borderCls = hasIssue
    ? 'border-red-200 dark:border-red-500/20'
    : isComplete
    ? 'border-green-200 dark:border-green-500/20'
    : hasContracts || wasSent
    ? 'border-amber-200 dark:border-amber-500/20'
    : 'border-gray-200 dark:border-white/10'

  return (
    <div className={`mt-2 rounded-lg border text-xs overflow-hidden ${borderCls}`}>
      <div className="flex items-center justify-between gap-2 px-2 py-1 bg-white/60 dark:bg-primary/20">
        <span className="font-semibold uppercase tracking-widest text-gray-500 dark:text-white/40 shrink-0">Contracting</span>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`shrink-0 ${eandoOk ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
            {eandoOk ? '✓ E&O' : '✕ E&O'}
          </span>
          <span className={`font-semibold truncate ${statusCls}`}>{status}</span>
        </div>
      </div>
      {isStub && (
        <div className="px-2 py-0.5 text-gray-400 dark:text-white/25 bg-gray-50 dark:bg-white/5 border-t border-gray-100 dark:border-white/5">
          Auto-generated record
        </div>
      )}
    </div>
  )
}
