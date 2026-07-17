import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base: served from the /pod/ subfolder on the school domain (cPanel).
// Must match the URL path exactly or the built asset URLs 404.
export default defineConfig({
  base: '/pod/',
  plugins: [react()],
})
