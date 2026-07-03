import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

/** Builds BNDZ Launcher WebView2 shell UI into the standalone host package */
export default defineConfig({
  root: path.resolve(__dirname, '../../src/launcher'),
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'BNDZ.Launcher.Host/Assets/launcher-ui'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.message?.includes('dynamic import will not move module into another chunk')) return;
        warn(warning);
      },
    },
  },
  resolve: {
    alias: {
      '@launcher': path.resolve(__dirname, '../../src/launcher'),
    },
  },
});
