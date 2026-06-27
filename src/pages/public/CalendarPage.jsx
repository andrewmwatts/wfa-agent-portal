import { useState } from 'react'
import { createPortal } from 'react-dom'
import PublicLayout from '../../components/public/PublicLayout'

// ── Symmetry business-month helpers ──────────────────────────────────────────

function lastFridayOf(year, month) {
  const lastDay = new Date(year, month + 1, 0)
  const dow = lastDay.getDay()
  return new Date(year, month, lastDay.getDate() - ((dow - 5 + 7) % 7))
}

function getBusinessMonth(referenceDate) {
  const y = referenceDate.getFullYear()
  const m = referenceDate.getMonth()

  const endDate = lastFridayOf(y, m)

  const prevM = m === 0 ? 11 : m - 1
  const prevY = m === 0 ? y - 1 : y
  const endPrevMonth = lastFridayOf(prevY, prevM)
  const startDate = new Date(endPrevMonth)
  startDate.setDate(startDate.getDate() + 1)

  const refMidnight = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate())
  const endMidnight = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())

  if (refMidnight > endMidnight) {
    const nextM = m === 11 ? 0 : m + 1
    const nextY = m === 11 ? y + 1 : y
    const newEnd = lastFridayOf(nextY, nextM)
    const newStart = new Date(endDate)
    newStart.setDate(newStart.getDate() + 1)
    return { start: newStart, end: newEnd }
  }

  return { start: startDate, end: endDate }
}

function getNextBusinessMonth(current) {
  const dayAfter = new Date(current.end)
  dayAfter.setDate(dayAfter.getDate() + 1)
  return getBusinessMonth(dayAfter)
}

function buildWeeks(start, end) {
  const weeks = []
  let cursor = new Date(start)
  let weekNum = 1
  while (cursor <= end) {
    const days = []
    for (let i = 0; i < 7; i++) {
      days.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push({ weekNum, days })
    weekNum++
  }
  return weeks
}

// ── Formatting helpers ────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTHS_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_LABELS   = ['Sat','Sun','Mon','Tue','Wed','Thu','Fri']

function fmtRange(start, end) {
  const sm = MONTHS_SHORT[start.getMonth()]
  const em = MONTHS_SHORT[end.getMonth()]
  const sy = start.getFullYear()
  const ey = end.getFullYear()
  if (sy !== ey) return `${sm} ${start.getDate()}, ${sy} – ${em} ${end.getDate()}, ${ey}`
  if (sm !== em)  return `${sm} ${start.getDate()} – ${em} ${end.getDate()}, ${ey}`
  return `${sm} ${start.getDate()}–${end.getDate()}, ${sy}`
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate()
}

// ── Business calendar (compact) ───────────────────────────────────────────────

function BusinessCalendar({ bMonth, today, showTodayHighlight, showLegend }) {
  const { start, end } = bMonth
  const weeks = buildWeeks(start, end)

  const COL_W      = 68
  const WEEK_COL_W = 36
  const ROW_H      = 52
  const HEAD_H     = 28

  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 500, color: '#003539', margin: '0 0 2px' }}>
        {MONTHS_FULL[end.getMonth()]}
      </h2>
      <p style={{ fontSize: 12, color: '#4A6568', margin: '0 0 12px', fontFamily: 'Inter, sans-serif' }}>
        {fmtRange(start, end)} · {weeks.length} business week{weeks.length !== 1 ? 's' : ''}
      </p>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: WEEK_COL_W + COL_W * 7, fontFamily: 'Inter, sans-serif' }}>

          <div style={{ display: 'flex' }}>
            <div style={{ width: WEEK_COL_W, flexShrink: 0 }} />
            {DAY_LABELS.map(d => (
              <div key={d} style={{
                width: COL_W, flexShrink: 0, height: HEAD_H,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 600, letterSpacing: '0.05em',
                color: '#005365', textTransform: 'uppercase',
                borderBottom: '1.5px solid #DDE6E8',
                background: '#F5F9FA',
              }}>
                {d}
              </div>
            ))}
          </div>

          {weeks.map(({ weekNum, days }) => {
            const isCurrentWeek = showTodayHighlight && days.some(d => isSameDay(d, today))
            return (
              <div key={weekNum} style={{ display: 'flex', borderBottom: '0.5px solid #DDE6E8' }}>
                <div style={{
                  width: WEEK_COL_W, flexShrink: 0, height: ROW_H,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isCurrentWeek ? '#003539' : '#F5F9FA',
                  borderRight: '0.5px solid #DDE6E8',
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: isCurrentWeek ? 'rgba(255,255,255,0.55)' : '#7A9499' }}>
                      WK
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.1, color: isCurrentWeek ? '#fff' : '#005365' }}>
                      {weekNum}
                    </div>
                  </div>
                </div>

                {days.map((day, i) => {
                  const isToday = showTodayHighlight && isSameDay(day, today)
                  const inMonth = day.getMonth() === end.getMonth()
                  return (
                    <div key={i} style={{
                      width: COL_W, flexShrink: 0, height: ROW_H,
                      borderRight: i < 6 ? '0.5px solid #DDE6E8' : 'none',
                      background: isToday ? '#EEF6F8' : '#fff',
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'flex-start', justifyContent: 'flex-start',
                      padding: '6px 8px', position: 'relative',
                    }}>
                      {isToday && (
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: '#005365' }} />
                      )}
                      <span style={{
                        fontSize: 12,
                        fontWeight: isToday ? 700 : 400,
                        color: isToday ? '#005365' : (inMonth ? '#1A2B2E' : '#9BB3B8'),
                        lineHeight: 1,
                      }}>
                        {day.getDate()}
                      </span>
                      {day.getDate() === 1 && (
                        <span style={{ fontSize: 9, color: '#7A9499', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {MONTHS_SHORT[day.getMonth()]}
                        </span>
                      )}
                      {isToday && (
                        <span style={{ fontSize: 8, color: '#005365', marginTop: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Today
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {showLegend && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, background: '#003539', borderRadius: 2 }} />
            <span style={{ fontSize: 11, color: '#4A6568', fontFamily: 'Inter, sans-serif' }}>Current week</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, background: '#EEF6F8', border: '0.5px solid #DDE6E8', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: '#005365' }} />
            </div>
            <span style={{ fontSize: 11, color: '#4A6568', fontFamily: 'Inter, sans-serif' }}>Today</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── MACC Schedule panel ───────────────────────────────────────────────────────
// Image lives at a fixed path in Supabase Storage (overwritten each week via Admin Tools).
// Cache-buster appended so the browser always fetches the latest version.
const MACC_IMAGE_URL =
  'https://vmsiaijeymiepnkkdawm.supabase.co/storage/v1/object/public/MACC%20schedule/current.jpg'

function MaccSchedule() {
  const [lightbox, setLightbox] = useState(false)
  const src = `${MACC_IMAGE_URL}?t=${Math.floor(Date.now() / 60000)}`

  return (
    <div style={{ position: 'sticky', top: 64 }}>
      <p style={{ fontSize: 11, color: '#7A9499', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px', fontFamily: 'Inter, sans-serif' }}>
        This Week
      </p>
      <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 500, color: '#003539', margin: '0 0 12px' }}>
        MACC Room of Our Dreams
      </h2>

      {/* Clickable thumbnail */}
      <div
        onClick={() => setLightbox(true)}
        style={{ cursor: 'zoom-in', position: 'relative', borderRadius: 8, overflow: 'hidden' }}
        title="Click to expand"
      >
        <img
          src={src}
          alt="MACC Room of Our Dreams — Live Dialer Schedule"
          style={{ width: '100%', borderRadius: 8, border: '0.5px solid #DDE6E8', display: 'block' }}
          onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }}
        />
        {/* Expand hint badge */}
        <div style={{
          position: 'absolute', bottom: 8, right: 8,
          background: 'rgba(0,53,57,0.75)', borderRadius: 6,
          padding: '3px 7px', display: 'flex', alignItems: 'center', gap: 4,
          backdropFilter: 'blur(4px)',
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
          <span style={{ fontSize: 10, color: '#fff', fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>Expand</span>
        </div>
        <div style={{
          display: 'none', border: '1.5px dashed #C5D8DC', borderRadius: 8,
          background: '#F5F9FA', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '48px 24px', textAlign: 'center', gap: 10,
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9BB3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <p style={{ fontSize: 13, color: '#4A6568', margin: 0, fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
            No schedule uploaded yet. Upload via Admin Tools → MACC Schedule.
          </p>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <a
          href="https://us02web.zoom.us/j/3580944678?pwd=bjVqVmJZMS9LaDJSMEFidkI4NWozQT09"
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 13, color: '#EE2666', fontFamily: 'Inter, sans-serif', textDecoration: 'none', fontWeight: 500 }}
        >
          Join the MACC Room →
        </a>
        <p style={{ fontSize: 12, color: '#7A9499', margin: '6px 0 0', fontFamily: 'Inter, sans-serif', lineHeight: 1.7 }}>
          Meeting ID: 358 094 4678<br />
          Passcode: grit
        </p>
      </div>

      {/* Lightbox overlay — portalled to body so it clears all column stacking contexts */}
      {lightbox && createPortal(
        <div
          onClick={() => setLightbox(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24, cursor: 'zoom-out',
          }}
        >
          <img
            src={src}
            alt="MACC Room of Our Dreams — Live Dialer Schedule"
            style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 10, boxShadow: '0 32px 80px rgba(0,0,0,0.6)', display: 'block' }}
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(false)}
            style={{
              position: 'fixed', top: 20, right: 24,
              background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%',
              width: 36, height: 36, cursor: 'pointer', color: '#fff',
              fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'blur(4px)',
            }}
          >✕</button>
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Rules bullets ─────────────────────────────────────────────────────────────

const BULLETS = [
  'Slingshot requires a submitted policy in at least 3 of 4 business weeks (or 4 of 5 in a 5-week month).',
  'All other promotion metrics are based on issued business — issue dates follow the calendar month (1st through last day).',
  'This means that some instant-issue business may "submit" in one month but issue in the previous month.',
  'Leaderboards use Symmetry business weeks and months.',
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const today = new Date()
  const currentMonth = getBusinessMonth(today)
  const nextMonth    = getNextBusinessMonth(currentMonth)

  return (
    <PublicLayout>
      <div style={{ background: '#fff', minHeight: 'calc(100vh - 52px)', padding: '36px 28px 60px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>

          {/* Two-column layout */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'start' }}>

            {/* Left — MACC dialer schedule */}
            <MaccSchedule />

            {/* Right — business calendars + rules */}
            <div>
              <p style={{ fontSize: 11, color: '#7A9499', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 20px', fontFamily: 'Inter, sans-serif' }}>
                Business Months
              </p>
              <ul style={{ margin: '0 0 28px', padding: '0 0 0 18px', listStyle: 'disc' }}>
                {BULLETS.map((b, i) => (
                  <li key={i} style={{ fontSize: 13, color: '#4A6568', fontFamily: 'Inter, sans-serif', lineHeight: 1.6, marginBottom: i < BULLETS.length - 1 ? 6 : 0 }}>
                    {b}
                  </li>
                ))}
              </ul>
              <BusinessCalendar bMonth={currentMonth} today={today} showTodayHighlight={true}  showLegend={true} />
              <BusinessCalendar bMonth={nextMonth}    today={today} showTodayHighlight={false} showLegend={false} />
            </div>

          </div>

        </div>
      </div>
    </PublicLayout>
  )
}
