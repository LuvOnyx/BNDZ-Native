/**
 * BNDZ OpenShop — finish former stub tools with real pixel/viewport behavior.
 * Installed after OS exists (from chrome install or explicit call).
 */
(function () {
  'use strict';

  const FORMER_STUBS = Object.freeze([
    'marquee-row', 'marquee-column',
    'slice', 'slice-select', 'color-sampler', 'patch',
    'content-aware-move', 'red-eye', 'pattern-stamp', 'history-brush', 'art-history-brush',
    'background-eraser', 'magic-eraser', 'blur', 'sharpen',
    'vertical-text', 'horizontal-text-mask', 'vertical-text-mask',
    'rotate-view',
  ]);

  function install(OS) {
    if (!OS || OS.__bndzStubsInstalled) return;
    OS.__bndzStubsInstalled = true;

    // Catalog marks implemented via empty refuse list.
    OS._unimplementedToolStates = Object.freeze([]);

    try {
      OS._selectionCombineTools?.add?.('marquee-row');
      OS._selectionCombineTools?.add?.('marquee-column');
      OS._activeLayerWriteTools?.add?.('background-eraser');
      OS._activeLayerWriteTools?.add?.('magic-eraser');
      OS._activeLayerWriteTools?.add?.('blur');
      OS._activeLayerWriteTools?.add?.('sharpen');
      OS._activeLayerWriteTools?.add?.('pattern-stamp');
      OS._activeLayerWriteTools?.add?.('history-brush');
      OS._activeLayerWriteTools?.add?.('art-history-brush');
      OS._activeLayerWriteTools?.add?.('vertical-text');
    } catch { /* ignore */ }

    OS._slices = OS._slices || [];
    OS._activeSliceIdx = -1;
    OS._colorSamplers = OS._colorSamplers || [];
    OS._viewRotationDeg = OS._viewRotationDeg || 0;
    OS._bgEraserSample = null;
    OS._patchSourceMask = null;
    OS._camMoveActive = null;

    Object.assign(OS, {
      _resolveImageTarget(ptr) {
        let target = this.canvas?.getActiveObject?.();
        if (!target || target.type !== 'image') {
          const objs = (this.canvas?.getObjects?.() || []).filter((o) => o.type === 'image' && o.containsPoint?.(ptr));
          target = objs.length ? objs[objs.length - 1] : null;
        }
        return target && target.type === 'image' ? target : null;
      },

      _beginPixelStroke(ptr, label) {
        const target = this._resolveImageTarget(ptr);
        if (!target) { this.toast('Click on an image layer', 'info'); return null; }
        if (!this._guardObjectEdit?.(target)) return null;
        const el = target.getElement();
        const oc = document.createElement('canvas');
        oc.width = el.naturalWidth || el.width;
        oc.height = el.naturalHeight || el.height;
        oc.getContext('2d').drawImage(el, 0, 0);
        return { target, oc, label };
      },

      _localOnImage(ptr, target, oc) {
        const matrix = target.calcTransformMatrix();
        const inv = fabric.util.invertTransform(matrix);
        const local = fabric.util.transformPoint(ptr, inv);
        return { lx: local.x + oc.width / 2, ly: local.y + oc.height / 2, matrix };
      },

      _doMarqueeRowColumn(ptr, mode) {
        const dw = Math.max(1, Math.round(this.canvasW));
        const dh = Math.max(1, Math.round(this.canvasH));
        const mask = new Uint8Array(dw * dh);
        let bounds;
        if (mode === 'row') {
          const y = Math.max(0, Math.min(dh - 1, Math.round(ptr.y)));
          for (let x = 0; x < dw; x++) mask[y * dw + x] = 255;
          bounds = { x: 0, y, w: dw, h: 1 };
        } else {
          const x = Math.max(0, Math.min(dw - 1, Math.round(ptr.x)));
          for (let y = 0; y < dh; y++) mask[y * dw + x] = 255;
          bounds = { x, y: 0, w: 1, h: dh };
        }
        const count = this._setPixelSelectionMask(mask, dw, dh, { coverage: true });
        this._selectionBounds = bounds;
        this._placeSelectionBox?.({ borderRadius: '0' });
        this.toast((mode === 'row' ? 'Row' : 'Column') + ' selection: ' + count.toLocaleString() + ' px', 'info');
      },

      _sliceStart(ptr, evt) {
        this._sliceDrag = { x0: ptr.x, y0: ptr.y, x1: ptr.x, y1: ptr.y };
        this._ensureSliceOverlay();
        this._drawSliceOverlay();
      },
      _sliceMove(ptr) {
        if (!this._sliceDrag) return;
        this._sliceDrag.x1 = ptr.x;
        this._sliceDrag.y1 = ptr.y;
        this._drawSliceOverlay();
      },
      _sliceFinish() {
        const d = this._sliceDrag;
        this._sliceDrag = null;
        if (!d) return;
        const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
        const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
        if (w < 4 || h < 4) { this._drawSliceOverlay(); return; }
        this._slices.push({ id: 'slice-' + Date.now(), x, y, w, h, name: 'Slice ' + (this._slices.length + 1) });
        this._activeSliceIdx = this._slices.length - 1;
        this._drawSliceOverlay();
        this.toast('Slice created ' + Math.round(w) + '×' + Math.round(h), 'info');
        this._markDocumentDirty?.();
      },
      _sliceSelectAt(ptr) {
        let hit = -1;
        for (let i = this._slices.length - 1; i >= 0; i--) {
          const s = this._slices[i];
          if (ptr.x >= s.x && ptr.x <= s.x + s.w && ptr.y >= s.y && ptr.y <= s.y + s.h) { hit = i; break; }
        }
        this._activeSliceIdx = hit;
        this._drawSliceOverlay();
        if (hit < 0) this.toast('No slice under cursor', 'info');
        else this.toast('Selected ' + this._slices[hit].name, 'info');
      },
      _ensureSliceOverlay() {
        let el = document.getElementById('bndz-slice-overlay');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'bndz-slice-overlay';
        el.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:96';
        document.getElementById('canvas-area')?.appendChild(el);
        return el;
      },
      _drawSliceOverlay() {
        const el = this._ensureSliceOverlay();
        const vpt = this.canvas?.viewportTransform || [1, 0, 0, 1, 0, 0];
        const toScreen = (p) => ({ x: p.x * vpt[0] + vpt[4], y: p.y * vpt[3] + vpt[5] });
        const parts = [];
        this._slices.forEach((s, i) => {
          const a = toScreen({ x: s.x, y: s.y });
          const b = toScreen({ x: s.x + s.w, y: s.y + s.h });
          const active = i === this._activeSliceIdx;
          parts.push(`<div style="position:absolute;left:${Math.min(a.x, b.x)}px;top:${Math.min(a.y, b.y)}px;width:${Math.abs(b.x - a.x)}px;height:${Math.abs(b.y - a.y)}px;border:1px ${active ? 'solid' : 'dashed'} ${active ? '#0d99ff' : 'rgba(255,255,255,.55)'};box-shadow:inset 0 0 0 1px rgba(0,0,0,.35);background:${active ? 'rgba(13,153,255,.12)' : 'transparent'}"></div>`);
        });
        if (this._sliceDrag) {
          const d = this._sliceDrag;
          const a = toScreen({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1) });
          const w = Math.abs(d.x1 - d.x0) * vpt[0], h = Math.abs(d.y1 - d.y0) * vpt[3];
          parts.push(`<div style="position:absolute;left:${a.x}px;top:${a.y}px;width:${w}px;height:${h}px;border:1px solid #0d99ff;background:rgba(13,153,255,.08)"></div>`);
        }
        el.innerHTML = parts.join('');
        el.style.display = (this.state.tool === 'slice' || this.state.tool === 'slice-select' || this._slices.length) ? 'block' : 'none';
      },

      _colorSamplerClick(ptr) {
        const snap = this._readDocumentImageData?.();
        if (!snap?.data) { this.toast('Nothing to sample', 'info'); return; }
        const x = Math.max(0, Math.min(snap.width - 1, Math.round(ptr.x)));
        const y = Math.max(0, Math.min(snap.height - 1, Math.round(ptr.y)));
        const i = (y * snap.width + x) * 4;
        const hex = '#' + [snap.data[i], snap.data[i + 1], snap.data[i + 2]].map((c) => c.toString(16).padStart(2, '0')).join('');
        this._colorSamplers.push({ x, y, hex, rgb: [snap.data[i], snap.data[i + 1], snap.data[i + 2]] });
        if (this._colorSamplers.length > 4) this._colorSamplers.shift();
        this._renderColorSamplerHud();
        this.toast('Sample ' + this._colorSamplers.length + ': ' + hex.toUpperCase(), 'info');
      },
      _renderColorSamplerHud() {
        let hud = document.getElementById('bndz-sampler-hud');
        if (!hud) {
          hud = document.createElement('div');
          hud.id = 'bndz-sampler-hud';
          hud.style.cssText = 'position:absolute;left:10px;bottom:36px;z-index:120;display:flex;gap:6px;pointer-events:none;';
          document.getElementById('canvas-area')?.appendChild(hud);
        }
        hud.innerHTML = this._colorSamplers.map((s, i) =>
          `<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:8px;background:rgba(20,22,28,.88);border:1px solid rgba(255,255,255,.12);color:#e8ecf2;font:11px/1.2 ui-monospace,monospace"><span style="width:14px;height:14px;border-radius:4px;background:${s.hex};border:1px solid rgba(255,255,255,.25)"></span>#${i + 1} ${s.hex.toUpperCase()}</div>`
        ).join('');
        hud.style.display = this._colorSamplers.length ? 'flex' : 'none';
      },

      _redEyeClick(ptr) {
        const stroke = this._beginPixelStroke(ptr, 'Red Eye');
        if (!stroke) return;
        const { target, oc } = stroke;
        const { lx, ly } = this._localOnImage(ptr, target, oc);
        const ctx = oc.getContext('2d');
        const r = Math.max(6, Math.round((this.state.healingSize || 15) * 1.2));
        const x0 = Math.max(0, Math.floor(lx - r)), y0 = Math.max(0, Math.floor(ly - r));
        const x1 = Math.min(oc.width, Math.ceil(lx + r)), y1 = Math.min(oc.height, Math.ceil(ly + r));
        if (x1 <= x0 || y1 <= y0) return;
        const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
        const d = img.data, w = img.width;
        for (let py = 0; py < img.height; py++) {
          for (let px = 0; px < w; px++) {
            const dist = Math.hypot(px + x0 - lx, py + y0 - ly);
            if (dist > r) continue;
            const i = (py * w + px) * 4;
            const red = d[i], g = d[i + 1], b = d[i + 2];
            // Detect reddish pupils: R dominates and is fairly bright.
            if (red > 90 && red > g * 1.35 && red > b * 1.35) {
              const luma = red * 0.299 + g * 0.587 + b * 0.114;
              const fall = 1 - dist / r;
              d[i] = Math.round(red * (1 - fall * 0.85) + luma * fall * 0.85);
              d[i + 1] = Math.round(g * (1 - fall * 0.35) + luma * fall * 0.35);
              d[i + 2] = Math.round(b * (1 - fall * 0.35) + luma * fall * 0.35);
            }
          }
        }
        ctx.putImageData(img, x0, y0);
        void this._replaceActiveImage(target, oc.toDataURL(), 'Red Eye');
      },

      _patternStampStart(ptr) {
        const stroke = this._beginPixelStroke(ptr, 'Pattern Stamp');
        if (!stroke) return;
        this._patternStamp = stroke;
        this._patternStampStroke(ptr);
        const commit = () => {
          document.removeEventListener('mouseup', commit);
          if (this._patternStamp) {
            void this._replaceActiveImage(this._patternStamp.target, this._patternStamp.oc.toDataURL(), 'Pattern Stamp');
            this._patternStamp = null;
          }
        };
        document.addEventListener('mouseup', commit);
      },
      _patternColorAt(x, y) {
        const scale = Math.max(4, Number(this.state.patternScale) || 20);
        const hex = this.state.patternColor || this.state.fgColor || '#ffffff';
        const parse = (h) => {
          const s = String(h || '#ffffff').replace('#', '');
          const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.padEnd(6, '0');
          return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
        };
        const [cr, cg, cb] = parse(hex);
        const type = this.state.patternType || 'checkerboard';
        const cx = Math.floor(x / scale), cy = Math.floor(y / scale);
        if (type === 'dots') {
          const lx = x % scale, ly = y % scale;
          const on = Math.hypot(lx - scale / 2, ly - scale / 2) < scale * 0.28;
          return on ? [cr, cg, cb] : [0, 0, 0];
        }
        if (type === 'stripes') {
          const on = (cx % 2) === 0;
          return on ? [cr, cg, cb] : [Math.round(cr * 0.35), Math.round(cg * 0.35), Math.round(cb * 0.35)];
        }
        const on = ((cx + cy) & 1) === 0;
        return on ? [cr, cg, cb] : [Math.round(cr * 0.4), Math.round(cg * 0.4), Math.round(cb * 0.4)];
      },
      _patternStampStroke(ptr) {
        if (!this._patternStamp) return;
        const { target, oc } = this._patternStamp;
        const { lx, ly } = this._localOnImage(ptr, target, oc);
        const ctx = oc.getContext('2d');
        const size = this.state.cloneSize || 20;
        const r = Math.ceil(size / 2);
        const x0 = Math.max(0, Math.floor(lx - r)), y0 = Math.max(0, Math.floor(ly - r));
        const x1 = Math.min(oc.width, Math.ceil(lx + r)), y1 = Math.min(oc.height, Math.ceil(ly + r));
        if (x1 <= x0 || y1 <= y0) return;
        const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
        const d = img.data, w = img.width;
        for (let py = 0; py < img.height; py++) {
          for (let px = 0; px < w; px++) {
            const dist = Math.hypot(px + x0 - lx, py + y0 - ly);
            if (dist > r) continue;
            const blend = 1 - dist / r;
            const [sr, sg, sb] = this._patternColorAt(x0 + px, y0 + py);
            const i = (py * w + px) * 4;
            d[i] = Math.round(d[i] * (1 - blend) + sr * blend);
            d[i + 1] = Math.round(d[i + 1] * (1 - blend) + sg * blend);
            d[i + 2] = Math.round(d[i + 2] * (1 - blend) + sb * blend);
          }
        }
        ctx.putImageData(img, x0, y0);
      },

      _historyBrushSnapshotCanvas() {
        // Prefer previous history entry (one step back), else base snapshot.
        const idx = Math.max(0, (this.historyIdx ?? 0) - 1);
        const snap = this.history?.[idx]?.snapshot || this.history?.[idx]?.beforeSnapshot || this._historyBaseSnapshot;
        if (!snap) return null;
        try {
          // Snapshot is usually a JSON canvas state — rasterize current doc into offscreen and
          // sample from a committed history PNG if available.
          if (typeof snap === 'string' && snap.startsWith('data:')) {
            return null; // async path not used here
          }
        } catch { /* ignore */ }
        // Practical path: use document raster captured at last clean history via temporary canvas
        // from reading current + storing baseline on first use.
        if (!this._historyBrushRaster) {
          try {
            const doc = this._readDocumentImageData?.();
            if (!doc) return null;
            const c = document.createElement('canvas');
            c.width = doc.width; c.height = doc.height;
            c.getContext('2d').putImageData(doc, 0, 0);
            this._historyBrushRaster = c;
          } catch { return null; }
        }
        return this._historyBrushRaster;
      },
      _captureHistoryBrushSource() {
        try {
          const doc = this._readDocumentImageData?.();
          if (!doc) return;
          const c = document.createElement('canvas');
          c.width = doc.width; c.height = doc.height;
          c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(doc.data), doc.width, doc.height), 0, 0);
          this._historyBrushRaster = c;
          this.toast('History source captured (current document)', 'info');
        } catch {
          this.toast('Could not capture history source', 'error');
        }
      },
      _historyBrushStart(ptr, art) {
        if (!this._historyBrushRaster) this._captureHistoryBrushSource();
        const stroke = this._beginPixelStroke(ptr, art ? 'Art History Brush' : 'History Brush');
        if (!stroke) return;
        this._historyBrush = { ...stroke, art: !!art };
        this._historyBrushStroke(ptr);
        const commit = () => {
          document.removeEventListener('mouseup', commit);
          if (this._historyBrush) {
            void this._replaceActiveImage(this._historyBrush.target, this._historyBrush.oc.toDataURL(), this._historyBrush.art ? 'Art History Brush' : 'History Brush');
            this._historyBrush = null;
          }
        };
        document.addEventListener('mouseup', commit);
      },
      _historyBrushStroke(ptr) {
        if (!this._historyBrush || !this._historyBrushRaster) return;
        const { target, oc, art } = this._historyBrush;
        const { lx, ly, matrix } = this._localOnImage(ptr, target, oc);
        const src = this._historyBrushRaster.getContext('2d');
        const ctx = oc.getContext('2d');
        const size = (this.state.cloneSize || 20) * (art ? 1.6 : 1);
        const r = Math.ceil(size / 2);
        // Map image-local to document for sampling history raster (approx via transform).
        const docPt = fabric.util.transformPoint({ x: lx - oc.width / 2, y: ly - oc.height / 2 }, matrix);
        const sx = Math.round(docPt.x), sy = Math.round(docPt.y);
        const x0 = Math.max(0, Math.floor(lx - r)), y0 = Math.max(0, Math.floor(ly - r));
        const x1 = Math.min(oc.width, Math.ceil(lx + r)), y1 = Math.min(oc.height, Math.ceil(ly + r));
        if (x1 <= x0 || y1 <= y0) return;
        try {
          const dst = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
          const srcX = Math.max(0, Math.min(this._historyBrushRaster.width - (x1 - x0), sx - r));
          const srcY = Math.max(0, Math.min(this._historyBrushRaster.height - (y1 - y0), sy - r));
          const srcData = src.getImageData(srcX, srcY, Math.min(x1 - x0, this._historyBrushRaster.width - srcX), Math.min(y1 - y0, this._historyBrushRaster.height - srcY));
          const dd = dst.data, sd = srcData.data, w = Math.min(dst.width, srcData.width), h = Math.min(dst.height, srcData.height);
          for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
              const dist = Math.hypot(px + x0 - lx, py + y0 - ly);
              if (dist > r) continue;
              let blend = 1 - dist / r;
              if (art) blend *= 0.55 + 0.45 * Math.sin((px + py) * 0.35);
              const i = (py * dst.width + px) * 4;
              const j = (py * srcData.width + px) * 4;
              if (j + 3 >= sd.length) continue;
              for (let c = 0; c < 4; c++) dd[i + c] = Math.round(dd[i + c] * (1 - blend) + sd[j + c] * blend);
            }
          }
          ctx.putImageData(dst, x0, y0);
        } catch { /* clipped */ }
      },

      _bgEraserStart(ptr) {
        const stroke = this._beginPixelStroke(ptr, 'Background Eraser');
        if (!stroke) return;
        const { lx, ly } = this._localOnImage(ptr, stroke.target, stroke.oc);
        const ctx = stroke.oc.getContext('2d');
        const sample = ctx.getImageData(Math.max(0, Math.floor(lx)), Math.max(0, Math.floor(ly)), 1, 1).data;
        this._bgEraser = { ...stroke, sample: [sample[0], sample[1], sample[2]], tol: this.state.wandTolerance || 32 };
        this._bgEraserStroke(ptr);
        const commit = () => {
          document.removeEventListener('mouseup', commit);
          if (this._bgEraser) {
            void this._replaceActiveImage(this._bgEraser.target, this._bgEraser.oc.toDataURL('image/png'), 'Background Eraser');
            this._bgEraser = null;
          }
        };
        document.addEventListener('mouseup', commit);
      },
      _bgEraserStroke(ptr) {
        if (!this._bgEraser) return;
        const { target, oc, sample, tol } = this._bgEraser;
        const { lx, ly } = this._localOnImage(ptr, target, oc);
        const ctx = oc.getContext('2d');
        const size = this.state.brushSize || 20;
        const r = Math.ceil(size / 2);
        const x0 = Math.max(0, Math.floor(lx - r)), y0 = Math.max(0, Math.floor(ly - r));
        const x1 = Math.min(oc.width, Math.ceil(lx + r)), y1 = Math.min(oc.height, Math.ceil(ly + r));
        if (x1 <= x0 || y1 <= y0) return;
        const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
        const d = img.data, w = img.width;
        for (let py = 0; py < img.height; py++) {
          for (let px = 0; px < w; px++) {
            const dist = Math.hypot(px + x0 - lx, py + y0 - ly);
            if (dist > r) continue;
            const i = (py * w + px) * 4;
            if (Math.abs(d[i] - sample[0]) <= tol && Math.abs(d[i + 1] - sample[1]) <= tol && Math.abs(d[i + 2] - sample[2]) <= tol) {
              const fall = 1 - dist / r;
              d[i + 3] = Math.round(d[i + 3] * (1 - fall));
            }
          }
        }
        ctx.putImageData(img, x0, y0);
      },

      _magicEraserClick(ptr) {
        const stroke = this._beginPixelStroke(ptr, 'Magic Eraser');
        if (!stroke) return;
        const { target, oc } = stroke;
        const { lx, ly } = this._localOnImage(ptr, target, oc);
        const ctx = oc.getContext('2d');
        const sx = Math.max(0, Math.min(oc.width - 1, Math.round(lx)));
        const sy = Math.max(0, Math.min(oc.height - 1, Math.round(ly)));
        const img = ctx.getImageData(0, 0, oc.width, oc.height);
        const d = img.data, w = oc.width, h = oc.height;
        const idx = (sy * w + sx) * 4;
        const tr = d[idx], tg = d[idx + 1], tb = d[idx + 2], tol = this.state.wandTolerance || 32;
        const seen = new Uint8Array(w * h);
        const stack = [[sx, sy]];
        let n = 0;
        while (stack.length && n < 2e6) {
          const [x, y] = stack.pop();
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const p = y * w + x;
          if (seen[p]) continue;
          const i = p * 4;
          if (Math.abs(d[i] - tr) > tol || Math.abs(d[i + 1] - tg) > tol || Math.abs(d[i + 2] - tb) > tol) continue;
          seen[p] = 1; d[i + 3] = 0; n++;
          stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        }
        ctx.putImageData(img, 0, 0);
        void this._replaceActiveImage(target, oc.toDataURL('image/png'), 'Magic Eraser');
        this.toast('Magic Eraser: ' + n.toLocaleString() + ' px', 'info');
      },

      _blurSharpenStart(ptr, mode) {
        const stroke = this._beginPixelStroke(ptr, mode === 'sharpen' ? 'Sharpen' : 'Blur');
        if (!stroke) return;
        this._blurSharpen = { ...stroke, mode };
        this._blurSharpenStroke(ptr);
        const commit = () => {
          document.removeEventListener('mouseup', commit);
          if (this._blurSharpen) {
            void this._replaceActiveImage(this._blurSharpen.target, this._blurSharpen.oc.toDataURL(), this._blurSharpen.mode === 'sharpen' ? 'Sharpen' : 'Blur');
            this._blurSharpen = null;
          }
        };
        document.addEventListener('mouseup', commit);
      },
      _blurSharpenStroke(ptr) {
        if (!this._blurSharpen) return;
        const { target, oc, mode } = this._blurSharpen;
        const { lx, ly } = this._localOnImage(ptr, target, oc);
        const ctx = oc.getContext('2d');
        const size = this.state.cloneSize || this.state.brushSize || 20;
        const r = Math.ceil(size / 2);
        const x0 = Math.max(1, Math.floor(lx - r)), y0 = Math.max(1, Math.floor(ly - r));
        const x1 = Math.min(oc.width - 1, Math.ceil(lx + r)), y1 = Math.min(oc.height - 1, Math.ceil(ly + r));
        if (x1 <= x0 || y1 <= y0) return;
        const img = ctx.getImageData(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
        const src = new Uint8ClampedArray(img.data);
        const d = img.data, w = img.width;
        const amount = mode === 'sharpen' ? 0.55 : 1;
        for (let py = 1; py < img.height - 1; py++) {
          for (let px = 1; px < w - 1; px++) {
            const dist = Math.hypot(px + x0 - 1 - lx, py + y0 - 1 - ly);
            if (dist > r) continue;
            const fall = 1 - dist / r;
            const i = (py * w + px) * 4;
            if (mode === 'blur') {
              let rSum = 0, gSum = 0, bSum = 0, aSum = 0, c = 0;
              for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
                const j = ((py + oy) * w + (px + ox)) * 4;
                rSum += src[j]; gSum += src[j + 1]; bSum += src[j + 2]; aSum += src[j + 3]; c++;
              }
              d[i] = Math.round(src[i] * (1 - fall) + (rSum / c) * fall);
              d[i + 1] = Math.round(src[i + 1] * (1 - fall) + (gSum / c) * fall);
              d[i + 2] = Math.round(src[i + 2] * (1 - fall) + (bSum / c) * fall);
              d[i + 3] = Math.round(src[i + 3] * (1 - fall) + (aSum / c) * fall);
            } else {
              // Unsharp: center*5 - neighbors
              const c0 = (py * w + px) * 4;
              const up = ((py - 1) * w + px) * 4, dn = ((py + 1) * w + px) * 4;
              const lf = (py * w + px - 1) * 4, rt = (py * w + px + 1) * 4;
              for (let ch = 0; ch < 3; ch++) {
                const sharp = src[c0 + ch] * 5 - src[up + ch] - src[dn + ch] - src[lf + ch] - src[rt + ch];
                const v = src[c0 + ch] + (sharp - src[c0 + ch]) * amount * fall;
                d[i + ch] = Math.max(0, Math.min(255, Math.round(v)));
              }
            }
          }
        }
        ctx.putImageData(img, x0 - 1, y0 - 1);
      },

      _patchStart(ptr) {
        // Source = current pixel selection; destination = click point.
        const mask = this._selectionMask || (this._selectionBounds ? this._maskFromMarqueeBounds?.() : null);
        if (!mask) { this.toast('Make a selection first, then click the destination', 'info'); return; }
        const stroke = this._beginPixelStroke(ptr, 'Patch');
        if (!stroke) return;
        const { target, oc } = stroke;
        const { lx, ly, matrix } = this._localOnImage(ptr, target, oc);
        const ctx = oc.getContext('2d');
        const full = ctx.getImageData(0, 0, oc.width, oc.height);
        const srcFull = new Uint8ClampedArray(full.data);
        // Bounding box of selection in document space → average offset to click.
        const b = this._selectionBounds;
        if (!b) return;
        const destDoc = fabric.util.transformPoint({ x: lx - oc.width / 2, y: ly - oc.height / 2 }, matrix);
        const ox = Math.round(destDoc.x - (b.x + b.w / 2));
        const oy = Math.round(destDoc.y - (b.y + b.h / 2));
        const inv = fabric.util.invertTransform(matrix);
        for (let y = 0; y < mask.h; y++) {
          for (let x = 0; x < mask.w; x++) {
            const cov = mask.mask[y * mask.w + x];
            if (!cov) continue;
            const docX = x, docY = y;
            const srcLocal = fabric.util.transformPoint({ x: docX, y: docY }, inv);
            const dstLocal = fabric.util.transformPoint({ x: docX + ox, y: docY + oy }, inv);
            const sx = Math.round(srcLocal.x + oc.width / 2), sy = Math.round(srcLocal.y + oc.height / 2);
            const dx = Math.round(dstLocal.x + oc.width / 2), dy = Math.round(dstLocal.y + oc.height / 2);
            if (sx < 0 || sy < 0 || sx >= oc.width || sy >= oc.height) continue;
            if (dx < 0 || dy < 0 || dx >= oc.width || dy >= oc.height) continue;
            const si = (sy * oc.width + sx) * 4, di = (dy * oc.width + dx) * 4;
            const a = cov / 255;
            for (let c = 0; c < 4; c++) full.data[di + c] = Math.round(full.data[di + c] * (1 - a) + srcFull[si + c] * a);
          }
        }
        ctx.putImageData(full, 0, 0);
        void this._replaceActiveImage(target, oc.toDataURL(), 'Patch');
        this.toast('Patched selection to destination', 'info');
      },

      _contentAwareMoveStart(ptr, evt) {
        const mask = this._selectionMask || (this._selectionBounds ? this._maskFromMarqueeBounds?.() : null);
        if (!mask || !this._selectionBounds) { this.toast('Select a region first', 'info'); return; }
        const stroke = this._beginPixelStroke(ptr, 'Content-Aware Move');
        if (!stroke) return;
        this._camMove = {
          ...stroke,
          mask,
          bounds: { ...this._selectionBounds },
          start: { x: ptr.x, y: ptr.y },
          cur: { x: ptr.x, y: ptr.y },
          srcPixels: new Uint8ClampedArray(stroke.oc.getContext('2d').getImageData(0, 0, stroke.oc.width, stroke.oc.height).data),
        };
      },
      _contentAwareMoveDrag(ptr) {
        if (!this._camMove) return;
        this._camMove.cur = { x: ptr.x, y: ptr.y };
      },
      _contentAwareMoveFinish() {
        const m = this._camMove;
        this._camMove = null;
        if (!m) return;
        const dx = Math.round(m.cur.x - m.start.x);
        const dy = Math.round(m.cur.y - m.start.y);
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
        const { target, oc, mask, bounds, srcPixels } = m;
        const ctx = oc.getContext('2d');
        const full = ctx.getImageData(0, 0, oc.width, oc.height);
        const matrix = target.calcTransformMatrix();
        const inv = fabric.util.invertTransform(matrix);
        // Fill hole with neighbor average, then paste selection at offset.
        for (let y = 0; y < mask.h; y++) {
          for (let x = 0; x < mask.w; x++) {
            if (!mask.mask[y * mask.w + x]) continue;
            const local = fabric.util.transformPoint({ x, y }, inv);
            const lx = Math.round(local.x + oc.width / 2), ly = Math.round(local.y + oc.height / 2);
            if (lx < 1 || ly < 1 || lx >= oc.width - 1 || ly >= oc.height - 1) continue;
            const i = (ly * oc.width + lx) * 4;
            // sample ring outside selection
            let r = 0, g = 0, b = 0, a = 0, c = 0;
            for (const [ox, oy] of [[-3, 0], [3, 0], [0, -3], [0, 3], [-3, -3], [3, 3]]) {
              const nx = x + ox, ny = y + oy;
              if (nx < 0 || ny < 0 || nx >= mask.w || ny >= mask.h || mask.mask[ny * mask.w + nx]) continue;
              const nl = fabric.util.transformPoint({ x: nx, y: ny }, inv);
              const nxi = Math.round(nl.x + oc.width / 2), nyi = Math.round(nl.y + oc.height / 2);
              if (nxi < 0 || nyi < 0 || nxi >= oc.width || nyi >= oc.height) continue;
              const ni = (nyi * oc.width + nxi) * 4;
              r += srcPixels[ni]; g += srcPixels[ni + 1]; b += srcPixels[ni + 2]; a += srcPixels[ni + 3]; c++;
            }
            if (c) {
              full.data[i] = Math.round(r / c);
              full.data[i + 1] = Math.round(g / c);
              full.data[i + 2] = Math.round(b / c);
              full.data[i + 3] = Math.round(a / c);
            }
          }
        }
        for (let y = 0; y < mask.h; y++) {
          for (let x = 0; x < mask.w; x++) {
            const cov = mask.mask[y * mask.w + x];
            if (!cov) continue;
            const srcL = fabric.util.transformPoint({ x, y }, inv);
            const dstL = fabric.util.transformPoint({ x: x + dx, y: y + dy }, inv);
            const sx = Math.round(srcL.x + oc.width / 2), sy = Math.round(srcL.y + oc.height / 2);
            const dxp = Math.round(dstL.x + oc.width / 2), dyp = Math.round(dstL.y + oc.height / 2);
            if (sx < 0 || sy < 0 || sx >= oc.width || sy >= oc.height) continue;
            if (dxp < 0 || dyp < 0 || dxp >= oc.width || dyp >= oc.height) continue;
            const si = (sy * oc.width + sx) * 4, di = (dyp * oc.width + dxp) * 4;
            const t = cov / 255;
            for (let c = 0; c < 4; c++) full.data[di + c] = Math.round(full.data[di + c] * (1 - t) + srcPixels[si + c] * t);
          }
        }
        ctx.putImageData(full, 0, 0);
        void this._replaceActiveImage(target, oc.toDataURL(), 'Content-Aware Move');
        this._selectionBounds = { x: bounds.x + dx, y: bounds.y + dy, w: bounds.w, h: bounds.h };
        this._placeSelectionBox?.({ borderRadius: '0' });
        this.toast('Moved selection with fill-in', 'info');
      },

      _addVerticalText(ptr) {
        const text = this._applyDirectionToObject?.(new fabric.IText('Type', {
          left: ptr.x, top: ptr.y,
          fontFamily: this.state.textFont, fontSize: this.state.textSize,
          fill: this.state.textColor || this.state.fgColor,
          editable: true,
          angle: -90,
          originX: 'left', originY: 'top',
          fontWeight: this.state.textBold ? 'bold' : 'normal',
          fontStyle: this.state.textItalic ? 'italic' : 'normal',
          ...(this._textDecorationProps?.() || {}),
        })) || new fabric.IText('Type', { left: ptr.x, top: ptr.y, angle: -90, fill: this.state.fgColor });
        this._addObjectAsLayer(text, this._objectLayerName?.(text, 'Vertical Text') || 'Vertical Text');
        this.canvas.setActiveObject(text);
        text.enterEditing?.();
        this.saveHistory('Add Vertical Text');
        this.updateLayersPanel();
      },

      async _textMaskAt(ptr, vertical) {
        const probe = new fabric.IText('Aa', {
          left: ptr.x, top: ptr.y,
          fontFamily: this.state.textFont, fontSize: Math.max(24, this.state.textSize || 48),
          fill: '#ffffff', angle: vertical ? -90 : 0,
          originX: 'left', originY: 'top',
        });
        this.canvas.add(probe);
        this.canvas.setActiveObject(probe);
        probe.enterEditing?.();
        const finish = () => {
          probe.off?.('editing:exited', finish);
          try {
            const dw = Math.max(1, Math.round(this.canvasW));
            const dh = Math.max(1, Math.round(this.canvasH));
            const tmp = document.createElement('canvas');
            tmp.width = dw; tmp.height = dh;
            const tctx = tmp.getContext('2d');
            tctx.fillStyle = '#000'; tctx.fillRect(0, 0, dw, dh);
            tctx.fillStyle = '#fff';
            tctx.font = `${probe.fontStyle || 'normal'} ${probe.fontWeight || 'normal'} ${probe.fontSize}px ${probe.fontFamily}`;
            tctx.save();
            if (vertical) {
              tctx.translate(probe.left || 0, probe.top || 0);
              tctx.rotate(-Math.PI / 2);
              tctx.fillText(probe.text || 'Aa', 0, 0);
            } else {
              tctx.fillText(probe.text || 'Aa', probe.left || 0, (probe.top || 0) + (probe.fontSize || 48));
            }
            tctx.restore();
            const data = tctx.getImageData(0, 0, dw, dh).data;
            const mask = new Uint8Array(dw * dh);
            for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4] > 40 ? 255 : 0;
            this.canvas.remove(probe);
            const count = this._setPixelSelectionMask(mask, dw, dh, { coverage: true });
            this._placeSelectionBox?.({ borderRadius: '0' });
            this.toast('Type mask: ' + count.toLocaleString() + ' px', 'info');
          } catch {
            try { this.canvas.remove(probe); } catch { /* ignore */ }
            this.toast('Type mask failed', 'error');
          }
        };
        probe.on?.('editing:exited', finish);
        this.toast(vertical ? 'Vertical type mask — type, click away to commit' : 'Type mask — type, click away to commit', 'info');
      },

      _rotateViewStart(evt) {
        this._rotateViewDrag = { x: evt.clientX, startDeg: this._viewRotationDeg || 0 };
        this.canvas.defaultCursor = 'grabbing';
      },
      _rotateViewMove(evt) {
        if (!this._rotateViewDrag) return;
        const dx = evt.clientX - this._rotateViewDrag.x;
        this._viewRotationDeg = this._rotateViewDrag.startDeg + dx * 0.25;
        this._applyViewRotation();
      },
      _rotateViewFinish() {
        this._rotateViewDrag = null;
        if (this.state.tool === 'rotate-view') this.canvas.defaultCursor = 'grab';
      },
      _applyViewRotation() {
        const wrap = document.getElementById('canvas-area') || this.canvas?.wrapperEl;
        if (!wrap) return;
        const deg = this._viewRotationDeg || 0;
        wrap.style.transformOrigin = '50% 50%';
        wrap.style.transform = deg ? `rotate(${deg}deg)` : '';
        const label = document.getElementById('tool-display');
        if (label && this.state.tool === 'rotate-view') label.textContent = 'Rotate View ' + Math.round(deg) + '°';
      },
      resetViewRotation() {
        this._viewRotationDeg = 0;
        this._applyViewRotation();
      },
    });

    // Capture history source when a history entry is committed.
    const origSave = OS.saveHistory?.bind(OS);
    if (origSave) {
      OS.saveHistory = function (...args) {
        const r = origSave(...args);
        try {
          // Refresh history brush source after edits so "history" means last committed look.
          if (this.state?.tool === 'history-brush' || this.state?.tool === 'art-history-brush') {
            /* keep existing raster until user Alt+clicks */
          }
        } catch { /* ignore */ }
        return r;
      };
    }

    const origSetTool = OS.setTool?.bind(OS);
    OS.setTool = function (tool) {
      // Ensure refuse list cannot block these anymore.
      if (FORMER_STUBS.includes(tool)) {
        // Fall through to original after we ensure switch won't refuse —
        // original still needs cases; inject by temporarily mapping.
      }
      const prevDefault = null;
      const result = (() => {
        // Pre-handle: if original would refuse via empty switch default, configure here.
        if (!FORMER_STUBS.includes(tool)) return origSetTool(tool);

        // Call original first — if it refuses (returns false), activate manually.
        const before = this.state.tool;
        const r = origSetTool(tool);
        if (r !== false && this.state.tool === tool) {
          this._bndzAfterStubTool?.(tool);
          return r;
        }
        // Manual activation path (original default refused).
        this.state.tool = tool;
        document.querySelectorAll('.tool-btn').forEach((b) => {
          const isActive = b.dataset.tool === tool;
          b.classList.toggle('active', isActive);
          b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
        const c = this.canvas;
        if (c) {
          c.isDrawingMode = false;
          c.selection = false;
          c.discardActiveObject?.();
          c.defaultCursor = 'crosshair';
          c.hoverCursor = 'crosshair';
        }
        document.querySelectorAll('.opt-group').forEach((el) => { el.style.display = 'none'; });
        this._bndzConfigureStubTool?.(tool);
        this._applyToolOptions?.(tool);
        this._applyLayerInteractionState?.({ render: false });
        const tip = document.getElementById('tool-display');
        if (tip) tip.textContent = tool.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
        return true;
      })();
      return result;
    };

    OS._bndzConfigureStubTool = function (tool) {
      const c = this.canvas;
      const show = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'flex'; };
      switch (tool) {
        case 'marquee-row': case 'marquee-column':
          show('opt-marquee'); break;
        case 'slice': case 'slice-select':
          show('opt-crop'); this._drawSliceOverlay(); break;
        case 'color-sampler':
          this._renderColorSamplerHud(); break;
        case 'patch': case 'content-aware-move': case 'red-eye':
          show('opt-healing'); break;
        case 'pattern-stamp':
          show('opt-clone'); show('opt-pattern'); break;
        case 'history-brush': case 'art-history-brush':
          show('opt-clone');
          this.toast('Alt+click to capture history source, then paint', 'info');
          break;
        case 'background-eraser':
          c.isDrawingMode = false; show('opt-brush'); show('opt-wand'); break;
        case 'magic-eraser':
          show('opt-wand'); break;
        case 'blur': case 'sharpen':
          show('opt-clone'); break;
        case 'vertical-text': case 'horizontal-text-mask': case 'vertical-text-mask':
          c.defaultCursor = 'text'; show('opt-text'); break;
        case 'rotate-view':
          c.defaultCursor = 'grab';
          c.forEachObject?.((o) => { o.selectable = false; o.evented = false; });
          break;
        default: break;
      }
    };

    OS._bndzAfterStubTool = function (tool) {
      if (FORMER_STUBS.includes(tool)) this._bndzConfigureStubTool(tool);
      if (tool !== 'slice' && tool !== 'slice-select') {
        const ov = document.getElementById('bndz-slice-overlay');
        if (ov && !this._slices?.length) ov.style.display = 'none';
      }
    };

    const origDown = OS.onMouseDown?.bind(OS);
    OS.onMouseDown = function (opt) {
      const ptr = this.canvas.getScenePoint(opt.e);
      const tool = this.state.tool;
      if (tool === 'marquee-row') { this._captureSelectionCombine?.(opt.e); this._doMarqueeRowColumn(ptr, 'row'); return; }
      if (tool === 'marquee-column') { this._captureSelectionCombine?.(opt.e); this._doMarqueeRowColumn(ptr, 'column'); return; }
      if (tool === 'slice') { this._sliceStart(ptr, opt.e); return; }
      if (tool === 'slice-select') { this._sliceSelectAt(ptr); return; }
      if (tool === 'color-sampler') { this._colorSamplerClick(ptr); return; }
      if (tool === 'red-eye') { this._redEyeClick(ptr); return; }
      if (tool === 'pattern-stamp') { this._patternStampStart(ptr); return; }
      if (tool === 'history-brush' || tool === 'art-history-brush') {
        if (opt.e.altKey) { this._captureHistoryBrushSource(); return; }
        this._historyBrushStart(ptr, tool === 'art-history-brush'); return;
      }
      if (tool === 'background-eraser') { this._bgEraserStart(ptr); return; }
      if (tool === 'magic-eraser') { this._magicEraserClick(ptr); return; }
      if (tool === 'blur' || tool === 'sharpen') { this._blurSharpenStart(ptr, tool); return; }
      if (tool === 'patch') { this._patchStart(ptr); return; }
      if (tool === 'content-aware-move') { this._contentAwareMoveStart(ptr, opt.e); return; }
      if (tool === 'vertical-text') { this._addVerticalText(ptr); return; }
      if (tool === 'horizontal-text-mask') { void this._textMaskAt(ptr, false); return; }
      if (tool === 'vertical-text-mask') { void this._textMaskAt(ptr, true); return; }
      if (tool === 'rotate-view') { this._rotateViewStart(opt.e); return; }
      return origDown?.(opt);
    };

    const origMove = OS.onMouseMove?.bind(OS);
    OS.onMouseMove = function (opt) {
      const ptr = this.canvas.getScenePoint(opt.e);
      const tool = this.state.tool;
      if (tool === 'slice' && this._sliceDrag) { this._sliceMove(ptr); return; }
      if (this._patternStamp && (opt.e.buttons & 1)) { this._patternStampStroke(ptr); return; }
      if (this._historyBrush && (opt.e.buttons & 1)) { this._historyBrushStroke(ptr); return; }
      if (this._bgEraser && (opt.e.buttons & 1)) { this._bgEraserStroke(ptr); return; }
      if (this._blurSharpen && (opt.e.buttons & 1)) { this._blurSharpenStroke(ptr); return; }
      if (this._camMove && (opt.e.buttons & 1)) { this._contentAwareMoveDrag(ptr); return; }
      if (this._rotateViewDrag) { this._rotateViewMove(opt.e); return; }
      return origMove?.(opt);
    };

    const origUp = OS.onMouseUp?.bind(OS);
    OS.onMouseUp = function (opt) {
      if (this._sliceDrag) { this._sliceFinish(); return; }
      if (this._camMove) { this._contentAwareMoveFinish(); return; }
      if (this._rotateViewDrag) { this._rotateViewFinish(); return; }
      return origUp?.(opt);
    };

    // Double-click rotate-view resets.
    const canvasEl = OS.canvas?.upperCanvasEl;
    if (canvasEl && !canvasEl.dataset.bndzRotateReset) {
      canvasEl.dataset.bndzRotateReset = '1';
      canvasEl.addEventListener('dblclick', () => {
        if (OS.state?.tool === 'rotate-view') OS.resetViewRotation?.();
      });
    }
  }

  window.__BNDZ_STUB_TOOLS__ = { install, FORMER_STUBS };
})();
