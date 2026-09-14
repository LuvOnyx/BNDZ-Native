import {
  BNDZ_AUTOMATION,
  BNDZ_INBOUND,
  BNDZ_LARGE,
  BNDZ_PROBLEMS,
  BNDZ_RECENT,
  BNDZ_SANDBOX,
} from '../bndzVirtualViews';
import {
  createSticky,
  defaultCanvas,
  listSpatialBoards,
  PILLAR_BOARD_ID,
  PILLAR_BOARD_NAME,
  saveSpatialCanvasNow,
  switchSpatialBoard,
  type CanvasItem,
  type SpatialCanvasDoc,
  type SpatialSticky,
} from '../spatialCanvasStore';

/** @deprecated Prefer PILLAR_BOARD_ID — Continuum is Home, not Spatial. */
export const CONTINUUM_BOARD_ID = PILLAR_BOARD_ID;
/** User-facing Spatial preset name — Continuum is Home, not this board. */
export const CONTINUUM_BOARD_NAME = PILLAR_BOARD_NAME;

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
    path: BNDZ_LARGE,
    name: 'Capacity',
    note: 'Space pressure · largest folders',
    sticky: 'Reclaim space from Capacity Solver.',
  },
  {
    path: BNDZ_AUTOMATION,
    name: 'Automation',
    note: 'Visual pipelines · watch / move / deploy',
    sticky: 'Drop pins into Automation nodes.',
  },
  {
    path: BNDZ_RECENT,
    name: 'Recent',
    note: 'Pulse · last touched paths',
    sticky: 'Quick jump from Recent heat.',
  },
];

const CARD_W = 168;
const CARD_H = 120;
const COLS = 3;
const GAP_X = 36;
const GAP_Y = 48;
const ORIGIN_X = 80;
const ORIGIN_Y = 80;

function layoutPillars(pillars: PillarPin[]): { items: CanvasItem[]; stickies: SpatialSticky[] } {
  const items: CanvasItem[] = [];
  const stickies: SpatialSticky[] = [];
  pillars.forEach((p, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = ORIGIN_X + col * (CARD_W + GAP_X);
    const y = ORIGIN_Y + row * (CARD_H + GAP_Y);
    const id = `continuum_${p.path.replace(/\W+/g, '_')}`;
    items.push({
      id,
      path: p.path,
      name: p.name,
      note: p.note,
      x,
      y,
      tags: ['pillar'],
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
  const base = defaultCanvas(PILLAR_BOARD_ID, PILLAR_BOARD_NAME);
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

function needsPillarSeed(doc: SpatialCanvasDoc): boolean {
  if (!doc.items.length) return true;
  const pillarTags = doc.items.filter(it => (it.tags || []).includes('pillar')).length;
  return pillarTags < 3;
}

/**
 * Ensure Pillar Board exists (Spatial preset), refresh pillar pins if empty, activate it.
 * Never steals a freeform board that was wrongly titled "Continuum".
 */
export async function openOrRefreshContinuumBoard(): Promise<SpatialCanvasDoc> {
  const boards = await listSpatialBoards();
  const existing = boards.find(
    b => b.id === PILLAR_BOARD_ID || b.name === PILLAR_BOARD_NAME,
  );

  if (existing) {
    let doc = await switchSpatialBoard(existing.id);
    let dirty = false;
    if (doc.id !== PILLAR_BOARD_ID) {
      doc = { ...doc, id: PILLAR_BOARD_ID };
      dirty = true;
    }
    if (doc.name !== PILLAR_BOARD_NAME) {
      doc = { ...doc, name: PILLAR_BOARD_NAME };
      dirty = true;
    }
    if (needsPillarSeed(doc)) {
      const fresh = buildContinuumBoardDoc();
      doc = {
        ...doc,
        id: PILLAR_BOARD_ID,
        name: PILLAR_BOARD_NAME,
        items: fresh.items,
        stickies: fresh.stickies,
        panX: 0,
        panY: 0,
        zoom: 0.92,
        updatedAt: Date.now(),
      };
      dirty = true;
    } else if (dirty) {
      doc = { ...doc, updatedAt: Date.now() };
    }
    if (dirty) await saveSpatialCanvasNow(doc);
    return doc;
  }

  const continuum = buildContinuumBoardDoc();
  await saveSpatialCanvasNow(continuum);
  return continuum;
}

