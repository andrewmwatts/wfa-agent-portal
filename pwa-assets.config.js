import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  headLinkOptions: {
    preset: 'default',
  },
  preset: {
    ...minimal2023Preset,
    maskable: {
      sizes: [512],
      // Teal background so maskable icons look right on adaptive icon platforms
      padding: 0.15,
      resizeOptions: { background: '#005365' },
    },
    apple: {
      sizes: [180],
      resizeOptions: { background: '#005365' },
    },
  },
  images: ['public/icon.png'],
})
