import { useMemo } from 'react'
import { DEFAULT_SCRIPTS } from '../config/salesScripts'

// ─── Script markup ─────────────────────────────────────────────────────────────
// One light markup shared by the built-in scripts and personal ones:
//   # Heading      ## Subheading      ### Label
//   1. numbered    - bullet           > tip box
//   [stage direction] → italic        blank line → new paragraph
// Anything else is a paragraph, with single line breaks kept as typed.

export function parseScript(text) {
  const blocks = []
  let para = []
  let list = null
  let tip  = null

  const flushPara = () => {
    if (para.length) { blocks.push({ type: 'p', text: para.join('\n') }); para = [] }
  }

  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const t = raw.trim()
    if (!t) { flushPara(); list = null; tip = null; continue }

    let m
    if ((m = t.match(/^(#{1,3})\s+(.*)$/))) {
      flushPara(); list = null; tip = null
      blocks.push({ type: `h${m[1].length}`, text: m[2] })
    } else if ((m = t.match(/^(\d+)[.)]\s+(.*)$/))) {
      flushPara(); tip = null
      if (!list || list.type !== 'ol') { list = { type: 'ol', start: Number(m[1]), items: [] }; blocks.push(list) }
      list.items.push(m[2])
    } else if ((m = t.match(/^[-•]\s+(.*)$/))) {
      flushPara(); tip = null
      if (!list || list.type !== 'ul') { list = { type: 'ul', items: [] }; blocks.push(list) }
      list.items.push(m[1])
    } else if ((m = t.match(/^>\s?(.*)$/))) {
      flushPara(); list = null
      if (!tip) { tip = { type: 'tip', lines: [] }; blocks.push(tip) }
      tip.lines.push(m[1])
    } else {
      list = null; tip = null
      para.push(t)
    }
  }
  flushPara()
  return blocks
}

// Splits text into plain runs and [bracketed] stage directions (nesting-safe;
// an unclosed bracket just stays plain text).
function splitInline(text) {
  const out = []
  let buf = ''
  let depth = 0
  for (const ch of text) {
    if (ch === '[') {
      if (depth === 0 && buf) { out.push({ t: buf }); buf = '' }
      depth++
      buf += ch
    } else if (ch === ']' && depth > 0) {
      buf += ch
      depth--
      if (depth === 0) { out.push({ dir: buf }); buf = '' }
    } else {
      buf += ch
    }
  }
  if (buf) out.push({ t: buf })
  return out
}

function Inline({ text }) {
  return splitInline(text).map((part, i) => part.dir
    ? <em key={i} className="italic text-blue-600 dark:text-blue-300">{part.dir}</em>
    : <span key={i}>{part.t}</span>)
}

function Block({ b }) {
  switch (b.type) {
    case 'h1':
      return <h3 className="mt-7 mb-2 pb-1.5 border-b border-gray-200 dark:border-white/10 text-sm font-extrabold uppercase tracking-wide text-accent">{b.text}</h3>
    case 'h2':
      return <h4 className="mt-5 mb-1.5 text-xs font-bold uppercase tracking-wider text-gray-800 dark:text-white/80">{b.text}</h4>
    case 'h3':
      return <h5 className="mt-4 mb-1 text-xs font-semibold text-gray-600 dark:text-white/60">{b.text}</h5>
    case 'ol':
      return (
        <ol start={b.start} className="list-decimal pl-6 my-2.5 space-y-1.5 text-sm leading-relaxed text-gray-800 dark:text-white/85 marker:text-gray-400 dark:marker:text-white/40">
          {b.items.map((it, i) => <li key={i}><Inline text={it} /></li>)}
        </ol>
      )
    case 'ul':
      return (
        <ul className="list-disc pl-6 my-2.5 space-y-1.5 text-sm leading-relaxed text-gray-800 dark:text-white/85 marker:text-gray-400 dark:marker:text-white/40">
          {b.items.map((it, i) => <li key={i}><Inline text={it} /></li>)}
        </ul>
      )
    case 'tip':
      return (
        <div className="my-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs leading-relaxed text-gray-700 dark:text-white/75 whitespace-pre-line">
          <Inline text={b.lines.join('\n')} />
        </div>
      )
    default:
      return <p className="my-2.5 text-sm leading-relaxed text-gray-800 dark:text-white/85 whitespace-pre-line"><Inline text={b.text} /></p>
  }
}

// ─── Pane ──────────────────────────────────────────────────────────────────────
// Sits against the lead card so a script and the card can be used side by side.
// personalScripts: the agent's own, [{ id, tab, heading, subtitle?, body }] — listed
// after the built-in B.E.S.T and R.E.A.L. scripts.

export default function ScriptPane({ personalScripts = [], activeId, onSelect, onClose, onManage, context }) {
  const scripts = useMemo(() => [...DEFAULT_SCRIPTS, ...personalScripts], [personalScripts])
  const active  = scripts.find(s => s.id === activeId) ?? scripts[0]
  const blocks = useMemo(() => parseScript(active?.body), [active])
  if (!active) return null

  const subtitle = [context, active.subtitle].filter(Boolean).join(' · ')

  return (
    <div className="fixed top-14 right-0 bottom-0 z-40 lg:z-30 w-full lg:right-[520px] lg:w-[400px] xl:w-[520px] 2xl:w-[600px] bg-white dark:bg-secondary border-l border-gray-200 dark:border-white/10 flex flex-col shadow-2xl">
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">{active.icon ?? '📄'}</span>
          <h2 className="flex-1 min-w-0 text-sm font-extrabold uppercase tracking-wider text-accent truncate">{active.heading}</h2>
          {onManage && (
            <button onClick={onManage} className="text-[11px] font-medium text-gray-400 dark:text-white/40 hover:text-accent transition-colors whitespace-nowrap">Manage</button>
          )}
          <button onClick={onClose} aria-label="Close scripts" className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-white/50 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors text-sm">✕</button>
        </div>
        {subtitle && (
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-gray-400 dark:text-white/40 truncate">{subtitle}</p>
        )}
      </div>

      {/* Script selector — built-ins first, then personal scripts */}
      <div className="px-4 pb-3 flex gap-2 overflow-x-auto shrink-0 border-b border-gray-100 dark:border-white/10">
        {scripts.map(s => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`whitespace-nowrap text-xs font-semibold px-4 py-2 rounded-lg border transition-colors ${
              s.id === active.id
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-gray-200 dark:border-white/10 text-gray-500 dark:text-white/50 hover:border-gray-300 dark:hover:border-white/20'
            } ${scripts.length <= 3 ? 'flex-1' : ''}`}
          >{s.tab}</button>
        ))}
      </div>

      <div key={active.id} className="flex-1 overflow-y-auto px-5 pt-1 pb-10">
        {blocks.map((b, i) => <Block key={i} b={b} />)}
      </div>
    </div>
  )
}
