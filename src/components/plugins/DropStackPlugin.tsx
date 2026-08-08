import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons8Icon, DragHandleGlyph } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import { formatUiPath, splitUiPath } from '../../lib/displayPath';
import { requestNativePrompt } from '../../lib/nativeDialog';
import {
  POINTER_FILE_DRAG_ACTIVE,
  POINTER_FILE_DRAG_END,
  POINTER_FILE_DRAG_MOVE,
} from '../../lib/pointerFileDragBridge';
import {
  loadDropStackLibrary,
  saveDropStackLibrary,
  type NamedDropStack,
} from '../../lib/dropStackStore';
import { pushToast } from '../ToastHost';
import PluginPanelShell from './PluginPanelShell';
import {
  PluginToolbarButton,
  PluginCard,
  PluginEmptyState,
  PluginHeroStrip,
  PluginHeroActionButton,
  PLUGIN_INPUT_CLASS,
} from './PluginPanelPrimitives';

export const DropStackPluginDef = {
  id: 'dropstack',
  name: 'Drop Stack',
  icon: 'dropstack',
  description: 'Stage files from multiple directories, then batch copy or move to the active pane.',
  targetPanel: 'bottom',
};

function splitPath(full: string): { leaf: string; parent: string } {
  const { leaf, parent } = splitUiPath(full);
  return { leaf, parent };
}

export default function DropStackPlugin({ focusedPath, selectedItems }: { focusedPath?: string; selectedItems?: string[] }) {
  const initial = useMemo(() => loadDropStackLibrary(), []);
  const [stacks, setStacks] = useState<NamedDropStack[]>(initial.stacks);
  const [activeId, setActiveId] = useState(initial.activeId);
  const [operating, setOperating] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [reorderIndex, setReorderIndex] = useState<number | null>(null);
  const [destPath, setDestPath] = useState('');
  const [keepAfter, setKeepAfter] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const reorderFromRef = useRef<number | null>(null);
  const reorderToRef = useRef<number | null>(null);

  const stack = stacks.find(s => s.id === activeId) || stacks[0];
  const items = stack?.items || [];

  useEffect(() => {
    saveDropStackLibrary(stacks, activeId);
  }, [stacks, activeId]);

  // Sync if paths were staged while this tab was unmounted / from another surface.
  useEffect(() => {
    const sync = () => {
      const lib = loadDropStackLibrary();
      setStacks(lib.stacks);
      setActiveId(lib.activeId);
    };
    window.addEventListener('bndz-drop-stack-stage', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('bndz-drop-stack-stage', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    if (focusedPath && !destPath) setDestPath(toWindowsPath(focusedPath));
  }, [focusedPath, destPath]);

  const updateActiveItems = useCallback((next: string[] | ((prev: string[]) => string[])) => {
    setStacks(prev => prev.map(s => {
      if (s.id !== activeId) return s;
      const itemsNext = typeof next === 'function' ? next(s.items) : next;
      return { ...s, items: itemsNext };
    }));
  }, [activeId]);

  const addPaths = useCallback((paths: string[]) => {
    const normalized = paths.map(toWindowsPath).filter(Boolean);
    if (!normalized.length) return;
    updateActiveItems(prev => [...new Set([...prev, ...normalized])]);
    pushToast({ kind: 'success', title: 'Added to stack', message: `${normalized.length} item(s) staged.` });
  }, [updateActiveItems]);

  // Light the glass zone only during real file drags (OLE / pointer session), not idle hover.
  useEffect(() => {
    const hitZone = (clientX: number, clientY: number) => {
      const over = document.elementsFromPoint(clientX, clientY).some(
        el => !!(el as HTMLElement).closest?.('[data-drop-stack-zone], [data-plugin-tab-id="dropstack"]'),
      );
      setDragOver(over);
    };
    const onExternalHover = (e: Event) => {
      const detail = (e as CustomEvent<{ webViewX?: number; webViewY?: number }>).detail || {};
      if (typeof detail.webViewX !== 'number' || typeof detail.webViewY !== 'number') return;
      hitZone(detail.webViewX, detail.webViewY);
    };
    const onPointerMove = (e: Event) => {
      const { clientX, clientY } = (e as CustomEvent<{ clientX: number; clientY: number }>).detail;
      hitZone(clientX, clientY);
    };
    const clear = () => setDragOver(false);
    const onPointerActive = (e: Event) => {
      if (!(e as CustomEvent<{ active?: boolean }>).detail?.active) clear();
    };
    const onPointerEnd = () => clear();
    window.addEventListener('bndz-external-drag-hover', onExternalHover);
    window.addEventListener('bndz-external-drop', clear);
    window.addEventListener('bndz-external-drop-failed', clear);
    window.addEventListener(POINTER_FILE_DRAG_MOVE, onPointerMove);
    window.addEventListener(POINTER_FILE_DRAG_ACTIVE, onPointerActive);
    window.addEventListener(POINTER_FILE_DRAG_END, onPointerEnd);
    return () => {
      window.removeEventListener('bndz-external-drag-hover', onExternalHover);
      window.removeEventListener('bndz-external-drop', clear);
      window.removeEventListener('bndz-external-drop-failed', clear);
      window.removeEventListener(POINTER_FILE_DRAG_MOVE, onPointerMove);
      window.removeEventListener(POINTER_FILE_DRAG_ACTIVE, onPointerActive);
      window.removeEventListener(POINTER_FILE_DRAG_END, onPointerEnd);
    };
  }, []);

  const addSelected = () => {
    if (!selectedItems?.length) return;
    addPaths(selectedItems);
  };

  const clearStack = () => {
    updateActiveItems([]);
    setSelected(new Set());
  };

  const removeStackItem = (item: string) => {
    updateActiveItems(prev => prev.filter(i => i !== item));
    setSelected(prev => {
      const next = new Set(prev);
      next.delete(item);
      return next;
    });
  };

  const moveItem = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    updateActiveItems(prev => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const beginReorder = (index: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    reorderFromRef.current = index;
    setReorderIndex(index);
    const startY = e.clientY;
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - e.clientX, ev.clientY - startY) < 4) return;
      dragging = true;
      const rows = Array.from(document.querySelectorAll('[data-drop-stack-item]'));
      let target = index;
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
        if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
          target = i;
          break;
        }
      }
      setReorderIndex(target);
      reorderToRef.current = target;
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const from = reorderFromRef.current;
      const to = reorderToRef.current ?? from;
      reorderFromRef.current = null;
      reorderToRef.current = null;
      setReorderIndex(null);
      if (from != null && dragging && to != null && from !== to) moveItem(from, to);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const browseDest = async () => {
    const picked = await IPC.openFolderDialog('Select drop stack destination');
    if (picked) setDestPath(picked);
  };

  const transferPaths = selected.size ? items.filter(p => selected.has(p)) : items;

  const executeBatch = async (action: 'copy' | 'move') => {
    const targetDir = (destPath || (focusedPath ? toWindowsPath(focusedPath) : '')).replace(/\\$/, '');
    if (!transferPaths.length || !targetDir || operating) return;
    setOperating(true);
    try {
      const operationId = `dropstack-${action}-${Date.now()}`;
      const label = `Drop stack ${action} (${transferPaths.length} items)`;
      await IPC.executeFsOperation(operationId, action, transferPaths, targetDir, false, label, 'normal');
      pushToast({ kind: 'success', title: action === 'copy' ? 'Copied' : 'Moved', message: `${transferPaths.length} item(s) queued to ${targetDir}` });
      if (!keepAfter) {
        if (selected.size) {
          updateActiveItems(prev => prev.filter(p => !selected.has(p)));
          setSelected(new Set());
        } else {
          clearStack();
        }
      }
    } catch {
      pushToast({ kind: 'error', title: 'Transfer failed', message: 'Could not queue drop stack transfer.' });
    } finally {
      setOperating(false);
    }
  };

  const newStack = () => {
    const s: NamedStack = { id: uid(), name: `Stack ${stacks.length + 1}`, items: [] };
    setStacks(prev => [...prev, s]);
    setActiveId(s.id);
    setSelected(new Set());
  };

  const renameActive = async () => {
    const name = await requestNativePrompt({
      title: 'Rename drop stack',
      message: 'Stack name',
      defaultValue: stack?.name || 'Stack',
    });
    if (!name?.trim()) return;
    setStacks(prev => prev.map(s => s.id === activeId ? { ...s, name: name.trim() } : s));
  };

  const deleteActive = () => {
    if (stacks.length <= 1) {
      clearStack();
      return;
    }
    const remaining = stacks.filter(s => s.id !== activeId);
    setStacks(remaining);
    setActiveId(remaining[0].id);
    setSelected(new Set());
  };

  const toggleSelect = (item: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  };

  return (
    <PluginPanelShell
      title="Drop Stack"
      icon="dropstack"
      iconColor="#a78bfa"
      variant="embedded"
      subtitle="Named stashes · selective transfer"
    >
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        <PluginHeroStrip
          icon={<Icons8Icon id="dropstack" size={52} className="opacity-90" />}
          name={stack?.name || 'Drop Stack'}
          typeLabel="Batch queue"
          path={destPath || focusedPath || undefined}
          meta={
            <span className="bndz-panel-muted text-xs">
              {items.length} staged · {selected.size ? `${selected.size} selected` : 'all'} · {stacks.length} stack(s)
            </span>
          }
          actions={
            <>
              <PluginHeroActionButton icon="plus_ui" variant="primary" onClick={addSelected} disabled={!selectedItems?.length}>Add selection</PluginHeroActionButton>
              <PluginHeroActionButton icon="copy" onClick={() => void executeBatch('copy')} disabled={!transferPaths.length || operating}>Copy</PluginHeroActionButton>
              <PluginHeroActionButton icon="chevron_right" onClick={() => void executeBatch('move')} disabled={!transferPaths.length || operating}>Move</PluginHeroActionButton>
              <PluginHeroActionButton icon="delete" onClick={clearStack} disabled={!items.length}>Clear</PluginHeroActionButton>
            </>
          }
        />
        <div className="flex flex-1 h-full gap-4 p-5 min-h-0">
          <PluginCard className="w-[320px] !p-0 flex flex-col overflow-hidden shrink-0">
            <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2 bg-white/[0.02]">
              <select
                value={activeId}
                onChange={e => { setActiveId(e.target.value); setSelected(new Set()); }}
                className={`${PLUGIN_INPUT_CLASS} !py-1 flex-1 min-w-0`}
              >
                {stacks.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.items.length})</option>
                ))}
              </select>
              <PluginToolbarButton icon="plus_ui" onClick={newStack} title="New stack">New</PluginToolbarButton>
              <PluginToolbarButton icon="rename" onClick={renameActive} title="Rename">Rename</PluginToolbarButton>
              <PluginToolbarButton icon="delete" onClick={deleteActive} title="Delete stack">Del</PluginToolbarButton>
            </div>
            <div className="px-3 py-1.5 border-b border-white/[0.06] flex items-center gap-2 text-[10px] text-white/45">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={keepAfter} onChange={e => setKeepAfter(e.target.checked)} />
                Keep after transfer
              </label>
              <button
                type="button"
                className="ml-auto hover:text-white/80"
                onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items))}
              >
                {selected.size === items.length && items.length ? 'Clear sel' : 'Select all'}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto bndz-scrollbar p-2 space-y-1.5 min-h-0">
              {items.length === 0 ? (
                <PluginEmptyState icon="dropstack" title="Stack empty" description="Drop files in the zone on the right, or add the current selection." />
              ) : items.map((item, i) => {
                const { leaf, parent } = splitPath(item);
                const isDragging = reorderIndex === i;
                const isSel = selected.has(item);
                return (
                  <div
                    key={item}
                    data-drop-stack-item
                    className={`flex items-center gap-2 rounded-lg px-2 py-2 group border transition-colors ${
                      isDragging
                        ? 'border-violet-400/40 bg-violet-500/10 opacity-70'
                        : isSel
                          ? 'border-sky-400/35 bg-sky-500/10'
                          : 'bg-black/25 border-white/[0.07] hover:border-violet-400/25 hover:bg-white/[0.03]'
                    }`}
                    title={item}
                  >
                    <input type="checkbox" checked={isSel} onChange={() => toggleSelect(item)} className="shrink-0" />
                    <div
                      className="flex flex-col items-center gap-0.5 shrink-0 opacity-40 group-hover:opacity-80 transition-opacity cursor-grab active:cursor-grabbing"
                      onPointerDown={e => beginReorder(i, e)}
                    >
                      <DragHandleGlyph size={11} className="text-violet-300/80" />
                      <span className="text-[9px] tabular-nums bndz-panel-muted leading-none">{i + 1}</span>
                    </div>
                    <Icons8Icon id="file_ui" size={14} className="shrink-0 opacity-60" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-slate-100 truncate leading-tight">{leaf}</div>
                      {parent && (
                        <div className="text-[10px] bndz-panel-muted bndz-mono truncate mt-0.5 leading-tight">{parent}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeStackItem(item)}
                      className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-300 shrink-0 p-1 rounded hover:bg-rose-500/10 transition-opacity"
                      title="Remove from stack"
                    >
                      <Icons8Icon id="delete" size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          </PluginCard>

          <div
            data-drop-stack-zone
            className={`bndz-dropstack-zone flex-1 flex flex-col justify-center items-center gap-3 min-w-0 px-3 sm:px-5 ${
              dragOver ? 'is-active' : ''
            }`}
          >
            <div className="bndz-dropstack-surface w-full max-w-xl">
              <div className="bndz-dropstack-frame">
                <div className="bndz-dropstack-aurora" aria-hidden>
                  <div className="bndz-dropstack-glow">
                    <div className="bndz-dropstack-blob bndz-dropstack-blob-a" />
                    <div className="bndz-dropstack-blob bndz-dropstack-blob-b" />
                    <div className="bndz-dropstack-blob bndz-dropstack-blob-c" />
                  </div>
                </div>
                <div className="bndz-dropstack-glass">
                  <div className="bndz-dropstack-copy">
                    <span className="bndz-dropstack-icon-well" aria-hidden>
                      <Icons8Icon id="upload" size={20} />
                    </span>
                    <span className="bndz-dropstack-title">
                      {dragOver ? 'Release to stage' : 'Drop files here or browse'}
                    </span>
                    <span className="bndz-dropstack-hint">
                      Stage from Explorer or the list — images, docs, folders…
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <PluginCard className="!py-2.5 !px-3 max-w-xl w-full space-y-2">
              <div className="bndz-plugin-section-title">Destination</div>
              <div className="flex items-center gap-1.5">
                <input
                  value={destPath}
                  onChange={e => setDestPath(e.target.value)}
                  placeholder="D:\Target\Folder"
                  className={`flex-1 min-w-0 ${PLUGIN_INPUT_CLASS} bndz-mono`}
                />
                <PluginToolbarButton icon="folder_open_ui" onClick={() => void browseDest()}>Browse</PluginToolbarButton>
              </div>
              {focusedPath && (
                <button
                  type="button"
                  className="bndz-dropstack-dest-link text-[10px]"
                  onClick={() => setDestPath(toWindowsPath(focusedPath))}
                >
                  Use active pane
                </button>
              )}
            </PluginCard>
          </div>
        </div>
      </div>
    </PluginPanelShell>
  );
}
