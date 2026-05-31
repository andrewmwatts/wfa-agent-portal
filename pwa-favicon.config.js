import { defineConfig } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  preset: {
    favicon: {
      sizes: [64],
      resizeOptions: {},
    },
  },
  images: ['public/WFA-Submarks-Combo-05.png'],
})
