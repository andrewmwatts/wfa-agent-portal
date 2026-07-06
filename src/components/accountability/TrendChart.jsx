import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { toYMD } from './utils/accountabilityCalc'

const DAY_ABB = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const SERIES = [
  { key: 'dials',     rawKey: 'dials_raw',     name: 'Dials',     color: '#2a78d6' },
  { key: 'contacts',  rawKey: 'contacts_raw',  name: 'Contacts',  color: '#1baf7a' },
  { key: 'appts_run', rawKey: 'appts_run_raw', name: 'Appts run', color: '#eda100' },
]

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      fontSize: 11, borderRadius: 6,
      border: '0.5px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      padding: '4px 8px', background: 'white',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 2, color: '#374151' }}>{label}</div>
      {SERIES.map(({ rawKey, name, color }) => {
        const entry = payload.find(p => p.dataKey === rawKey.replace('_raw', ''))
        if (!entry) return null
        return (
          <div key={rawKey} style={{ color, lineHeight: 1.6 }}>
            {name}: {entry.payload[rawKey] ?? 0}
          </div>
        )
      })}
    </div>
  )
}

export default function TrendChart({ data, days }) {
  const { chartData, maxVals } = useMemo(() => {
    const raw = days.map(date => {
      const ymd = toYMD(date)
      const row = data.find(r => r.date === ymd) ?? {}
      return {
        label:        DAY_ABB[date.getDay()],
        dials_raw:    Number(row.dials)     || 0,
        contacts_raw: Number(row.contacts)  || 0,
        appts_run_raw: Number(row.appts_run) || 0,
      }
    })

    const maxVals = {
      dials:     Math.max(...raw.map(r => r.dials_raw),     1),
      contacts:  Math.max(...raw.map(r => r.contacts_raw),  1),
      appts_run: Math.max(...raw.map(r => r.appts_run_raw), 1),
    }

    const chartData = raw.map(r => ({
      label:        r.label,
      dials_raw:    r.dials_raw,
      contacts_raw: r.contacts_raw,
      appts_run_raw: r.appts_run_raw,
      // Normalized 0-100 for display
      dials:        Math.round((r.dials_raw     / maxVals.dials)     * 100),
      contacts:     Math.round((r.contacts_raw  / maxVals.contacts)  * 100),
      appts_run:    Math.round((r.appts_run_raw / maxVals.appts_run) * 100),
    }))

    return { chartData, maxVals }
  }, [data, days])

  return (
    <div role="img" aria-label="7-day activity trend showing dials, contacts, and appointments run">
      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            width={32}
            domain={[0, 100]}
            tickFormatter={v => `${v}%`}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(0,0,0,0.07)', strokeWidth: 1 }} />
          {SERIES.map(({ key, color }) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-1 pl-1">
        {SERIES.map(({ key, name, color }) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 rounded" style={{ background: color }} />
            <span className="text-[9px] text-gray-400 dark:text-gray-500">
              {name} (max: {maxVals[key]})
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
