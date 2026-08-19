/**
 * BNDZ Photo Studio chrome — icons, glass flyouts, panels, color, zoom.
 * Must load before OS.init() (script tag before the main OpenShop block, or
 * install() is called from DOMContentLoaded before init).
 */
(function () {
  'use strict';

  function svg(inner, opts = {}) {
    const sw = opts.sw ?? 1.75;
    const fill = opts.fill ? ' fill="currentColor"' : ' fill="none"';
    return `<svg viewBox="0 0 24 24"${fill} stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
  }

  const TOOL_SVGS = {
    select: svg('<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/>', { sw: 2 }),
    'marquee-rect': svg('<rect x="3" y="3" width="18" height="18" rx="1" stroke-dasharray="3 2"/>', { sw: 2 }),
    'marquee-ellipse': svg('<ellipse cx="12" cy="12" rx="10" ry="7" stroke-dasharray="3 2"/>', { sw: 2 }),
    'marquee-row': svg('<line x1="3" y1="12" x2="21" y2="12" stroke-dasharray="4 3"/><line x1="3" y1="8" x2="21" y2="8" stroke-dasharray="4 3" opacity=".45"/><line x1="3" y1="16" x2="21" y2="16" stroke-dasharray="4 3" opacity=".45"/>', { sw: 2 }),
    'marquee-column': svg('<line x1="12" y1="3" x2="12" y2="21" stroke-dasharray="4 3"/><line x1="8" y1="3" x2="8" y2="21" stroke-dasharray="4 3" opacity=".45"/><line x1="16" y1="3" x2="16" y2="21" stroke-dasharray="4 3" opacity=".45"/>', { sw: 2 }),
    lasso: svg('<path d="M4 12c0 4.4 3.6 8.5 8 8.5s8-4.1 8-8.5-3.6-8.5-8-8.5C7.4 3.5 4 6.8 4 12z"/><circle cx="7.5" cy="19.5" r="1.75" fill="currentColor" stroke="none"/>', { sw: 2 }),
    'lasso-polygonal': svg('<path d="M4 20L8 6l6 3 5-7 3 18z"/>', { sw: 2 }),
    'lasso-magnetic': svg('<path d="M4 12c0 4.4 3.6 8 8 8"/><path d="M20 12c0-4.4-3.6-8-8-8"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>', { sw: 2 }),
    'magic-wand': svg('<path d="M15 4V2m0 14v-2M8 9H6m14 0h-2m-1.8-3.8L14 4m-4.2 9.8L8.6 15m9.8-1.2L19.6 15M9.8 5.2L8.6 4"/><path d="M2 22l10-10"/><circle cx="15" cy="9" r="1" fill="currentColor" stroke="none"/>', { sw: 2 }),
    'quick-selection': svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M8 11h6"/>', { sw: 2 }),
    'ai-segment': svg('<circle cx="12" cy="12" r="7" stroke-dasharray="3 2"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3"/><path d="M8.5 13.5c2.2 1.7 5.8 1.2 7-1.5"/>', { sw: 2 }),
    crop: svg('<path d="M6.1 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.1L16 6a2 2 0 0 1 2 2v15"/>', { sw: 2 }),
    'perspective-crop': svg('<path d="M4 4h16v16H4z"/><path d="M4 9l16-4"/><path d="M9 20l-4-16"/>', { sw: 2 }),
    slice: svg('<rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/>', { sw: 2 }),
    'slice-select': svg('<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M9 5v14M15 5v14M5 9h14M5 15h14"/>', { sw: 2 }),
    measure: svg('<path d="M2 20L20 2"/><path d="M6 16l2-2M10 12l2-2M14 8l2-2"/><circle cx="2" cy="20" r="1.5" fill="currentColor" stroke="none"/><circle cx="20" cy="2" r="1.5" fill="currentColor" stroke="none"/>', { sw: 2 }),
    brush: svg('<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.6 7.6"/><circle cx="11" cy="11" r="2"/>', { sw: 2 }),
    pencil: svg('<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>', { sw: 2 }),
    spray: svg('<rect x="6" y="12" width="10" height="10" rx="2"/><path d="M11 12V8"/><circle cx="7" cy="4" r="1" fill="currentColor" stroke="none"/><circle cx="11" cy="3" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="4" r="1" fill="currentColor" stroke="none"/>', { sw: 2 }),
    eraser: svg('<path d="M20 20H7L3 16l9-9 8 8-4 4z"/><path d="M6 11l8 8"/>', { sw: 2 }),
    'background-eraser': svg('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/><path d="M12 8v8"/>', { sw: 2 }),
    'magic-eraser': svg('<path d="M9 3H5a2 2 0 0 0-2 2v4"/><path d="M9 3l12 12"/><path d="M15 21h4a2 2 0 0 0 2-2v-4"/>', { sw: 2 }),
    clone: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4m-10-10h4m12 0h4"/><circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/>', { sw: 2 }),
    'pattern-stamp': svg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>', { sw: 2 }),
    healing: svg('<path d="M18 2l4 4-12 12H6v-4L18 2z"/><path d="M14 6l4 4"/><line x1="2" y1="22" x2="22" y2="22"/>', { sw: 2 }),
    'spot-healing': svg('<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/><path d="M12 8v8"/>', { sw: 2 }),
    patch: svg('<path d="M14 3l7 7-4 4-7-7z"/><path d="M3 14l7 7 4-4-7-7z"/>', { sw: 2 }),
    'content-aware-move': svg('<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>', { sw: 2 }),
    'red-eye': svg('<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/>', { sw: 2 }),
    'history-brush': svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>', { sw: 2 }),
    'art-history-brush': svg('<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/>', { sw: 2 }),
    dodge: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M3 12h9" opacity=".35" fill="currentColor" stroke="none"/>', { sw: 2 }),
    burn: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 12h9" opacity=".45" fill="currentColor" stroke="none"/>', { sw: 2 }),
    sponge: svg('<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/><line x1="8" y1="12" x2="16" y2="12"/>', { sw: 2 }),
    smudge: svg('<path d="M18 4l-4 4c-2 2-5 2-8 5s-1 6 2 7 5-1 7-4 3-6 5-8l4-4z"/>', { sw: 2 }),
    blur: svg('<circle cx="12" cy="12" r="8" opacity=".35"/><circle cx="12" cy="12" r="5" opacity=".55"/><circle cx="12" cy="12" r="2"/>', { sw: 2 }),
    sharpen: svg('<path d="M12 2l2 7h7l-5.5 4.5 2 7L12 16l-5.5 4.5 2-7L3 9h7z"/>', { sw: 2 }),
    rect: svg('<rect x="3" y="3" width="18" height="18" rx="2"/>', { sw: 2 }),
    'rounded-rect': svg('<rect x="3" y="5" width="18" height="14" rx="4"/>', { sw: 2 }),
    circle: svg('<circle cx="12" cy="12" r="10"/>', { sw: 2 }),
    triangle: svg('<path d="M12 3L2 21h20L12 3z"/>', { sw: 2 }),
    line: svg('<line x1="5" y1="19" x2="19" y2="5"/>', { sw: 2 }),
    arrow: svg('<line x1="5" y1="19" x2="19" y2="5"/><polyline points="10 5 19 5 19 14"/>', { sw: 2 }),
    polygon: svg('<path d="M12 2l8.5 6.2-3.2 10H6.7L3.5 8.2z"/>', { sw: 2 }),
    star: svg('<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>', { sw: 2 }),
    'custom-shape': svg('<path d="M4 14l4-8 4 4 4-6 4 10z"/>', { sw: 2 }),
    pen: svg('<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>', { sw: 2 }),
    'freeform-pen': svg('<path d="M4 20c4-8 8-12 16-14"/><circle cx="4" cy="20" r="2" fill="currentColor" stroke="none"/>', { sw: 2 }),
    'add-anchor': svg('<circle cx="12" cy="12" r="3"/><line x1="12" y1="5" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="19"/><line x1="5" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="19" y2="12"/>', { sw: 2 }),
    'delete-anchor': svg('<circle cx="12" cy="12" r="3"/><line x1="8" y1="8" x2="16" y2="16"/>', { sw: 2 }),
    'convert-point': svg('<path d="M4 20L12 4l8 16"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>', { sw: 2 }),
    text: svg('<polyline points="4 7 4 4 20 4 20 7"/><line x1="9.5" y1="20" x2="14.5" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>', { sw: 2 }),
    'vertical-text': svg('<polyline points="7 4 4 4 4 20"/><line x1="20" y1="9.5" x2="20" y2="14.5"/><line x1="4" y1="12" x2="20" y2="12"/>', { sw: 2 }),
    'horizontal-text-mask': svg('<rect x="4" y="8" width="16" height="8" stroke-dasharray="3 2"/><line x1="12" y1="4" x2="12" y2="20"/>', { sw: 2 }),
    'vertical-text-mask': svg('<rect x="8" y="4" width="8" height="16" stroke-dasharray="3 2"/><line x1="4" y1="12" x2="20" y2="12"/>', { sw: 2 }),
    'path-selection': svg('<path d="M4 4h16v16H4z"/><path d="M9 9h6v6H9z"/>', { sw: 2 }),
    'direct-selection': svg('<path d="M4 4h16v16H4z"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/>', { sw: 2 }),
    gradient: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 21L21 3" opacity=".45"/>', { sw: 2 }),
    fill: svg('<path d="M3 21v-3l9-9 3 3-9 9H3z"/><path d="M14 6l3-3 3 3"/><path d="M20 12.5a1.5 1.5 0 0 0 3 0c0-1.5-3-4-3-4s-3 2.5-3 4a1.5 1.5 0 0 0 3 0z"/>', { sw: 2 }),
    pattern: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>', { sw: 2 }),
    eyedropper: svg('<path d="M3 21v-3l9-9 3 3-9 9H3z"/><path d="M14.5 6.5l3-3a2.12 2.12 0 0 1 3 3l-3 3"/>', { sw: 2 }),
    'color-sampler': svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>', { sw: 2 }),
    note: svg('<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z"/><polyline points="14 3 14 8 21 8"/>', { sw: 2 }),
    pan: svg('<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 0 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>', { sw: 2 }),
    zoom: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>', { sw: 2 }),
    'rotate-view': svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>', { sw: 2 }),
    'quick-mask': svg('<rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" opacity=".25" stroke="currentColor"/>', { sw: 2 }),
    'screen-mode': svg('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>', { sw: 2 }),
  };

  const CTX_ICONS = {
    Cut: TOOL_SVGS.select,
    Copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    Paste: svg('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>'),
    Duplicate: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>'),
    Delete: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
    Transform: svg('<path d="M21 3l-6 6"/><path d="M3 21l6-6"/><path d="M14 3h7v7"/><path d="M3 14v7h7"/>'),
    Arrange: svg('<path d="M12 3v18"/><path d="M3 12h18"/>'),
    Deselect: svg('<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4 3"/>'),
    'Select Inverse': svg('<circle cx="12" cy="12" r="9"/><path d="M4 4l16 16"/>'),
    Modify: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    Grow: svg('<circle cx="11" cy="11" r="6"/><circle cx="11" cy="11" r="10"/>'),
    Similar: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/>'),
    'Select All': svg('<rect x="3" y="3" width="18" height="18" rx="1"/>'),
    'New Layer': svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    'Flatten Image': svg('<path d="M3 7.5h7l1.7 2H21v9.5H3z"/>'),
    Zoom: TOOL_SVGS.zoom,
    'Toggle Grid': TOOL_SVGS.pattern,
    'Toggle Rulers': svg('<path d="M2 12h20"/><path d="M12 2v20"/>'),
    'Layer Via Copy': svg('<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>'),
    'Layer Via Cut': svg('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/>'),
    'Clear Filters': svg('<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>'),
    'Duplicate Layer': svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>'),
    'Merge Down': svg('<path d="M8 18L12 22L16 18"/><path d="M12 2V22"/>'),
    'Blending Options': svg('<circle cx="12" cy="12" r="9" opacity=".35"/><circle cx="12" cy="12" r="5"/>'),
    'Layer Style': svg('<path d="M12 2l2 7h7l-5.5 4.5 2 7L12 16l-5.5 4.5 2-7L3 9h7z"/>'),
    'Add Layer Mask': svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="5"/>'),
    Rasterize: svg('<path d="M4 20l5-5"/><path d="M9 15l-5 5"/><path d="M15 4l5 5"/><path d="M20 9l-5-5"/>'),
  };

  function iconEl(toolState, className) {
    const markup = TOOL_SVGS[toolState];
    if (!markup) return null;
    const wrap = document.createElement('span');
    wrap.className = className || 'tool-member-icon';
    wrap.innerHTML = markup;
    const s = wrap.querySelector('svg');
    if (s) {
      s.classList.add(className || 'tool-member-icon');
      return s;
    }
    return wrap;
  }

  function injectCraftCss() {
    // Always refresh so prior broken craft CSS cannot stick across embeds.
    document.getElementById('bndz-studio-craft-css')?.remove();
    const style = document.createElement('style');
    style.id = 'bndz-studio-craft-css';
    style.textContent = `
/* === BNDZ OpenShop craft — flyouts are portaled to #flyout-host, NOT #toolbar === */

/* Right inspector: restore readable panels (do NOT flex-collapse content to 0) */
html[data-bndz-embed="1"] #panels{
  display:flex!important;
  flex-direction:column!important;
  gap:8px!important;
  padding:0 0 8px!important;
  overflow-x:hidden!important;
  overflow-y:auto!important;
  background:transparent!important;
  border:0!important;
}
html[data-bndz-embed="1"] #panels .panel-tab-group{
  display:flex!important;
  flex-direction:column!important;
  flex:0 0 auto!important;
  min-height:max-content!important;
  max-height:none!important;
  overflow:visible!important;
  border-radius:12px!important;
  margin:0!important;
  border:1px solid color-mix(in srgb,var(--border-active) 65%,transparent)!important;
  background:linear-gradient(180deg,var(--bg-depth-2),var(--bg-depth-1))!important;
  box-shadow:0 14px 34px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.04)!important;
}
html[data-bndz-embed="1"] #panels .panel-tab-group.ptg-flex{
  flex:0 0 auto!important;
  min-height:max-content!important;
}
html[data-bndz-embed="1"] #panels .panel-tab-group.is-collapsed{
  flex:0 0 auto!important;
  min-height:34px!important;
  max-height:34px!important;
  overflow:hidden!important;
}
html[data-bndz-embed="1"] #panels .panel-tab-group.is-rail-hidden,
#panels .panel-tab-group.is-rail-hidden{
  display:none!important;
  flex:0 0 0!important;
  min-height:0!important;
  max-height:0!important;
  height:0!important;
  opacity:0!important;
  pointer-events:none!important;
  margin:0!important;
  padding:0!important;
  border:0!important;
  overflow:hidden!important;
  transform:translateX(120%)!important;
  visibility:hidden!important;
}
html[data-bndz-embed="1"] .bndz-ptg-collapse{display:none!important;}
#bndz-panel-rail{
  display:flex!important;flex-direction:column!important;gap:6px!important;
  padding:8px 5px!important;width:var(--rail-w,36px)!important;
  background:linear-gradient(180deg,#1a2030,#121722)!important;
  border-left:1px solid color-mix(in srgb,var(--border) 80%,transparent)!important;
  box-shadow:inset 1px 0 0 rgba(255,255,255,.04)!important;
}
#bndz-panel-rail [data-rail]{
  width:26px!important;height:26px!important;border-radius:9px!important;
  border:1px solid transparent!important;background:transparent!important;
  color:var(--text-muted)!important;cursor:pointer!important;
  display:grid!important;place-items:center!important;
  transition:background .12s,border-color .12s,color .12s,box-shadow .12s!important;
}
#bndz-panel-rail [data-rail]:hover{
  color:var(--text-primary)!important;
  background:rgba(255,255,255,.05)!important;
  border-color:rgba(255,255,255,.08)!important;
}
#bndz-panel-rail [data-rail].on{
  color:#dce9ff!important;
  background:color-mix(in srgb,var(--accent) 28%,transparent)!important;
  border-color:color-mix(in srgb,var(--accent) 55%,transparent)!important;
  box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 25%,transparent),0 6px 16px rgba(0,0,0,.35)!important;
}

/* Pro tool-options bar — must sit above rulers/canvas (Gradient bar was buried). */
#tool-options{
  height:auto!important;min-height:44px!important;max-height:92px!important;
  padding:6px 10px!important;gap:10px!important;flex-wrap:wrap!important;
  background:linear-gradient(180deg,#1c2433,#141a26)!important;
  border-bottom:1px solid color-mix(in srgb,var(--border) 90%,transparent)!important;
  box-shadow:inset 0 -1px 0 rgba(255,255,255,.03)!important;
  align-items:center!important;overflow-x:auto!important;overflow-y:hidden!important;
  z-index:250!important;pointer-events:auto!important;isolation:isolate!important;
  top:calc(var(--topbar-h) + 8px)!important;
}
.ruler-h,.ruler-v{z-index:40!important;pointer-events:none!important}
body.rulers-on .ruler-h{top:calc(var(--topbar-h) + 60px)!important}
body.rulers-on .ruler-v{top:calc(var(--topbar-h) + 80px)!important}
body.rulers-on #canvas-area{top:calc(var(--topbar-h) + 80px)!important;z-index:10!important}
#canvas-area{z-index:10!important;top:calc(var(--topbar-h) + 60px)!important}
#toolbar{z-index:260!important}
#panels,#panel-rail{z-index:55!important}
#topbar{z-index:300!important;pointer-events:auto!important;isolation:isolate!important}
#topbar .menu-bar,#topbar .menu-item{pointer-events:auto!important;position:relative;z-index:2}
#tool-options .opt-group{
  align-items:center!important;gap:8px!important;flex-wrap:wrap!important;row-gap:6px!important;
}
#tool-options .bndz-opt-toolchip{
  display:inline-flex!important;align-items:center!important;gap:8px!important;
  flex:0 0 auto!important;padding:4px 10px 4px 6px!important;margin-right:4px!important;
  border-radius:10px!important;
  border:1px solid color-mix(in srgb,var(--accent) 40%,transparent)!important;
  background:color-mix(in srgb,var(--accent) 16%,transparent)!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05)!important;
}
#tool-options .bndz-opt-toolchip svg{width:16px!important;height:16px!important;display:block!important;color:#e8f1ff!important}
#tool-options .bndz-opt-toolchip .bndz-opt-toolname{
  font-size:11px!important;font-weight:700!important;letter-spacing:.02em!important;color:#e8f1ff!important;
  text-transform:capitalize!important;white-space:nowrap!important;
}
#tool-options .opt-group{align-items:center!important;gap:8px!important}
#tool-options label{
  font-size:10px!important;font-weight:700!important;letter-spacing:.04em!important;
  text-transform:uppercase!important;color:var(--text-muted)!important;opacity:.9!important;
}
#tool-options input[type="range"],
#panels input[type="range"]{
  -webkit-appearance:none!important;appearance:none!important;height:6px!important;
  border-radius:999px!important;border:0!important;outline:none!important;
  background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 75%,#10141c),#2a3344)!important;
  box-shadow:inset 0 1px 2px rgba(0,0,0,.45)!important;
}
#tool-options input[type="range"]{width:110px!important}
#panels input[type="range"]{flex:1 1 auto!important;min-width:80px!important}
#tool-options input[type="range"]::-webkit-slider-thumb,
#panels input[type="range"]::-webkit-slider-thumb{
  -webkit-appearance:none!important;width:15px!important;height:15px!important;border-radius:50%!important;
  background:radial-gradient(circle at 35% 30%,#fff,#9fd4ff 42%,#4aa3ff 100%)!important;
  border:2px solid #0a1522!important;box-shadow:0 0 0 3px rgba(76,163,255,.3),0 3px 8px rgba(0,0,0,.45)!important;
  cursor:grab!important;
}
#panels .panel-tab-content .ptc-inner{
  padding:10px 11px!important;
}
#panels .layer-item{
  border-radius:11px!important;
}
html[data-bndz-embed="1"] #layers-list-visual{
  max-height:none!important;
  overflow:visible!important;
  gap:6px!important;
}
#tool-options .opt-val,
#tool-options input[type="number"],
#tool-options select{
  min-height:26px!important;border-radius:8px!important;padding:3px 8px!important;
  border:1px solid color-mix(in srgb,var(--border) 85%,transparent)!important;
  background:#121822!important;color:var(--text-primary)!important;
  box-shadow:inset 0 1px 2px rgba(0,0,0,.35)!important;font-size:11px!important;font-weight:600!important;
}
#tool-options-reset{
  border-radius:9px!important;border:1px solid color-mix(in srgb,var(--border) 90%,transparent)!important;
  background:linear-gradient(180deg,#243044,#171e2b)!important;font-weight:700!important;letter-spacing:.02em!important;
}
#toolbar .audit-tool-face .tool-face-icon,
#toolbar .audit-tool-face svg.tool-face-icon{
  width:18px!important;height:18px!important;display:block!important;opacity:1!important;visibility:visible!important;
}
#toolbar .audit-tool-face.active .tool-face-icon{color:#eaf3ff!important;filter:drop-shadow(0 0 4px rgba(110,170,255,.45));}
#toolbar .tool-btn.bndz-tool-stub{opacity:.72!important}
#toolbar .tool-btn.bndz-tool-stub:hover{opacity:1!important}
html[data-bndz-embed="1"] #panels .panel-tabs{
  flex:0 0 auto!important;
  position:relative!important;
  min-height:36px!important;
  display:flex!important;
  visibility:visible!important;
  opacity:1!important;
  z-index:2;
}
html[data-bndz-embed="1"] #panels .panel-tab-content.active{
  display:flex!important;
  flex-direction:column!important;
  flex:0 0 auto!important;
  min-height:max-content!important;
  overflow:visible!important;
  visibility:visible!important;
  opacity:1!important;
}
html[data-bndz-embed="1"] #panels .panel-tab-content.active > .ptc-inner{
  display:block!important;
  flex:0 0 auto!important;
  min-height:max-content!important;
  overflow:visible!important;
  padding:10px 12px!important;
}
html[data-bndz-embed="1"] #layers-list-visual{
  max-height:none!important;
  min-height:0!important;
  overflow:visible!important;
}
html[data-bndz-embed="1"] #history-list{
  max-height:min(28vh,200px)!important;
  min-height:72px!important;
  overflow-y:auto!important;
}
html[data-bndz-embed="1"] .layers-list-shell{
  display:block!important;
  min-height:96px!important;
}

/* Glass tool menus — ONLY when open. Unscoped #flyout-host rules leaked
   closed flyouts as thin ghost icon columns over the toolbar/ruler. */
#flyout-host{
  z-index:10050!important;
}
#flyout-host .audit-tool-flyout:not(.show):not(:popover-open),
.tool-flyout.audit-tool-flyout:not(.show):not(:popover-open){
  display:none!important;
  visibility:hidden!important;
  pointer-events:none!important;
  opacity:0!important;
}
#flyout-host .audit-tool-flyout.show,
#flyout-host .audit-tool-flyout:popover-open,
.tool-flyout.audit-tool-flyout.show,
.tool-flyout.audit-tool-flyout:popover-open{
  display:flex!important;
  flex-direction:column!important;
  visibility:visible!important;
  opacity:1!important;
  min-width:280px!important;
  width:max-content!important;
  max-width:min(360px,calc(100vw - 24px))!important;
  max-height:min(70vh,520px)!important;
  overflow-x:hidden!important;
  overflow-y:auto!important;
  padding:8px!important;
  gap:3px!important;
  border-radius:14px!important;
  border:1px solid color-mix(in srgb,var(--border-active) 75%,transparent)!important;
  background:linear-gradient(165deg,
    color-mix(in srgb,var(--bg-depth-2) 97%,#1a2333),
    color-mix(in srgb,var(--bg-depth-1) 98%,#0d121a))!important;
  box-shadow:0 22px 56px rgba(0,0,0,.62),inset 0 1px 0 rgba(255,255,255,.07)!important;
  backdrop-filter:blur(18px) saturate(1.2)!important;
  pointer-events:auto!important;
}
#flyout-host .audit-tool-flyout.show .tool-btn,
#flyout-host .audit-tool-flyout:popover-open .tool-btn,
.tool-flyout.audit-tool-flyout.show .tool-btn,
.tool-flyout.audit-tool-flyout:popover-open .tool-btn{
  width:100%!important;
  min-width:260px!important;
  height:40px!important;
  min-height:40px!important;
  max-height:none!important;
  display:flex!important;
  align-items:center!important;
  justify-content:flex-start!important;
  gap:10px!important;
  padding:6px 10px!important;
  border-radius:10px!important;
  border:1px solid transparent!important;
  background:transparent!important;
  color:var(--text-primary)!important;
  box-shadow:none!important;
  transform:none!important;
}
#flyout-host .audit-tool-flyout.show .tool-btn::before,
#flyout-host .audit-tool-flyout.show .tool-btn::after,
#flyout-host .audit-tool-flyout:popover-open .tool-btn::before,
#flyout-host .audit-tool-flyout:popover-open .tool-btn::after,
.tool-flyout.audit-tool-flyout.show .tool-btn::before,
.tool-flyout.audit-tool-flyout.show .tool-btn::after{
  content:none!important;display:none!important;
}
#flyout-host .audit-tool-flyout.show .tool-btn:hover,
#flyout-host .audit-tool-flyout:popover-open .tool-btn:hover,
.tool-flyout.audit-tool-flyout.show .tool-btn:hover{
  background:color-mix(in srgb,var(--accent) 18%,transparent)!important;
  border-color:color-mix(in srgb,var(--accent) 32%,transparent)!important;
}
#flyout-host .audit-tool-flyout.show .tool-btn.active,
#flyout-host .audit-tool-flyout:popover-open .tool-btn.active,
.tool-flyout.audit-tool-flyout.show .tool-btn.active{
  background:color-mix(in srgb,var(--accent) 24%,transparent)!important;
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 48%,transparent)!important;
}
#flyout-host .audit-tool-flyout.show .bndz-icon-well,
#flyout-host .audit-tool-flyout:popover-open .bndz-icon-well,
.tool-flyout.audit-tool-flyout.show .bndz-icon-well{
  width:28px!important;height:28px!important;flex:0 0 28px!important;
  border-radius:9px!important;display:grid!important;place-items:center!important;
  background:rgba(255,255,255,.05)!important;
  border:1px solid rgba(255,255,255,.08)!important;
}
#flyout-host .audit-tool-flyout.show .tool-member-icon,
#flyout-host .audit-tool-flyout.show svg.tool-member-icon,
#flyout-host .audit-tool-flyout:popover-open .tool-member-icon,
#flyout-host .audit-tool-flyout:popover-open svg.tool-member-icon,
.tool-flyout.audit-tool-flyout.show .tool-member-icon,
.tool-flyout.audit-tool-flyout.show svg.tool-member-icon{
  width:18px!important;height:18px!important;flex:0 0 18px!important;
  color:var(--text-secondary)!important;display:block!important;
  opacity:1!important;visibility:visible!important;
}
#flyout-host .audit-tool-flyout.show .tool-name,
#flyout-host .audit-tool-flyout:popover-open .tool-name,
.tool-flyout.audit-tool-flyout.show .tool-name{
  flex:1 1 auto!important;
  overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;
  font-size:12.5px!important;font-weight:600!important;
  color:var(--text-primary)!important;letter-spacing:.01em!important;
  text-align:left!important;
}
#flyout-host .audit-tool-flyout.show .tool-shortcut,
#flyout-host .audit-tool-flyout:popover-open .tool-shortcut,
.tool-flyout.audit-tool-flyout.show .tool-shortcut{
  margin-inline-start:auto!important;flex:0 0 auto!important;
  font:600 10px 'JetBrains Mono',monospace!important;
  color:var(--text-muted)!important;opacity:.9!important;
  padding:3px 7px!important;border-radius:6px!important;
  background:rgba(255,255,255,.05)!important;
}
#toolbar .audit-tool-face .tool-face-icon,
#toolbar .audit-tool-face svg.tool-face-icon{
  width:18px!important;height:18px!important;display:block!important;
}
html[data-bndz-embed="1"] #toolbar .tool-family-label{display:none!important}
html[data-bndz-embed="1"] #toolbar .audit-tool-face{
  height:var(--tool-size)!important;width:var(--tool-size)!important;
  border-radius:10px!important;
}
/* Hide face CSS tooltips while a flyout is open (stops "Move Move" clutter) */
html.bndz-flyout-open #toolbar .audit-tool-face[data-tip]::after{opacity:0!important;content:none!important}

.color-box.fg,.color-box.bg,#fg-color,#bg-color{
  border-radius:10px!important;
  border:2px solid rgba(255,255,255,.18)!important;
  box-shadow:0 6px 16px rgba(0,0,0,.35),inset 0 0 0 1px rgba(0,0,0,.25)!important;
}
.bndz-color-chip{
  appearance:none;width:28px;height:22px;border-radius:8px;cursor:pointer;
  border:1px solid rgba(255,255,255,.2);
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.35),0 2px 6px rgba(0,0,0,.25);
}
.bndz-color-chip:hover{transform:translateY(-1px);border-color:var(--accent)}
input[type="color"].bndz-hidden-native{position:absolute!important;opacity:0!important;width:0!important;height:0!important;pointer-events:none!important}

.ctx-icon{display:inline-flex;width:16px;height:16px;flex:0 0 16px;color:var(--text-muted)}
.ctx-icon svg{width:16px;height:16px;display:block}
#context-menu{border-radius:12px!important;padding:6px!important;min-width:228px;
  backdrop-filter:blur(14px);box-shadow:0 18px 48px rgba(0,0,0,.5)!important}

.layer-info{position:relative;padding-right:28px}
.layer-fx{position:absolute;right:0;top:50%;transform:translateY(-50%);border:0;
  background:linear-gradient(135deg,rgba(255,43,214,.14),rgba(13,153,255,.1));
  color:var(--accent);font:700 9px/1 'JetBrains Mono',monospace;padding:4px 6px;border-radius:6px;
  cursor:pointer;opacity:0;transition:opacity .12s}
.layer-item:hover .layer-fx,.layer-item.active .layer-fx{opacity:1}
.bndz-layers-fx-bar{display:flex;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
.bndz-layers-fx-bar .btn{flex:1;font-size:10px;padding:6px 8px;border-radius:8px}

/* Preferences / modals — Mica-like glass */
.modal-overlay{backdrop-filter:blur(18px) saturate(1.2)!important;background:rgba(8,12,20,.55)!important}
.modal-overlay .modal{
  border-radius:16px!important;border:1px solid rgba(255,255,255,.12)!important;
  background:linear-gradient(165deg,rgba(36,42,56,.88),rgba(18,22,32,.92))!important;
  box-shadow:0 24px 64px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08)!important;
  backdrop-filter:blur(28px) saturate(1.35)!important;
}
`;
    document.head.appendChild(style);
  }

  function seedToolbarIcons(toolbar) {
    if (!toolbar) return;
    Object.entries(TOOL_SVGS).forEach(([toolState, markup]) => {
      let btn = toolbar.querySelector(`.bndz-icon-seed[data-tool="${toolState}"]`);
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tool-btn bndz-icon-seed';
        btn.dataset.tool = toolState;
        btn.hidden = true;
        btn.tabIndex = -1;
        toolbar.appendChild(btn);
      }
      if (!btn.querySelector('svg')) btn.innerHTML = markup;
    });
    toolbar.dataset.bndzIconsSeeded = '1';
  }

  /** After registry rebuild, force every face/flyout row to use TOOL_SVGS. */
  function paintToolboxIcons() {
    if (paintToolboxIcons._busy) return;
    paintToolboxIcons._busy = true;
    try {
      document.querySelectorAll('#toolbar .tool-btn[data-tool], #flyout-host .tool-btn[data-tool]').forEach((btn) => {
        const tool = btn.dataset.tool;
        if (!tool || !TOOL_SVGS[tool]) return;
        const isFace = btn.classList.contains('audit-tool-face');
        const inFlyout = !!btn.closest('.audit-tool-flyout');
        const className = isFace ? 'tool-face-icon' : 'tool-member-icon';

        if (isFace) {
          const existing = btn.querySelector(':scope > .tool-face-icon, :scope > svg.tool-face-icon');
          if (existing && btn.dataset.bndzPainted === tool) return;
          const next = iconEl(tool, className);
          if (!next) return;
          btn.querySelectorAll(':scope > .tool-member-glyph, :scope > .tool-glyph').forEach((g) => g.remove());
          const oldIcon = btn.querySelector(':scope > .tool-member-icon, :scope > .tool-face-icon, :scope > .bndz-icon-well, :scope > svg');
          if (oldIcon) oldIcon.replaceWith(next);
          else btn.prepend(next);
          btn.dataset.bndzPainted = tool;
          return;
        }

        if (!inFlyout) return;

        // Already painted for this tool with well + name structure — skip to avoid MutationObserver loops.
        const well = btn.querySelector(':scope > .bndz-icon-well');
        const nameEl = btn.querySelector(':scope > .tool-name');
        if (well && nameEl && btn.dataset.bndzPainted === tool && well.querySelector('svg')) {
          btn.removeAttribute('data-tip');
          return;
        }

        const next = iconEl(tool, className);
        if (!next) return;
        btn.removeAttribute('data-tip');
        const labelText = nameEl?.textContent?.trim()
          || btn.getAttribute('aria-label')
          || btn.title
          || tool.replace(/-/g, ' ');
        const shortcutEl = btn.querySelector('.tool-shortcut');
        const shortcutText = shortcutEl?.textContent?.trim()
          || shortcutEl?.dataset?.osShortcut
          || btn.dataset.osShortcut
          || '';
        const nextWell = document.createElement('span');
        nextWell.className = 'bndz-icon-well';
        nextWell.appendChild(next);
        const name = document.createElement('span');
        name.className = 'tool-name';
        name.textContent = labelText;
        const sc = document.createElement('span');
        sc.className = 'tool-shortcut';
        if (shortcutText) sc.dataset.osShortcut = shortcutText;
        sc.textContent = shortcutText;
        btn.replaceChildren(nextWell, name, sc);
        btn.dataset.bndzPainted = tool;
      });
    } finally {
      paintToolboxIcons._busy = false;
    }
  }

  function watchFlyoutOpenState() {
    const sync = () => {
      const open = !!document.querySelector(
        '#flyout-host .audit-tool-flyout.show, #flyout-host .audit-tool-flyout:popover-open, .tool-flyout.audit-tool-flyout.show'
      );
      document.documentElement.classList.toggle('bndz-flyout-open', open);
    };
    const host = document.getElementById('flyout-host');
    if (host && host.dataset.bndzFlyoutWatch !== '1') {
      host.dataset.bndzFlyoutWatch = '1';
      new MutationObserver(sync).observe(host, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }
    document.querySelectorAll('.audit-tool-flyout').forEach((fly) => {
      if (fly.dataset.bndzFlyoutWatch === '1') return;
      fly.dataset.bndzFlyoutWatch = '1';
      new MutationObserver(sync).observe(fly, { attributes: true, attributeFilter: ['class'] });
    });
    sync();
  }

  function restoreInspectorPanels() {
    document.querySelectorAll('#panels .panel-tab-group').forEach((g, i) => {
      g.classList.remove('is-collapsed');
      g.querySelectorAll('.bndz-ptg-collapse').forEach((b) => b.remove());
      // Do not force-open rail-hidden groups — rail state is intentional.
      try {
        if (localStorage.getItem('bndz-os-ptg-' + i) !== '0') {
          g.classList.remove('is-rail-hidden');
          localStorage.setItem('bndz-os-ptg-' + i, '1');
        }
      } catch { /* ignore */ }
    });
    document.querySelectorAll('#panels .panel-tab-content.active').forEach((el) => {
      el.hidden = false;
      el.style.display = 'flex';
      el.style.visibility = 'visible';
      el.style.opacity = '1';
      el.style.minHeight = 'max-content';
    });
    document.querySelectorAll('#panels .panel-tabs').forEach((el) => {
      el.style.display = 'flex';
      el.style.visibility = 'visible';
    });
  }

  function syncOptionsToolChip(OS) {
    const bar = document.getElementById('tool-options');
    if (!bar) return;
    let chip = bar.querySelector('.bndz-opt-toolchip');
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'bndz-opt-toolchip';
      chip.innerHTML = '<span class="bndz-opt-icon"></span><span class="bndz-opt-toolname"></span>';
      bar.prepend(chip);
    }
    const tool = OS?.state?.tool || 'move';
    const iconHost = chip.querySelector('.bndz-opt-icon');
    const nameEl = chip.querySelector('.bndz-opt-toolname');
    if (iconHost) {
      iconHost.replaceChildren();
      const svg = iconEl(tool, 'tool-face-icon');
      if (svg) iconHost.appendChild(svg);
    }
    if (nameEl) nameEl.textContent = String(tool).replace(/-/g, ' ');
  }

  function openLayerProperties(OS) {
    document.getElementById('ptg1-tab-props')?.click();
    document.querySelector('#ptg1-props .style-section')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  function showLayerMenu(OS, e, layerIndex) {
    e.preventDefault();
    e.stopPropagation();
    const clicked = OS.layers?.[layerIndex];
    const selectedIds = Array.isArray(OS._selectedLayerIds) ? OS._selectedLayerIds.filter(Boolean) : [];
    const multi = selectedIds.length > 1 && clicked && selectedIds.includes(clicked.id);
    if (!multi) OS.selectLayer(layerIndex);
    const menu = document.getElementById('context-menu');
    if (!menu) return;
    const layer = OS.layers?.[layerIndex];
    const count = multi ? selectedIds.length : 1;
    const items = [
      { label: multi ? `Duplicate ${count} Layers` : 'Duplicate Layer', fn: () => OS.duplicateLayer() },
      { label: layer?.locked && !multi ? 'Unlock & Delete Layer' : (multi ? `Delete ${count} Layers` : 'Delete Layer'), fn: () => OS.deleteLayer({ force: true }) },
      { sep: true },
      { label: layer?.locked ? 'Unlock Layer' : 'Lock Layer', fn: () => OS.toggleLayerLock?.(layerIndex) },
      { label: 'Merge Down', fn: () => OS.mergeDown() },
      { sep: true },
      { label: 'Blending Options', fn: () => openLayerProperties(OS) },
      { label: 'Layer Style', fn: () => { openLayerProperties(OS); OS.applyLayerStyle?.(); } },
      { label: 'Add Layer Mask', fn: () => OS.addLayerMask?.() },
    ];
    menu.replaceChildren();
    items.forEach((it) => {
      if (it.sep) {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        menu.appendChild(sep);
        return;
      }
      const row = document.createElement('div');
      row.className = 'ctx-item';
      const iconKey = it.label.includes('Delete') ? 'Delete Layer' : it.label;
      if (CTX_ICONS[iconKey]) {
        const el = document.createElement('span');
        el.className = 'ctx-icon';
        el.innerHTML = CTX_ICONS[iconKey];
        row.appendChild(el);
      }
      const label = document.createElement('span');
      label.textContent = it.label;
      row.appendChild(label);
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        it.fn?.();
        menu.classList.remove('visible');
        OS._hidePopover?.(menu);
      });
      menu.appendChild(row);
    });
    let mx = e.clientX;
    let my = e.clientY;
    if (mx + 240 > window.innerWidth) mx = window.innerWidth - 244;
    if (my + items.length * 30 > window.innerHeight) my = window.innerHeight - items.length * 30 - 4;
    menu.style.left = `${mx}px`;
    menu.style.top = `${my}px`;
    // Native popover path: class "visible" alone stays display:none!important — must showPopover.
    // Reuse the canvas context-menu anchor so position-area works.
    if (OS._nativePopoverUI && typeof OS._showPopover === 'function') {
      let anchor = document.getElementById('context-menu-anchor');
      if (!anchor) {
        anchor = document.createElement('span');
        anchor.id = 'context-menu-anchor';
        anchor.setAttribute('aria-hidden', 'true');
        anchor.style.cssText = 'position:fixed;width:1px;height:1px;pointer-events:none';
        document.body.appendChild(anchor);
        OS._anchorPopover?.(anchor, menu, 'block-end span-inline-end', { ownerClass: null });
      }
      anchor.style.left = `${mx}px`;
      anchor.style.top = `${my}px`;
      try { OS._showPopover(menu); } catch { /* fall through */ }
    }
    menu.classList.add('visible');
  }

  function enhanceLayerRows(OS) {
    const visual = document.getElementById('layers-list-visual');
    if (!visual) return;
    const rows = OS._visibleLayerRows?.() || [];
    visual.querySelectorAll('.layer-item').forEach((row, rowIndex) => {
      const idx = rows[rowIndex]?.index;
      if (!Number.isInteger(idx)) return;
      if (!row.querySelector('.layer-fx')) {
        const fx = document.createElement('button');
        fx.type = 'button';
        fx.className = 'layer-fx';
        fx.title = 'Layer effects / styles';
        fx.textContent = 'fx';
        fx.addEventListener('click', (ev) => {
          ev.stopPropagation();
          OS.selectLayer(idx);
          openLayerProperties(OS);
        });
        row.querySelector('.layer-info')?.appendChild(fx);
      }
      if (row.dataset.bndzCtxBound === '1') return;
      row.dataset.bndzCtxBound = '1';
      row.addEventListener('contextmenu', (ev) => showLayerMenu(OS, ev, idx));
    });
  }

  function installZoomFixes(OS) {
    const area = document.getElementById('canvas-area');
    if (!area || area.dataset.bndzZoomBound === '1') return;
    area.dataset.bndzZoomBound = '1';
    area.addEventListener('wheel', (e) => {
      if (e.defaultPrevented || !OS.canvas?.upperCanvasEl) return;
      if (e.target?.closest?.('#canvas-hud')) return;
      e.preventDefault();
      const rect = OS.canvas.upperCanvasEl.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      let z = (OS.canvas.getZoom() || OS.zoom || 1) * Math.pow(0.999, delta);
      z = Math.min(Math.max(0.05, z), 20);
      OS._zoomToPoint(z, point, { snap: OS._pixelZoomSnap });
    }, { passive: false, capture: true });
    document.getElementById('canvas-zoom-display')?.addEventListener('dblclick', (e) => {
      e.preventDefault();
      OS.zoomReset?.();
    });
    document.getElementById('zoom-display')?.addEventListener('dblclick', (e) => {
      e.preventDefault();
      OS.zoomReset?.();
    });
  }

  function installColorWheel(OS) {
    const origDraw = OS._drawColorWheel?.bind(OS);
    const origInit = OS.initColorWheel?.bind(OS);
    OS._drawColorWheel = function bndzDrawWheel() {
      const cv = document.getElementById('color-wheel');
      if (!cv) return;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const w = cv.width;
      const h = cv.height;
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(cx, cy) - 2;
      const img = ctx.createImageData(w, h);
      const data = img.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const i = (y * w + x) * 4;
          if (dist > r) {
            data[i + 3] = 0;
            continue;
          }
          const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
          const sat = dist / r;
          const c = sat;
          const xh = c * (1 - Math.abs(((hue / 60) % 2) - 1));
          let rr = 0;
          let gg = 0;
          let bb = 0;
          if (hue < 60) { rr = c; gg = xh; }
          else if (hue < 120) { rr = xh; gg = c; }
          else if (hue < 180) { gg = c; bb = xh; }
          else if (hue < 240) { gg = xh; bb = c; }
          else if (hue < 300) { rr = xh; bb = c; }
          else { rr = c; bb = xh; }
          const m = 0.5 - c * 0.5;
          data[i] = Math.round((rr + m) * 255);
          data[i + 1] = Math.round((gg + m) * 255);
          data[i + 2] = Math.round((bb + m) * 255);
          data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    };

    OS.initColorWheel = function bndzInitWheel() {
      const cv = document.getElementById('color-wheel');
      if (!cv) return origInit?.();
      OS._drawColorWheel();
      let dragging = false;
      let rect = null;
      let raf = 0;
      let pending = null;
      const pick = (e) => {
        pending = e;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const ev = pending;
          pending = null;
          if (!ev || !dragging) return;
          const r = rect || cv.getBoundingClientRect();
          const x = ev.clientX - r.left;
          const y = ev.clientY - r.top;
          const cx = 60;
          const cy = 60;
          const rad = 58;
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > rad + 2) return;
          const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
          const sat = Math.min((dist / rad) * 100, 100);
          const hh = document.getElementById('hsb-h');
          const ss = document.getElementById('hsb-s');
          const hv = document.getElementById('hsb-h-val');
          const sv = document.getElementById('hsb-s-val');
          const cur = document.getElementById('cw-cursor');
          if (hh) hh.value = String(Math.round(hue));
          if (ss) ss.value = String(Math.round(sat));
          if (hv) hv.textContent = String(Math.round(hue));
          if (sv) sv.textContent = String(Math.round(sat));
          if (cur) {
            const clamped = Math.min(dist, rad);
            const ang = Math.atan2(dy, dx);
            cur.style.left = `${cx + Math.cos(ang) * clamped}px`;
            cur.style.top = `${cy + Math.sin(ang) * clamped}px`;
          }
          OS._bndzWheelDragging = true;
          OS._hsbToFg?.();
          OS._bndzWheelDragging = false;
        });
      };
      cv.addEventListener('pointerdown', (e) => {
        dragging = true;
        rect = cv.getBoundingClientRect();
        cv.setPointerCapture?.(e.pointerId);
        pick(e);
      });
      cv.addEventListener('pointermove', (e) => { if (dragging) pick(e); });
      const end = (e) => {
        dragging = false;
        rect = null;
        try { cv.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
        OS._syncSwatchGridSelection?.(OS.state?.fgColor);
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
    };

    const origSync = OS._syncSwatchGridSelection?.bind(OS);
    if (origSync) {
      OS._syncSwatchGridSelection = function (color) {
        if (OS._bndzWheelDragging) return;
        const root = document.getElementById('color-swatches')
          || document.getElementById('ptg2-color')
          || document.getElementById('panels');
        const safe = OS._validHexColor?.(color) || color;
        if (!root || !safe) return origSync(color);
        root.querySelectorAll('[role="gridcell"][data-os-swatch-color]').forEach((cell) => {
          cell.setAttribute('aria-selected', cell.dataset.osSwatchColor === safe ? 'true' : 'false');
        });
      };
    }
  }

  function upgradeNativeColorInputs() {
    document.querySelectorAll('input[type="color"]').forEach((input) => {
      if (input.dataset.bndzChip === '1') return;
      if (input.id === 'fg-picker' || input.id === 'bg-picker') {
        input.classList.add('bndz-hidden-native');
        return;
      }
      if (input.style.display === 'none' || input.hidden) return;
      // Hidden proxy pickers paired with visible .bndz-color-chip spans
      if (input.style.opacity === '0' || input.style.pointerEvents === 'none') return;
      input.dataset.bndzChip = '1';
      input.classList.add('bndz-color-chip');
      const sync = () => { input.style.backgroundColor = input.value; };
      sync();
      input.addEventListener('input', sync);
      input.addEventListener('change', sync);
    });
  }

  function skipServiceWorkerInEmbed(OS) {
    if (document.documentElement.dataset.bndzEmbed !== '1') return;
    const orig = OS._initOfflineSupport?.bind(OS);
    if (!orig) return;
    OS._initOfflineSupport = function () {
      /* Embed loads assets from BNDZ host — skip PWA SW cache races. */
      OS._setOfflineState?.({ lane: 'hosted', shellReady: true, installed: false });
    };
  }

  function installHsvPopover(OS) {
    if (!window.BndzHsvPopover?.mount) return;
    const fg = document.getElementById('fg-color');
    const bg = document.getElementById('bg-color');
    if (fg) fg.dataset.bndzColorTarget = 'fg';
    if (bg) bg.dataset.bndzColorTarget = 'bg';
    // Real DOM ids (Layer Style / Text FX) — previous map used typos and never bound.
    const targetById = {
      'fg-color': 'fg', 'bg-color': 'bg',
      'shape-fill': 'fg', 'shape-stroke': 'stroke',
      'pen-stroke': 'fg', 'text-color': 'fg',
      'grad-from': 'fg', 'grad-to': 'bg', 'grad-mid': 'local',
      'poly-fill': 'fg', 'poly-stroke': 'stroke',
      'star-fill': 'fg', 'pattern-color': 'fg',
      'grad-from-chip': 'fg',
      'ls-ds-color': 'local', 'ls-og-color': 'local', 'ls-st-color': 'local',
      'tfx-color': 'local', 'tfx-stroke-color': 'local',
      'wm-color': 'local',
      'gm-c1': 'local', 'gm-c2': 'local', 'gm-c3': 'local',
      'adj-pf-color': 'local', 'adj-rc-src': 'local', 'adj-rc-tgt': 'local',
      'fd-shadow': 'local', 'fd-high': 'local',
      'ct-color': 'local', 'es-matte': 'local',
      'text-decoration-color': 'local',
    };
    Object.entries(targetById).forEach(([id, target]) => {
      const el = document.getElementById(id);
      if (el) el.dataset.bndzColorTarget = target;
    });
    window.__BNDZ_HSV_POP__ = window.BndzHsvPopover.mount({
      targetById,
      getColor: (target) => {
        if (target === 'stroke') return OS.state.shapeStroke || OS.state.fgColor;
        if (target === 'bg') return OS.state.bgColor;
        return OS.state.fgColor;
      },
      setColor: (hex, _a, target, el) => {
        if (target === 'stroke') {
          if (typeof OS.setShapeStroke === 'function') OS.setShapeStroke(hex);
          else OS.setFgColor(hex);
        } else if (target === 'bg') OS.setBgColor(hex);
        else if (target === 'fg') OS.setFgColor(hex);
        // local: popover already wrote el.value + dispatched change
        else if (el && typeof OS.previewLayerStyle === 'function' && String(el.id || '').startsWith('ls-')) {
          try { OS.previewLayerStyle(); } catch { /* ignore */ }
        }
      },
      getAlpha: () => 1,
      openNative: (target, el) => {
        if (el && el.type === 'color') { el.click(); return; }
        const id = target === 'bg' ? 'bg-picker' : (target === 'stroke' ? 'shape-stroke' : 'fg-picker');
        document.getElementById(id)?.click();
      },
    });
  }

  function installPanelDock(OS) {
    const panels = document.getElementById('panels');
    if (!panels || panels.dataset.bndzDock === '1') return;
    panels.dataset.bndzDock = '1';
    const DOCKS = ['right', 'left', 'bottom'];
    let dragGroup = null;
    let dragOrigin = null;
    let zonesShown = false;

    let zones = document.getElementById('bndz-dock-zones');
    if (!zones) {
      zones = document.createElement('div');
      zones.id = 'bndz-dock-zones';
      zones.innerHTML = DOCKS.map((d) => `<div class="bndz-dock-zone" data-dock="${d}">${d}</div>`).join('');
      document.body.appendChild(zones);
      const zcss = document.createElement('style');
      zcss.textContent = `#bndz-dock-zones{display:none;position:fixed;inset:0;z-index:13000;pointer-events:none}
#bndz-dock-zones.show{display:block;pointer-events:none}
.bndz-dock-zone{position:absolute;pointer-events:none;display:grid;place-items:center;font:700 11px system-ui;letter-spacing:.08em;text-transform:uppercase;color:#dce9ff;background:rgba(13,153,255,.18);border:1px dashed rgba(13,153,255,.55);transition:background .12s,border-color .12s}
.bndz-dock-zone.hot{background:rgba(13,153,255,.38);border-color:#7ec8ff;color:#fff}
.bndz-dock-zone[data-dock="left"]{left:0;top:12%;bottom:12%;width:72px}
.bndz-dock-zone[data-dock="right"]{right:0;top:12%;bottom:12%;width:72px}
.bndz-dock-zone[data-dock="bottom"]{left:20%;right:20%;bottom:48px;height:56px}
.bndz-dock-dragging{opacity:.85;outline:1px solid rgba(13,153,255,.5)}
#panels.bndz-dock-left{right:auto!important;left:var(--toolbar-w)!important;border-left:0!important;border-right:1px solid var(--border)!important}
#canvas-area.bndz-dock-left,#tool-options.bndz-dock-left,#bottom-tabs.bndz-dock-left{left:calc(var(--toolbar-w) + var(--panel-width))!important;right:var(--rail-w)!important}
#panels.bndz-dock-bottom{top:auto!important;left:var(--toolbar-w)!important;right:var(--rail-w)!important;bottom:var(--statusbar-h)!important;width:auto!important;height:min(42vh,360px)!important;flex-direction:row!important;border-left:0!important;border-top:1px solid var(--border)!important}
#canvas-area.bndz-dock-bottom{bottom:calc(var(--statusbar-h) + var(--bottom-tabs-h) + min(42vh,360px))!important;right:var(--rail-w)!important}`;
      document.head.appendChild(zcss);
    }

    function applyDock(dock, { silent = false } = {}) {
      const canvas = document.getElementById('canvas-area');
      const toolOpts = document.getElementById('tool-options');
      const tabs = document.getElementById('bottom-tabs');
      [panels, canvas, toolOpts, tabs].forEach((el) => {
        el?.classList.remove('bndz-dock-left', 'bndz-dock-bottom', 'bndz-dock-right');
      });
      const cls = dock === 'left' ? 'bndz-dock-left' : dock === 'bottom' ? 'bndz-dock-bottom' : 'bndz-dock-right';
      [panels, canvas, toolOpts, tabs].forEach((el) => el?.classList.add(cls));
      try {
        OS._prefs = OS._prefs || {};
        OS._prefs.panelDock = dock;
        try { localStorage.setItem('os_panel_dock', dock); } catch { /* ignore */ }
        OS._persistPreferences?.();
      } catch { /* ignore */ }
      OS._syncCanvasLayoutForPanelRail?.();
      OS.resizeCanvas?.();
      if (!silent) OS.toast?.('Panels docked ' + dock, 'info');
    }

    function hitDockAt(clientX, clientY) {
      // Geometry hit-test — zones use pointer-events:none and are hidden on
      // pointerup, so elementFromPoint never sees them.
      let best = null;
      zones.querySelectorAll('.bndz-dock-zone').forEach((z) => {
        const r = z.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          best = z.dataset.dock || null;
        }
      });
      return best;
    }

    function persistPanelOrder() {
      try {
        const order = [...panels.querySelectorAll('.panel-tab-group')].map((g, i) => g.dataset.bndzTitle || String(i));
        localStorage.setItem('os_panel_order', JSON.stringify(order));
        OS._prefs = OS._prefs || {};
        OS._prefs.panelOrder = order;
      } catch { /* ignore */ }
    }

    function endDrag(e) {
      if (!dragGroup) return;
      const moved = dragOrigin && Math.hypot(e.clientX - dragOrigin.x, e.clientY - dragOrigin.y) > 8;
      const dock = (moved && zonesShown) ? hitDockAt(e.clientX, e.clientY) : null;
      zones.classList.remove('show');
      zones.querySelectorAll('.bndz-dock-zone').forEach((z) => z.classList.remove('hot'));
      dragGroup.classList.remove('bndz-dock-dragging');
      if (dock) applyDock(dock);
      persistPanelOrder();
      dragGroup = null;
      dragOrigin = null;
      zonesShown = false;
    }

    panels.querySelectorAll('.panel-tab-group').forEach((group) => {
      const header = group.querySelector('.panel-tabs') || group.firstElementChild;
      if (!header || header.dataset.bndzDockBound === '1') return;
      header.dataset.bndzDockBound = '1';
      header.style.cursor = 'grab';
      header.title = ((header.title || '') + ' · Drag to reorder / dock left·right·bottom').trim();
      header.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('button,input,select,a')) return;
        dragGroup = group;
        dragOrigin = { x: e.clientX, y: e.clientY };
        zonesShown = false;
        header.style.cursor = 'grabbing';
        group.classList.add('bndz-dock-dragging');
        // Do NOT setPointerCapture — it blocks zone hit-testing on drop.
      });
    });

    window.addEventListener('pointermove', (e) => {
      if (!dragGroup) return;
      if (!zonesShown && dragOrigin && Math.hypot(e.clientX - dragOrigin.x, e.clientY - dragOrigin.y) > 8) {
        zones.classList.add('show');
        zonesShown = true;
      }
      // Reorder within panel stack
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.panel-tab-group');
      if (over && over !== dragGroup && panels.contains(over)) {
        const rect = over.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) panels.insertBefore(dragGroup, over);
        else panels.insertBefore(dragGroup, over.nextSibling);
      }
      if (zonesShown) {
        zones.querySelectorAll('.bndz-dock-zone').forEach((z) => {
          const r = z.getBoundingClientRect();
          const hot = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          z.classList.toggle('hot', hot);
        });
      }
    });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    function restorePanelOrder() {
      try {
        const raw = localStorage.getItem('os_panel_order');
        if (!raw) return;
        const order = JSON.parse(raw);
        if (!Array.isArray(order) || !order.length) return;
        const groups = [...panels.querySelectorAll('.panel-tab-group')];
        order.forEach((title) => {
          const g = groups.find((el) => el.dataset.bndzTitle === title);
          if (g) panels.appendChild(g);
        });
      } catch { /* ignore */ }
    }

    // Prefer localStorage — OS._prefs.panelDock defaults to 'right' before init restores prefs.
    function restoreDockSide() {
      try {
        const ls = localStorage.getItem('os_panel_dock');
        const fromPrefs = OS._prefs?.panelDock;
        const saved = (ls && DOCKS.includes(ls)) ? ls
          : (fromPrefs && DOCKS.includes(fromPrefs) ? fromPrefs : null);
        if (saved) applyDock(saved, { silent: true });
      } catch { /* ignore */ }
    }

    OS._bndzApplyPanelDock = applyDock;
    OS._bndzRestorePanelDock = () => { restorePanelOrder(); restoreDockSide(); };
    // Dock side can restore now; panel *order* waits until bndzTitle labels are stamped after init.
    restoreDockSide();
  }

  function install(OS) {
    if (!OS || OS.__bndzChromeInstalled) return;
    OS.__bndzChromeInstalled = true;
    injectCraftCss();
    installZoomFixes(OS);
    installColorWheel(OS);
    installHsvPopover(OS);
    installPanelDock(OS);
    skipServiceWorkerInEmbed(OS);
    restoreInspectorPanels();

    const origBuild = OS._buildToolboxFromRegistry?.bind(OS);
    if (origBuild) {
      OS._buildToolboxFromRegistry = function bndzBuildToolbox() {
        const toolbar = document.getElementById('toolbar');
        if (toolbar) {
          delete toolbar.dataset.registryBuilt;
          seedToolbarIcons(toolbar);
        }
        const result = origBuild();
        paintToolboxIcons();
        requestAnimationFrame(() => {
          paintToolboxIcons();
          watchFlyoutOpenState();
        });
        setTimeout(() => {
          paintToolboxIcons();
          watchFlyoutOpenState();
        }, 50);
        return result;
      };
    }

    const origGroups = OS.initToolGroups?.bind(OS);
    if (origGroups) {
      OS.initToolGroups = function () {
        origGroups();
        paintToolboxIcons();
        watchFlyoutOpenState();
        requestAnimationFrame(paintToolboxIcons);
        setTimeout(paintToolboxIcons, 80);
      };
    }

    const origClose = OS._closeAllFlyouts?.bind(OS);
    if (origClose) {
      OS._closeAllFlyouts = function () {
        origClose();
        document.documentElement.classList.remove('bndz-flyout-open');
      };
    }

    const origDelete = OS.deleteLayer?.bind(OS);
    if (origDelete && !OS.__bndzDeleteWrapped) {
      OS.__bndzDeleteWrapped = true;
      OS.deleteLayer = function (opts) {
        return origDelete(opts || { force: true });
      };
    }

    const origLayers = OS.updateLayersPanel?.bind(OS);
    if (origLayers) {
      OS.updateLayersPanel = function () {
        origLayers();
        enhanceLayerRows(OS);
      };
    }

    const origInitCtx = OS.initContextMenu?.bind(OS);
    if (origInitCtx) {
      OS.initContextMenu = function () {
        origInitCtx();
        const menu = document.getElementById('context-menu');
        if (!menu || menu.dataset.bndzCtxIcons === '1') return;
        menu.dataset.bndzCtxIcons = '1';
        const decorate = () => {
          if (!menu.classList.contains('visible')) return;
          menu.querySelectorAll('.ctx-item:not([data-bndz-icon])').forEach((item) => {
            const label = item.querySelector('span')?.textContent?.trim();
            const key = label?.includes('Last Filter') ? 'Clear Filters' : label;
            const icon = CTX_ICONS[key] || CTX_ICONS[label];
            if (!icon) return;
            const el = document.createElement('span');
            el.className = 'ctx-icon';
            el.innerHTML = icon;
            item.prepend(el);
            item.dataset.bndzIcon = '1';
          });
        };
        new MutationObserver(decorate).observe(menu, { attributes: true, attributeFilter: ['class'] });
      };
    }

    const origApplyOpts = OS._applyToolOptions?.bind(OS);
    if (origApplyOpts) {
      OS._applyToolOptions = function (tool) {
        const schema = origApplyOpts(tool);
        syncOptionsToolChip(OS);
        paintToolboxIcons();
        return schema;
      };
    }

    const origSetTool = OS.setTool?.bind(OS);
    if (origSetTool) {
      OS.setTool = function (tool) {
        const result = origSetTool(tool);
        paintToolboxIcons();
        syncOptionsToolChip(OS);
        return result;
      };
    }

    setTimeout(() => {
      upgradeNativeColorInputs();
      syncOptionsToolChip(OS);
      paintToolboxIcons();
    }, 200);
    setTimeout(upgradeNativeColorInputs, 800);
    setTimeout(restoreInspectorPanels, 300);
    const flyHost = document.getElementById('flyout-host');
    if (flyHost && !flyHost.dataset.bndzPaintObs) {
      flyHost.dataset.bndzPaintObs = '1';
      // Only react to structural adds (new flyout rows), not our own icon paints.
      new MutationObserver((mutations) => {
        if (paintToolboxIcons._busy) return;
        const added = mutations.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches?.('.tool-btn') || n.querySelector?.('.tool-btn'))));
        if (added) paintToolboxIcons();
      }).observe(flyHost, { childList: true, subtree: true });
    }
    document.addEventListener('click', () => {
      document.getElementById('context-menu')?.classList.remove('visible');
    }, true);
  }

  window.__BNDZ_STUDIO_CHROME__ = { install, TOOL_SVGS, CTX_ICONS, paintToolboxIcons };
})();
