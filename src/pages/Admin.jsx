import { useAuth } from '../context/AuthContext'

export default function Admin() {
  const { userProfile, signOut } = useAuth()

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Admin Panel</h2>
      <p className="text-gray-400 dark:text-white/50 text-sm mb-8">Manage agents, owners, and portal settings.</p>

      <div className="space-y-3">
        {['Users & Roles', 'Agency Overview', 'Settings'].map(section => (
          <div key={section} className="bg-white border border-gray-200 dark:bg-primary dark:border-white/10 rounded-2xl px-6 py-5 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">{section}</h3>
              <p className="text-xs text-gray-400 dark:text-white/30 mt-0.5">Coming soon</p>
            </div>
            <span className="text-gray-300 dark:text-white/20 text-xl">›</span>
          </div>
        ))}
      </div>
    </main>
  )
}
