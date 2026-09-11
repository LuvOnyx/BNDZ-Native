/**
 * BNDZ shared HSV color popover — no CDN.
 * Captures ALL color chips via delegation (static + dynamically created modals).
 * Usage: BndzHsvPopover.mount({ getColor, setColor, getAlpha, openNative })
 */
(function (global) {
  'use strict';

  function hsvToHex(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    const to = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
    return ('#' + to(r) + to(g) + to(b)).toUpperCase();
  }

  function hexToHsv(hex) {
    let h = String(hex || '#ffffff').trim();
    if (h[0] !== '#') h = '#' + h;
    if (/^#[0-9a-fA-F]{3}$/.test(h)) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    if (!/^#[0-9a-fA-F]{6}$/i.test(h)) h = '#ffffff';
    const r = parseInt(h.slice(1, 3), 16) / 255;
    const g = parseInt(h.slice(3, 5), 16) / 255;
    const b = parseInt(h.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let hue = 0;
    if (d) {
      if (max === r) hue = ((g - b) / d) % 6;
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue *= 60; if (hue < 0) hue += 360;
    }
    const s = max === 0 ? 0 : d / max;
    return { h: hue, s, v: max };
  }

  function ensureStyles() {
    if (document.getElementById('bndz-hsv-popover-css')) return;
    const css = document.createElement('style');
    css.id = 'bndz-hsv-popover-css';
    css.textContent = `
.bndz-color-pop{position:fixed;z-index:14000;width:220px;padding:10px;border-radius:14px;
  background:linear-gradient(180deg,#262a33,#171920);border:1px solid rgba(255,255,255,.12);
  box-shadow:0 18px 48px rgba(0,0,0,.55),0 0 0 1px rgba(120,180,255,.08);
  display:flex;flex-direction:column;gap:8px;color:#e8ecf2;font:12px/1.3 system-ui,sans-serif}
.bndz-color-pop[hidden]{display:none!important}
.bndz-cp-sv{position:relative;height:120px;border-radius:10px;border:1px solid rgba(255,255,255,.1);cursor:crosshair;
  background:linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,var(--bndz-cp-hue,#0d99ff))}
.bndz-cp-knob{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.5);pointer-events:none}
.bndz-cp-hue,.bndz-cp-alpha{-webkit-appearance:none;appearance:none;width:100%;height:10px;border-radius:999px;border:0;outline:none}
.bndz-cp-hue{background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)}
.bndz-cp-alpha{background:linear-gradient(90deg,transparent,var(--bndz-cp-hue,#0d99ff))}
.bndz-cp-hue::-webkit-slider-thumb,.bndz-cp-alpha::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #222;cursor:grab}
.bndz-cp-row{display:flex;gap:6px;align-items:center}
.bndz-cp-row input{flex:1;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:#12141a;color:#fff;padding:6px 8px;font:12px/1.2 ui-monospace,monospace}
.bndz-cp-row button{border-radius:8px;border:1px solid rgba(255,255,255,.14);background:#22262f;color:#e8ecf2;padding:6px 10px;cursor:pointer;font-weight:650}
`;
    document.head.appendChild(css);
  }

  function ensureDom() {
    let pop = document.getElementById('bndz-color-pop');
    if (pop) return pop;
    pop = document.createElement('div');
    pop.id = 'bndz-color-pop';
    pop.className = 'bndz-color-pop';
    pop.hidden = true;
    pop.innerHTML = `
      <div class="bndz-cp-sv" id="bndz-cp-sv"><div class="bndz-cp-knob" id="bndz-cp-svk"></div></div>
      <input type="range" id="bndz-cp-hue" class="bndz-cp-hue" min="0" max="360" value="210" />
      <input type="range" id="bndz-cp-alpha" class="bndz-cp-alpha" min="0" max="100" value="100" />
      <div class="bndz-cp-row">
        <input id="bndz-cp-hex" type="text" maxlength="7" value="#FFFFFF" />
        <button type="button" id="bndz-cp-native" title="System picker">...</button>
        <button type="button" id="bndz-cp-apply">Apply</button>
      </div>`;
    document.body.appendChild(pop);
    return pop;
  }

  function isColorChip(el) {
    if (!el || !el.closest) return null;
    if (el.closest('#bndz-color-pop')) return null;
    const chip = el.closest(
      'input[type="color"], [data-bndz-hsv], .fx-p-color, #fg-color, #bg-color, #fill-sw, #stroke-sw, #color-chip, .grad-stop, #grad-from-chip, #fx-color'
    );
    return chip || null;
  }

  /**
   * @param {object} opts
   * @param {(target:string)=>string} [opts.getColor]
   * @param {(hex:string, alpha:number, target:string, el?:HTMLElement)=>void} [opts.setColor]
   * @param {(target:string)=>number} [opts.getAlpha]
   * @param {(target:string, el?:HTMLElement)=>void} [opts.openNative]
   * @param {Record<string,string>} [opts.targetById] id → 'fg'|'bg'|'local'
   */
  function mount(opts) {
    ensureStyles();
    const pop = ensureDom();
    const sv = pop.querySelector('#bndz-cp-sv');
    const knob = pop.querySelector('#bndz-cp-svk');
    const hueEl = pop.querySelector('#bndz-cp-hue');
    const alphaEl = pop.querySelector('#bndz-cp-alpha');
    const hexEl = pop.querySelector('#bndz-cp-hex');
    let target = 'fg';
    let activeEl = null;
    let mode = 'global'; // 'global' | 'local'
    let hsv = { h: 210, s: 0.2, v: 0.85 };
    const targetById = opts.targetById || {};

    function syncUi() {
      const hex = hsvToHex(hsv.h, hsv.s, hsv.v);
      sv.style.setProperty('--bndz-cp-hue', hsvToHex(hsv.h, 1, 1));
      knob.style.left = (hsv.s * 100) + '%';
      knob.style.top = ((1 - hsv.v) * 100) + '%';
      hueEl.value = String(Math.round(hsv.h));
      hexEl.value = hex;
      pop.style.setProperty('--bndz-cp-hue', hex);
    }

    function writeLocal(hex, a) {
      if (!activeEl) return;
      if (activeEl.type === 'color' || activeEl.tagName === 'INPUT') {
        activeEl.value = hex;
        activeEl.dispatchEvent(new Event('input', { bubbles: true }));
        activeEl.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (activeEl.classList?.contains('grad-stop') || activeEl.dataset) {
        activeEl.style.background = hex;
        activeEl.dataset.color = hex;
        activeEl.dispatchEvent(new CustomEvent('bndz-color', { bubbles: true, detail: { hex, alpha: a } }));
      }
    }

    function applyLive() {
      const hex = hsvToHex(hsv.h, hsv.s, hsv.v);
      const a = (+alphaEl.value) / 100;
      if (mode === 'local') {
        writeLocal(hex, a);
        opts.setColor?.(hex, a, 'local', activeEl);
        return;
      }
      opts.setColor?.(hex, a, target, activeEl);
    }

    function resolveTarget(el) {
      if (el.dataset?.bndzColorTarget) return el.dataset.bndzColorTarget;
      const id = el.id ? '#' + el.id : '';
      if (targetById[el.id]) return targetById[el.id];
      if (targetById[id]) return targetById[id];
      if (el.id === 'bg-color' || el.id === 'shape-stroke' || el.id === 'poly-stroke' || el.id === 'grad-to') return 'bg';
      if (el.id === 'fg-color' || el.id === 'shape-fill' || el.id === 'pen-stroke' || el.id === 'poly-fill'
        || el.id === 'star-fill' || el.id === 'text-color' || el.id === 'grad-from' || el.id === 'pattern-color'
        || el.id === 'fill-sw') return 'fg';
      if (el.id === 'stroke-sw') return 'stroke';
      return 'local';
    }

    function openPop(which, anchor) {
      activeEl = anchor || null;
      target = which || 'fg';
      mode = (target === 'fg' || target === 'bg' || target === 'stroke') ? 'global' : 'local';
      let cur = '#ffffff';
      if (mode === 'local' && activeEl) {
        cur = activeEl.value || activeEl.dataset?.color || activeEl.style?.background || '#000000';
        if (String(cur).startsWith('rgb')) cur = '#000000';
      } else if (opts.getColor) {
        cur = opts.getColor(target) || '#ffffff';
      }
      hsv = hexToHsv(cur);
      const a = opts.getAlpha ? opts.getAlpha(target) : 1;
      alphaEl.value = String(Math.round((a == null ? 1 : a) * 100));
      syncUi();
      const r = (anchor || document.body).getBoundingClientRect();
      pop.hidden = false;
      pop.style.left = Math.min(window.innerWidth - 240, Math.max(8, r.left)) + 'px';
      pop.style.top = Math.min(window.innerHeight - 260, r.bottom + 6) + 'px';
    }

    function closePop() {
      pop.hidden = true;
      activeEl = null;
    }

    sv.addEventListener('pointerdown', (e) => {
      const move = (ev) => {
        const r = sv.getBoundingClientRect();
        hsv.s = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
        hsv.v = Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height));
        syncUi(); applyLive();
      };
      move(e);
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    hueEl.addEventListener('input', () => { hsv.h = +hueEl.value; syncUi(); applyLive(); });
    alphaEl.addEventListener('input', () => applyLive());
    hexEl.addEventListener('change', () => {
      hsv = hexToHsv(hexEl.value);
      syncUi(); applyLive();
    });
    pop.querySelector('#bndz-cp-apply').addEventListener('click', () => { applyLive(); closePop(); });
    pop.querySelector('#bndz-cp-native').addEventListener('click', () => {
      closePop();
      if (opts.openNative) opts.openNative(target, activeEl);
      else if (activeEl && activeEl.type === 'color') activeEl.click();
    });

    document.addEventListener('pointerdown', (e) => {
      if (pop.hidden) return;
      if (e.target.closest('#bndz-color-pop')) return;
      if (isColorChip(e.target)) return;
      closePop();
    }, true);

    // Capture-phase: intercept every color chip, including late-created modals.
    document.addEventListener('click', (e) => {
      const el = isColorChip(e.target);
      if (!el) return;
      // Shift+click on #color-chip swaps stroke/fill target (Design Board) — don't steal it.
      if (e.shiftKey && (el.id === 'color-chip' || el.dataset?.bndzAllowShift)) return;
      e.preventDefault();
      e.stopPropagation();
      openPop(resolveTarget(el), el);
    }, true);

    return { open: openPop, close: closePop, pop, hsvToHex, hexToHsv };
  }

  global.BndzHsvPopover = { mount, hsvToHex, hexToHsv };
})(typeof window !== 'undefined' ? window : globalThis);
