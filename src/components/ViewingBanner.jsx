import { useViewing } from '../context/ViewingContext'
import { useTheme } from '../context/ThemeContext'

export default function ViewingBanner() {
  const { subjects, activeIdx, isSelf, activeSubject, setActiveSubject } = useViewing()
  const { theme } = useTheme()

  // Hide when there's only one subject and it's self
  if (subjects.length <= 1 && isSelf) return null

  const optionStyle = theme === 'dark'
    ? { background: '#003539', color: '#fff' }
    : {}

  return (
    <div className="bg-primary/5 border-b border-primary/10 dark:bg-primary/50 dark:border-white/10 px-6 py-2 flex items-center gap-3">
      <span className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40">
        Viewing as
      </span>
      {subjects.length > 1 ? (
        <select
          value={activeIdx}
          onChange={e => setActiveSubject(Number(e.target.value))}
          className="bg-white text-gray-900 text-sm font-medium border border-gray-300 dark:bg-primary dark:text-white dark:border-white/20 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-accent/60 cursor-pointer"
        >
          {subjects.map((s, i) => (
            <option key={s.profile.id} value={i} style={optionStyle}>
              {s.isSelf ? `${s.profile.full_name} (you)` : s.profile.full_name}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-sm font-medium text-gray-900 dark:text-white">{activeSubject?.full_name}</span>
      )}
    </div>
  )
}
