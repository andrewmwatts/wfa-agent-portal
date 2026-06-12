import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkOnly, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

// Precache all build output (manifest injected by VitePWA at build time)
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

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
    self.registration.showNotification(data.title ?? 'New Lead', {
      body:  data.body  ?? 'A new lead has been assigned to you.',
      icon:  '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      data:  { url: data.url ?? '/leads' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find(c => c.url.includes(self.location.origin))
      if (existing) return existing.focus()
      return clients.openWindow(event.notification.data.url)
    })
  )
})
