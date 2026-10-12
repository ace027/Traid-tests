import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const target = 'http://localhost:8989';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/feed': { target, changeOrigin: true },
      '/ping': { target, changeOrigin: true },
      '/initialize.json': { target, changeOrigin: true },
    },
  },
});
