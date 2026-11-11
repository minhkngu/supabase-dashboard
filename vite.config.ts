import { defineConfig, type Plugin } from 'vitest/config';

// Vite's SPA fallback answers unknown paths with index.html (200). Refuse
// dotfile paths outright so `.env*` and similar never look served.
const denyDotfiles: Plugin = {
  name: 'siris-deny-dotfiles',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const pathname = decodeURIComponent((req.url || '').split('?')[0]);
      if (pathname.split('/').some(part => part.startsWith('.') && part.length > 1 && part !== '.vite')) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [denyDotfiles],
  envPrefix: 'SIRIS_CLIENT_',
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true } },
  },
  test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.js'] },
});
