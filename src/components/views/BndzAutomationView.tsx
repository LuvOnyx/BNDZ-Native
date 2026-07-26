import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState,
  type Connection, type Node, type Edge, Handle, Position, Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Icons8Icon } from '../Icons8Icon';
import {
  loadAutomationGraph, saveAutomationGraph, saveAutomationGraphNow, runAutomationGraph,
  type AutomationNodeType, type AutomationGraph,
} from '../../lib/automationStore';
import { IPC } from '../../lib/ipcBridge';
import { useAppConfig } from '../../data/configContext';

type NodeData = {
  label: string;
  nodeType: AutomationNodeType;
  fields: Record<string, string>;
};

const NODE_DEFS: Record<AutomationNodeType, { label: string; color: string; fields: Array<{ key: string; label: string; placeholder?: string }> }> = {
  watchFolder: { label: 'Watch folder', color: '#7eb8e8', fields: [{ key: 'path', label: 'Folder path', placeholder: 'C:\\Projects\\deploy' }] },
  filterExtension: { label: 'Filter extension', color: '#34d399', fields: [{ key: 'extensions', label: 'Extensions', placeholder: 'zip,rar,7z' }] },
  filterArchive: { label: 'Archives only', color: '#a78bfa', fields: [{ key: 'extensions', label: 'Archive types', placeholder: 'zip,rar,7z,tar.gz' }] },
  copyTo: { label: 'Copy to', color: '#60a5fa', fields: [{ key: 'dest', label: 'Destination', placeholder: 'D:\\Backup' }] },
  moveTo: { label: 'Move to', color: '#fbbf24', fields: [{ key: 'dest', label: 'Destination', placeholder: 'D:\\Archive' }] },
  rsyncDeploy: { label: 'Remote deploy', color: '#f472b6', fields: [
    { key: 'source', label: 'Local source (optional)', placeholder: 'Uses pipeline files if empty' },
    { key: 'remote', label: 'Target (user@host:/path or folder)', placeholder: 'user@host:/var/www or D:\\Backup' },
    { key: 'extraArgs', label: 'Extra rsync args (optional)', placeholder: '-avz --delete' },
  ] },
  log: { label: 'Log', color: '#94a3b8', fields: [{ key: 'message', label: 'Message', placeholder: 'Pipeline checkpoint' }] },
};

function BndzNode({ data, selected }: { data: NodeData; selected?: boolean }) {
  const def = NODE_DEFS[data.nodeType];
  return (
    <div className={`bndz-flow-node${selected ? ' is-selected' : ''}`} style={{ borderColor: def.color }}>
      <Handle type="target" position={Position.Left} className="bndz-flow-handle" />
      <div className="bndz-flow-node-title" style={{ color: def.color }}>{def.label}</div>
      {def.fields.map(f => (
        <div key={f.key} className="bndz-flow-node-field">
          <span className="bndz-flow-node-field-label">{f.label}</span>
          <span className="bndz-flow-node-field-value">{data.fields[f.key] || '—'}</span>
        </div>
      ))}
      <Handle type="source" position={Position.Right} className="bndz-flow-handle" />
    </div>
  );
}

const nodeTypes = { bndzNode: BndzNode };

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
    edges: graph.edges.map(e => ({ id: e.id, source: e.source, target: e.target, animated: true })),
  };
}

function flowToGraph(name: string, nodes: Node<NodeData>[], edges: Edge[]): AutomationGraph {
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
    updatedAt: Date.now(),
  };
}

export default function BndzAutomationView() {
  const { config } = useAppConfig();
  const autoSave = config.automationAutoSave !== false;
  const saveDelayMs = typeof config.automationAutoSaveDelayMs === 'number'
    ? config.automationAutoSaveDelayMs
    : 800;
  const panOnScroll = config.automationPanOnScroll !== false;
  const zoomOnScroll = config.automationZoomOnScroll !== false;

  const [graphName, setGraphName] = useState('File pipeline');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    loadAutomationGraph().then(g => {
      setGraphName(g.name);
      const { nodes: n, edges: e } = graphToFlow(g);
      setNodes(n);
      setEdges(e);
    });
  }, [setNodes, setEdges]);

  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);

  useEffect(() => {
    if (!autoSave || nodes.length === 0) return;
    const g = flowToGraph(graphName, nodes, edges);
    void saveAutomationGraph(g, saveDelayMs).then(ok => {
      if (!ok) setStatus('Auto-save failed');
    });
  }, [autoSave, saveDelayMs, graphName, nodes, edges]);

  const onConnect = useCallback((conn: Connection) => {
    setEdges(eds => addEdge({ ...conn, animated: true }, eds));
  }, [setEdges]);

  const addNode = (type: AutomationNodeType) => {
    const id = `n_${Date.now()}`;
    const def = NODE_DEFS[type];
    const newNode: Node<NodeData> = {
      id,
      type: 'bndzNode',
      position: { x: 120 + nodes.length * 40, y: 80 + nodes.length * 30 },
      data: {
        label: def.label,
        nodeType: type,
        fields: Object.fromEntries(def.fields.map(f => [f.key, ''])),
      },
    };
    setNodes(nds => [...nds, newNode]);
    setSelectedNodeId(id);
  };

  const updateSelectedField = (key: string, value: string) => {
    if (!selectedNodeId) return;
    setNodes(nds => nds.map(n => n.id === selectedNodeId
      ? { ...n, data: { ...n.data, fields: { ...n.data.fields, [key]: value } } }
      : n));
  };

  const save = async () => {
    const g = flowToGraph(graphName, nodes, edges);
    const ok = await saveAutomationGraphNow(g);
    setStatus(ok ? 'Pipeline saved' : 'Save failed');
  };

  const run = async () => {
    setRunning(true);
    setStatus(null);
    setLog([]);
    const g = flowToGraph(graphName, nodes, edges);
    await saveAutomationGraph(g);
    const result = await runAutomationGraph(g);
    setLog(result.log || []);
    setStatus(result.ok ? 'Pipeline completed' : (result.error || 'Pipeline failed'));
    setRunning(false);
  };

  const pickFolder = async (fieldKey: string) => {
    if (!IPC.isNative || !selectedNode) return;
    const picked = await IPC.openFolderDialog('Select folder');
    if (picked) updateSelectedField(fieldKey, picked);
  };

  return (
    <div className="bndz-automation flex flex-col h-full min-h-0" data-bndz-surface>
      <header className="shrink-0 px-4 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <Icons8Icon id="zap_ui" size={16} className="text-[#fbbf24]" />
          <input
            className="bg-transparent text-sm font-semibold text-white outline-none border-b border-transparent focus:border-[#7eb8e8] min-w-[160px]"
            value={graphName}
            onChange={e => setGraphName(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status && <span className="text-[10px] text-[#7eb8e8]">{status}</span>}
          <button type="button" className="bndz-lens-chip" onClick={() => void save()}>Save</button>
          <button type="button" className="bndz-lens-chip" disabled={running} onClick={() => void run()}>
            {running ? 'Running…' : 'Run pipeline'}
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="bndz-automation-palette shrink-0 w-[200px] border-r border-white/[0.06] p-2 overflow-y-auto bndz-scrollbar">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 px-1 mb-2">Blocks</div>
          {(Object.keys(NODE_DEFS) as AutomationNodeType[]).map(type => (
            <button
              key={type}
              type="button"
              className="bndz-automation-palette-btn"
              onClick={() => addNode(type)}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: NODE_DEFS[type].color }} />
              {NODE_DEFS[type].label}
            </button>
          ))}
        </aside>

        <div className="flex-1 min-w-0 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            nodesDraggable
            nodesConnectable
            elementsSelectable
            panOnDrag={[1, 2]}
            selectionOnDrag={false}
            panOnScroll={panOnScroll}
            zoomOnScroll={zoomOnScroll}
            onSelectionChange={({ nodes: sel }) => setSelectedNodeId(sel[0]?.id || null)}
            className="bndz-automation-flow"
          >
            <Background gap={18} size={1} color="rgba(255,255,255,0.04)" />
            <Controls className="bndz-flow-controls" />
            <MiniMap className="bndz-flow-minimap" maskColor="rgba(0,0,0,0.65)" />
            <Panel position="top-left" className="text-[10px] text-gray-500 bg-black/30 px-2 py-1 rounded">
              Connect blocks left → right · Run executes in topological order
            </Panel>
          </ReactFlow>
        </div>

        <aside className="bndz-automation-inspector shrink-0 w-[240px] border-l border-white/[0.06] p-3 overflow-y-auto bndz-scrollbar">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Inspector</div>
          {!selectedNode ? (
            <p className="text-[11px] text-gray-500">Select a block to edit properties.</p>
          ) : (
            <>
              <div className="text-xs font-medium text-white mb-3">{NODE_DEFS[selectedNode.data.nodeType].label}</div>
              {NODE_DEFS[selectedNode.data.nodeType].fields.map(f => (
                <label key={f.key} className="block mb-3">
                  <span className="text-[10px] text-gray-500 block mb-1">{f.label}</span>
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
              <button
                type="button"
                className="text-[10px] text-rose-400 hover:text-rose-300 mt-2"
                onClick={() => {
                  setNodes(nds => nds.filter(n => n.id !== selectedNode.id));
                  setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id));
                  setSelectedNodeId(null);
                }}
              >
                Delete block
              </button>
            </>
          )}
          {log.length > 0 && (
            <div className="mt-4 border-t border-white/[0.06] pt-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Run log</div>
              <pre className="text-[10px] text-gray-400 bndz-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto bndz-scrollbar">{log.join('\n')}</pre>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
