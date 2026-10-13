import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      outDir: 'BNDZBackend/Assets/ui',
      emptyOutDir: true,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        onwarn(warning, warn) {
          if (warning.message?.includes('dynamic import will not move module into another chunk')) return;
          warn(warning);
        },
        output: {
          manualChunks(id) {
            // Shared runtime pieces get their own chunk. Without this Rollup parks them inside
            // whichever manual chunk claims them first (e.g. syntax / xyflow), and the startup
            // bundle then has to preload that whole library just to reach a 1 KB helper.
            if (
              id.includes('vite/preload-helper') ||
              id.includes('commonjsHelpers') ||
              id.includes('node_modules/@babel/runtime') ||
              id.includes('node_modules/use-sync-external-store') ||
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/scheduler/')
            ) {
              return 'vendor';
            }
            if (id.includes('node_modules/framer-motion') || id.includes('node_modules/motion')) {
              return 'motion';
            }
            if (id.includes('node_modules/pdfjs-dist')) {
              return 'pdf';
            }
            if (id.includes('node_modules/mammoth')) {
              return 'docx';
            }
            if (
              id.includes('node_modules/react-markdown') ||
              id.includes('node_modules/remark') ||
              id.includes('node_modules/rehype') ||
              id.includes('node_modules/micromark')
            ) {
              return 'markdown';
            }
            if (id.includes('node_modules/react-syntax-highlighter')) {
              return 'syntax';
            }
            if (id.includes('node_modules/recharts')) {
              return 'charts';
            }
            if (id.includes('node_modules/@tanstack/react-virtual')) {
              return 'virtual';
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'icons';
            }
            if (id.includes('node_modules/monaco-editor') || id.includes('node_modules/@monaco-editor')) {
              return 'monaco';
            }
            if (id.includes('node_modules/wavesurfer')) {
              return 'wavesurfer';
            }
            if (id.includes('node_modules/@xyflow')) {
              return 'xyflow';
            }
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
