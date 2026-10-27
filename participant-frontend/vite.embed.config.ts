import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  esbuild: { charset: 'ascii' },
  build: {
    outDir: 'dist/embed',
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: 'src/embed/eye.tsx',
      name: 'EmotioxEyeBundle',
      formats: ['iife'],
      fileName: () => 'eye.js',
    },
  },
})
