import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envPrefix: 'SIRIS_CLIENT_',
  server: {
    host: '127.0.0.1', port: 3000, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true } },
  },
  test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.js'] },
});
