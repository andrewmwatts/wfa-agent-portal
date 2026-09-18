import Step1Reconciliation from './Step1Reconciliation'

/**
 * Step 3 — Final Review.
 *
 * The same importer, the same adjudication and the same cards as Step 1, run against
 * the FINAL ledger: what Snapshot shows after the internal edits (Step 1) and the
 * external disputes (Step 2). Its job is to confirm the numbers all align before
 * they go on to Promotions.
 *
 * The one difference in what a card offers: Edit, and nothing to dispute — the
 * disputes are done, so anything that still doesn't line up is fixed in the tracker.
 */
export default function Step3FinalReview({
  cycle, reconciliations, ready = true, personnel, canWrite, onStepComplete, onRefresh,
}) {
  // Results are kept in a table created by a migration. Until it exists, say so up
  // front rather than letting the first run fail.
  if (!ready && !cycle?.completed_at) {
    return (
      <div className="rounded-2xl border border-amber-300 dark:border-amber-600/40 bg-amber-50 dark:bg-amber-500/10 p-6 space-y-2">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          Final Review needs one database change before it can be used
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300/80 leading-relaxed">
          Run <code className="font-mono">scripts/migration-snapshot-final-review.sql</code> in
          the Supabase SQL editor, then reload this page. Everything else in the cycle keeps
          working in the meantime.
        </p>
      </div>
    )
  }

  return (
    <Step1Reconciliation
      phase="final"
      cycle={cycle}
      reconciliations={reconciliations}
      disputes={[]}
      personnel={personnel}
      canWrite={canWrite}
      onStepComplete={onStepComplete}
      onRefresh={onRefresh}
    />
  )
}
