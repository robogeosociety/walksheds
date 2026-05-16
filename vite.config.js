import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  base: '/',
  plugins: [react(), basicSsl()],
  server: {
    port: 5187,
    strictPort: true,
    host: true,
    allowedHosts: ['.local'],
  },
})
