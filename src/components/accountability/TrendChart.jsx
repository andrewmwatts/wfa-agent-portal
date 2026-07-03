import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { toYMD } from './utils/accountabilityCalc'

const DAY_ABB = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const SERIES = [
  { key: 'dials',     name: 'Dials',     color: '#2a78d6' },
  { key: 'contacts',  name: 'Contacts',  color: '#1baf7a' },
  { key: 'appts_run', name: 'Appts run', color: '#eda100' },
]

export default function TrendChart({ data, days }) {
  const chartData = useMemo(() => days.map(date => {
    const ymd = toYMD(date)
    const row = data.find(r => r.date === ymd) ?? {}
    return {
      label:     DAY_ABB[date.getDay()],
      dials:     Number(row.dials)     || 0,
      contacts:  Number(row.contacts)  || 0,
      appts_run: Number(row.appts_run) || 0,
    }
  }), [data, days])

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
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              fontSize: 11, borderRadius: 6,
              border: '0.5px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              padding: '4px 8px',
            }}
            itemStyle={{ padding: '1px 0', lineHeight: 1.4 }}
            cursor={{ stroke: 'rgba(0,0,0,0.07)', strokeWidth: 1 }}
          />
          {SERIES.map(({ key, name, color }) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={name}
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
            <span className="text-[9px] text-gray-400 dark:text-gray-500">{name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
