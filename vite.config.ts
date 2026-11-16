import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// SINGLE=1 gera um único index.html autocontido (abre com duplo clique, sem servidor)
const single = process.env.SINGLE === '1'

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(single ? [viteSingleFile()] : [])],
  base: './',
  server: { host: true, port: 5173 },
  build: { chunkSizeWarningLimit: 2000, outDir: single ? 'dist-single' : 'dist' },
})
