import type { AutomationGraph, AutomationNode, AutomationEdge } from '../automationStore';
import { defaultAutomationViewport } from '../automationStore';

export type AutomationRecipe = {
  id: string;
  label: string;
  blurb: string;
  group: 'everyday' | 'advanced';
  build: () => { nodes: AutomationNode[]; edges: AutomationEdge[]; name: string };
};

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function profileRoot(): string {
  // Vite/browser — USERPROFILE is not available; use a clear placeholder the user can edit.
  return '%USERPROFILE%';
}

function downloadsPath() { return `${profileRoot()}\\Downloads`; }
function picturesShots() { return `${profileRoot()}\\Pictures\\Screenshots`; }
function documentsPath() { return `${profileRoot()}\\Documents`; }
function desktopPath() { return `${profileRoot()}\\Desktop`; }

/** Everyday recipes so Automation is useful on first open — not a blank canvas. */
export const AUTOMATION_RECIPES: AutomationRecipe[] = [
  {
    id: 'downloads-tidy',
    label: 'Downloads tidy',
    blurb: 'Watch Downloads and move files older than 30 days into Documents\\Archive\\Downloads.',
    group: 'everyday',
    build: () => {
      const watch = uid('watch');
      const age = uid('age');
      const move = uid('move');
      const notify = uid('notify');
      const nodes: AutomationNode[] = [
        { id: watch, type: 'watchFolder', position: { x: 40, y: 120 }, data: { path: downloadsPath(), liveWatch: 'true', includeSubdirs: 'false' } },
        { id: age, type: 'filterAge', position: { x: 280, y: 120 }, data: { mode: 'olderThan', days: '30' } },
        { id: move, type: 'moveTo', position: { x: 520, y: 120 }, data: { dest: `${documentsPath()}\\Archive\\Downloads` } },
        { id: notify, type: 'notifyToast', position: { x: 760, y: 120 }, data: { message: 'Archived old Downloads items' } },
      ];
      const edges: AutomationEdge[] = [
        { id: uid('e'), source: watch, target: age },
        { id: uid('e'), source: age, target: move },
        { id: uid('e'), source: move, target: notify },
      ];
      return { nodes, edges, name: 'Downloads tidy' };
    },
  },
  {
    id: 'screenshot-collect',
    label: 'Screenshot collector',
    blurb: 'Watch Desktop for new images and copy them into Pictures\\Screenshots with a tag.',
    group: 'everyday',
    build: () => {
      const watch = uid('watch');
      const ext = uid('ext');
      const copy = uid('copy');
      const tag = uid('tag');
      const nodes: AutomationNode[] = [
        { id: watch, type: 'watchFolder', position: { x: 40, y: 100 }, data: { path: desktopPath(), liveWatch: 'true', includeSubdirs: 'false' } },
        { id: ext, type: 'filterExtension', position: { x: 280, y: 100 }, data: { extensions: 'png,jpg,jpeg' } },
        { id: copy, type: 'copyTo', position: { x: 520, y: 100 }, data: { dest: picturesShots() } },
        { id: tag, type: 'applyTag', position: { x: 760, y: 100 }, data: { tag: 'screenshot' } },
      ];
      const edges: AutomationEdge[] = [
        { id: uid('e'), source: watch, target: ext },
        { id: uid('e'), source: ext, target: copy },
        { id: uid('e'), source: copy, target: tag },
      ];
      return { nodes, edges, name: 'Screenshot collector' };
    },
  },
  {
    id: 'zip-inbox',
    label: 'Zip extract inbox',
    blurb: 'When archives land in Downloads, extract them into Documents\\Extracted.',
    group: 'everyday',
    build: () => {
      const watch = uid('watch');
      const arch = uid('arch');
      const extract = uid('extract');
      const notify = uid('notify');
      const nodes: AutomationNode[] = [
        { id: watch, type: 'watchFolder', position: { x: 40, y: 110 }, data: { path: downloadsPath(), liveWatch: 'true', includeSubdirs: 'false' } },
        { id: arch, type: 'filterArchive', position: { x: 280, y: 110 }, data: { extensions: 'zip,rar,7z,tar.gz' } },
        { id: extract, type: 'extractArchive', position: { x: 520, y: 110 }, data: { dest: `${documentsPath()}\\Extracted` } },
        { id: notify, type: 'notifyToast', position: { x: 760, y: 110 }, data: { message: 'Archive extracted' } },
      ];
      const edges: AutomationEdge[] = [
        { id: uid('e'), source: watch, target: arch },
        { id: uid('e'), source: arch, target: extract },
        { id: uid('e'), source: extract, target: notify },
      ];
      return { nodes, edges, name: 'Zip extract inbox' };
    },
  },
  {
    id: 'manual-copy',
    label: 'Copy selected files',
    blurb: 'Manual run: take selected/Spatial paths and copy them to Documents.',
    group: 'everyday',
    build: () => {
      const run = uid('run');
      const pin = uid('pin');
      const copy = uid('copy');
      const nodes: AutomationNode[] = [
        { id: run, type: 'manualRun', position: { x: 60, y: 120 }, data: {} },
        { id: pin, type: 'spatialPin', position: { x: 300, y: 120 }, data: { paths: '' } },
        { id: copy, type: 'copyTo', position: { x: 540, y: 120 }, data: { dest: documentsPath() } },
      ];
      const edges: AutomationEdge[] = [
        { id: uid('e'), source: run, target: pin },
        { id: uid('e'), source: pin, target: copy },
      ];
      return { nodes, edges, name: 'Copy selected files' };
    },
  },
  {
    id: 'deploy-rsync',
    label: 'Deploy (rsync)',
    blurb: 'Advanced: sync a project folder with rsync.',
    group: 'advanced',
    build: () => {
      const run = uid('run');
      const rsync = uid('rsync');
      const nodes: AutomationNode[] = [
        { id: run, type: 'manualRun', position: { x: 60, y: 120 }, data: {} },
        { id: rsync, type: 'rsyncDeploy', position: { x: 320, y: 120 }, data: { source: 'C:\\Projects\\site', dest: 'user@host:/var/www/' } },
      ];
      const edges: AutomationEdge[] = [{ id: uid('e'), source: run, target: rsync }];
      return { nodes, edges, name: 'Deploy (rsync)' };
    },
  },
  {
    id: 'archive-backup',
    label: 'Archive backup',
    blurb: 'Advanced: zip Documents into a backup archive.',
    group: 'advanced',
    build: () => {
      const run = uid('run');
      const zip = uid('zip');
      const nodes: AutomationNode[] = [
        { id: run, type: 'manualRun', position: { x: 60, y: 120 }, data: {} },
        { id: zip, type: 'compressArchive', position: { x: 320, y: 120 }, data: { format: 'zip', dest: 'D:\\Backup\\Documents.zip' } },
      ];
      const edges: AutomationEdge[] = [{ id: uid('e'), source: run, target: zip }];
      return { nodes, edges, name: 'Archive backup' };
    },
  },
];

export function recipeToGraph(recipe: AutomationRecipe, id?: string): AutomationGraph {
  const built = recipe.build();
  return {
    id: id || `pipe-${Date.now().toString(36)}`,
    name: built.name,
    nodes: built.nodes,
    edges: built.edges,
    viewport: defaultAutomationViewport(),
    armed: false,
    updatedAt: Date.now(),
  };
}

/** Seed a useful starter chain from selected file paths (not a lone spatialPin). */
export function buildSeedPipelineFromPaths(paths: string[]): { nodes: AutomationNode[]; edges: AutomationEdge[]; name: string } {
  const run = uid('run');
  const pin = uid('pin');
  const copy = uid('copy');
  const notify = uid('notify');
  const nodes: AutomationNode[] = [
    { id: run, type: 'manualRun', position: { x: 40, y: 110 }, data: {} },
    { id: pin, type: 'spatialPin', position: { x: 280, y: 110 }, data: { paths: paths.join('\n') } },
    { id: copy, type: 'copyTo', position: { x: 520, y: 110 }, data: { dest: documentsPath() } },
    { id: notify, type: 'notifyToast', position: { x: 760, y: 110 }, data: { message: 'Copied selection' } },
  ];
  const edges: AutomationEdge[] = [
    { id: uid('e'), source: run, target: pin },
    { id: uid('e'), source: pin, target: copy },
    { id: uid('e'), source: copy, target: notify },
  ];
  return { nodes, edges, name: 'From selection' };
}
