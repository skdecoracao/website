import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build da SPA para dist/ (servido pelo Worker via [assets]).
// dev do front: proxy /api para o worker local (wrangler dev na 8787).
export default defineConfig({
  plugins: [react()],
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
});
