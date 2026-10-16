import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import CalendarEventModal from '../CalendarEventModal'
import { fmtDate, fmtDateTime } from '../../utils/format'
import { LEAD_SECTIONS } from './leadFields'
import { typeCfg, getLeadTZ, hasValue, fmtWhen, fmtDay, attemptTotals } from './leadHelpers'
import Icon from './icons'

// The lead card for sales leads (the drawer that opens from the Leads list).
//
// Read mode shows only the fields that have a value — the card fills itself from the
// lead as received. "Edit" switches every field to an input. Work actions (call, text,
// log an attempt, status, callback) and the CQF entry point stay available in both modes.
//
// Styling uses only the agency's primary / secondary / accent. Sections are told apart by
// weight, not hue: the "work" card is solid primary, everything else is a quiet card,
// and accent marks titles, the one call to action, and active states.

const INPUT = 'w-full text-base rounded-lg px-3 py-2 border bg-white dark:bg-white/5 text-gray-900 dark:text-white border-gray-300 dark:border-white/15 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60 transition-colors'
const INPUT_ON_SOLID = 'w-full text-base rounded-lg px-3 py-2 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/60'
const LABEL = 'block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-white/50 mb-1'
const BTN_OUTLINE = 'border border-primary/30 dark:border-white/25 text-primary dark:text-white hover:bg-primary/5 dark:hover:bg-white/10 transition-colors'
// Solid primary keeps white text legible whatever the agency's accent is; accent shows as the outline.
const BTN_CTA = 'bg-primary text-white border border-accent hover:bg-primary/85 active:bg-primary/75 transition-colors'
const LINK = 'text-primary dark:text-white underline decoration-accent decoration-2 underline-offset-2 hover:decoration-4'
const NEUTRAL_BADGE = 'bg-primary/10 text-primary dark:bg-white/10 dark:text-white/80'

function Card({ title, right, children, variant = 'quiet', emphasis = false }) {
  const solid = variant === 'solid'
  return (
    <section className={`rounded-2xl overflow-hidden ${
      solid
        ? 'bg-primary text-white shadow-md ring-1 ring-black/5 dark:ring-white/15'
        : `bg-white dark:bg-primary/30 shadow-sm ${emphasis ? 'border-2 border-accent/60' : 'border border-gray-200 dark:border-white/10'}`
    }`}>
      <header className={`flex items-center gap-2.5 px-4 py-2.5 ${
        solid ? 'border-b border-white/15' : 'bg-primary/5 dark:bg-white/5 border-b border-gray-200 dark:border-white/10'
      }`}>
        <span className="w-1 h-4 rounded-full bg-accent shrink-0" />
        <h3 className={`flex-1 min-w-0 text-sm font-extrabold uppercase tracking-wider truncate ${solid ? 'text-white' : 'text-primary dark:text-white/85'}`}>{title}</h3>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

function fieldDisplay(f, v) {
  if (f.display) return f.display(v)
  if (f.kind === 'date') return fmtDate(v)
  return String(v)
}

function ViewField({ f, value }) {
  const text = fieldDisplay(f, value)
  let body = <span className="break-words">{text}</span>
  if (f.link === 'tel')    body = <a href={`tel:+1${String(value).replace(/[^0-9]/g, '')}`} className={LINK}>{text}</a>
  if (f.link === 'mailto') body = <a href={`mailto:${value}`} className={LINK + ' break-all'}>{text}</a>
  return (
    <div className={f.span === 2 ? 'col-span-2' : ''}>
      <p className={LABEL}>{f.label}</p>
      <p className="text-base font-medium text-gray-900 dark:text-white">{body}</p>
    </div>
  )
}

const ACT_ICON = { call: 'phone', text: 'chat', note: 'pencil', status: 'refresh', callback: 'calendar' }

export default function LeadPanel({
  lead: l, activity, actLoading, statuses, statusSaving, scriptsOpen,
  onToggleScripts, onClose, onLogAttempt, onAttemptNote, onStatusChange,
  onCallbackChange, onPatch, onOpenCqf, attemptError,
  // Docked pane (iPad landscape): the pane supplies a Lead / Scripts / CQF tab bar under the
  // header, and swaps the body for the active tab. The lead body stays mounted (hidden) so
  // scroll position, edit mode and half-typed notes survive a tab switch.
  tabsNode = null, overrideBody = null, hideClose = false,
}) {
  const { userProfile } = useAuth()
  const calConnected = userProfile?.google_calendar_connected ?? false
  const [showCalModal, setShowCalModal] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm]       = useState({})
  const [logging, setLogging] = useState(null)         // 'call' | 'text' while a log request is in flight
  const [pendingNote, setPendingNote] = useState(null) // { id, type, text } — note for the attempt just logged
  const [noteEdit, setNoteEdit] = useState(null)       // { id, text } — editing an older entry's note

  // A different lead was opened: start in read mode with a fresh form
  useEffect(() => {
    const init = {}
    for (const s of LEAD_SECTIONS) for (const f of s.fields) init[f.key] = l[f.key] ?? ''
    init.name  = l.name  ?? ''
    init.notes = l.notes ?? ''
    setForm(init)
    setEditing(false)
    setPendingNote(null)
    setNoteEdit(null)
  }, [l.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function commit(f) {
    let val = form[f.key]
    val = (val === '' || val == null) ? null : val
    if (val !== null && f.kind === 'int') val = parseInt(val, 10) || null
    if (val !== null && f.kind === 'state') val = String(val).toUpperCase().slice(0, 2)
    const orig = hasValue(l[f.key]) ? l[f.key] : null
    if (orig !== val) onPatch(f.key, val)
  }

  const tz     = getLeadTZ(l.state)
  const tc     = typeCfg(l.lead_type)
  const { calls, texts, total } = attemptTotals(l)
  const cbVal  = l.callback_at ? new Date(l.callback_at).toISOString().slice(0, 16) : ''
  const digits = (l.phone || '').replace(/[^0-9]/g, '')

  // Attempt numbers: oldest call/text entry is #1 (activity arrives newest-first)
  const attemptNo = useMemo(() => {
    const map = {}
    let n = 0
    for (let i = activity.length - 1; i >= 0; i--) {
      const a = activity[i]
      if (a.activity_type === 'call' || a.activity_type === 'text') map[a.id] = ++n
    }
    return map
  }, [activity])

  const groupedActivity = useMemo(() => {
    const groups = {}
    for (const a of activity) {
      const day = new Date(a.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      if (!groups[day]) groups[day] = []
      groups[day].push(a)
    }
    return groups
  }, [activity])

  async function log(type) {
    if (logging) return
    setLogging(type)
    try {
      const entry = await onLogAttempt(type)
      if (entry) setPendingNote({ id: entry.id, type, text: '' })
    } finally { setLogging(null) }
  }

  async function savePendingNote() {
    if (!pendingNote) return
    if (pendingNote.text.trim()) await onAttemptNote(pendingNote.id, pendingNote.text)
    setPendingNote(null)
  }

  async function saveNoteEdit() {
    if (!noteEdit) return
    await onAttemptNote(noteEdit.id, noteEdit.text)
    setNoteEdit(null)
  }

  const hasCarrierPrep = !!(l.carrier_prep && (l.carrier_prep.available?.trim() || l.carrier_prep.notes?.trim() || (l.carrier_prep.options ?? []).some(o => o?.carrier?.trim())))

  return (
    <>
      {showCalModal && <CalendarEventModal lead={l} onClose={() => setShowCalModal(false)} />}

      {/* ── Header ── */}
      <div className="flex items-start gap-3 px-4 py-3 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-primary/40 shrink-0">
        {!hideClose && (
          <button onClick={onClose} aria-label="Close" className={`mt-1 w-11 h-11 sm:w-9 sm:h-9 touch:sm:w-11 touch:sm:h-11 flex items-center justify-center rounded-lg text-lg ${BTN_OUTLINE}`}>←</button>
        )}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              value={form.name ?? ''}
              onChange={e => set('name', e.target.value)}
              onBlur={() => { const v = (form.name ?? '').trim(); if (v && v !== l.name) onPatch('name', v) }}
              className={INPUT + ' text-xl font-bold'}
            />
          ) : (
            <h2 className="text-2xl font-extrabold leading-tight text-gray-900 dark:text-white break-words">{l.name}</h2>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${NEUTRAL_BADGE}`}>{tc.label}</span>
            <span className="text-sm text-gray-500 dark:text-white/55">{l.lead_type}{l.state ? ` · ${l.state}` : ''}</span>
            {tz && (
              <span className={`text-sm font-semibold ${tz.goodTime ? 'text-gray-700 dark:text-white/80' : 'text-red-500 dark:text-red-300'}`}>
                {tz.label} {tz.timeStr}{tz.goodTime ? ' ✓' : ' ⛔'}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setEditing(e => !e)}
          className={`mt-1 shrink-0 flex items-center gap-1.5 text-sm font-semibold px-3 py-2 min-h-11 touch:min-h-11 rounded-lg border transition-colors ${
            editing ? BTN_CTA : `border-primary/30 dark:border-white/25 text-primary dark:text-white hover:bg-primary/5 dark:hover:bg-white/10`
          }`}
        ><Icon name={editing ? 'check' : 'pencil'} className="w-4 h-4" />{editing ? 'Done' : 'Edit'}</button>
      </div>

      {tabsNode}

      {overrideBody}

      {/* ── Body ── */}
      <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain bg-gray-50 dark:bg-secondary p-4 space-y-4 ${overrideBody ? 'hidden' : ''}`}>

        {/* Work this lead — the one solid card */}
        <Card variant="solid" title="Work this lead">
          <div className="grid grid-cols-2 gap-3">
            {digits ? (
              <>
                <a href={`tel:+1${digits}`} className="flex items-center justify-center gap-2 sm:gap-3 rounded-2xl bg-white text-primary py-4 px-2 shadow-sm hover:bg-white/90 active:bg-white/80 transition-colors">
                  <Icon name="phone" className="w-6 h-6 sm:w-8 sm:h-8 shrink-0" />
                  <span className="text-left min-w-0">
                    <span className="block text-2xl font-extrabold leading-none">Call</span>
                    <span className="block text-xs sm:text-sm font-semibold opacity-75 whitespace-nowrap">{l.phone}</span>
                  </span>
                </a>
                <a href={`sms:+1${digits}`} className="flex items-center justify-center gap-2 sm:gap-3 rounded-2xl border-2 border-white text-white py-4 px-2 hover:bg-white/10 active:bg-white/20 transition-colors">
                  <Icon name="chat" className="w-6 h-6 sm:w-8 sm:h-8 shrink-0" />
                  <span className="text-left min-w-0">
                    <span className="block text-2xl font-extrabold leading-none">Text</span>
                    <span className="block text-xs sm:text-sm font-semibold opacity-75 whitespace-nowrap">{l.phone}</span>
                  </span>
                </a>
              </>
            ) : (
              <p className="col-span-2 text-base text-white/80 py-3 text-center rounded-2xl bg-white/10">No phone number on this lead — add one under Edit.</p>
            )}
          </div>

          <p className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-white/65">After you dial or text</p>
          <div className="grid grid-cols-2 gap-3">
            {[['call', 'Log call attempt', calls], ['text', 'Log text attempt', texts]].map(([type, label, n]) => (
              <button key={type} onClick={() => log(type)} disabled={!!logging}
                className="rounded-xl border border-white/35 bg-white/10 hover:bg-white/20 active:bg-white/25 disabled:opacity-50 text-white py-3 transition-colors">
                <span className="flex items-center justify-center gap-1.5 text-base font-bold">
                  <Icon name="plus" className="w-4 h-4" />{logging === type ? 'Logging…' : label}
                </span>
                <span className="block text-xs font-medium text-white/70">{n} so far</span>
              </button>
            ))}
          </div>

          <p className="mt-3 text-base text-white/90">
            {total === 0
              ? 'No attempts logged yet.'
              : <><strong className="text-white">{total} attempt{total !== 1 ? 's' : ''}</strong> · last {l.last_attempt_type === 'text' ? 'text' : 'call'} {fmtWhen(l.last_attempt_at) || '—'}</>}
          </p>
          {attemptError && <p className="mt-2 text-sm rounded-lg bg-red-500/25 text-red-50 px-3 py-2">{attemptError}</p>}

          {pendingNote && (
            <div className="mt-3 rounded-xl border border-white/25 bg-white/10 p-3">
              <p className="text-sm font-semibold text-white mb-1.5">
                Logged ✓ — add a note about this {pendingNote.type} attempt? <span className="font-normal opacity-70">(optional)</span>
              </p>
              <textarea
                autoFocus rows={2} value={pendingNote.text}
                onChange={e => setPendingNote(p => ({ ...p, text: e.target.value }))}
                placeholder={pendingNote.type === 'call' ? 'e.g. Voicemail left, call back after 5' : 'e.g. Sent intro text, no reply yet'}
                className={INPUT_ON_SOLID + ' resize-none'}
              />
              <div className="flex gap-2 mt-2">
                <button onClick={savePendingNote} className="text-sm px-4 py-1.5 rounded-lg bg-white text-primary font-semibold hover:bg-white/90 transition-colors">Save note</button>
                <button onClick={() => setPendingNote(null)} className="text-sm px-3 py-1.5 rounded-lg border border-white/40 text-white hover:bg-white/10 transition-colors">Skip</button>
              </div>
            </div>
          )}
        </Card>

        {/* Status, callback, appointment */}
        <Card title="Status & follow-up">
          <label className={LABEL}>Status</label>
          <select
            value={l.status}
            onChange={e => onStatusChange(e.target.value)}
            disabled={statusSaving}
            className={INPUT + ' cursor-pointer font-semibold'}
          >
            {statuses.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-white/55">
            {l.last_dispositioned_at ? <>Status changed <span className="font-semibold text-gray-700 dark:text-white/80">{fmtDay(l.last_dispositioned_at)}</span></> : 'Status not changed yet'}
          </p>

          <label className={LABEL + ' mt-4'}>Callback</label>
          <div className="flex gap-2 items-center">
            <input
              type="datetime-local" defaultValue={cbVal} key={cbVal}
              onBlur={e => onCallbackChange(e.target.value)}
              className={INPUT + ' flex-1 dark:[color-scheme:dark]'}
            />
            {l.callback_at && (
              <button onClick={() => onCallbackChange('')} className={`text-sm px-3 py-2 rounded-lg ${BTN_OUTLINE}`}>Clear</button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <button
              onClick={() => calConnected && setShowCalModal(true)}
              title={calConnected ? 'Schedule calendar event' : 'Connect Google Calendar in your profile to use this'}
              className={`flex items-center justify-center gap-2 rounded-xl py-3 text-base font-semibold ${
                calConnected ? BTN_OUTLINE : 'border border-gray-200 dark:border-white/10 text-gray-400 dark:text-white/25 cursor-not-allowed'
              }`}
            ><Icon name="calendar" className="w-5 h-5" />Set appointment</button>
            {onToggleScripts && (
              <button onClick={onToggleScripts}
                className={`flex items-center justify-center gap-2 rounded-xl py-3 text-base font-semibold border transition-colors ${
                  scriptsOpen ? 'bg-primary text-white border-primary dark:bg-white dark:text-primary dark:border-white' : `border-primary/30 dark:border-white/25 text-primary dark:text-white hover:bg-primary/5 dark:hover:bg-white/10`
                }`}
              ><Icon name="script" className="w-5 h-5" />{scriptsOpen ? 'Hide scripts' : 'Scripts'}</button>
            )}
          </div>
        </Card>

        {/* CQF entry — outlined in accent so it reads as the next step */}
        <Card title="Client Qualification Form" emphasis>
          <p className="text-base text-gray-700 dark:text-white/75">
            {l.cqf
              ? <>In progress · updated <span className="font-semibold">{fmtWhen(l.cqf_updated_at) || '—'}</span></>
              : 'Not started. Date of birth, smoker status and other basics fill in from this card.'}
          </p>
          <button onClick={onOpenCqf}
            className={`mt-3 w-full flex items-center justify-center gap-2.5 rounded-2xl border-2 py-4 text-xl font-extrabold shadow-sm ${BTN_CTA}`}>
            <Icon name="clipboard" className="w-6 h-6 text-accent" />{l.cqf ? 'Continue CQF' : 'Start CQF'}
          </button>
          {hasCarrierPrep && (
            <div className="mt-3 rounded-xl bg-primary/5 dark:bg-white/5 p-3">
              <p className={LABEL}>Carrier prep</p>
              {l.carrier_prep.available?.trim() && <p className="text-sm text-gray-600 dark:text-white/65 mb-1">Available: {l.carrier_prep.available}</p>}
              {(l.carrier_prep.options ?? []).filter(o => o?.carrier?.trim()).map((o, i) => (
                <p key={i} className="text-base text-gray-900 dark:text-white"><span className="font-semibold">{o.carrier}</span>{o.product ? ` — ${o.product}` : ''}</p>
              ))}
              {l.carrier_prep.notes?.trim() && <p className="text-sm text-gray-600 dark:text-white/65 whitespace-pre-wrap mt-1">{l.carrier_prep.notes}</p>}
            </div>
          )}
        </Card>

        {/* Data sections — read mode: only fields with a value */}
        {LEAD_SECTIONS.map(sec => {
          const filled = sec.fields.filter(f => hasValue(l[f.key]))
          const flagsOn = (sec.flags ?? []).filter(fl => l[fl.key] === true)
          if (!editing && filled.length === 0 && flagsOn.length === 0) return null
          const fields = editing ? sec.fields : filled
          return (
            <Card key={sec.key} title={sec.title}>
              {fields.length > 0 && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {fields.map(f => editing && !f.readOnly ? (
                    <div key={f.key} className={f.span === 2 ? 'col-span-2' : ''}>
                      <label className={LABEL}>{f.label}</label>
                      {f.kind === 'select' ? (
                        <select value={form[f.key] ?? ''} className={INPUT + ' cursor-pointer'}
                          onChange={e => { set(f.key, e.target.value); onPatch(f.key, e.target.value || null) }}>
                          <option value="">—</option>
                          {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <input
                          type={f.kind === 'date' ? 'date' : f.kind === 'int' ? 'number' : f.kind === 'email' ? 'email' : f.kind === 'tel' ? 'tel' : 'text'}
                          value={form[f.key] ?? ''} placeholder="—"
                          maxLength={f.kind === 'state' ? 2 : undefined}
                          onChange={e => set(f.key, f.kind === 'state' ? e.target.value.toUpperCase() : e.target.value)}
                          onBlur={() => commit(f)}
                          className={INPUT + (f.kind === 'date' ? ' dark:[color-scheme:dark]' : '')}
                        />
                      )}
                    </div>
                  ) : hasValue(l[f.key]) ? (
                    <ViewField key={f.key} f={f} value={l[f.key]} />
                  ) : null)}
                </div>
              )}
              {(sec.flags ?? []).length > 0 && (
                editing ? (
                  <div className="flex flex-wrap gap-5 mt-4">
                    {sec.flags.map(fl => (
                      <label key={fl.key} className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={!!l[fl.key]} onChange={e => onPatch(fl.key, e.target.checked)} className="w-5 h-5 rounded accent-accent" />
                        <span className="text-base text-gray-800 dark:text-white/85">{fl.label}</span>
                      </label>
                    ))}
                  </div>
                ) : flagsOn.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {flagsOn.map(fl => (
                      <span key={fl.key} className={`text-sm font-bold px-3 py-1 rounded-full ${fl.tone === 'warn' ? 'bg-accent/10 text-gray-900 dark:text-white border border-accent/50' : NEUTRAL_BADGE}`}>
                        {fl.label}
                      </span>
                    ))}
                  </div>
                )
              )}
            </Card>
          )
        })}

        {/* Notes */}
        <Card title="Lead notes">
          <textarea
            value={form.notes ?? ''}
            onChange={e => set('notes', e.target.value)}
            onBlur={() => { const v = (form.notes ?? '').trim() || null; if (v !== (hasValue(l.notes) ? l.notes : null)) onPatch('notes', v) }}
            rows={4}
            placeholder="Anything worth remembering about this lead…"
            className={INPUT + ' resize-y'}
          />
        </Card>

        {/* Activity */}
        <Card
          title="Activity"
          right={<span className="text-xs font-semibold text-gray-500 dark:text-white/55">{total} attempt{total !== 1 ? 's' : ''}</span>}
        >
          {actLoading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map(i => <div key={i} className="h-12 bg-gray-100 dark:bg-white/5 rounded-lg" />)}
            </div>
          ) : activity.length === 0 ? (
            <p className="text-base text-gray-500 dark:text-white/55">No activity yet. Log a call or text attempt to get started.</p>
          ) : (
            <div className="space-y-5">
              {Object.entries(groupedActivity).map(([day, entries]) => (
                <div key={day}>
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-white/45 mb-2">{day}</p>
                  <div className="space-y-3">
                    {entries.map(a => {
                      const isAttempt = attemptNo[a.id] != null
                      const label = isAttempt
                        ? `${a.activity_type === 'call' ? 'Call' : 'Text'} attempt #${attemptNo[a.id]}`
                        : a.body.replace(/^\S*[^\w\s]\S*\s/, '')
                      return (
                        <div key={a.id} className="flex gap-3">
                          <span className={`mt-0.5 w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${NEUTRAL_BADGE}`}>
                            <Icon name={ACT_ICON[a.activity_type] || 'clipboard'} className="w-4 h-4" />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-semibold text-gray-900 dark:text-white">{label}</p>
                            <p className="text-sm text-gray-500 dark:text-white/45">{fmtDateTime(a.created_at)}</p>
                            {noteEdit?.id === a.id ? (
                              <div className="mt-2">
                                <textarea autoFocus rows={2} value={noteEdit.text} onChange={e => setNoteEdit(n => ({ ...n, text: e.target.value }))} className={INPUT + ' resize-none'} />
                                <div className="flex gap-2 mt-2">
                                  <button onClick={saveNoteEdit} className={`text-sm px-4 py-1.5 rounded-lg font-semibold ${BTN_CTA}`}>Save</button>
                                  <button onClick={() => setNoteEdit(null)} className={`text-sm px-3 py-1.5 rounded-lg ${BTN_OUTLINE}`}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {a.note && (
                                  <div className="mt-1.5 bg-primary/5 dark:bg-white/5 border-l-4 border-accent rounded-r-lg px-3 py-2">
                                    <p className="text-base text-gray-700 dark:text-white/80 whitespace-pre-wrap">{a.note}</p>
                                  </div>
                                )}
                                {isAttempt && (
                                  <button onClick={() => setNoteEdit({ id: a.id, text: a.note ?? '' })} className={`mt-1 text-sm font-medium ${LINK}`}>
                                    {a.note ? 'Edit note' : '+ Add note'}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="h-6" />
      </div>
    </>
  )
}
