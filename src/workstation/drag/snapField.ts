export type SnapZone = {
  id: string;
  strength: number;
};

const zones = new Map<string, number>();

export function setSnapZone(id: string, active: boolean, strength = 0.85) {
  if (active) zones.set(id, strength);
  else zones.delete(id);
}

export function clearSnapZones() {
  zones.clear();
}

export function computeSnapTension(): number {
  if (!zones.size) return 0;
  return Math.max(...zones.values());
}

export function listSnapZones(): SnapZone[] {
  return [...zones.entries()].map(([id, strength]) => ({ id, strength }));
}
