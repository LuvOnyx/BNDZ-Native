/** Persistent Drop Stack library + staging (works even when the plugin tab is unmounted). */
import { toWindowsPath } from './pathUtils';
import { pushToast } from '../components/ToastHost';

const LEGACY_KEY = 'bndz-dropstack-v1';
const STACKS_KEY = 'bndz-dropstacks-v2';

export type NamedDropStack = { id: string; name: string; items: string[] };

function uid() {
  return `stk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function loadDropStackLibrary(): { stacks: NamedDropStack[]; activeId: string } {
  try {
    const raw = localStorage.getItem(STACKS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.stacks) && parsed.stacks.length) {
        const stacks = parsed.stacks.map((s: any) => ({
          id: String(s.id || uid()),
          name: String(s.name || 'Stack'),
          items: Array.isArray(s.items) ? s.items.filter((p: unknown): p is string => typeof p === 'string') : [],
        }));
        const activeId = stacks.some((s: NamedDropStack) => s.id === parsed.activeId) ? parsed.activeId : stacks[0].id;
        return { stacks, activeId };
      }
    }
  } catch { /* fall through */ }
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    const items = legacy ? JSON.parse(legacy) : [];
    const stack: NamedDropStack = { id: uid(), name: 'Main', items: Array.isArray(items) ? items : [] };
    return { stacks: [stack], activeId: stack.id };
  } catch {
    const stack: NamedDropStack = { id: uid(), name: 'Main', items: [] };
    return { stacks: [stack], activeId: stack.id };
  }
}

export function saveDropStackLibrary(stacks: NamedDropStack[], activeId: string) {
  localStorage.setItem(STACKS_KEY, JSON.stringify({ stacks, activeId }));
  const active = stacks.find(s => s.id === activeId);
  if (active) localStorage.setItem(LEGACY_KEY, JSON.stringify(active.items));
}

/** Persist + notify UI. Safe when Drop Stack plugin is not mounted. */
export function appendDropStackPaths(rawPaths: string[]): string[] {
  const normalized = rawPaths.map(toWindowsPath).filter(Boolean);
  if (!normalized.length) return [];
  const { stacks, activeId } = loadDropStackLibrary();
  const active = stacks.find(s => s.id === activeId) || stacks[0];
  const before = active?.items.length ?? 0;
  const nextStacks = stacks.map(s => {
    if (s.id !== activeId) return s;
    return { ...s, items: [...new Set([...s.items, ...normalized])] };
  });
  const after = (nextStacks.find(s => s.id === activeId) || nextStacks[0])?.items.length ?? 0;
  saveDropStackLibrary(nextStacks, activeId);
  window.dispatchEvent(new CustomEvent('bndz-drop-stack-stage', {
    detail: { paths: normalized, added: Math.max(0, after - before) },
  }));
  if (after > before) {
    pushToast({ kind: 'success', title: 'Added to stack', message: `${after - before} item(s) staged.` });
  }
  return normalized;
}
