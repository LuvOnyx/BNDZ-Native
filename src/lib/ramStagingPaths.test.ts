import { describe, expect, it } from 'vitest';
import { canonicalDropPath, resolveDropRoute, MESH_DROP_INBOX_DEST } from './fsPathRouting';
import { isFsDropTargetPath, isBndzRamWritablePath } from './bndzVirtualViews';

describe('RAM staging drop paths', () => {
  it('preserves /bndz/ram zone paths in canonicalDropPath', () => {
    expect(canonicalDropPath('/bndz/ram/zone-1')).toBe('/bndz/ram/zone-1');
    expect(canonicalDropPath('/bndz/ram/zone-1/sub')).toBe('/bndz/ram/zone-1/sub');
  });

  it('repairs mangled bndz\\ram\\… paths', () => {
    expect(canonicalDropPath('bndz\\ram\\zone-1')).toBe('/bndz/ram/zone-1');
    expect(canonicalDropPath('bndz/ram/zone-1/a')).toBe('/bndz/ram/zone-1/a');
  });

  it('treats zone paths as drop targets, not the picker root', () => {
    expect(isFsDropTargetPath('/bndz/ram')).toBe(false);
    expect(isFsDropTargetPath('/bndz/ram/zone-1')).toBe(true);
    expect(isBndzRamWritablePath('/bndz/ram/zone-1/sub')).toBe(true);
    expect(isFsDropTargetPath('/bndz/home')).toBe(false);
    expect(isFsDropTargetPath('/C:/Users')).toBe(true);
  });
});

describe('mesh-drop-send route', () => {
  it('routes inbox dest to mesh-drop-send', () => {
    const route = resolveDropRoute('copy', ['C:\\a\\b.txt'], MESH_DROP_INBOX_DEST);
    expect(route.kind).toBe('mesh-drop-send');
    if (route.kind === 'mesh-drop-send') {
      expect(route.paths.length).toBe(1);
    }
  });

  it('preserves MESH_DROP_INBOX_DEST in canonicalDropPath', () => {
    expect(canonicalDropPath(MESH_DROP_INBOX_DEST)).toBe(MESH_DROP_INBOX_DEST);
  });

  it('routes local→mesh as upload', () => {
    const route = resolveDropRoute('copy', ['C:\\a\\b.txt'], '/mesh/host-1/inbox');
    expect(route.kind).toBe('mesh-upload');
    if (route.kind === 'mesh-upload') {
      expect(route.hostId).toBe('host-1');
      expect(route.remoteDestDir).toBe('/inbox');
    }
  });

  it('routes mesh→local as download', () => {
    const route = resolveDropRoute('copy', ['/mesh/host-1/a/b.txt'], '/C:/Users/Public');
    expect(route.kind).toBe('mesh-download');
    if (route.kind === 'mesh-download') {
      expect(route.hostId).toBe('host-1');
    }
  });
});
