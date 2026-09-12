import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { VitePWA } from 'vite-plugin-pwa'

const tailwindConfig = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'rgb(var(--color-primary) / <alpha-value>)',
          light:   'rgb(var(--color-primary-light) / <alpha-value>)',
          dark:    'rgb(var(--color-primary-dark) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'rgb(var(--color-secondary) / <alpha-value>)',
          light:   'rgb(var(--color-secondary-light) / <alpha-value>)',
          dark:    'rgb(var(--color-secondary-dark) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          light:   'rgb(var(--color-accent-light) / <alpha-value>)',
          dark:    'rgb(var(--color-accent-dark) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',   // show our own update prompt rather than auto-refreshing
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      includeAssets: [
        'favicon.ico',
        'icon.svg',
        'apple-touch-icon-180x180.png',
      ],
      manifest: {
        name:             'WFA Agent Portal',
        short_name:       'WFA Portal',
        description:      'Watts Family Agency Agent Portal',
        // Neutral rather than WFA's own teal — this is the OS-level
        // installed-app identity (title bar, splash screen), shared by every
        // agency's users alike, so it shouldn't read as "belonging" to WFA
        // specifically for someone whose in-app branding is a different
        // palette entirely. In-app chrome follows the logged-in agency's own
        // colors dynamically (see AgencyContext.jsx); this can't — it's fixed
        // at PWA-install time — so neutral is the least jarring fixed choice.
        theme_color:      '#1a1a1a',
        background_color: '#1a1a1a',
        display:          'standalone',
        orientation:      'portrait',
        start_url:        '/',
        scope:            '/',
        icons: [
          { src: 'pwa-64x64.png',             sizes: '64x64',   type: 'image/png' },
          { src: 'pwa-192x192.png',           sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png',           sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // Precache all build output
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
  css: {
    postcss: {
      plugins: [
        tailwindcss(tailwindConfig),
        autoprefixer(),
      ],
    },
  },
})
