/**
 * Pack a PNG byte array into a single-image .ico (PNG-in-ICO).
 * Chromium/WebView2 accept this for favicons and downloads.
 */
(function (global) {
  'use strict';

  function pngToIcoBlob(pngBytes) {
    const bytes = pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes);
    const header = new ArrayBuffer(22);
    const view = new DataView(header);
    view.setUint16(0, 0, true); // reserved
    view.setUint16(2, 1, true); // type = icon
    view.setUint16(4, 1, true); // count
    view.setUint8(6, 0); // width 256
    view.setUint8(7, 0); // height 256
    view.setUint8(8, 0); // palette
    view.setUint8(9, 0); // reserved
    view.setUint16(10, 1, true); // planes
    view.setUint16(12, 32, true); // bit count
    view.setUint32(14, bytes.byteLength, true);
    view.setUint32(18, 22, true); // image offset
    return new Blob([header, bytes], { type: 'image/x-icon' });
  }

  async function dataUrlPngToIcoBlob(dataUrl) {
    const res = await fetch(dataUrl);
    const buf = await res.arrayBuffer();
    return pngToIcoBlob(new Uint8Array(buf));
  }

  async function downloadIcoFromPngDataUrl(dataUrl, filename) {
    const blob = await dataUrlPngToIcoBlob(dataUrl);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'icon.ico';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return blob;
  }

  global.BndzPngIco = { pngToIcoBlob, dataUrlPngToIcoBlob, downloadIcoFromPngDataUrl };
})(typeof window !== 'undefined' ? window : globalThis);
