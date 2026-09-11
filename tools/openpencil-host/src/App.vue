<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { createEditor } from '@open-pencil/core/editor'
import { provideEditor, CanvasRoot, CanvasSurface } from '@open-pencil/vue'
import EngineInputBridge from './EngineInputBridge.vue'
import { TOOL_MAP, createHostApi, type HostApi } from './hostApi'

const props = defineProps<{
  inlineHost?: boolean
  onHostEvent?: (msg: Record<string, unknown>) => void
  onApiReady?: (api: HostApi) => void
  onBootError?: (message: string) => void
}>()

const editor = createEditor({
  getViewportSize: () => {
    const el = document.querySelector('.engine-root') as HTMLElement | null
    const w = el?.clientWidth || window.innerWidth || 960
    const h = el?.clientHeight || window.innerHeight || 640
    return { width: Math.max(64, w), height: Math.max(64, h) }
  },
})
provideEditor(editor)

const ready = ref(false)
const status = ref('booting')
const paintDefaults = ref({ fill: '#D9D9D9', stroke: '#FFFFFF', strokeWidth: 2 })

function emitHost(msg: Record<string, unknown>) {
  const payload = { source: 'bndz-openpencil', ...msg }
  props.onHostEvent?.(payload)
  if (!props.inlineHost) {
    try { window.parent?.postMessage(payload, '*') } catch { /* ignore */ }
  } else {
    try { window.dispatchEvent(new CustomEvent('bndz-openpencil', { detail: payload })) } catch { /* ignore */ }
  }
}

const hostApi = createHostApi(editor, paintDefaults, ready, emitHost, (s) => { status.value = s })

function onHostMessage(ev: MessageEvent) {
  hostApi.handle(ev.data as Record<string, unknown>)
}

async function waitForCanvas(ms = 12000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const c = document.querySelector('.engine-root canvas') as HTMLCanvasElement | null
    if (c && c.width > 8 && c.height > 8) return c
    await new Promise((r) => setTimeout(r, 40))
  }
  return null
}

let resizeObs: ResizeObserver | null = null

onMounted(async () => {
  if (!props.inlineHost) window.addEventListener('message', onHostMessage)
  await nextTick()

  const root = document.querySelector('.engine-root')
  if (root && typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(() => {
      try { (editor as any).requestRender?.() } catch { /* ignore */ }
      try { (editor as any).requestRepaint?.() } catch { /* ignore */ }
    })
    resizeObs.observe(root)
  }

  const canvas = await waitForCanvas()
  if (!canvas) {
    status.value = 'canvas-timeout'
    emitHost({ type: 'error', message: 'OpenPencil canvas failed to initialize' })
    emitHost({ type: 'ready', tools: Object.keys(TOOL_MAP), degraded: true })
    ready.value = true
    props.onBootError?.('OpenPencil canvas failed to initialize')
    return
  }

  try {
    editor.createShape('FRAME', 80, 80, 960, 640)
    editor.zoomToFit()
  } catch { /* ignore */ }

  ready.value = true
  status.value = 'ready'
  props.onApiReady?.(hostApi)
  emitHost({ type: 'ready', tools: Object.keys(TOOL_MAP), degraded: false })
})

onBeforeUnmount(() => {
  if (!props.inlineHost) window.removeEventListener('message', onHostMessage)
  if (props.inlineHost) delete (window as any).__BNDZ_OP_ENGINE__
  resizeObs?.disconnect()
  resizeObs = null
})
</script>

<template>
  <div class="engine-root" :data-ready="ready">
    <CanvasRoot class="canvas-root" :show-rulers="false">
      <CanvasSurface class="canvas-surface" tabindex="0" />
      <EngineInputBridge />
    </CanvasRoot>
    <div class="engine-status">{{ status }} · OpenPencil</div>
  </div>
</template>

<style>
html, body, #app, .bndz-op-inline-root {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1e1e1e;
}
.engine-root {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1e1e1e;
  touch-action: none;
}
.canvas-root {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  height: 100%;
  position: relative;
}
.canvas-surface,
.canvas-root canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
  touch-action: none;
  cursor: crosshair;
}
.engine-status {
  position: absolute;
  left: 10px;
  bottom: 8px;
  z-index: 2;
  font: 11px/1.2 ui-sans-serif, system-ui, sans-serif;
  color: rgba(255, 255, 255, 0.45);
  pointer-events: none;
}
</style>
