/**
 * BND1 directory listing binary codec — mirrors BNDZBackend/Services/DirListingSharedBuffer.cs
 * Decode SharedBuffer ArrayBuffer → plain file-list objects for the React UI.
 */

const MAGIC = 0x31444e42; // 'BND1' LE
const VERSION = 1;
const TYPE_FILE = 1;
const TYPE_DIRECTORY = 2;

const ATTR_HIDDEN = 1 << 0;
const ATTR_SYSTEM = 1 << 1;
const ATTR_READONLY = 1 << 2;
const ATTR_ARCHIVE = 1 << 3;
const ATTR_COMPRESSED = 1 << 4;
const ATTR_ENCRYPTED = 1 << 5;
const ATTR_REPARSE = 1 << 6;
const ATTR_SHELL = 1 << 7;

function attrNames(bits: number): string[] {
  const out: string[] = [];
  if (bits & ATTR_HIDDEN) out.push('hidden');
  if (bits & ATTR_SYSTEM) out.push('system');
  if (bits & ATTR_READONLY) out.push('readonly');
  if (bits & ATTR_ARCHIVE) out.push('archive');
  if (bits & ATTR_COMPRESSED) out.push('compressed');
  if (bits & ATTR_ENCRYPTED) out.push('encrypted');
  if (bits & ATTR_REPARSE) out.push('reparse');
  return out;
}

function ticksToIso(utcTicks: bigint | number): string {
  // .NET DateTime ticks are 100ns since 0001-01-01; JS epoch is 1970-01-01.
  // Ticks at Unix epoch = 621355968000000000
  const ticks = typeof utcTicks === 'bigint' ? utcTicks : BigInt(utcTicks);
  const unixMs = Number((ticks - 621355968000000000n) / 10000n);
  return new Date(unixMs).toISOString();
}

function readUtf8(view: DataView, offset: number, len: number, decoder: TextDecoder): { text: string; next: number } {
  if (len <= 0) return { text: '', next: offset };
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, len);
  return { text: decoder.decode(bytes), next: offset + len };
}

/** Decode a BND1 SharedBuffer payload into the same shape as legacy DIR_CONTENTS_RESULT. */
export function decodeBnd1DirListing(buffer: ArrayBuffer): any[] {
  const view = new DataView(buffer);
  if (view.byteLength < 10) throw new Error('BND1 buffer too small');
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) throw new Error(`BND1 bad magic 0x${magic.toString(16)}`);
  const version = view.getUint16(4, true);
  if (version !== VERSION) throw new Error(`BND1 unsupported version ${version}`);
  const count = view.getUint32(6, true);
  const decoder = new TextDecoder('utf-8');
  const items: any[] = new Array(count);
  let o = 10;

  for (let i = 0; i < count; i++) {
    if (o + 38 > view.byteLength) throw new Error('BND1 truncated entry header');
    const typeByte = view.getUint8(o); o += 1;
    const attrBits = view.getUint8(o); o += 1;
    const size = Number(view.getBigInt64(o, true)); o += 8;
    const modifiedTicks = view.getBigInt64(o, true); o += 8;
    const createdTicks = view.getBigInt64(o, true); o += 8;
    const nameLen = view.getUint16(o, true); o += 2;
    const pathLen = view.getUint16(o, true); o += 2;
    const extLen = view.getUint16(o, true); o += 2;
    const labelLen = view.getUint16(o, true); o += 2;
    const commentLen = view.getUint16(o, true); o += 2;
    const tagCount = view.getUint16(o, true); o += 2;

    let name: string, path: string, extension: string, label: string, comment: string;
    ({ text: name, next: o } = readUtf8(view, o, nameLen, decoder));
    ({ text: path, next: o } = readUtf8(view, o, pathLen, decoder));
    ({ text: extension, next: o } = readUtf8(view, o, extLen, decoder));
    ({ text: label, next: o } = readUtf8(view, o, labelLen, decoder));
    ({ text: comment, next: o } = readUtf8(view, o, commentLen, decoder));

    const tags: string[] = [];
    for (let t = 0; t < tagCount; t++) {
      const tl = view.getUint16(o, true); o += 2;
      let tag: string;
      ({ text: tag, next: o } = readUtf8(view, o, tl, decoder));
      tags.push(tag);
    }

    const item: any = {
      id: path || name,
      name,
      type: typeByte === TYPE_DIRECTORY ? 'directory' : 'file',
      path,
      size,
      extension,
      modified: ticksToIso(modifiedTicks),
      created: ticksToIso(createdTicks),
      attributes: attrNames(attrBits),
    };
    if (attrBits & ATTR_SHELL) item.isShellItem = true;
    if (label) item.label = label;
    if (comment) item.comment = comment;
    if (tags.length) item.tags = tags;
    items[i] = item;
  }

  return items;
}
