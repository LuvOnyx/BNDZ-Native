import {
  BNDZ_AUTOMATION,
  BNDZ_INBOUND,
  BNDZ_LARGE,
  BNDZ_PROBLEMS,
  BNDZ_RAM_ROOT,
  BNDZ_RECENT,
  BNDZ_SANDBOX,
} from '../bndzVirtualViews';
import {
  createSticky,
  defaultCanvas,
  listSpatialBoards,
  saveSpatialCanvasNow,
  switchSpatialBoard,
  type CanvasItem,
  type SpatialCanvasDoc,
  type SpatialSticky,
} from '../spatialCanvasStore';

export const CONTINUUM_BOARD_ID = 'continuum-home';
export const CONTINUUM_BOARD_NAME = 'Continuum';

type PillarPin = {
  path: string;
  name: string;
  note: string;
  sticky: string;
};

/** Category demo pins — ≥5 live pillars with real virtual roots. */
const CONTINUUM_PILLARS: PillarPin[] = [
  {
    path: BNDZ_SANDBOX,
    name: 'Sandbox',
    note: 'Project sandbox sessions · commit / discard',
    sticky: 'Stage risky edits here before Commit.',
  },
  {
    path: BNDZ_PROBLEMS,
    name: 'Library Health',
    note: 'Live problems feed · one-click fixes',
    sticky: 'Sick badges open Health Problems.',
  },
  {
    path: BNDZ_INBOUND,
    name: 'Inbound',
    note: 'Capture volume · copy into library',
    sticky: 'Drop arrivals → Inbound capture.',
  },
  {
    path: BNDZ_RAM_ROOT,
    name: 'RAM Staging',
    note: 'ImDisk / AIM zones · flush from deck',
    sticky: 'Stage hot projects into RAM zones.',
  },
  {
    path: BNDZ_LARGE,
    name: 'Capacity pressure',
    note: 'Large files · feeds Capacity Solver',
    sticky: 'Pressure → Capacity what-if plan.',
  },
  {
    path: BNDZ_RECENT,
    name: 'Branch / recent',
    note: 'Recent activity · Branching Time tips',
    sticky: 'History → Branch scrub / restore.',
  },
  {
    path: BNDZ_AUTOMATION,
    name: 'Automation',
    note: 'Reactive pipelines · Continuum sync',
    sticky: 'Wire Continuum sync recipe here.',
  },
];

function layoutPillars(pins: PillarPin[]): { items: CanvasItem[]; stickies: SpatialSticky[] } {
  const cols = 4;
  const gapX = 260;
  const gapY = 220;
  const originX = 48;
  const originY = 56;
  const items: CanvasItem[] = [];
  const stickies: SpatialSticky[] = [];

  pins.forEach((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const id = `continuum_${p.path.replace(/\W+/g, '_')}`;
    const x = originX + col * gapX;
    const y = originY + row * gapY;
    items.push({
      id,
      path: p.path,
      name: p.name,
      x,
      y,
      note: p.note,
    });
    stickies.push(createSticky({
      id: `sticky_${id}`,
      text: p.sticky,
      x: x + 168,
      y: y - 12,
      tetherToId: id,
      color: i % 2 === 0 ? '#f5e6a8' : '#cfe0f5',
      rotation: (i % 3) - 1,
    }));
  });

  return { items, stickies };
}

export function buildContinuumBoardDoc(): SpatialCanvasDoc {
  const { items, stickies } = layoutPillars(CONTINUUM_PILLARS);
  const base = defaultCanvas(CONTINUUM_BOARD_ID, CONTINUUM_BOARD_NAME);
  return {
    ...base,
    items,
    stickies,
    panX: 0,
    panY: 0,
    zoom: 0.92,
    updatedAt: Date.now(),
  };
}

/**
 * Ensure Continuum board exists, refresh pillar pins if empty, activate it.
 * Returns the active Continuum doc.
 */
export async function openOrRefreshContinuumBoard(): Promise<SpatialCanvasDoc> {
  const boards = await listSpatialBoards();
  const existing = boards.find(b => b.id === CONTINUUM_BOARD_ID || b.name === CONTINUUM_BOARD_NAME);

  if (existing) {
    let doc = await switchSpatialBoard(existing.id);
    if (!doc.items.length) {
      const fresh = buildContinuumBoardDoc();
      doc = {
        ...doc,
        id: CONTINUUM_BOARD_ID,
        name: CONTINUUM_BOARD_NAME,
        items: fresh.items,
        stickies: fresh.stickies,
        panX: 0,
        panY: 0,
        zoom: 0.92,
        updatedAt: Date.now(),
      };
      await saveSpatialCanvasNow(doc);
    }
    return doc;
  }

  const continuum = buildContinuumBoardDoc();
  await saveSpatialCanvasNow(continuum);
  return continuum;
}
