import { resolve } from 'node:path'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: './',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
    global: 'globalThis',
  },
  plugins: [
    {
      name: 'stub-openpencil-fig-worker',
      enforce: 'pre',
      resolveId(id, importer) {
        if (
          id.includes('kiwi/fig/parse/worker')
          || id.endsWith('fig/parse/worker.ts')
          || id.endsWith('fig/parse/worker')
        ) {
          return '\0bndz-stub-fig-worker'
        }
        // Absolute-ish resolves from published package
        if (importer && id.includes('worker') && importer.includes('formats/fig')) {
          if (id.includes('worker')) return '\0bndz-stub-fig-worker'
        }
        return null
      },
      load(id) {
        if (id === '\0bndz-stub-fig-worker') {
          return 'export default function FigWorker() {}\nexport const workerUrl = "";\n'
        }
        return null
      },
    },
    {
      name: 'copy-canvaskit-wasm',
      closeBundle() {
        const candidates = [
          resolve(__dirname, 'node_modules/canvaskit-wasm/bin/canvaskit.wasm'),
          resolve(__dirname, 'node_modules/@open-pencil/core/node_modules/canvaskit-wasm/bin/canvaskit.wasm'),
          resolve(__dirname, '../../node_modules/canvaskit-wasm/bin/canvaskit.wasm'),
        ]
        const destDir = resolve(__dirname, '../../public/editors/engines/openpencil')
        mkdirSync(destDir, { recursive: true })
        for (const src of candidates) {
          if (existsSync(src)) {
            copyFileSync(src, resolve(destDir, 'canvaskit.wasm'))
            break
          }
        }
      },
    },
    vue(),
  ],
  optimizeDeps: {
    exclude: ['canvaskit-wasm'],
  },
  build: {
    target: 'esnext',
    outDir: resolve(__dirname, '../../public/editors/engines/openpencil'),
    emptyOutDir: true,
    assetsDir: 'assets',
    commonjsOptions: { transformMixedEsModules: true },
  },
  server: { port: 3334 },
})
