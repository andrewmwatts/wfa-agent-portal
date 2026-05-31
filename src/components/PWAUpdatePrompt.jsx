import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Slim banner that appears at the bottom of the screen when a new version
 * of the app has been downloaded and is waiting to activate.
 *
 * Uses `registerType: 'prompt'` so the user chooses when to reload, rather
 * than the app refreshing under them unexpectedly.
 */
export default function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      // Silently check for updates every 60 minutes
      if (r) setInterval(() => r.update(), 60 * 60 * 1000)
    },
  })

  if (!needRefresh) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border bg-white dark:bg-primary border-primary/15 dark:border-white/10 text-sm max-w-sm w-[calc(100vw-2rem)]">
      <span className="text-lg shrink-0">🔄</span>
      <p className="flex-1 text-gray-700 dark:text-white/80 font-medium leading-snug">
        A new version is available
      </p>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={() => setNeedRefresh(false)}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/15 text-gray-500 dark:text-white/50 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
        >
          Later
        </button>
        <button
          onClick={() => updateServiceWorker(true)}
          className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 transition-colors"
        >
          Update
        </button>
      </div>
    </div>
  )
}
