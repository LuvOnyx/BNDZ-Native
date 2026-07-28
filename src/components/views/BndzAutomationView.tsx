import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState,
  type Connection, type Node, type Edge, Handle, Position, Panel, SelectionMode,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Icons8Icon } from '../Icons8Icon';
import WorkspaceMenuPanel, { WorkspaceMenuItem, WorkspaceMenuSep } from '../workspace/WorkspaceMenuPanel';
import {
  loadAutomationGraph, hydrateAutomationFromJson, invalidateAutomationCache,
  saveAutomationGraphNow, runAutomationGraph, stableAutomationJson,
  defaultAutomationViewport,
  type AutomationNodeType, type AutomationGraph, type AutomationViewport,
} from '../../lib/automationStore';
import { IPC } from '../../lib/ipcBridge';
import { useAppConfig } from '../../data/configContext';
import { useWorkspaceContextMenu } from '../workspace/useWorkspaceContextMenu';
import { useWorkspaceAutosave } from '../../lib/useWorkspaceAutosave';
import { flushBndzMeta } from '../../lib/bndzMetaStore';
import WorkspaceSplash, { useWorkspaceSplash } from '../workspace/WorkspaceSplash';
import WorkspaceCommandBar from '../workspace/WorkspaceCommandBar';
import AutomationViewportRestore from '../workspace/AutomationViewportRestore';
import { focusWorkspaceSurface } from '../../lib/workspace/workspaceFocus';
import {
  lintAutomationGraph, dryRunGraph, type LintIssue, type DryRunStep,
} from '../../lib/workspace/automationLint';

type NodeData = {
  label: string;
  nodeType: AutomationNodeType;
  fields: Record<string, string>;
};

type NodeDef = {
  label: string;
  color: string;
  icon: string;
  category: 'trigger' | 'filter' | 'action' | 'utility';
  desc: string;
  fields: Array<{ key: string; label: string; placeholder?: string }>;
};

const NODE_DEFS: Record<AutomationNodeType, NodeDef> = {
  watchFolder: {
    label: 'Watch folder', color: '#7eb8e8', icon: 'folder_open_ui', category: 'trigger',
    desc: 'Monitor a folder for new or changed files',
    fields: [{ key: 'path', label: 'Folder path', placeholder: 'C:\\Projects\\deploy' }],
  },
  filterExtension: {
    label: 'Filter extension', color: '#34d399', icon: 'filter_ui', category: 'filter',
    desc: 'Keep only files matching extensions',
    fields: [{ key: 'extensions', label: 'Extensions', placeholder: 'zip,rar,7z' }],
  },
  filterArchive: {
    label: 'Archives only', color: '#a78bfa', icon: 'zip', category: 'filter',
    desc: 'Pass through archive types only',
    fields: [{ key: 'extensions', label: 'Archive types', placeholder: 'zip,rar,7z,tar.gz' }],
  },
  copyTo: {
    label: 'Copy to', color: '#60a5fa', icon: 'copy', category: 'action',
    desc: 'Copy matched files to a destination',
    fields: [{ key: 'dest', label: 'Destination', placeholder: 'D:\\Backup' }],
  },
  moveTo: {
    label: 'Move to', color: '#fbbf24', icon: 'move_ui', category: 'action',
    desc: 'Move matched files to a destination',
    fields: [{ key: 'dest', label: 'Destination', placeholder: 'D:\\Archive' }],
  },
  rsyncDeploy: {
    label: 'Remote deploy', color: '#f472b6', icon: 'cloud_ui', category: 'action',
    desc: 'Push files via rsync / SCP to remote host',
    fields: [
      { key: 'source', label: 'Local source (optional)', placeholder: 'Uses pipeline files if empty' },
      { key: 'remote', label: 'Target (user@host:/path)', placeholder: 'user@host:/var/www' },
      { key: 'extraArgs', label: 'Extra rsync args', placeholder: '-avz --delete' },
    ],
  },
  log: {
    label: 'Log', color: '#94a3b8', icon: 'notepad', category: 'utility',
    desc: 'Write a checkpoint message to the run log',
    fields: [{ key: 'message', label: 'Message', placeholder: 'Pipeline checkpoint' }],
  },
};

const PALETTE_GROUPS: Array<{ id: string; label: string; types: AutomationNodeType[] }> = [
  { id: 'triggers', label: 'Triggers', types: ['watchFolder'] },
  { id: 'filters', label: 'Filters', types: ['filterExtension', 'filterArchive'] },
  { id: 'actions', label: 'Actions', types: ['copyTo', 'moveTo', 'rsyncDeploy'] },
  { id: 'utility', label: 'Utility', types: ['log'] },
];

const CATEGORY_LABEL: Record<NodeDef['category'], string> = {
  trigger: 'Trigger',
  filter: 'Filter',
  action: 'Action',
  utility: 'Utility',
};

function BndzNode({ data, selected }: { data: NodeData; selected?: boolean }) {
  const def = NODE_DEFS[data.nodeType];
  const filled = def.fields.filter(f => data.fields[f.key]?.trim()).length;
  return (
    <div className={`bndz-flow-node bndz-flow-node--${def.category}${selected ? ' is-selected' : ''}`} style={{ ['--node-accent' as string]: def.color }}>
      <div className="bndz-flow-node-glow" aria-hidden />
      <Handle type="target" position={Position.Left} className="bndz-flow-handle" />
      <div className="bndz-flow-node-head">
        <span className="bndz-flow-node-icon" style={{ color: def.color }}><Icons8Icon id={def.icon} size={14} /></span>
        <span className="bndz-flow-node-title">{def.label}</span>
        <span className="bndz-flow-node-chip">{CATEGORY_LABEL[def.category]}</span>
      </div>
      {def.fields.map(f => (
        <div key={f.key} className="bndz-flow-node-field">
          <span className="bndz-flow-node-field-label">{f.label}</span>
          <span className={`bndz-flow-node-field-value${data.fields[f.key]?.trim() ? '' : ' is-empty'}`}>
            {data.fields[f.key]?.trim() || f.placeholder || '—'}
          </span>
        </div>
      ))}
      <div className="bndz-flow-node-foot">
        <span>{filled}/{def.fields.length} configured</span>
      </div>
      <Handle type="source" position={Position.Right} className="bndz-flow-handle" />
    </div>
  );
}

const MemoBndzNode = React.memo(BndzNode);
const nodeTypes = { bndzNode: MemoBndzNode };

function graphToFlow(graph: AutomationGraph): { nodes: Node<NodeData>[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map(n => ({
      id: n.id,
      type: 'bndzNode',
      position: n.position,
      data: {
        label: NODE_DEFS[n.type]?.label || n.type,
        nodeType: n.type,
        fields: Object.fromEntries(Object.entries(n.data).map(([k, v]) => [k, String(v ?? '')])),
      },
    })),
    edges: graph.edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
  };
}

function flowToGraph(
  name: string,
  nodes: Node<NodeData>[],
  edges: Edge[],
  viewport: AutomationViewport = defaultAutomationViewport(),
): AutomationGraph {
  return {
    id: 'default',
    name,
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.data.nodeType,
      position: n.position,
      data: { ...n.data.fields },
    })),
    edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
    viewport,
    updatedAt: 0,
  };
}

function stableGraphJson(
  name: string,
  nodes: Node<NodeData>[],
  edges: Edge[],
  viewport: AutomationViewport,
): string {
  return stableAutomationJson(flowToGraph(name, nodes, edges, viewport));
}

function makeFlowNode(
  type: AutomationNodeType,
  id: string,
  x: number,
  y: number,
  fields: Record<string, string> = {},
): Node<NodeData> {
  const def = NODE_DEFS[type];
  return {
    id,
    type: 'bndzNode',
    position: { x, y },
    data: {
      label: def.label,
      nodeType: type,
      fields: Object.fromEntries(def.fields.map(f => [f.key, fields[f.key] || ''])),
    },
  };
}

export default function BndzAutomationView() {
  const { config } = useAppConfig();
  const autoSave = config.automationAutoSave !== false;
  const saveDelayMs = typeof config.automationAutoSaveDelayMs === 'number'
    ? Math.max(1200, config.automationAutoSaveDelayMs)
    : 1500;
  const panOnScroll = config.automationPanOnScroll !== false;
  const zoomOnScroll = config.automationZoomOnScroll !== false;

  const [graphName, setGraphName] = useState('File pipeline');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lintIssues, setLintIssues] = useState<LintIssue[]>([]);
  const [dryRunSteps, setDryRunSteps] = useState<DryRunStep[]>([]);
  const [dryRunMode, setDryRunMode] = useState(false);
  const [graphReady, setGraphReady] = useState(false);
  const [savedViewport, setSavedViewport] = useState<AutomationViewport>(defaultAutomationViewport());
  const surfaceRef = useRef<HTMLDivElement>(null);
  const graphNameRef = useRef(graphName);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const viewportRef = useRef<AutomationViewport>(defaultAutomationViewport());
  const viewportSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  graphNameRef.current = graphName;
  nodesRef.current = nodes;
  edgesRef.current = edges;
  const { menu, closeMenu, openMenu } = useWorkspaceContextMenu(surfaceRef);
  const splash = useWorkspaceSplash('automation', {
    isReady: graphReady,
    isEmpty: nodes.length === 0,
    resetEmptyHintOnMount: true,
  });

  const fieldSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const autosave = useWorkspaceAutosave(
    () => stableGraphJson(graphNameRef.current, nodesRef.current, edgesRef.current, viewportRef.current),
    async snap => {
      const parsed = JSON.parse(snap) as AutomationGraph;
      parsed.updatedAt = Date.now();
      hydrateAutomationFromJson(JSON.stringify(parsed));
      return flushBndzMeta('automation_graph_v1', JSON.stringify(parsed));
    },
    saveDelayMs,
    autoSave,
  );

  const { schedule: scheduleSave, seed: seedAutosave, flush: flushAutosave } = autosave;

  const scheduleViewportSave = useCallback(() => {
    if (viewportSaveTimer.current) clearTimeout(viewportSaveTimer.current);
    viewportSaveTimer.current = setTimeout(() => {
      viewportSaveTimer.current = null;
      scheduleSave();
    }, 300);
  }, [scheduleSave]);

  const onViewportMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    viewportRef.current = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    scheduleViewportSave();
  }, [scheduleViewportSave]);

  useEffect(() => {
    let active = true;
    invalidateAutomationCache();
    loadAutomationGraph({ force: true }).then(g => {
      if (!active) return;
      setGraphName(g.name);
      const { nodes: n, edges: e } = graphToFlow(g);
      setNodes(n);
      setEdges(e);
      const vp = g.viewport ?? defaultAutomationViewport();
      viewportRef.current = vp;
      setSavedViewport(vp);
      seedAutosave(stableGraphJson(g.name, n, e, vp));
      setGraphReady(true);
    });
    return () => { active = false; };
  }, [setNodes, setEdges, seedAutosave]);

  useLayoutEffect(() => {
    return () => {
      if (viewportSaveTimer.current) clearTimeout(viewportSaveTimer.current);
      void flushAutosave(true);
    };
  }, [flushAutosave]);

  useEffect(() => {
    focusWorkspaceSurface(surfaceRef.current);
  }, []);

  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);

  useEffect(() => {
    const graph = flowToGraph(graphName, nodes, edges, viewportRef.current);
    setLintIssues(lintAutomationGraph(graph));
  }, [graphName, nodes, edges]);

  const runDry = useCallback(() => {
    const graph = flowToGraph(graphNameRef.current, nodesRef.current, edgesRef.current, viewportRef.current);
    setDryRunSteps(dryRunGraph(graph));
    setDryRunMode(true);
    setStatus('Dry-run preview — no files touched');
  }, []);

  const onConnect = useCallback((conn: Connection) => {
    setEdges(eds => addEdge({ ...conn, id: `e_${Date.now()}` }, eds));
    scheduleSave();
  }, [setEdges, scheduleSave]);

  const addNode = useCallback((type: AutomationNodeType, at?: { x: number; y: number }, fields?: Record<string, string>) => {
    const id = `n_${Date.now()}`;
    const def = NODE_DEFS[type];
    const newNode: Node<NodeData> = {
      id,
      type: 'bndzNode',
      position: at || { x: 120 + nodes.length * 40, y: 80 + nodes.length * 30 },
      data: {
        label: def.label,
        nodeType: type,
        fields: Object.fromEntries(def.fields.map(f => [f.key, fields?.[f.key] || ''])),
      },
    };
    setNodes(nds => [...nds, newNode]);
    setSelectedNodeId(id);
    closeMenu();
    scheduleSave();
  }, [nodes.length, setNodes, closeMenu, scheduleSave]);

  useEffect(() => {
    const onSpatialPin = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const paths = (detail.paths as string[] | undefined)?.filter(Boolean);
      if (!paths?.length) return;
      const path = paths[0];
      const isDir = !path.split(/[/\\]/).pop()?.includes('.');
      addNode(isDir ? 'watchFolder' : 'filterExtension', { x: 200, y: 120 }, isDir
        ? { path }
        : { extensions: path.split(/[/\\]/).pop()?.split('.').pop() || '' });
      setStatus(`Added block from pin: ${path.split(/[/\\]/).pop()}`);
    };
    window.addEventListener('bndz-automation-add-from-pin', onSpatialPin);
    return () => window.removeEventListener('bndz-automation-add-from-pin', onSpatialPin);
  }, [addNode]);

  const deleteNode = useCallback((id: string) => {
    setNodes(nds => nds.filter(n => n.id !== id));
    setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
    closeMenu();
    scheduleSave();
  }, [setNodes, setEdges, selectedNodeId, closeMenu, scheduleSave]);

  const deleteEdge = useCallback((id: string) => {
    setEdges(eds => eds.filter(e => e.id !== id));
    if (selectedEdgeId === id) setSelectedEdgeId(null);
    closeMenu();
    scheduleSave();
  }, [setEdges, selectedEdgeId, closeMenu, scheduleSave]);

  const deleteSelected = useCallback(() => {
    if (selectedNodeId) {
      deleteNode(selectedNodeId);
      return;
    }
    if (selectedEdgeId) deleteEdge(selectedEdgeId);
  }, [selectedNodeId, selectedEdgeId, deleteNode, deleteEdge]);

  const duplicateNode = useCallback((id: string) => {
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    const newId = `n_${Date.now()}`;
    setNodes(nds => [...nds, {
      ...node,
      id: newId,
      position: { x: node.position.x + 48, y: node.position.y + 40 },
      selected: false,
    }]);
    setSelectedNodeId(newId);
    closeMenu();
    scheduleSave();
  }, [nodes, setNodes, closeMenu, scheduleSave]);

  const disconnectNode = useCallback((id: string) => {
    setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
    setStatus('Connections removed');
    closeMenu();
    scheduleSave();
  }, [setEdges, closeMenu, scheduleSave]);

  const onNodesDelete = useCallback((deleted: Node<NodeData>[]) => {
    const ids = new Set(deleted.map(n => n.id));
    setEdges(eds => eds.filter(e => !ids.has(e.source) && !ids.has(e.target)));
    if (selectedNodeId && ids.has(selectedNodeId)) setSelectedNodeId(null);
    scheduleSave();
  }, [setEdges, selectedNodeId, scheduleSave]);

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    if (selectedEdgeId && deleted.some(e => e.id === selectedEdgeId)) setSelectedEdgeId(null);
    scheduleSave();
  }, [selectedEdgeId, scheduleSave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedNodeId && !selectedEdgeId) return;
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, selectedEdgeId, deleteSelected]);

  const scheduleFieldSave = useCallback(() => {
    if (fieldSaveTimer.current) clearTimeout(fieldSaveTimer.current);
    fieldSaveTimer.current = setTimeout(() => {
      fieldSaveTimer.current = null;
      scheduleSave();
    }, 400);
  }, [scheduleSave]);

  const updateSelectedField = (key: string, value: string) => {
    if (!selectedNodeId) return;
    setNodes(nds => nds.map(n => n.id === selectedNodeId
      ? { ...n, data: { ...n.data, fields: { ...n.data.fields, [key]: value } } }
      : n));
    scheduleFieldSave();
  };

  const save = async () => {
    const g = flowToGraph(graphName, nodes, edges, viewportRef.current);
    const ok = await saveAutomationGraphNow(g);
    if (ok) seedAutosave(stableGraphJson(g.name, nodes, edges, viewportRef.current));
    setStatus(ok ? 'Pipeline saved' : 'Save failed');
  };

  const run = async () => {
    setRunning(true);
    setStatus(null);
    setLog([]);
    const g = flowToGraph(graphName, nodes, edges, viewportRef.current);
    const payload = { ...g, updatedAt: Date.now() };
    hydrateAutomationFromJson(JSON.stringify(payload));
    await flushBndzMeta('automation_graph_v1', JSON.stringify(payload));
    seedAutosave(stableGraphJson(graphName, nodes, edges, viewportRef.current));
    const result = await runAutomationGraph(payload);
    setLog(result.log || []);
    setStatus(result.ok ? 'Pipeline completed' : (result.error || 'Pipeline failed'));
    setRunning(false);
  };

  const pickFolder = async (fieldKey: string) => {
    if (!IPC.isNative || !selectedNode) return;
    const picked = await IPC.openFolderDialog('Select folder');
    if (picked) updateSelectedField(fieldKey, picked);
  };

  const loadTemplate = useCallback((template: 'deploy' | 'backup') => {
    const ts = Date.now();
    if (template === 'deploy') {
      const n1 = `n_${ts}_w`, n2 = `n_${ts}_f`, n3 = `n_${ts}_r`, n4 = `n_${ts}_l`;
      setNodes([
        makeFlowNode('watchFolder', n1, 40, 120, { path: 'C:\\Projects\\site' }),
        makeFlowNode('filterExtension', n2, 280, 100, { extensions: 'zip,js,css,html' }),
        makeFlowNode('rsyncDeploy', n3, 520, 120, { remote: 'user@host:/var/www', extraArgs: '-avz --delete' }),
        makeFlowNode('log', n4, 780, 140, { message: 'Deploy complete' }),
      ]);
      setEdges([
        { id: `e_${ts}_1`, source: n1, target: n2 },
        { id: `e_${ts}_2`, source: n2, target: n3 },
        { id: `e_${ts}_3`, source: n3, target: n4 },
      ]);
      setGraphName('Deploy pipeline');
    } else {
      const n1 = `n_${ts}_w`, n2 = `n_${ts}_a`, n3 = `n_${ts}_c`, n4 = `n_${ts}_l`;
      setNodes([
        makeFlowNode('watchFolder', n1, 40, 120, { path: 'C:\\Documents' }),
        makeFlowNode('filterArchive', n2, 280, 100, { extensions: 'zip,rar,7z' }),
        makeFlowNode('copyTo', n3, 520, 120, { dest: 'D:\\Backup' }),
        makeFlowNode('log', n4, 780, 140, { message: 'Backup copied' }),
      ]);
      setEdges([
        { id: `e_${ts}_1`, source: n1, target: n2 },
        { id: `e_${ts}_2`, source: n2, target: n3 },
        { id: `e_${ts}_3`, source: n3, target: n4 },
      ]);
      setGraphName('Archive backup');
    }
    setSelectedNodeId(null);
    setStatus('Template loaded — edit paths then Run');
    scheduleSave();
  }, [setNodes, setEdges, scheduleSave]);

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node<NodeData>) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    openMenu({ x: e.clientX, y: e.clientY, kind: 'automation-node', targetId: node.id });
  }, [openMenu]);

  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    openMenu({ x: e.clientX, y: e.clientY, kind: 'automation-edge', targetId: edge.id });
  }, [openMenu]);

  const onPaneContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu({ x: e.clientX, y: e.clientY, kind: 'automation-canvas' });
  }, [openMenu]);

  const menuNode = nodes.find(n => n.id === menu?.targetId);

  return (
    <div
      ref={surfaceRef}
      tabIndex={0}
      className="bndz-automation bndz-ws-skin--automation flex flex-col h-full min-h-0 outline-none"
      data-bndz-surface
      data-bndz-workspace-surface
      onPointerDown={e => {
        if (e.target === e.currentTarget) e.stopPropagation();
        focusWorkspaceSurface(surfaceRef.current);
      }}
    >
      {splash.visible && (
        <WorkspaceSplash
          workspaceId="automation"
          eyebrow="Circuit studio"
          title="Automation"
          subtitle="Wire file pipelines like a live circuit — watch, filter, copy, deploy across local and remote hosts."
          icon="zap_ui"
          accent="#38bdf8"
          features={[
            { icon: 'zap_ui', title: 'Visual pipelines', desc: 'Connect blocks left to right' },
            { icon: 'cloud_ui', title: 'Remote deploy', desc: 'rsync / SCP blocks for instant push' },
            { icon: 'keyboard_ui', title: 'Delete key', desc: 'Select a block and press Delete' },
            { icon: 'sync_folders', title: 'Auto-save', desc: 'Pipeline persists as you edit' },
          ]}
          onDismiss={() => splash.dismiss()}
        />
      )}

      <header className="bndz-ws-chrome bndz-ws-chrome--automation shrink-0">
        <div className="bndz-ws-chrome-brand min-w-0">
          <span className="bndz-ws-chrome-sigil bndz-ws-chrome-sigil--automation" aria-hidden>
            <img src="/Ui/plugin.svg" alt="" className="bndz-ws-sigil-img" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <input
                className="bndz-ws-pipeline-name"
                value={graphName}
                onChange={e => { setGraphName(e.target.value); scheduleFieldSave(); }}
                spellCheck={false}
              />
              <span className="bndz-ws-pill bndz-ws-pill--automation">Circuit</span>
            </div>
            <p className="bndz-ws-chrome-desc">
              {nodes.length} block{nodes.length === 1 ? '' : 's'} · {edges.length} wire{edges.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <div className="bndz-ws-chrome-actions shrink-0">
          {status && <span className="bndz-ws-status">{status}</span>}
          <button type="button" className="bndz-ws-chip" disabled={running} onClick={runDry}>
            Dry run
          </button>
          <button type="button" className="bndz-ws-chip bndz-ws-chip--primary" disabled={running || lintIssues.some(i => i.severity === 'error')} onClick={() => void run()}>
            {running ? 'Running…' : 'Run pipeline'}
          </button>
        </div>
      </header>

      <WorkspaceCommandBar
        variant="automation"
        hint="Del removes · drag marquee · middle-drag pan"
        commands={[
          { id: 'deploy', label: 'Deploy template', iconSrc: '/launcher-icons/emblem-downloads.svg', onClick: () => loadTemplate('deploy') },
          { id: 'backup', label: 'Backup template', iconSrc: '/launcher-icons/emblem-documents.svg', onClick: () => loadTemplate('backup') },
          { id: 'save', label: 'Flush save', iconSrc: '/Ui/plugin.svg', onClick: () => void save() },
          { id: 'intro', label: 'Intro', iconSrc: '/Ui/image-loading.svg', onClick: () => splash.replay() },
        ]}
      />

      <div className="flex flex-1 min-h-0">
        <aside className="bndz-automation-palette shrink-0 overflow-y-auto bndz-scrollbar">
          <div className="bndz-automation-palette-head">
            <span className="bndz-automation-palette-title">Block library</span>
            <span className="bndz-automation-palette-sub">Click to add · right-click canvas · Del removes</span>
          </div>
          {PALETTE_GROUPS.map(group => (
            <div key={group.id} className="bndz-automation-palette-group">
              <div className="bndz-automation-palette-group-label">{group.label}</div>
              {group.types.map(type => {
                const def = NODE_DEFS[type];
                return (
                  <button
                    key={type}
                    type="button"
                    className="bndz-automation-palette-btn"
                    style={{ ['--block-accent' as string]: def.color }}
                    onClick={() => addNode(type)}
                    title={def.desc}
                  >
                    <span className="bndz-automation-palette-icon"><Icons8Icon id={def.icon} size={14} /></span>
                    <span className="bndz-automation-palette-btn-body">
                      <span className="bndz-automation-palette-btn-label">{def.label}</span>
                      <span className="bndz-automation-palette-btn-desc">{def.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <div className="flex-1 min-w-0 relative bndz-automation-canvas-wrap">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            onPaneContextMenu={onPaneContextMenu}
            onNodeDragStop={scheduleSave}
            nodeTypes={nodeTypes}
            nodesDraggable
            nodesConnectable
            elementsSelectable
            onlyRenderVisibleElements
            elevateNodesOnSelect={false}
            deleteKeyCode={['Delete', 'Backspace']}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            panOnDrag={[1, 2]}
            panOnScroll={panOnScroll}
            zoomOnScroll={zoomOnScroll}
            zoomActivationKeyCode="Control"
            panOnScrollSpeed={0.75}
            defaultViewport={savedViewport}
            onMoveEnd={onViewportMoveEnd}
            minZoom={0.4}
            maxZoom={1.8}
            onSelectionChange={({ nodes: sel, edges: selE }) => {
              setSelectedNodeId(sel[0]?.id || null);
              setSelectedEdgeId(selE[0]?.id || null);
            }}
            className="bndz-automation-flow"
            proOptions={{ hideAttribution: true }}
          >
            <AutomationViewportRestore viewport={savedViewport} />
            <Background gap={24} size={1} color="rgba(56,189,248,0.06)" />
            <Controls className="bndz-flow-controls" showInteractive={false} />
            {nodes.length > 4 && (
              <MiniMap
                className="bndz-flow-minimap"
                maskColor="rgba(0,0,0,0.75)"
                nodeColor={n => NODE_DEFS[(n.data as NodeData).nodeType]?.color || '#38bdf8'}
                pannable
                zoomable
              />
            )}
            <Panel position="bottom-center" className="bndz-flow-hint-panel">
              Ctrl+scroll zoom · scroll pan · middle-drag pan · right-click actions
            </Panel>
          </ReactFlow>
        </div>

        <aside className="bndz-automation-inspector shrink-0 overflow-y-auto bndz-scrollbar">
          <div className="bndz-automation-inspector-head">
            <span className="bndz-automation-inspector-title">Inspector</span>
            {selectedNode && (
              <span className="bndz-automation-inspector-chip" style={{ color: NODE_DEFS[selectedNode.data.nodeType].color }}>
                {NODE_DEFS[selectedNode.data.nodeType].label}
              </span>
            )}
          </div>
          {!selectedNode ? (
            <div className="bndz-automation-inspector-empty">
              <Icons8Icon id="zap_ui" size={28} className="opacity-25 mb-2" />
              <p>Select a block to edit properties, or add one from the library.</p>
            </div>
          ) : (
            <div className="bndz-automation-inspector-body">
              <p className="bndz-automation-inspector-desc">{NODE_DEFS[selectedNode.data.nodeType].desc}</p>
              {NODE_DEFS[selectedNode.data.nodeType].fields.map(f => (
                <label key={f.key} className="bndz-automation-field">
                  <span className="bndz-automation-field-label">{f.label}</span>
                  <div className="flex gap-1">
                    <input
                      className="bndz-automation-input flex-1"
                      value={selectedNode.data.fields[f.key] || ''}
                      placeholder={f.placeholder}
                      onChange={e => updateSelectedField(f.key, e.target.value)}
                    />
                    {(f.key === 'path' || f.key === 'dest' || f.key === 'source') && IPC.isNative && (
                      <button type="button" className="bndz-lens-chip shrink-0" onClick={() => void pickFolder(f.key)}>…</button>
                    )}
                  </div>
                </label>
              ))}
              <div className="bndz-automation-inspector-actions">
                <button type="button" className="bndz-lens-chip" onClick={() => duplicateNode(selectedNode.id)}>Duplicate</button>
                <button type="button" className="bndz-lens-chip" onClick={() => disconnectNode(selectedNode.id)}>Disconnect</button>
              </div>
              <p className="bndz-automation-inspector-kbd">Press <kbd>Delete</kbd> to remove selected block or wire.</p>
            </div>
          )}
          {lintIssues.length > 0 && (
            <div className="bndz-automation-lint">
              <div className="bndz-automation-log-head">Pipeline lint</div>
              <ul className="bndz-automation-lint-list">
                {lintIssues.map(issue => (
                  <li key={issue.id} className={`bndz-automation-lint-item bndz-automation-lint-item--${issue.severity}`}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {dryRunMode && dryRunSteps.length > 0 && (
            <div className="bndz-automation-timeline">
              <div className="bndz-automation-log-head">Dry-run timeline</div>
              <ol className="bndz-automation-timeline-list">
                {dryRunSteps.map((step, i) => (
                  <li key={step.nodeId} className="bndz-automation-timeline-step">
                    <span className="bndz-automation-timeline-idx">{i + 1}</span>
                    <span className="bndz-automation-timeline-action">{step.action}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {log.length > 0 && (
            <div className="bndz-automation-log">
              <div className="bndz-automation-log-head">Run log</div>
              <pre className="bndz-automation-log-body bndz-mono">{log.join('\n')}</pre>
            </div>
          )}
        </aside>
      </div>

      {menu?.kind === 'automation-node' && menuNode && (
        <WorkspaceMenuPanel variant="automation" x={menu.x} y={menu.y}>
          <WorkspaceMenuItem label="Duplicate block" icon="copy" onClick={() => duplicateNode(menuNode.id)} />
          <WorkspaceMenuItem label="Disconnect all" icon="sync" onClick={() => disconnectNode(menuNode.id)} />
          <WorkspaceMenuSep />
          <WorkspaceMenuItem label="Delete block" icon="delete" danger onClick={() => deleteNode(menuNode.id)} />
        </WorkspaceMenuPanel>
      )}

      {menu?.kind === 'automation-edge' && menu.targetId && (
        <WorkspaceMenuPanel variant="automation" x={menu.x} y={menu.y}>
          <WorkspaceMenuItem label="Delete connection" icon="delete" danger onClick={() => deleteEdge(menu.targetId!)} />
        </WorkspaceMenuPanel>
      )}

      {menu?.kind === 'automation-canvas' && (
        <WorkspaceMenuPanel variant="automation" x={menu.x} y={menu.y}>
          <WorkspaceMenuItem label="Add from pin path" icon="view_grid" onClick={() => {
            void navigator.clipboard.readText().then(text => {
              if (text) window.dispatchEvent(new CustomEvent('bndz-automation-add-from-pin', { detail: { paths: [text.trim()] } }));
            });
          }} />
          <WorkspaceMenuSep />
          <WorkspaceMenuItem label="Add watch folder" icon="folder_open_ui" onClick={() => addNode('watchFolder')} />
          <WorkspaceMenuItem label="Add copy to" icon="copy" onClick={() => addNode('copyTo')} />
          <WorkspaceMenuItem label="Add remote deploy" icon="cloud_ui" onClick={() => addNode('rsyncDeploy')} />
          <WorkspaceMenuSep />
          <WorkspaceMenuItem label="Add log block" icon="notepad" onClick={() => addNode('log')} />
        </WorkspaceMenuPanel>
      )}
    </div>
  );
}
