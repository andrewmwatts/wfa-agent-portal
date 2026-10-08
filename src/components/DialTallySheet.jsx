import { useEffect } from 'react'
import { createPortal } from 'react-dom'

const NAVY = '#00178A'
const PINK = '#EE2666'
const TEAL = '#005365'
const GRID = '#BBBBBB'
const FONT = "Inter, Arial, Helvetica, sans-serif"

const COLS = 25
const ROWS = 25
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const DAY_NAMES = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
const DAY_FIELDS = ['DIALS', 'CONTACTS', 'APPOINTMENTS']

const PRINT_CSS = `
  @page { size: letter portrait; margin: 0.4in; }
  @media print {
    body > *:not(#dial-tally-print-root) { display: none !important; }
    body { overflow: visible !important; background: #fff !important; }
    #dial-tally-print-root { position: static !important; inset: auto !important; background: #fff !important; overflow: visible !important; padding: 0 !important; }
    #dial-tally-print-root .no-print { display: none !important; }
    #dial-tally-print-root .sheet { width: 100% !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; }
    #dial-tally-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`

function SectionLabel({ children, style }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', color: TEAL, ...style }}>
      {children}
    </div>
  )
}

export default function DialTallySheet({ onClose }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div
      id="dial-tally-print-root"
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)', overflow: 'auto', padding: '24px 12px' }}
    >
      <style>{PRINT_CSS}</style>

      <div className="no-print" style={{ maxWidth: '7.7in', margin: '0 auto 12px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          onClick={() => window.print()}
          style={{ background: PINK, color: '#fff', border: 0, borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}
        >
          Print
        </button>
        <button
          onClick={onClose}
          style={{ background: '#fff', color: '#333', border: '1px solid #ccc', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
        >
          Close
        </button>
      </div>

      <div
        className="sheet"
        style={{ width: '7.7in', margin: '0 auto', background: '#fff', padding: '0.3in', boxSizing: 'border-box', fontFamily: FONT, color: '#111', boxShadow: '0 4px 24px rgba(0,0,0,0.35)' }}
      >
        {/* Title */}
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, color: NAVY, lineHeight: 1.1 }}>
          Weekly Activity Tracker
        </h1>
        <div style={{ height: 3, background: PINK, margin: '6px 0 10px' }} />

        {/* Week of */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.12em', color: NAVY }}>WEEK OF:</span>
          <span style={{ flex: 1, borderBottom: '1px solid #CCC', height: 16 }} />
        </div>

        {/* Dial grid */}
        <div style={{ border: '1.5px solid #333', borderRadius: 6, padding: '8px 10px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.14em', color: NAVY }}>NUMBER OF DIALS</span>
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.05em' }}>MARK ONE BOX FOR EACH DIAL · GOAL: 500/WEEK</span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${COLS}, 1fr) 0.42in`,
              borderTop: `1px solid ${GRID}`,
              borderLeft: `1px solid ${GRID}`,
            }}
          >
            {Array.from({ length: ROWS }).flatMap((_, r) => [
              ...Array.from({ length: COLS }).map((__, c) => (
                <div
                  key={`${r}-${c}`}
                  style={{ height: '0.19in', borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}` }}
                />
              )),
              <div
                key={`label-${r}`}
                style={{ height: '0.19in', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontSize: 9, fontWeight: 700, color: '#444' }}
              >
                {(r + 1) * COLS}
              </div>,
            ])}
          </div>
        </div>

        {/* Running tally */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '12px 0 5px' }}>
          <SectionLabel>RUNNING TALLY</SectionLabel>
          <span style={{ fontSize: 10, fontStyle: 'italic' }}>Use these boxes to tally up your daily activity</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '0.08in 0.1in' }}>
          {DAY_NAMES.map((day, i) => (
            <div
              key={day}
              style={{ gridColumn: i < 4 ? 'span 3' : 'span 4', border: `1.5px solid ${PINK}`, borderRadius: 6, overflow: 'hidden' }}
            >
              <div style={{ background: PINK, color: '#fff', textAlign: 'center', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', padding: '3px 0' }}>
                {day}
              </div>
              {DAY_FIELDS.map((field, j) => (
                <div key={field} style={{ display: 'flex', height: '0.29in', borderTop: j === 0 ? 'none' : '1px solid #F0B8CA' }}>
                  <span style={{ width: '0.95in', flexShrink: 0, borderRight: '1px solid #F0B8CA', padding: '3px 0 0 6px', boxSizing: 'border-box', fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', color: '#555' }}>
                    {field}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Daily habit */}
        <SectionLabel style={{ margin: '12px 0 5px' }}>DAILY HABIT</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F2F6F9', borderRadius: 6, padding: '8px 12px' }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: NAVY }}>PERSONAL DEVELOPMENT</span>
          <div style={{ display: 'flex', gap: 18 }}>
            {DAYS.map(d => (
              <div key={d} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <span style={{ width: 14, height: 14, border: `1.5px solid ${PINK}`, borderRadius: 3, background: '#fff' }} />
                <span style={{ fontSize: 9.5, fontWeight: 800, color: '#777', letterSpacing: '0.04em' }}>{d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
