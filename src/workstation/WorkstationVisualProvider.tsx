import React, { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { deriveSelectionSignature, type SelectionSignature } from './selectionSignature';
import {
  getMotionPhaseSnapshot,
  resetMotionBus,
  setMotionDragPhase,
  setMotionSnapTension,
  subscribeMotionPhase,
  type DragPhase,
} from './workstationMotionBus';
import { probeWebGL } from './webglProbe';

type SnapTarget = { id: string; rect: DOMRect; strength: number };

type WorkstationVisualContextValue = {
  selectionSignature: SelectionSignature;
  dragPhase: DragPhase;
  snapTension: number;
  gpuInspectionEnabled: boolean;
  registerSnapTarget: (id: string, rect: DOMRect, strength: number) => void;
  clearSnapTargets: () => void;
  setDragPhase: (phase: DragPhase) => void;
};

const WorkstationVisualContext = createContext<WorkstationVisualContextValue | null>(null);

const snapTargets = new Map<string, SnapTarget>();

function recomputeSnapTension() {
  if (!snapTargets.size) {
    setMotionSnapTension(0);
    return;
  }
  const max = Math.max(...[...snapTargets.values()].map(t => t.strength));
  setMotionSnapTension(max);
}

type Props = {
  children: React.ReactNode;
  selectedPaths?: string[];
  selectedTypes?: string[];
  focusedEntity?: { name?: string; extension?: string; type?: string; path?: string } | null;
  gpuInspection?: boolean;
};

export function WorkstationVisualProvider({
  children,
  selectedPaths = [],
  selectedTypes = [],
  focusedEntity = null,
  gpuInspection = true,
}: Props) {
  const motion = useSyncExternalStore(subscribeMotionPhase, getMotionPhaseSnapshot, getMotionPhaseSnapshot);

  const selectionSignature = useMemo(
    () => deriveSelectionSignature(selectedPaths, selectedTypes, focusedEntity),
    [selectedPaths, selectedTypes, focusedEntity],
  );

  const registerSnapTarget = useCallback((id: string, rect: DOMRect, strength: number) => {
    snapTargets.set(id, { id, rect, strength });
    recomputeSnapTension();
  }, []);

  const clearSnapTargets = useCallback(() => {
    snapTargets.clear();
    setMotionSnapTension(0);
  }, []);

  const setDragPhase = useCallback((phase: DragPhase) => {
    setMotionDragPhase(phase);
    if (phase === 'idle') {
      clearSnapTargets();
      resetMotionBus();
    }
  }, [clearSnapTargets]);

  const value = useMemo<WorkstationVisualContextValue>(() => ({
    selectionSignature,
    dragPhase: motion.dragPhase,
    snapTension: motion.snapTension,
    gpuInspectionEnabled: gpuInspection !== false && probeWebGL(),
    registerSnapTarget,
    clearSnapTargets,
    setDragPhase,
  }), [
    selectionSignature,
    motion.dragPhase,
    motion.snapTension,
    gpuInspection,
    registerSnapTarget,
    clearSnapTargets,
    setDragPhase,
  ]);

  return (
    <WorkstationVisualContext.Provider value={value}>
      {children}
    </WorkstationVisualContext.Provider>
  );
}

export function useWorkstationVisual(): WorkstationVisualContextValue {
  const ctx = useContext(WorkstationVisualContext);
  if (!ctx) {
    return {
      selectionSignature: { kind: 'empty' },
      dragPhase: 'idle',
      snapTension: 0,
      gpuInspectionEnabled: probeWebGL(),
      registerSnapTarget: () => {},
      clearSnapTargets: () => {},
      setDragPhase: () => {},
    };
  }
  return ctx;
}
