import { resolve } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
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
      buildStart() {
        // @open-pencil/core 0.14.0 ships compiled JS that still references its
        // TypeScript source names (./export-worker.ts, kiwi/fig/parse/worker.ts)
        // while dist only carries the .js files. Twin every dist .js to its .ts
        // name so Rollup can resolve those entries.
        const dist = resolve(__dirname, 'node_modules/@open-pencil/core/dist')
        const walk = (dir) => {
          for (const name of readdirSync(dir)) {
            const p = resolve(dir, name)
            if (statSync(p).isDirectory()) walk(p)
            else if (name.endsWith('.js')) {
              const twin = p.slice(0, -3) + '.ts'
              if (!existsSync(twin)) copyFileSync(p, twin)
            }
          }
        }
        if (existsSync(dist)) walk(dist)
      },
      resolveId(id, importer) {
        if (
          id.includes('kiwi/fig/parse/worker')
          || id.endsWith('fig/parse/worker.ts')
          || id.endsWith('fig/parse/worker')
          || id.endsWith('fig/export-worker.ts')
        ) {
          return '\0bndz-stub-fig-worker'
        }
        // Absolute-ish resolves from published package.
        // Windows hands us backslash paths -- normalize before matching.
        const from = (importer || '').replace(/\\/g, '/')
        if (from && id.includes('worker') && from.includes('formats/fig')) {
          return '\0bndz-stub-fig-worker'
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
