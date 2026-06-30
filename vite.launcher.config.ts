import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

/** Builds SuperCmd-derived BNDZ Launcher shell for WebView2 host */
export default defineConfig({
  root: path.resolve(__dirname, 'src/launcher'),
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'BNDZBackend/Assets/launcher-ui'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@launcher': path.resolve(__dirname, 'src/launcher'),
    },
  },
});
