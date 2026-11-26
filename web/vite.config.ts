import { defineConfig } from 'vite';

// Entwicklung: API und WebSocket des lokalen Servers durchreichen.
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
