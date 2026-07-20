import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'ui',
  // Serve data/ as static assets so the app can fetch /dataset.json directly.
  publicDir: '../data',
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    // scoring-core lives above the Vite root and is imported by the app.
    fs: { allow: ['..'] },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
