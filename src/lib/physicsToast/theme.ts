import type { ToastKind } from '../../components/ToastHost';

export const PHYSICS_TOAST_WIDTH = 360;
export const PHYSICS_TOAST_HEADER_H = 40;
export const PHYSICS_TOAST_RADIUS = 8;
export const PHYSICS_TOAST_BLUR = PHYSICS_TOAST_RADIUS * 0.5;
export const PHYSICS_TOAST_EXPAND_HEADER_H = PHYSICS_TOAST_HEADER_H + PHYSICS_TOAST_BLUR * 3;
export const PHYSICS_TOAST_FILTER_ID = 'bndz-physics-toast-gooey';

export const PHYSICS_TOAST_COLORS: Record<ToastKind, string> = {
  success: '#34d399',
  error: '#fb7185',
  warning: '#fbbf24',
  info: '#38bdf8',
  progress: '#a78bfa',
};

export const PHYSICS_TOAST_SURFACE = 'var(--bndz-surface-raised, #1a1d26)';
