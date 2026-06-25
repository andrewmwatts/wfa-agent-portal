import { CHIPS } from './publicConstants'

export default function ChipRow({ activeSeries, onSelect }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
      <span style={{
        fontSize: 11, color: '#7A9499', textTransform: 'uppercase',
        letterSpacing: '0.06em', fontFamily: 'Inter, sans-serif', flexShrink: 0,
      }}>
        Series
      </span>
      {CHIPS.map(({ label, slug }) => {
        const active = slug === activeSeries
        return (
          <button key={label} onClick={() => onSelect(slug)}
            style={{
              fontSize: 12, padding: '5px 12px', borderRadius: 99,
              border: 'none', cursor: 'pointer',
              background: active ? '#005365' : '#EEF1F2',
              color: active ? '#fff' : '#4A6568',
              fontFamily: 'Inter, sans-serif',
              transition: 'background 0.15s, color 0.15s',
            }}>
            {label}
          </button>
        )
      })}
    </div>
  )
}
