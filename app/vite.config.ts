import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = resolve(__dirname, 'src/renderer');

export default defineConfig({
  root,
  base: './',
  publicDir: resolve(root, 'public'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': root,
    },
  },
  server: { port: 5317, strictPort: true },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(root, 'main.html'),
        island: resolve(root, 'island.html'),
        leafy: resolve(root, 'leafy.html'),
        palette: resolve(root, 'palette.html'),
        engine: resolve(root, 'engine.html'),
      },
    },
  },
});
