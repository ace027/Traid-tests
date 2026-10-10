import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
