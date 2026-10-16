import { hasValue } from './leadHelpers'
import { CONDITIONS } from './cqfConfig'
import { fmtDate } from '../../utils/format'

// What has been entered in the Client Qualification Form, read-only, for the lead card.
// Shows saved answers only — anything the CQF merely prefilled from the lead card is already
// on the card — and skips whatever is blank, so a half-filled CQF shows just what was captured.

const LABEL = 'block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-white/50 mb-0.5'

// The CQF is prefilled from the lead card, so a saved value that still matches the card isn't repeated.
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()

function height(p) {
  const ft = hasValue(p?.ft) ? `${p.ft}′` : ''
  const inch = hasValue(p?.inch) ? `${p.inch}″` : ''
  return [ft, inch].filter(Boolean).join(' ')
}

// Rows for one person: height / weight, age, occupation, smoker
function personRows(p, who, lead) {
  if (!p) return []
  const rows = []
  const hw = [height(p), hasValue(p.weight) ? `${p.weight} lb` : ''].filter(Boolean).join(' · ')
  if (hw) rows.push([`${who} height / weight`, hw])
  if (who !== 'Client') {
    if (hasValue(p.name) && !same(p.name, lead.spouse_name)) rows.push([`${who} name`, p.name])
    if (hasValue(p.dob))  rows.push([`${who} birthday`, fmtDate(p.dob)])
    else if (hasValue(p.age)) rows.push([`${who} age`, String(p.age)])
  }
  if (hasValue(p.occupation) && !(who === 'Client' && same(p.occupation, lead.employment))) rows.push([`${who} occupation`, p.occupation])
  if (p.smoker === true && who !== 'Client') rows.push([`${who} tobacco`, 'Smoker'])
  return rows
}

function Block({ label, children }) {
  return (
    <div>
      <p className={LABEL}>{label}</p>
      {children}
    </div>
  )
}

function Conditions({ cqf, who, title }) {
  const on = CONDITIONS.filter(c => cqf.conditions?.[who]?.[c.key]?.on)
  const other = cqf.other_conditions?.[who]
  if (on.length === 0 && !hasValue(other)) return null
  return (
    <Block label={title}>
      <ul className="space-y-1.5">
        {on.map(c => {
          const answers = (cqf.conditions[who][c.key].a ?? []).filter(hasValue)
          return (
            <li key={c.key} className="text-base text-gray-900 dark:text-white">
              <span className="font-semibold">{c.label}</span>
              {answers.length > 0 && <span className="text-gray-600 dark:text-white/65"> — {answers.join(' · ')}</span>}
            </li>
          )
        })}
        {hasValue(other) && (
          <li className="text-base text-gray-900 dark:text-white"><span className="font-semibold">Other</span><span className="text-gray-600 dark:text-white/65"> — {other}</span></li>
        )}
      </ul>
    </Block>
  )
}

export default function CqfSummary({ cqf, lead = {} }) {
  if (!cqf || typeof cqf !== 'object') return null

  const rows = [
    ...personRows(cqf.client, 'Client', lead),
    ...personRows(cqf.spouse, 'Spouse', lead),
  ]
  const misc = [
    ['Beneficiary', same(cqf.beneficiary_name, lead.beneficiary) && !hasValue(cqf.beneficiary_relationship) ? '' : [cqf.beneficiary_name, cqf.beneficiary_relationship && `(${cqf.beneficiary_relationship})`].filter(hasValue).join(' ')],
    ['Children', same(cqf.children, lead.has_children) && !hasValue(cqf.children_ages) ? '' : [cqf.children, cqf.children === 'Yes' && hasValue(cqf.children_ages) ? `ages ${cqf.children_ages}` : ''].filter(hasValue).join(' · ')],
    ['Coverage wanted', same(cqf.coverage_wanted, lead.coverage) ? '' : cqf.coverage_wanted],
    ['Monthly budget', cqf.monthly_budget],
    ['Existing coverage', cqf.existing_coverage],
  ].filter(([, v]) => hasValue(v))

  const meds = [['Client', cqf.medications?.client], ['Spouse', cqf.medications?.spouse]].filter(([, v]) => hasValue(v))

  const blocks = []
  if (hasValue(cqf.why)) {
    blocks.push(<Block key="why" label="Client’s why"><p className="text-base text-gray-900 dark:text-white whitespace-pre-wrap">{cqf.why}</p></Block>)
  }
  if (rows.length > 0) {
    blocks.push(
      <div key="people" className="grid grid-cols-2 gap-x-4 gap-y-3">
        {rows.map(([k, v]) => (
          <div key={k}><p className={LABEL}>{k}</p><p className="text-base font-medium text-gray-900 dark:text-white break-words">{v}</p></div>
        ))}
      </div>,
    )
  }
  const condClient = <Conditions key="cc" cqf={cqf} who="client" title="Medical — client" />
  const condSpouse = <Conditions key="cs" cqf={cqf} who="spouse" title="Medical — spouse" />
  blocks.push(condClient, condSpouse)
  if (meds.length > 0) {
    blocks.push(
      <Block key="meds" label="Medications">
        <div className="space-y-1">
          {meds.map(([who, v]) => (
            <p key={who} className="text-base text-gray-900 dark:text-white whitespace-pre-wrap">
              {meds.length > 1 && <span className="font-semibold">{who}: </span>}{v}
            </p>
          ))}
        </div>
      </Block>,
    )
  }
  if (misc.length > 0) {
    blocks.push(
      <div key="misc" className="grid grid-cols-2 gap-x-4 gap-y-3">
        {misc.map(([k, v]) => (
          <div key={k} className={k === 'Existing coverage' || k === 'Beneficiary' ? 'col-span-2' : ''}>
            <p className={LABEL}>{k}</p><p className="text-base font-medium text-gray-900 dark:text-white break-words">{v}</p>
          </div>
        ))}
      </div>,
    )
  }

  // The conditions blocks render null when empty, so count what actually has content
  const hasAny = Boolean(hasValue(cqf.why) || rows.length || misc.length || meds.length
    || CONDITIONS.some(c => cqf.conditions?.client?.[c.key]?.on || cqf.conditions?.spouse?.[c.key]?.on)
    || hasValue(cqf.other_conditions?.client) || hasValue(cqf.other_conditions?.spouse))
  if (!hasAny) return null

  return <div className="mt-4 pt-4 border-t border-gray-200 dark:border-white/10 space-y-4">{blocks}</div>
}
