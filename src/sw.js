import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkOnly, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

// Precache all build output (manifest injected by VitePWA at build time)
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// injectManifest mode doesn't wire this up automatically (unlike generateSW) —
// without it, the "Update" button's updateServiceWorker(true) call has nothing
// to skip waiting, so the new SW never activates and the page never reloads.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// Never cache API calls
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkOnly()
)

// Supabase REST — network first, fall back to cache for offline reads
registerRoute(
  ({ url }) => url.hostname.includes('.supabase.co'),
  new NetworkFirst({
    cacheName: 'supabase-cache',
    networkTimeoutSeconds: 10,
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 300 }),
    ],
  })
)

// ── Push notifications ────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title ?? 'New Lead', {
        body:  data.body  ?? 'A new lead has been assigned to you.',
        icon:  '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        data:  { url: data.url ?? '/portal/leads' },
      })
      // App icon badge — Android Chrome and desktop Chrome/Edge only (no iOS/Firefox support)
      if ('setAppBadge' in navigator) {
        try {
          const active = await self.registration.getNotifications()
          await navigator.setAppBadge(active.length)
        } catch { /* ignore — badging not available */ }
      }
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      if ('setAppBadge' in navigator) {
        try {
          const remaining = await self.registration.getNotifications()
          if (remaining.length) await navigator.setAppBadge(remaining.length)
          else await navigator.clearAppBadge()
        } catch { /* ignore — badging not available */ }
      }
      const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = clientList.find(c => c.url.includes(self.location.origin))
      if (existing) return existing.focus()
      return clients.openWindow(event.notification.data.url)
    })()
  )
})
