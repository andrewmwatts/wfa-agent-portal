import { useViewing } from '../context/ViewingContext'

export default function AccountabilityPage() {
  const { permissions } = useViewing()
  if (!permissions.accountability.read) return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      <p className="text-sm text-red-500">You don't have access to this section.</p>
    </main>
  )
  return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Accountability</h1>
      <p className="text-sm text-gray-400 dark:text-white/40">Coming soon.</p>
    </main>
  )
}
