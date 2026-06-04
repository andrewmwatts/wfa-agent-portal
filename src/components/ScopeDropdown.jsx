import { useTheme } from '../context/ThemeContext'
import { buildOwnersList } from '../utils/agencyScope'

/**
 * ScopeDropdown
 * Master Agency / individual-baseshop selector used on director+ pages.
 *
 * Props:
 *   masterPersonnel — full master-agency personnel array
 *   selfId          — activeSubject.sfg_id (the logged-in / viewed-as user)
 *   value           — current selectedScope ('master' | sfg_id)
 *   onChange        — called with the new scope string (not a synthetic event)
 */
export default function ScopeDropdown({ masterPersonnel, selfId, value, onChange }) {
  const { theme } = useTheme()
  const optionStyle = theme === 'dark' ? { background: '#003539', color: '#fff' } : {}
  const owners = buildOwnersList(masterPersonnel, selfId)

  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-xs bg-gray-100 border border-gray-300 text-gray-900 dark:bg-white/10 dark:border-white/20 dark:text-white rounded-lg px-2.5 py-1 focus:outline-none focus:border-accent cursor-pointer"
    >
      <option value="master" style={optionStyle}>Master Agency</option>
      {owners.map(o => (
        <option key={o.sfg_id} value={o.sfg_id} style={optionStyle}>{o.name}</option>
      ))}
    </select>
  )
}
