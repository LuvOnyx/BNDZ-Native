<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { createEditor, type Tool } from '@open-pencil/core/editor'
import { provideEditor, CanvasRoot, CanvasSurface } from '@open-pencil/vue'

const TOOL_MAP: Record<string, Tool> = {
  select: 'SELECT',
  move: 'SELECT',
  frame: 'FRAME',
  rect: 'RECTANGLE',
  rectangle: 'RECTANGLE',
  ellipse: 'ELLIPSE',
  line: 'LINE',
  arrow: 'LINE',
  polygon: 'POLYGON',
  star: 'STAR',
  text: 'TEXT',
  pen: 'PEN',
  pencil: 'PEN',
  hand: 'HAND',
  zoom: 'HAND',
}

type SolidPaint = {
  type: 'SOLID'
  visible: boolean
  opacity: number
  color: { r: number; g: number; b: number; a: number }
}

function hexToRgb01(hex: string): { r: number; g: number; b: number; a: number } | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex || '').trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
    a: 1,
  }
}

function solidPaint(hex: string, opacity = 1): SolidPaint | null {
  const color = hexToRgb01(hex)
  if (!color) return null
  return { type: 'SOLID', visible: true, opacity, color }
}

const editor = createEditor()
provideEditor(editor)

editor.createShape('FRAME', 80, 80, 960, 640)
editor.zoomToFit()

const ready = ref(false)
const status = ref('booting')
const paintDefaults = ref<{ fill: string; stroke: string; strokeWidth: number }>({
  fill: '#D9D9D9',
  stroke: '#FFFFFF',
  strokeWidth: 2,
})

function postParent(msg: Record<string, unknown>) {
  try {
    window.parent?.postMessage({ source: 'bndz-openpencil', ...msg }, '*')
  } catch { /* ignore */ }
}

function applyStyleToSelection(opts: { fill?: string; stroke?: string; strokeWidth?: number }) {
  if (opts.fill) paintDefaults.value.fill = opts.fill
  if (opts.stroke) paintDefaults.value.stroke = opts.stroke
  if (typeof opts.strokeWidth === 'number' && Number.isFinite(opts.strokeWidth)) {
    paintDefaults.value.strokeWidth = Math.max(0, opts.strokeWidth)
  }

  const ids = [...(editor.state.selectedIds || [])]
  if (!ids.length) return

  const fillPaint = opts.fill ? solidPaint(opts.fill) : null
  const strokePaint = opts.stroke ? solidPaint(opts.stroke) : null
  const weight = paintDefaults.value.strokeWidth

  for (const id of ids) {
    const node = (editor as any).graph?.get?.(id) || (editor as any).getNode?.(id)
    if (!node) continue
    const changes: Record<string, unknown> = {}
    if (fillPaint) {
      const fills = Array.isArray(node.fills) && node.fills.length
        ? node.fills.map((f: any, i: number) => (i === 0 ? { ...f, ...fillPaint } : f))
        : [fillPaint]
      changes.fills = fills
    }
    if (strokePaint || typeof opts.strokeWidth === 'number') {
      const baseStroke = strokePaint || solidPaint(paintDefaults.value.stroke)
      if (baseStroke) {
        const strokes = Array.isArray(node.strokes) && node.strokes.length
          ? node.strokes.map((s: any, i: number) => (
              i === 0
                ? { ...s, ...baseStroke, strokeWeight: weight, weight }
                : s
            ))
          : [{ ...baseStroke, strokeWeight: weight, weight }]
        changes.strokes = strokes
      }
      if (typeof weight === 'number') {
        changes.strokeWeight = weight
      }
    }
    if (Object.keys(changes).length) {
      try {
        editor.updateNodeWithUndo(id, changes as any, 'Inspector style')
      } catch {
        try { editor.updateNode(id, changes as any) } catch { /* ignore */ }
      }
    }
  }
  try { (editor as any).requestRender?.() } catch { /* ignore */ }
}

function onHostMessage(ev: MessageEvent) {
  const d = ev.data
  if (!d || d.source !== 'bndz-host') return
  if (d.type === 'setTool') {
    const t = TOOL_MAP[String(d.tool || '').toLowerCase()]
    if (t) editor.setActiveTool(t)
    status.value = `tool:${t || d.tool}`
    return
  }
  if (d.type === 'setStyle') {
    applyStyleToSelection({
      fill: typeof d.fill === 'string' ? d.fill : undefined,
      stroke: typeof d.stroke === 'string' ? d.stroke : undefined,
      strokeWidth: typeof d.strokeWidth === 'number' ? d.strokeWidth : undefined,
    })
    status.value = 'style'
    return
  }
  if (d.type === 'undo') {
    try { (editor as any).undo?.() } catch { /* ignore */ }
    return
  }
  if (d.type === 'redo') {
    try { (editor as any).redo?.() } catch { /* ignore */ }
    return
  }
  if (d.type === 'exportPng') {
    void exportPng()
    return
  }
  if (d.type === 'keydown' || d.type === 'keyup') {
    window.dispatchEvent(new KeyboardEvent(d.type, {
      key: d.key,
      code: d.code,
      ctrlKey: !!d.ctrlKey,
      metaKey: !!d.metaKey,
      shiftKey: !!d.shiftKey,
      altKey: !!d.altKey,
      bubbles: true,
    }))
  }
}

async function exportPng() {
  try {
    const canvas = document.querySelector('canvas')
    if (!canvas) throw new Error('No canvas')
    const dataUrl = (canvas as HTMLCanvasElement).toDataURL('image/png')
    postParent({ type: 'exported', format: 'png', dataUrl })
  } catch (err) {
    postParent({ type: 'error', message: String((err as Error)?.message || err) })
  }
}

onMounted(() => {
  window.addEventListener('message', onHostMessage)
  ready.value = true
  status.value = 'ready'
  postParent({ type: 'ready', tools: Object.keys(TOOL_MAP) })
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onHostMessage)
})
</script>

<template>
  <div class="engine-root" :data-ready="ready">
    <CanvasRoot class="canvas-root">
      <CanvasSurface class="canvas-surface" />
    </CanvasRoot>
    <div class="engine-status">{{ status }} · OpenPencil</div>
  </div>
</template>

<style>
.engine-root {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1e1e1e;
}
.canvas-root {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  height: 100%;
}
.canvas-surface {
  width: 100% !important;
  height: 100% !important;
  display: block;
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
