import { defineConfig } from 'vite';

export default defineConfig({
  root: 'app',
  publicDir: 'public',
  base: './',
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: ['.manus.computer'],
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 650,
  },
});
