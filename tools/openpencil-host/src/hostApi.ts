import type { Editor, Tool } from '@open-pencil/core/editor'

export const TOOL_MAP: Record<string, Tool> = {
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

type Rgba = { r: number; g: number; b: number; a: number }
type SolidPaint = {
  type: 'SOLID'
  visible: boolean
  opacity: number
  color: Rgba
}

export type HostPayload = Record<string, unknown> & { source?: string; type?: string }

export type HostApi = {
  handle: (payload: HostPayload) => void
  getState: () => { activeTool: Tool; nodeCount: number; ready: boolean }
}

function hexToRgb01(hex: string): Rgba | null {
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

function getNode(editor: Editor, id: string): any | null {
  try {
    return (editor as any).graph?.get?.(id)
      || (editor as any).graph?.nodes?.get?.(id)
      || (editor as any).getNode?.(id)
      || null
  } catch {
    return null
  }
}

export function createHostApi(
  editor: Editor,
  paintDefaults: { value: { fill: string; stroke: string; strokeWidth: number } },
  ready: { value: boolean },
  emit: (msg: Record<string, unknown>) => void,
  onStatus: (s: string) => void,
): HostApi {
  function applyPaintToNode(id: string, opts?: { fill?: string; stroke?: string; strokeWidth?: number }) {
    const node = getNode(editor, id)
    if (!node) return
    const fillHex = opts?.fill ?? paintDefaults.value.fill
    const strokeHex = opts?.stroke ?? paintDefaults.value.stroke
    const weight = typeof opts?.strokeWidth === 'number' && Number.isFinite(opts.strokeWidth)
      ? Math.max(0, opts.strokeWidth)
      : paintDefaults.value.strokeWidth

    const fillPaint = solidPaint(fillHex)
    const strokePaint = solidPaint(strokeHex)
    const changes: Record<string, unknown> = {}
    const type = String(node.type || '')
    const strokeFirst = type === 'LINE' || type === 'VECTOR' || type === 'ARROW'

    if (fillPaint && !strokeFirst) {
      changes.fills = Array.isArray(node.fills) && node.fills.length
        ? node.fills.map((f: any, i: number) => (i === 0 ? { ...f, ...fillPaint } : f))
        : [fillPaint]
    }
    if (strokePaint) {
      const strokeObj = { ...strokePaint, strokeWeight: weight, weight }
      changes.strokes = Array.isArray(node.strokes) && node.strokes.length
        ? node.strokes.map((s: any, i: number) => (i === 0 ? { ...s, ...strokeObj } : s))
        : [strokeObj]
      changes.strokeWeight = weight
    }
    if (!Object.keys(changes).length) return
    try {
      editor.updateNodeWithUndo(id, changes as any, 'Style')
    } catch {
      try { editor.updateNode(id, changes as any) } catch { /* ignore */ }
    }
  }

  wireCreateShapePaint(editor, applyPaintToNode)

  function applyStyleToSelection(opts: { fill?: string; stroke?: string; strokeWidth?: number }) {
    if (opts.fill) paintDefaults.value.fill = opts.fill
    if (opts.stroke) paintDefaults.value.stroke = opts.stroke
    if (typeof opts.strokeWidth === 'number' && Number.isFinite(opts.strokeWidth)) {
      paintDefaults.value.strokeWidth = Math.max(0, opts.strokeWidth)
    }
    const ids = [...(editor.state.selectedIds || [])]
    for (const id of ids) applyPaintToNode(id, opts)
    try { (editor as any).requestRender?.() } catch { /* ignore */ }
    try { (editor as any).requestRepaint?.() } catch { /* ignore */ }
  }

  async function exportPng() {
    try {
      const canvas = document.querySelector('.engine-root canvas') as HTMLCanvasElement | null
      if (!canvas) throw new Error('No canvas')
      const dataUrl = canvas.toDataURL('image/png')
      emit({ type: 'exported', format: 'png', dataUrl })
    } catch (err) {
      emit({ type: 'error', message: String((err as Error)?.message || err) })
    }
  }

  function setActiveTool(t: Tool, key: string) {
    try { editor.setActiveTool(t) } catch { /* ignore */ }
    try { (editor as any).setTool?.(t) } catch { /* ignore */ }
    try { editor.state.activeTool = t } catch { /* ignore */ }
    onStatus(`tool:${t}`)
    emit({ type: 'toolChanged', tool: key, engineTool: t })
  }

  function handle(payload: HostPayload) {
    if (!payload || payload.source !== 'bndz-host') return
    const d = payload
    if (d.type === 'setTool') {
      const key = String(d.tool || '').toLowerCase()
      const t = TOOL_MAP[key]
      if (t) setActiveTool(t, key)
      else onStatus(`tool?:${key}`)
      return
    }
    if (d.type === 'setStyle') {
      applyStyleToSelection({
        fill: typeof d.fill === 'string' ? d.fill : undefined,
        stroke: typeof d.stroke === 'string' ? d.stroke : undefined,
        strokeWidth: typeof d.strokeWidth === 'number' ? d.strokeWidth : undefined,
      })
      onStatus(`style ${paintDefaults.value.stroke}/${paintDefaults.value.fill}`)
      return
    }
    if (d.type === 'getState') {
      let nodeCount = 0
      try {
        nodeCount = editor.graph.getChildren(editor.state.currentPageId)?.length ?? 0
      } catch { /* ignore */ }
      emit({ type: 'state', activeTool: editor.state.activeTool, nodeCount, ready: ready.value })
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
    if (d.type === 'zoomIn') {
      try {
        editor.state.zoom = Math.min(64, (editor.state.zoom || 1) * 1.15)
        ;(editor as any).requestRender?.()
      } catch { /* ignore */ }
      return
    }
    if (d.type === 'zoomOut') {
      try {
        editor.state.zoom = Math.max(0.05, (editor.state.zoom || 1) / 1.15)
        ;(editor as any).requestRender?.()
      } catch { /* ignore */ }
      return
    }
    if (d.type === 'zoomFit') {
      try { editor.zoomToFit() } catch { /* ignore */ }
      return
    }
    if (d.type === 'exportPng') {
      void exportPng()
      return
    }
    if (d.type === 'keydown' || d.type === 'keyup') {
      window.dispatchEvent(new KeyboardEvent(String(d.type), {
        key: String(d.key || ''),
        code: String(d.code || ''),
        ctrlKey: !!d.ctrlKey,
        metaKey: !!d.metaKey,
        shiftKey: !!d.shiftKey,
        altKey: !!d.altKey,
        bubbles: true,
        cancelable: true,
      }))
    }
  }

  return {
    handle,
    getState: () => {
      let nodeCount = 0
      try {
        nodeCount = editor.graph.getChildren(editor.state.currentPageId)?.length ?? 0
      } catch { /* ignore */ }
      return { activeTool: editor.state.activeTool, nodeCount, ready: ready.value }
    },
  }
}

export function wireCreateShapePaint(
  editor: Editor,
  applyPaintToNode: (id: string, opts?: { fill?: string; stroke?: string; strokeWidth?: number }) => void,
) {
  const rawCreateShape = editor.createShape.bind(editor)
  ;(editor as any).createShape = (type: any, x: number, y: number, w: number, h: number, parentId?: string, name?: string) => {
    const id = rawCreateShape(type, x, y, w, h, parentId, name)
    try { applyPaintToNode(id) } catch { /* ignore */ }
    return id
  }
}
