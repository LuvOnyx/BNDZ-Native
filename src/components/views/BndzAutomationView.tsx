import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, addEdge, useNodesState, useEdgesState, applyNodeChanges,
  type Connection, type Node, type Edge, Handle, Position, Panel, SelectionMode,
  type Viewport, type ReactFlowInstance, type OnNodesChange, type OnEdgesChange, type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Icons8Icon } from '../Icons8Icon';
import WorkspaceMenuPanel, { WorkspaceMenuItem, WorkspaceMenuSep } from '../workspace/WorkspaceMenuPanel';
import {
  loadAutomationGraph, loadAutomationLibrary, hydrateAutomationFromJson,
  invalidateAutomationCache, saveAutomationGraphNow,
  runAutomationGraph, syncAutomationLive, getAutomationLiveStatus, createPipeline,
  saveAutomationLibrary, stableAutomationJson, defaultAutomationViewport,
  deletePipeline, duplicatePipeline, exportPipelineJson, importPipelineFromJson,
  addPipelineToLibrary, appendAutomationRunRecord, loadAutomationRunHistory,
  type AutomationNodeType, type AutomationGraph, type AutomationViewport,
  type AutomationLibrary, type AutomationLiveStatus, type AutomationRunRecord,
} from '../../lib/automationStore';
import { IPC } from '../../lib/ipcBridge';
import { formatUiPath } from '../../lib/displayPath';
import { useAppConfig } from '../../data/configContext';
import { useWorkspaceContextMenu } from '../workspace/useWorkspaceContextMenu';
import { useWorkspaceAutosave } from '../../lib/useWorkspaceAutosave';
import { flushBndzMeta } from '../../lib/bndzMetaStore';
import WorkspaceSplash, { useWorkspaceSplash } from '../workspace/WorkspaceSplash';
import WorkspaceCommandBar from '../workspace/WorkspaceCommandBar';
import AutomationViewportRestore from '../workspace/AutomationViewportRestore';
import { focusWorkspaceSurface, shouldHandleWorkspaceKeys } from '../../lib/workspace/workspaceFocus';
import { bindWorkspaceCursorGuard } from '../../lib/workspace/workspaceCursorGuard';
import {
  lintAutomationGraph, dryRunGraph, lintErrorCount, FOLDER_FIELD_KEYS,
  type LintIssue, type DryRunStep,
} from '../../lib/workspace/automationLint';
import {
  NODE_DEFS, PALETTE_GROUPS, CATEGORY_LABEL, type AutomationNodeDef,
  resolveAutomationNodeDef,
} from '../../lib/workspace/automationNodeDefs';
import { consumeAutomationSeed, type AutomationPendingSeed } from '../../lib/workspace/automationPendingSeed';
import { AUTOMATION_RECIPES, recipeToGraph } from '../../lib/workspace/automationTemplates';
import {
  getWorkspaceClipboard, setWorkspaceClipboard,
} from '../../lib/workspace/workspaceClipboard';

type NodeData = {
  label: string;
  nodeType: AutomationNodeType;
  fields: Record<string, string>;
  lintSeverity?: 'error' | 'warn' | null;
};

function BndzNode({ data, selected }: NodeProps<Node<NodeData>>) {
  const def = resolveAutomationNodeDef(data.nodeType);
  const filled = def.fields.filter(f => data.fields[f.key]?.trim()).length;
  const lintClass = data.lintSeverity === 'error'
    ? ' has-lint-error'
    : data.lintSeverity === 'warn'
      ? ' has-lint-warn'
      : '';
  const ledTone = data.lintSeverity === 'error'
    ? 'is-error'
    : data.lintSeverity === 'warn'
      ? 'is-warn'
      : filled === def.fields.length && def.fields.length > 0
        ? 'is-ok'
        : 'is-idle';
  return (
    <div
      className={`bndz-flow-node bndz-rack-module bndz-flow-node--${def.category}${selected ? ' is-selected' : ''}${def.branchOutputs ? ' bndz-flow-node--branch' : ''}${lintClass}`}
      style={{ ['--node-accent' as string]: def.color }}
    >
      <span className="bndz-rack-screw bndz-rack-screw--tl" aria-hidden />
      <span className="bndz-rack-screw bndz-rack-screw--tr" aria-hidden />
      <span className="bndz-rack-screw bndz-rack-screw--bl" aria-hidden />
      <span className="bndz-rack-screw bndz-rack-screw--br" aria-hidden />
      <span className="bndz-rack-rail" aria-hidden />
      <Handle type="target" position={Position.Left} className="bndz-flow-handle" />
      <div className="bndz-rack-head">
        <span className="bndz-rack-bezel" style={{ color: def.color }}>
          <Icons8Icon id={def.icon} size={18} />
        </span>
        <div className="bndz-rack-head-text">
          <span className="bndz-rack-title">{def.label}</span>
          <span className="bndz-rack-tag">{CATEGORY_LABEL[def.category]}</span>
        </div>
        <span className={`bndz-rack-led ${ledTone}`} title={data.lintSeverity || 'ready'} aria-hidden />
      </div>
      <div className="bndz-rack-lcd">
        {def.fields.slice(0, 3).map(f => (
          <div key={f.key} className="bndz-rack-lcd-row">
            <span className="bndz-rack-lcd-key">{f.label}</span>
            <span className={`bndz-rack-lcd-val${data.fields[f.key]?.trim() ? '' : ' is-empty'}`}>
              {data.fields[f.key]?.trim() || f.placeholder || '—'}
            </span>
          </div>
        ))}
        {def.fields.length > 3 && (
          <div className="bndz-rack-lcd-row">
            <span className="bndz-rack-lcd-val">+{def.fields.length - 3} more fields</span>
          </div>
        )}
      </div>
      <div className="bndz-rack-meter">
        <span className="bndz-rack-meter-fill" style={{ width: `${def.fields.length ? (filled / def.fields.length) * 100 : 0}%` }} />
        <span className="bndz-rack-meter-label">{filled}/{def.fields.length} configured</span>
      </div>
      {def.branchOutputs ? (
        <>
          <Handle type="source" id="true" position={Position.Right} className="bndz-flow-handle bndz-flow-handle--true" style={{ top: '38%' }} />
          <Handle type="source" id="false" position={Position.Right} className="bndz-flow-handle bndz-flow-handle--false" style={{ top: '68%' }} />
          <div className="bndz-flow-branch-labels" aria-hidden>
            <span className="bndz-flow-branch-label bndz-flow-branch-label--true">yes</span>
            <span className="bndz-flow-branch-label bndz-flow-branch-label--false">no</span>
          </div>
        </>
      ) : (
        <Handle type="source" position={Position.Right} className="bndz-flow-handle" />
      )}
    </div>
  );
}

const MemoBndzNode = React.memo(BndzNode);
const nodeTypes = { bndzNode: MemoBndzNode };

type AutomationFlowPaneProps = {
  nodes: Node<NodeData>[];
  edges: Edge[];
  panOnScroll: boolean;
  zoomOnScroll: boolean;
  savedViewport: AutomationViewport;
  onInit: (inst: ReactFlowInstance) => void;
  onNodesChange: OnNodesChange<Node<NodeData>>;
  onEdgesChange: OnEdgesChange<Edge>;
  onConnect: (conn: Connection) => void;
  onNodesDelete: (deleted: Node<NodeData>[]) => void;
  onEdgesDelete: (deleted: Edge[]) => void;
  onNodeContextMenu: (e: React.MouseEvent, node: Node) => void;
  onEdgeContextMenu: (e: React.MouseEvent, edge: Edge) => void;
  onPaneContextMenu: (e: React.MouseEvent | MouseEvent) => void;
  onNodeDragStart: (e: React.MouseEvent, node: Node) => void;
  onNodeDragStop: () => void;
  onNodeClick: (e: React.MouseEvent, node: Node) => void;
  onNodePress: (nodeId: string) => void;
  onPaneClick: () => void;
  onViewportMoveEnd: (event: MouseEvent | TouchEvent | null, viewport: Viewport) => void;
  loadRecipe: (id: string) => void;
};

/** Isolated React Flow tree — keeps palette/inspector from re-reconciling every drag frame. */
const AutomationFlowPane = React.memo(function AutomationFlowPane({
  nodes,
  edges,
  panOnScroll,
  zoomOnScroll,
  savedViewport,
  onInit,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodesDelete,
  onEdgesDelete,
  onNodeContextMenu,
  onEdgeContextMenu,
  onPaneContextMenu,
  onNodeDragStart,
  onNodeDragStop,
  onNodeClick,
  onNodePress,
  onPaneClick,
  onViewportMoveEnd,
  loadRecipe,
}: AutomationFlowPaneProps) {
  return (
    <div
      className="flex-1 min-w-0 relative bndz-automation-canvas-wrap"
      onContextMenu={e => e.stopPropagation()}
      onPointerDownCapture={(e) => {
        if (e.button !== 0) return;
        const nodeEl = (e.target as HTMLElement).closest('.react-flow__node[data-id]') as HTMLElement | null;
        if (!nodeEl) return;
        const id = nodeEl.getAttribute('data-id');
        if (!id) return;
        onNodePress(id);
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onInit={onInit}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        nodeDragThreshold={10}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        onlyRenderVisibleElements
        elevateNodesOnSelect={false}
        deleteKeyCode={['Delete', 'Backspace']}
        selectNodesOnDrag={false}
        selectionOnDrag
        multiSelectionKeyCode={['Meta', 'Control']}
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1]}
        panOnScroll={panOnScroll}
        zoomOnScroll={zoomOnScroll}
        zoomActivationKeyCode="Control"
        panOnScrollSpeed={0.75}
        defaultViewport={savedViewport}
        onMoveEnd={onViewportMoveEnd}
        minZoom={0.4}
        maxZoom={1.8}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#34d399', strokeWidth: 2.25, filter: 'drop-shadow(0 0 4px rgba(52,211,153,0.35))' },
        }}
        connectionLineStyle={{ stroke: '#6ee7b7', strokeWidth: 2, strokeDasharray: '6 4' }}
        className="bndz-automation-flow"
        proOptions={{ hideAttribution: true }}
      >
        <AutomationViewportRestore viewport={savedViewport} />
        <Background gap={24} size={1} color="rgba(52,211,153,0.07)" />
        <Controls className="bndz-flow-controls" showInteractive={false} />
        {nodes.length > 6 && (
          <MiniMap
            className="bndz-flow-minimap"
            maskColor="rgba(0,0,0,0.75)"
            nodeColor={n => resolveAutomationNodeDef((n.data as NodeData).nodeType).color}
            pannable
            zoomable
          />
        )}
        <Panel position="bottom-center" className="bndz-flow-hint-panel">
          Drag empty canvas to marquee · middle-drag pan · Ctrl+scroll zoom · Ctrl+C/V blocks
        </Panel>
        {nodes.length === 0 && (
          <Panel position="top-center" className="bndz-automation-empty-panel">
            <div className="bndz-automation-empty">
              <h3>Start with a recipe</h3>
              <p>Pick an everyday job — then edit the folder paths and press Run.</p>
              <div className="bndz-automation-empty-grid">
                {AUTOMATION_RECIPES.filter(r => r.group === 'everyday').map(r => (
                  <button key={r.id} type="button" className="bndz-automation-empty-card" onClick={() => loadRecipe(r.id)}>
                    <strong>{r.label}</strong>
                    <span>{r.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
});

type AutomationPaletteProps = {
  onAddNode: (type: AutomationNodeType) => void;
};

const AutomationPalette = React.memo(function AutomationPalette({ onAddNode }: AutomationPaletteProps) {
  return (
    <aside className="bndz-automation-palette shrink-0 overflow-y-auto bndz-scrollbar">
      <div className="bndz-automation-palette-head">
        <span className="bndz-automation-palette-title">Block library</span>
        <span className="bndz-automation-palette-sub">Click to add · right-click canvas</span>
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
                onClick={() => onAddNode(type)}
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
  );
});

type AutomationInspectorProps = {
  selectedNode: Node<NodeData> | null;
  lintIssues: LintIssue[];
  dryRunMode: boolean;
  dryRunSteps: DryRunStep[];
  log: string[];
  showRunHistory: boolean;
  runHistory: AutomationRunRecord[];
  armed: boolean;
  liveStatus: AutomationLiveStatus | null;
  updateSelectedField: (key: string, value: string) => void;
  pickFolder: (key: string) => void | Promise<void>;
  duplicateNode: (id: string) => void;
  copySelectedNode: () => void;
  disconnectNode: (id: string) => void;
  focusLintNode: (nodeId?: string) => void;
  setDryRunMode: (v: boolean) => void;
  setDryRunSteps: (steps: DryRunStep[]) => void;
  setShowRunHistory: React.Dispatch<React.SetStateAction<boolean>>;
};

/** Memoized so drag-position parent updates do not rebuild the inspector DOM. */
const AutomationInspector = React.memo(function AutomationInspector({
  selectedNode,
  lintIssues,
  dryRunMode,
  dryRunSteps,
  log,
  showRunHistory,
  runHistory,
  armed,
  liveStatus,
  updateSelectedField,
  pickFolder,
  duplicateNode,
  copySelectedNode,
  disconnectNode,
  focusLintNode,
  setDryRunMode,
  setDryRunSteps,
  setShowRunHistory,
}: AutomationInspectorProps) {
  const renderField = (f: AutomationNodeDef['fields'][number], node: Node<NodeData>) => {
    const val = node.data.fields[f.key] || '';
    if (f.type === 'boolean') {
      const checked = val === 'true' || val === '1' || val === 'on';
      return (
        <label key={f.key} className="bndz-automation-field bndz-automation-field--bool">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => updateSelectedField(f.key, e.target.checked ? 'true' : 'false')}
          />
          <span className="bndz-automation-field-label">{f.label}</span>
        </label>
      );
    }
    if (f.type === 'select' && f.options) {
      return (
        <label key={f.key} className="bndz-automation-field">
          <span className="bndz-automation-field-label">{f.label}</span>
          <select
            className="bndz-automation-input"
            value={val || f.options[0]?.value || ''}
            onChange={e => updateSelectedField(f.key, e.target.value)}
          >
            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      );
    }
    return (
      <label key={f.key} className="bndz-automation-field">
        <span className="bndz-automation-field-label">{f.label}</span>
        <div className="flex gap-1">
          <input
            className="bndz-automation-input flex-1"
            value={val}
            placeholder={f.placeholder}
            onChange={e => updateSelectedField(f.key, e.target.value)}
          />
          {(f.type === 'folder' || FOLDER_FIELD_KEYS.has(f.key)) && IPC.isNative && (
            <button type="button" className="bndz-lens-chip shrink-0" onClick={() => void pickFolder(f.key)}>…</button>
          )}
        </div>
      </label>
    );
  };

  return (
    <aside className="bndz-automation-inspector shrink-0 bndz-scrollbar">
      <div className="bndz-automation-inspector-head">
        <span className="bndz-automation-inspector-title">Inspector</span>
        {selectedNode && (() => {
          const def = resolveAutomationNodeDef(selectedNode.data.nodeType);
          return (
            <span className="bndz-automation-inspector-chip" style={{ color: def.color }}>
              {def.label}
            </span>
          );
        })()}
      </div>
      <div className="bndz-automation-inspector-scroll overflow-y-auto bndz-scrollbar flex-1 min-h-0">
      {!selectedNode ? (
        <div className="bndz-automation-inspector-empty">
          <Icons8Icon id="zap_ui" size={28} className="opacity-25 mb-2" />
          <p>Select a block to edit its properties, or click the library to add one.</p>
        </div>
      ) : (() => {
        const def = resolveAutomationNodeDef(selectedNode.data.nodeType);
        return (
        <div className="bndz-automation-inspector-body">
          <p className="bndz-automation-inspector-desc">{def.desc}</p>
          {def.fields.map(f => renderField(f, selectedNode))}
          <div className="bndz-automation-inspector-actions">
            <button type="button" className="bndz-lens-chip" onClick={() => duplicateNode(selectedNode.id)}>Duplicate</button>
            <button type="button" className="bndz-lens-chip" onClick={() => copySelectedNode()}>Copy</button>
            <button type="button" className="bndz-lens-chip" onClick={() => disconnectNode(selectedNode.id)}>Disconnect</button>
          </div>
          <p className="bndz-automation-inspector-kbd">Press <kbd>Delete</kbd> to remove · <kbd>Ctrl+C</kbd>/<kbd>Ctrl+V</kbd> copy/paste</p>
        </div>
        );
      })()}
      {lintIssues.length > 0 && (
        <div className="bndz-automation-lint">
          <div className="bndz-automation-log-head">
            Pipeline lint
            <span className="bndz-automation-lint-count">
              {lintErrorCount(lintIssues)} err · {lintIssues.length - lintErrorCount(lintIssues)} warn
            </span>
          </div>
          <ul className="bndz-automation-lint-list">
            {lintIssues.map(issue => (
              <li key={issue.id} className={`bndz-automation-lint-item bndz-automation-lint-item--${issue.severity}`}>
                {issue.nodeId ? (
                  <button
                    type="button"
                    className="bndz-automation-lint-jump"
                    onClick={() => focusLintNode(issue.nodeId)}
                    title="Select block on canvas"
                  >
                    {issue.message}
                  </button>
                ) : (
                  <span>{issue.message}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {dryRunMode && dryRunSteps.length > 0 && (
        <div className="bndz-automation-timeline">
          <div className="bndz-automation-log-head flex items-center justify-between gap-2">
            <span>Dry-run timeline</span>
            <button type="button" className="bndz-lens-chip" onClick={() => { setDryRunMode(false); setDryRunSteps([]); }}>Dismiss</button>
          </div>
          <ol className="bndz-automation-timeline-list">
            {dryRunSteps.map((step, i) => (
              <li key={`${step.nodeId}-${i}`} className={`bndz-automation-timeline-step bndz-automation-timeline-step--${step.status}`}>
                <button type="button" className="bndz-automation-timeline-jump" onClick={() => focusLintNode(step.nodeId)}>
                  <span className="bndz-automation-timeline-idx">{i + 1}</span>
                  <span className="bndz-automation-timeline-action">{step.action}</span>
                </button>
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
      {(showRunHistory || runHistory.length > 0) && (
        <div className="bndz-automation-log">
          <div className="bndz-automation-log-head flex items-center justify-between gap-2">
            <span>Run history</span>
            <button type="button" className="bndz-lens-chip" onClick={() => setShowRunHistory(v => !v)}>
              {showRunHistory ? 'Hide' : 'Show'}
            </button>
          </div>
          {showRunHistory && (
            <ul className="bndz-automation-history-list">
              {runHistory.length === 0 ? (
                <li className="bndz-automation-history-empty">No runs yet</li>
              ) : runHistory.map(entry => (
                <li key={entry.id} className={`bndz-automation-history-item${entry.ok ? '' : ' is-failed'}`}>
                  <div className="bndz-automation-history-meta">
                    <span>{entry.pipelineName}</span>
                    <span>{new Date(entry.startedAt).toLocaleString()}</span>
                  </div>
                  {entry.error && <div className="bndz-automation-history-error">{entry.error}</div>}
                  {entry.log.length > 0 && (
                    <pre className="bndz-automation-log-body bndz-mono text-[10px]">{entry.log.slice(-6).join('\n')}</pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {armed && liveStatus && (
        <div className="bndz-automation-log">
          <div className="bndz-automation-log-head">Live status</div>
          <ul className="bndz-automation-history-list">
            {liveStatus.watchers.map(w => (
              <li key={`${w.path}-${w.pipelineName}`} className="bndz-automation-history-item">
                <div className="bndz-automation-history-meta">
                  <span>{w.pipelineName}</span>
                  <span>{w.live ? 'live' : 'idle'}</span>
                </div>
                <div className="text-[10px] text-gray-400 truncate">{formatUiPath(w.path)}</div>
                {w.lastError && <div className="bndz-automation-history-error">{w.lastError}</div>}
              </li>
            ))}
            {liveStatus.schedules.map(s => (
              <li key={s.nodeId} className="bndz-automation-history-item">
                <div className="bndz-automation-history-meta">
                  <span>{s.pipelineName}</span>
                  <span>{s.active ? `every ${s.intervalMinutes}m` : 'paused'}</span>
                </div>
                {s.lastError && <div className="bndz-automation-history-error">{s.lastError}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {liveStatus?.recentRuns && liveStatus.recentRuns.length > 0 && (
        <div className="bndz-automation-log">
          <div className="bndz-automation-log-head">Watcher runs</div>
          <ul className="bndz-automation-history-list">
            {liveStatus.recentRuns.slice(0, 10).map((run, i) => (
              <li key={`${run.triggeredAt}-${i}`} className={`bndz-automation-history-item${run.ok ? '' : ' is-failed'}`}>
                <div className="bndz-automation-history-meta">
                  <span>{run.pipelineName}</span>
                  <span>{new Date(run.triggeredAt).toLocaleTimeString()}</span>
                </div>
                <div className="text-[10px] text-gray-400 truncate">{formatUiPath(run.triggerPath)} · {run.fileCount} file(s)</div>
                {run.error && <div className="bndz-automation-history-error">{run.error}</div>}
                {run.log.length > 0 && (
                  <pre className="bndz-automation-log-body bndz-mono text-[10px]">{run.log.slice(-4).join('\n')}</pre>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </aside>
  );
});

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
    edges: graph.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      className: e.sourceHandle === 'false' ? 'bndz-flow-edge--false' : e.sourceHandle === 'true' ? 'bndz-flow-edge--true' : undefined,
    })),
  };
}

function flowToGraph(
  graph: Pick<AutomationGraph, 'id' | 'name' | 'armed'>,
  nodes: Node<NodeData>[],
  edges: Edge[],
  viewport: AutomationViewport = defaultAutomationViewport(),
): AutomationGraph {
  return {
    id: graph.id,
    name: graph.name,
    armed: graph.armed,
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.data.nodeType,
      position: n.position,
      data: { ...n.data.fields },
    })),
    edges: edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || undefined,
    })),
    viewport,
    updatedAt: 0,
  };
}

function stableGraphJson(
  meta: Pick<AutomationGraph, 'id' | 'name' | 'armed'>,
  nodes: Node<NodeData>[],
  edges: Edge[],
  viewport: AutomationViewport,
): string {
  return stableAutomationJson(flowToGraph(meta, nodes, edges, viewport));
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

/**
 * Compute flow-space position that maps to the current viewport center,
 * offset so a ~260×140 node lands centered.
 */
function viewportCenterPosition(
  rfInstance: ReactFlowInstance | null | undefined,
  surface: HTMLElement | null | undefined,
): { x: number; y: number } {
  const el = surface?.querySelector('.bndz-automation-flow') as HTMLElement | null;
  if (!rfInstance || !el) return { x: 120, y: 80 };
  const rect = el.getBoundingClientRect();
  const screenCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const flowPos = rfInstance.screenToFlowPosition(screenCenter);
  return { x: flowPos.x - 130, y: flowPos.y - 70 };
}

export default function BndzAutomationView() {
  const { config } = useAppConfig();
  const autoSave = config.automationAutoSave !== false;
  const saveDelayMs = typeof config.automationAutoSaveDelayMs === 'number'
    ? Math.max(1200, config.automationAutoSaveDelayMs)
    : 1500;
  const panOnScroll = config.automationPanOnScroll !== false;
  const zoomOnScroll = config.automationZoomOnScroll !== false;

  const [pipelineId, setPipelineId] = useState('default');
  const [graphName, setGraphName] = useState('File pipeline');
  const [armed, setArmed] = useState(false);
  const [library, setLibrary] = useState<AutomationLibrary | null>(null);
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const selectedNodeIdRef = useRef<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lintIssues, setLintIssues] = useState<LintIssue[]>([]);
  const [dryRunSteps, setDryRunSteps] = useState<DryRunStep[]>([]);
  const [dryRunMode, setDryRunMode] = useState(false);
  const [graphReady, setGraphReady] = useState(false);
  const [liveStatus, setLiveStatus] = useState<AutomationLiveStatus | null>(null);
  const [runHistory, setRunHistory] = useState<AutomationRunRecord[]>(() => loadAutomationRunHistory());
  const [showRunHistory, setShowRunHistory] = useState(false);
  const [savedViewport, setSavedViewport] = useState<AutomationViewport>(defaultAutomationViewport());
  const surfaceRef = useRef<HTMLDivElement>(null);
  const graphMetaRef = useRef({ id: pipelineId, name: graphName, armed });
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const viewportRef = useRef<AutomationViewport>(defaultAutomationViewport());
  const viewportSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodeDraggingRef = useRef(false);
  const chromeFrozenRef = useRef({ nodes: 0, edges: 0 });
  const lintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rfInstanceRef = useRef<ReactFlowInstance<Node<NodeData>, Edge> | null>(null);
  graphMetaRef.current = { id: pipelineId, name: graphName, armed };
  if (!nodeDraggingRef.current) {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }
  const { menu, closeMenu, openMenu } = useWorkspaceContextMenu(surfaceRef);
  const splash = useWorkspaceSplash('automation', {
    isReady: graphReady,
    isEmpty: nodes.length === 0,
    resetEmptyHintOnMount: false,
  });

  const fieldSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  const autosave = useWorkspaceAutosave(
    () => stableGraphJson(graphMetaRef.current, nodesRef.current, edgesRef.current, viewportRef.current),
    async snap => {
      const parsed = JSON.parse(snap) as AutomationGraph;
      parsed.updatedAt = Date.now();
      hydrateAutomationFromJson(JSON.stringify(parsed));
      await flushBndzMeta('automation_graph_v1', JSON.stringify(parsed));
      const lib = await loadAutomationLibrary();
      const idx = lib.pipelines.findIndex(p => p.id === parsed.id);
      const pipelines = [...lib.pipelines];
      if (idx >= 0) pipelines[idx] = parsed;
      else pipelines.push(parsed);
      await flushBndzMeta('automation_library_v1', JSON.stringify({ ...lib, activeId: parsed.id, pipelines, updatedAt: Date.now() }));
      if (parsed.armed) await syncAutomationLive(parsed);
      return true;
    },
    saveDelayMs,
    autoSave,
  );

  const { schedule: scheduleSave, seed: seedAutosave, flush: flushAutosave } = autosave;

  const currentGraph = useCallback((): AutomationGraph => (
    flowToGraph(graphMetaRef.current, nodesRef.current, edgesRef.current, viewportRef.current)
  ), []);

  const loadGraphIntoEditor = useCallback((g: AutomationGraph) => {
    setPipelineId(g.id);
    setGraphName(g.name);
    setArmed(!!g.armed);
    const { nodes: n, edges: e } = graphToFlow(g);
    setNodes(n);
    setEdges(e);
    const vp = g.viewport ?? defaultAutomationViewport();
    viewportRef.current = vp;
    setSavedViewport(vp);
    seedAutosave(stableGraphJson({ id: g.id, name: g.name, armed: !!g.armed }, n, e, vp));
  }, [setNodes, setEdges, seedAutosave]);

  // Declared before applySeed — dep array must not read addNode while still in TDZ.
  const addNode = useCallback((type: AutomationNodeType, at?: { x: number; y: number }, fields?: Record<string, string>) => {
    const id = `n_${Date.now()}`;
    const pos = at ?? viewportCenterPosition(rfInstanceRef.current, surfaceRef.current);
    const newNode: Node<NodeData> = { ...makeFlowNode(type, id, pos.x, pos.y, fields), selected: true };
    setNodes(nds => nds.map(n => n.selected ? { ...n, selected: false } : n).concat(newNode));
    setSelectedNodeId(id);
    closeMenu();
    scheduleSave();
  }, [setNodes, closeMenu, scheduleSave]);

  const applySeed = useCallback((seed?: AutomationPendingSeed | null) => {
    const s = seed ?? consumeAutomationSeed();
    if (!s) return;
    if (s.pipeline?.nodes?.length) {
      const graph = {
        id: pipelineId,
        name: s.pipeline.name || graphName,
        nodes: s.pipeline.nodes,
        edges: s.pipeline.edges,
        viewport: defaultAutomationViewport(),
        armed: false,
        updatedAt: Date.now(),
      } as AutomationGraph;
      const { nodes: n, edges: e } = graphToFlow(graph);
      setNodes(n);
      setEdges(e);
      nodesRef.current = n;
      edgesRef.current = e;
      setGraphName(graph.name);
      scheduleSave();
      setStatus(`Loaded starter: ${graph.name}`);
      requestAnimationFrame(() => {
        rfInstanceRef.current?.fitView({ padding: 0.18, duration: 280, maxZoom: 1.25 });
      });
      return;
    }
    if (!s.type) return;
    addNode(s.type, undefined, s.fields || {});
    setStatus(`Added ${NODE_DEFS[s.type].label} block`);
  }, [setNodes, setEdges, scheduleSave, pipelineId, graphName, addNode]);

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
    loadAutomationLibrary({ force: true }).then(lib => {
      if (!active) return;
      setLibrary(lib);
      const g = lib.pipelines.find(p => p.id === lib.activeId) || lib.pipelines[0];
      loadGraphIntoEditor(g);
      setGraphReady(true);
      applySeed(consumeAutomationSeed());
      if (IPC.isNative) {
        // Re-sync every armed pipeline so one graph save cannot wipe another's watchers.
        for (const p of lib.pipelines) {
          if (p.armed) void syncAutomationLive(p);
        }
        void getAutomationLiveStatus().then(s => { if (active && s) setLiveStatus(s); });
      }
    });
    return () => { active = false; };
  }, [loadGraphIntoEditor, applySeed]);

  useEffect(() => {
    if (!armed || !IPC.isNative) return;
    let active = true;
    const poll = () => {
      if (document.hidden || nodeDraggingRef.current) return;
      void getAutomationLiveStatus().then(s => { if (active && s) setLiveStatus(s); });
    };
    poll();
    const id = window.setInterval(poll, 8000);
    const onVis = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      active = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [armed]);

  useEffect(() => {
    const onSeed = () => applySeed();
    window.addEventListener('bndz-automation-seed', onSeed);
    return () => window.removeEventListener('bndz-automation-seed', onSeed);
  }, [applySeed]);

  useLayoutEffect(() => {
    return () => {
      if (viewportSaveTimer.current) clearTimeout(viewportSaveTimer.current);
      void flushAutosave(true);
    };
  }, [flushAutosave]);

  useEffect(() => {
    focusWorkspaceSurface(surfaceRef.current);
  }, []);

  useEffect(() => {
    if (!graphReady) return;
    const el = surfaceRef.current;
    if (!el) return;
    return bindWorkspaceCursorGuard(el);
  }, [graphReady]);

  /** Fingerprint of graph *data* only — ignores node positions so drag does not re-lint. */
  const lintKeyRef = useRef('');
  const lintGraphKey = useMemo(() => {
    // Skip expensive stringify while dragging — positions change every frame but data does not.
    if (nodeDraggingRef.current) return lintKeyRef.current;
    const next = nodes.map(n => `${n.id}\0${n.data.nodeType}\0${JSON.stringify(n.data.fields)}`).join('\n')
      + '|' + edges.map(e => `${e.id}:${e.source}:${e.target}:${e.sourceHandle || ''}`).join(';');
    lintKeyRef.current = next;
    return next;
  }, [nodes, edges]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find(n => n.id === selectedNodeId) || null;
  // Position-only node updates must not refresh the inspector every drag frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, lintGraphKey]);

  useEffect(() => {
    if (nodeDraggingRef.current) return;
    if (lintTimer.current) clearTimeout(lintTimer.current);
    lintTimer.current = setTimeout(() => {
      lintTimer.current = null;
      if (nodeDraggingRef.current) return;
      const issues = lintAutomationGraph(currentGraph());
      setLintIssues(issues);
      const byNode = new Map<string, 'error' | 'warn'>();
      for (const issue of issues) {
        if (!issue.nodeId) continue;
        const prev = byNode.get(issue.nodeId);
        if (issue.severity === 'error' || prev !== 'error') {
          byNode.set(issue.nodeId, issue.severity);
        }
      }
      setNodes(nds => {
        let changed = false;
        const next = nds.map(n => {
          const sev = byNode.get(n.id) || null;
          if ((n.data.lintSeverity || null) === sev) return n;
          changed = true;
          return { ...n, data: { ...n.data, lintSeverity: sev } };
        });
        return changed ? next : nds;
      });
    }, 520);
    return () => {
      if (lintTimer.current) clearTimeout(lintTimer.current);
    };
  }, [pipelineId, graphName, armed, lintGraphKey, currentGraph, setNodes]);

  const focusLintNode = useCallback((nodeId?: string) => {
    if (!nodeId) return;
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setNodes(nds => nds.map(n => ({ ...n, selected: n.id === nodeId })));
    const target = nodesRef.current.find(n => n.id === nodeId);
    const rf = rfInstanceRef.current;
    if (target && rf) {
      const w = (target.measured?.width ?? 280);
      const h = (target.measured?.height ?? 190);
      void rf.setCenter(target.position.x + w / 2, target.position.y + h / 2, { zoom: Math.max(rf.getZoom(), 1), duration: 320 });
    }
  }, [setNodes]);

  const runDry = useCallback(() => {
    const steps = dryRunGraph(currentGraph());
    setDryRunSteps(steps);
    setDryRunMode(true);
    const errs = lintErrorCount(lintAutomationGraph(currentGraph()));
    setStatus(errs
      ? `Dry-run preview · ${errs} error${errs === 1 ? '' : 's'} — fix before Run`
      : 'Dry-run preview — no files touched');
  }, [currentGraph]);

  const onConnect = useCallback((conn: Connection) => {
    setEdges(eds => addEdge({
      ...conn,
      id: `e_${Date.now()}`,
      className: conn.sourceHandle === 'false' ? 'bndz-flow-edge--false' : conn.sourceHandle === 'true' ? 'bndz-flow-edge--true' : undefined,
    }, eds));
    scheduleSave();
  }, [setEdges, scheduleSave]);

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
    if (selectedNodeId) { deleteNode(selectedNodeId); return; }
    if (selectedEdgeId) deleteEdge(selectedEdgeId);
  }, [selectedNodeId, selectedEdgeId, deleteNode, deleteEdge]);

  const clearPipeline = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setArmed(false);
    setDryRunMode(false);
    setDryRunSteps([]);
    setStatus('Pipeline cleared');
    scheduleSave();
    void flushAutosave(true);
    closeMenu();
  }, [setNodes, setEdges, scheduleSave, flushAutosave, closeMenu]);

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

  const copySelectedNode = useCallback(() => {
    const node = nodes.find(n => n.id === selectedNodeId);
    if (!node) return;
    setWorkspaceClipboard({
      kind: 'automation-node',
      nodeType: node.data.nodeType,
      fields: { ...node.data.fields },
    });
    setStatus('Block copied — Ctrl+V to paste');
  }, [nodes, selectedNodeId]);

  const pasteNode = useCallback(() => {
    const clip = getWorkspaceClipboard();
    if (clip?.kind !== 'automation-node') return;
    addNode(clip.nodeType as AutomationNodeType, undefined, clip.fields);
  }, [addNode]);

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
      if (!shouldHandleWorkspaceKeys(surfaceRef.current)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedNodeId) {
        e.preventDefault();
        copySelectedNode();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        const clip = getWorkspaceClipboard();
        if (clip?.kind === 'automation-node') {
          e.preventDefault();
          pasteNode();
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedNodeId && !selectedEdgeId) return;
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, selectedEdgeId, deleteSelected, copySelectedNode, pasteNode]);

  const scheduleFieldSave = useCallback(() => {
    if (fieldSaveTimer.current) clearTimeout(fieldSaveTimer.current);
    fieldSaveTimer.current = setTimeout(() => {
      fieldSaveTimer.current = null;
      scheduleSave();
    }, 400);
  }, [scheduleSave]);

  const updateSelectedField = useCallback((key: string, value: string) => {
    if (!selectedNodeId) return;
    setNodes(nds => nds.map(n => n.id === selectedNodeId
      ? { ...n, data: { ...n.data, fields: { ...n.data.fields, [key]: value } } }
      : n));
    scheduleFieldSave();
  }, [selectedNodeId, setNodes, scheduleFieldSave]);

  const pickFolder = useCallback(async (fieldKey: string) => {
    if (!IPC.isNative) return;
    const picked = await IPC.openFolderDialog('Select folder');
    if (picked) updateSelectedField(fieldKey, picked);
  }, [updateSelectedField]);

  const toggleArmed = useCallback(async () => {
    const next = !armed;
    if (next && lintIssues.some(i => i.severity === 'error')) {
      setStatus('Fix pipeline errors before arming');
      return;
    }
    setArmed(next);
    graphMetaRef.current = { ...graphMetaRef.current, armed: next };
    scheduleSave();
    const g = { ...currentGraph(), armed: next, updatedAt: Date.now() };
    if (IPC.isNative) {
      const status = await syncAutomationLive(g);
      if (status) setLiveStatus(status);
      setStatus(next ? 'Pipeline armed — live watchers active' : 'Pipeline disarmed');
    } else {
      setStatus(next ? 'Armed (native host required for live run)' : 'Disarmed');
    }
  }, [armed, scheduleSave, currentGraph, lintIssues]);

  const armAllPipelines = useCallback(async (nextArmed: boolean) => {
    if (!library) return;
    await flushAutosave(true);
    const nextLib = {
      ...library,
      pipelines: library.pipelines.map(p => ({
        ...p,
        armed: p.id === pipelineId ? nextArmed : nextArmed,
        updatedAt: Date.now(),
      })),
    };
    // Persist each pipeline
    for (const p of nextLib.pipelines) {
      await saveAutomationGraphNow(p);
      if (IPC.isNative) await syncAutomationLive(p);
    }
    setLibrary(nextLib);
    setArmed(nextArmed);
    setStatus(nextArmed ? 'All pipelines armed' : 'All pipelines disarmed');
  }, [library, pipelineId, flushAutosave]);

  const save = async () => {
    const g = { ...currentGraph(), updatedAt: Date.now() };
    const ok = await saveAutomationGraphNow(g);
    if (ok) seedAutosave(stableGraphJson(graphMetaRef.current, nodes, edges, viewportRef.current));
    if (g.armed && IPC.isNative) {
      const status = await syncAutomationLive(g);
      if (status) setLiveStatus(status);
    }
    setStatus(ok ? 'Pipeline saved' : 'Save failed');
  };

  const run = async () => {
    setRunning(true);
    setStatus(null);
    setLog([]);
    const g = { ...currentGraph(), updatedAt: Date.now() };
    const startedAt = Date.now();
    hydrateAutomationFromJson(JSON.stringify(g));
    await saveAutomationGraphNow(g);
    seedAutosave(stableGraphJson(graphMetaRef.current, nodes, edges, viewportRef.current));
    const result = await runAutomationGraph(g);
    setLog(result.log || []);
    setStatus(result.ok ? 'Pipeline completed' : (result.error || 'Pipeline failed'));
    setRunHistory(appendAutomationRunRecord({
      pipelineId: g.id,
      pipelineName: g.name,
      startedAt,
      ok: result.ok,
      log: result.log || [],
      error: result.error,
    }));
    setRunning(false);
  };

  const switchPipeline = useCallback(async (id: string) => {
    if (!library) return;
    const g = library.pipelines.find(p => p.id === id);
    if (!g) return;
    await flushAutosave(true);
    if (armed && IPC.isNative) {
      await syncAutomationLive({ ...currentGraph(), armed: false });
      setArmed(false);
    }
    const updatedLib = { ...library, activeId: id, updatedAt: Date.now() };
    setLibrary(updatedLib);
    await saveAutomationLibrary(updatedLib);
    loadGraphIntoEditor(g);
    if (g.armed && IPC.isNative) {
      setArmed(true);
      const status = await syncAutomationLive(g);
      setLiveStatus(status);
    }
    setStatus(`Switched to ${g.name}`);
  }, [library, flushAutosave, loadGraphIntoEditor, armed, currentGraph]);

  useEffect(() => {
    const onSelect = (e: Event) => {
      const id = (e as CustomEvent).detail?.id as string | undefined;
      if (id) void switchPipeline(id);
    };
    window.addEventListener('bndz-automation-select-pipeline', onSelect);
    return () => window.removeEventListener('bndz-automation-select-pipeline', onSelect);
  }, [switchPipeline]);

  const newPipeline = useCallback(async () => {
    const g = createPipeline(`Pipeline ${(library?.pipelines.length ?? 0) + 1}`);
    const updatedLib: AutomationLibrary = {
      activeId: g.id,
      pipelines: [...(library?.pipelines ?? []), g],
      updatedAt: Date.now(),
    };
    setLibrary(updatedLib);
    await saveAutomationLibrary(updatedLib);
    loadGraphIntoEditor(g);
    setStatus('New pipeline created');
  }, [library, loadGraphIntoEditor]);

  const removePipeline = useCallback(async () => {
    if (!library || library.pipelines.length <= 1) {
      setStatus('Cannot delete the only pipeline');
      return;
    }
    if (armed && IPC.isNative) {
      await syncAutomationLive({ ...currentGraph(), armed: false });
      setArmed(false);
    }
    const updatedLib = await deletePipeline(pipelineId);
    if (!updatedLib) return;
    setLibrary(updatedLib);
    const g = updatedLib.pipelines.find(p => p.id === updatedLib.activeId) || updatedLib.pipelines[0];
    loadGraphIntoEditor(g);
    setStatus('Pipeline deleted');
  }, [library, pipelineId, armed, currentGraph, loadGraphIntoEditor]);

  const clonePipeline = useCallback(async () => {
    const result = await duplicatePipeline(pipelineId);
    if (!result) return;
    setLibrary(result.lib);
    loadGraphIntoEditor(result.graph);
    setStatus(`Duplicated as ${result.graph.name}`);
  }, [pipelineId, loadGraphIntoEditor]);

  const exportPipeline = useCallback(() => {
    const g = currentGraph();
    const json = exportPipelineJson(g);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${g.name || 'pipeline'}.bndz-pipeline.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Pipeline exported');
  }, [currentGraph]);

  const importPipeline = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.bndz-pipeline.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const graph = importPipelineFromJson(String(reader.result), file.name.replace(/\.[^.]+$/, ''));
        if (!graph) {
          setStatus('Import failed — invalid pipeline JSON');
          return;
        }
        void addPipelineToLibrary(graph).then(lib => {
          setLibrary(lib);
          loadGraphIntoEditor(graph);
          setStatus(`Imported ${graph.name}`);
        });
      };
      reader.readAsText(file);
    };
    input.click();
  }, [loadGraphIntoEditor]);

  const loadRecipe = useCallback((recipeId: string) => {
    const recipe = AUTOMATION_RECIPES.find(r => r.id === recipeId);
    if (!recipe) return;
    const g = recipeToGraph(recipe, pipelineId);
    const { nodes: n, edges: e } = graphToFlow(g);
    setNodes(n);
    setEdges(e);
    nodesRef.current = n;
    edgesRef.current = e;
    setGraphName(g.name);
    setSelectedNodeId(null);
    setStatus(`${g.name} ready — edit folder paths then Arm / Run`);
    scheduleSave();
    requestAnimationFrame(() => {
      rfInstanceRef.current?.fitView({ padding: 0.18, duration: 280, maxZoom: 1.25 });
    });
  }, [pipelineId, setNodes, setEdges, scheduleSave]);

  const loadTemplate = useCallback((template: 'deploy' | 'backup') => {
    loadRecipe(template === 'deploy' ? 'deploy-rsync' : 'archive-backup');
  }, [loadRecipe]);

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

  const onFlowInit = useCallback((inst: ReactFlowInstance) => {
    rfInstanceRef.current = inst;
  }, []);

  const pendingDragNodes = useRef<Node<NodeData>[] | null>(null);
  const dragElByIdRef = useRef<Map<string, HTMLElement>>(new Map());
  const dragRafRef = useRef(0);
  const dragPendingPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const setFlowDraggingClass = useCallback((on: boolean) => {
    const el = surfaceRef.current?.querySelector('.bndz-automation-flow');
    el?.classList.toggle('is-node-dragging', on);
  }, []);

  const flushDragTransforms = useCallback(() => {
    dragRafRef.current = 0;
    const pending = dragPendingPosRef.current;
    if (!pending.size) return;
    for (const [id, pos] of pending) {
      let el = dragElByIdRef.current.get(id);
      if (!el) {
        el = surfaceRef.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`) as HTMLElement | null || undefined;
        if (el) {
          dragElByIdRef.current.set(id, el);
          el.style.willChange = 'transform';
        }
      }
      if (el) el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    }
    pending.clear();
  }, []);

  const nodePressStampRef = useRef(0);

  const applyNodeSelection = useCallback((nodeId: string | null, { toggle }: { toggle: boolean }) => {
    if (nodeId) nodePressStampRef.current = performance.now();
    nodeDraggingRef.current = false;
    setSelectedEdgeId(null);
    const prev = selectedNodeIdRef.current;
    const next = toggle && prev === nodeId ? null : nodeId;
    selectedNodeIdRef.current = next;
    setSelectedNodeId(next);
    setNodes(nds => nds.map(n => ({ ...n, selected: next !== null && n.id === next })));
  }, [setNodes]);

  const onNodeClick = useCallback((e: React.MouseEvent, node: Node) => {
    e.stopPropagation();
    applyNodeSelection(node.id, { toggle: false });
  }, [applyNodeSelection]);

  const onNodePress = useCallback((nodeId: string) => {
    applyNodeSelection(nodeId, { toggle: false });
  }, [applyNodeSelection]);

  const onPaneClick = useCallback(() => {
    if (nodeDraggingRef.current) return;
    if (performance.now() - nodePressStampRef.current < 400) return;
    applyNodeSelection(null, { toggle: false });
  }, [applyNodeSelection]);

  const onNodeDragStart = useCallback((_e: React.MouseEvent, node: Node) => {
    applyNodeSelection(node.id, { toggle: false });
    nodeDraggingRef.current = true;
    chromeFrozenRef.current = {
      nodes: nodesRef.current.length,
      edges: edgesRef.current.length,
    };
    dragElByIdRef.current.clear();
    dragPendingPosRef.current.clear();
    const surface = surfaceRef.current;
    const ids = new Set<string>([node.id]);
    for (const n of nodesRef.current) {
      if (n.selected) ids.add(n.id);
    }
    if (surface) {
      for (const id of ids) {
        const el = surface.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`) as HTMLElement | null;
        if (el) {
          dragElByIdRef.current.set(id, el);
          el.style.willChange = 'transform';
        }
      }
    }
    setFlowDraggingClass(true);
  }, [setFlowDraggingClass, applyNodeSelection]);

  const onNodeDragStop = useCallback(() => {
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current);
      flushDragTransforms();
    }
    for (const el of dragElByIdRef.current.values()) {
      el.style.willChange = '';
    }
    dragElByIdRef.current.clear();
    dragPendingPosRef.current.clear();
    const flushed = pendingDragNodes.current || nodesRef.current;
    pendingDragNodes.current = null;
    nodeDraggingRef.current = false;
    setFlowDraggingClass(false);
    nodesRef.current = flushed;
    setNodes(flushed);
    const sel = flushed.find(n => n.selected);
    if (sel) {
      selectedNodeIdRef.current = sel.id;
      setSelectedNodeId(sel.id);
    }
    scheduleSave();
  }, [scheduleSave, setNodes, setFlowDraggingClass, flushDragTransforms]);

  /** Mid-drag: refs + rAF translate3d for position/dimensions — select changes pass through to React state. */
  const onNodesChange = useCallback<OnNodesChange<Node<NodeData>>>((changes) => {
    if (nodeDraggingRef.current) {
      const dragChanges: NodeChange<Node<NodeData>>[] = [];
      const passthrough: NodeChange<Node<NodeData>>[] = [];
      for (const c of changes) {
        if (c.type === 'position' || c.type === 'dimensions') {
          dragChanges.push(c);
        } else {
          passthrough.push(c);
        }
      }
      if (dragChanges.length > 0) {
        const base = pendingDragNodes.current ?? nodesRef.current;
        const next = applyNodeChanges(dragChanges, base);
        pendingDragNodes.current = next;
        nodesRef.current = next;
        for (const c of dragChanges) {
          if (c.type !== 'position' || !c.position || !('id' in c) || !c.id) continue;
          dragPendingPosRef.current.set(c.id, c.position);
        }
        if (!dragRafRef.current) {
          dragRafRef.current = requestAnimationFrame(flushDragTransforms);
        }
      }
      if (passthrough.length > 0) {
        onNodesChangeBase(passthrough);
      }
      return;
    }
    onNodesChangeBase(changes);
  }, [onNodesChangeBase, flushDragTransforms]);

  const menuNode = nodes.find(n => n.id === menu?.targetId);
  const liveWatchers = liveStatus?.watchers?.filter(w => w.live).length ?? 0;
  const liveSchedules = liveStatus?.schedules?.filter(s => s.active).length ?? 0;

  // Freeze chrome counts while dragging so header/command bar skip extra work mid-drag.
  const chromeNodeCount = nodeDraggingRef.current ? chromeFrozenRef.current.nodes : nodes.length;
  const chromeEdgeCount = nodeDraggingRef.current ? chromeFrozenRef.current.edges : edges.length;

  return (
    <div
      ref={surfaceRef}
      tabIndex={0}
      className={`bndz-automation bndz-ws-skin--automation flex flex-col h-full min-h-0 outline-none${running ? ' is-running' : ''}${armed && liveWatchers > 0 ? ' is-armed-live' : ''}`}
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
          subtitle="Wire file pipelines — watch, filter, branch, deploy. Arm pipelines for live folder watchers and schedules."
          icon="zap_ui"
          accent="#38bdf8"
          features={[
            { icon: 'zap_ui', title: '22 block types', desc: 'Triggers, filters, actions, branches' },
            { icon: 'cloud_ui', title: 'Live watchers', desc: 'Arm pipeline for real-time folder monitoring' },
            { icon: 'branch', title: 'Branch splits', desc: 'True/false outputs for conditional flows' },
            { icon: 'sync_folders', title: 'Pipeline library', desc: 'Multiple named pipelines' },
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
            <div className="flex items-center gap-2 flex-wrap">
              {library && (
                <select
                  className="bndz-automation-pipeline-select"
                  value={pipelineId}
                  onChange={e => void switchPipeline(e.target.value)}
                  title="Pipeline library"
                >
                  {library.pipelines.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.armed ? '● ' : ''}{p.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                className="bndz-ws-pipeline-name"
                value={graphName}
                onChange={e => { setGraphName(e.target.value); scheduleFieldSave(); }}
                spellCheck={false}
              />
              <span className="bndz-ws-pill bndz-ws-pill--automation">Circuit</span>
              <button
                type="button"
                className={`bndz-ws-chip${armed ? ' bndz-ws-chip--armed' : ''}`}
                onClick={() => void toggleArmed()}
                title={armed ? 'Disarm live watchers' : 'Arm for live watchers & schedules'}
              >
                {armed ? '● Armed' : '○ Disarmed'}
              </button>
              {library && library.pipelines.length > 1 && (
                <>
                  <button
                    type="button"
                    className="bndz-ws-chip"
                    title="Arm all pipelines"
                    onClick={() => void armAllPipelines(true)}
                  >
                    Arm all
                  </button>
                  <button
                    type="button"
                    className="bndz-ws-chip"
                    title="Disarm all pipelines"
                    onClick={() => void armAllPipelines(false)}
                  >
                    Disarm all
                  </button>
                </>
              )}
            </div>
            <p className="bndz-ws-chrome-desc">
              {chromeNodeCount} block{chromeNodeCount === 1 ? '' : 's'} · {chromeEdgeCount} wire{chromeEdgeCount === 1 ? '' : 's'}
              {armed && (liveWatchers > 0 || liveSchedules > 0) && (
                <span className="bndz-automation-live-badge">
                  {' '}· {liveWatchers} watcher{liveWatchers === 1 ? '' : 's'}{liveSchedules > 0 ? ` · ${liveSchedules} schedule${liveSchedules === 1 ? '' : 's'}` : ''}
                </span>
              )}
              {liveStatus?.watchers?.some(w => w.lastError) && (
                <span className="bndz-automation-live-badge bndz-automation-live-badge--error">
                  {' '}· watcher error
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="bndz-ws-chrome-actions shrink-0">
          {status && <span className="bndz-ws-status">{status}</span>}
          {lintIssues.length > 0 && (
            <span
              className={`bndz-automation-lint-badge${lintErrorCount(lintIssues) ? ' is-error' : ''}`}
              title={lintIssues.map(i => i.message).join('\n')}
            >
              {lintErrorCount(lintIssues)
                ? `${lintErrorCount(lintIssues)} error${lintErrorCount(lintIssues) === 1 ? '' : 's'}`
                : `${lintIssues.length} warn`}
            </span>
          )}
          <button type="button" className="bndz-ws-chip" disabled={running} onClick={runDry}>Dry run</button>
          <button
            type="button"
            className="bndz-ws-chip bndz-ws-chip--primary"
            disabled={running || lintErrorCount(lintIssues) > 0}
            onClick={() => void run()}
            title={lintErrorCount(lintIssues) > 0 ? 'Fix pipeline lint errors before running' : undefined}
          >
            {running ? 'Running…' : 'Run pipeline'}
          </button>
        </div>
      </header>

      <WorkspaceCommandBar
        variant="automation"
        hint="Del removes · Ctrl+C/V block · middle-drag pan"
        commands={[
          { id: 'new', label: 'New pipeline', iconSrc: '/Ui/plugin.svg', onClick: () => void newPipeline() },
          { id: 'dup-pipe', label: 'Duplicate pipeline', iconSrc: '/launcher-icons/copy.png', onClick: () => void clonePipeline() },
          { id: 'del-pipe', label: 'Delete pipeline', iconSrc: '/launcher-icons/trash_ui.png', disabled: (library?.pipelines.length ?? 0) <= 1, onClick: () => void removePipeline() },
          { id: 'export-pipe', label: 'Export pipeline', iconSrc: '/launcher-icons/emblem-downloads.svg', onClick: exportPipeline },
          { id: 'import-pipe', label: 'Import pipeline', iconSrc: '/launcher-icons/emblem-documents.svg', onClick: importPipeline },
          {
            id: 'fit-view',
            label: 'Fit all',
            iconSrc: '/launcher-icons/details-view.svg',
            onClick: () => {
              const rf = rfInstanceRef.current;
              if (!rf) return;
              void rf.fitView({ padding: 0.18, duration: 280, maxZoom: 1.25 });
            },
          },
          {
            id: 'reset-zoom',
            label: 'Reset zoom',
            iconSrc: '/launcher-icons/emblem-synchronizing.svg',
            onClick: () => {
              const rf = rfInstanceRef.current;
              if (!rf) return;
              const { x, y } = rf.getViewport();
              // Keep pan; snap zoom to 1 around current viewport center via setViewport after measuring.
              const zoom = rf.getZoom();
              const el = document.querySelector('.bndz-automation-flow') as HTMLElement | null;
              if (!el) {
                void rf.setViewport({ x, y, zoom: 1 }, { duration: 200 });
                return;
              }
              const rect = el.getBoundingClientRect();
              const cx = rect.width / 2;
              const cy = rect.height / 2;
              const worldX = (cx - x) / zoom;
              const worldY = (cy - y) / zoom;
              void rf.setViewport({ x: cx - worldX, y: cy - worldY, zoom: 1 }, { duration: 200 });
            },
          },
          { id: 'history', label: 'Run history', iconSrc: '/launcher-icons/clock_ui.png', onClick: () => setShowRunHistory(v => !v) },
          { id: 'tidy', label: 'Downloads tidy', iconSrc: '/launcher-icons/emblem-downloads.svg', onClick: () => loadRecipe('downloads-tidy') },
          { id: 'shots', label: 'Screenshots', iconSrc: '/launcher-icons/emblem-documents.svg', onClick: () => loadRecipe('screenshot-collect') },
          { id: 'zip', label: 'Zip inbox', iconSrc: '/launcher-icons/zip.png', onClick: () => loadRecipe('zip-inbox') },
          { id: 'deploy', label: 'Deploy', iconSrc: '/launcher-icons/emblem-shared.svg', onClick: () => loadTemplate('deploy') },
          { id: 'save', label: 'Flush save', iconSrc: '/Ui/plugin.svg', onClick: () => void save() },
          { id: 'clear', label: 'Clear pipeline', iconSrc: '/launcher-icons/trash_ui.png', disabled: chromeNodeCount === 0 && chromeEdgeCount === 0, onClick: clearPipeline },
          { id: 'intro', label: 'Intro', iconSrc: '/Ui/image-loading.svg', onClick: () => splash.replay() },
        ]}
      />

      <div className="flex flex-1 min-h-0">
        <AutomationPalette onAddNode={addNode} />

        <AutomationFlowPane
          nodes={nodes}
          edges={edges}
          panOnScroll={panOnScroll}
          zoomOnScroll={zoomOnScroll}
          savedViewport={savedViewport}
          onInit={onFlowInit}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={onNodeClick}
          onNodePress={onNodePress}
          onPaneClick={onPaneClick}
          onViewportMoveEnd={onViewportMoveEnd}
          loadRecipe={loadRecipe}
        />

        <AutomationInspector
          selectedNode={selectedNode}
          lintIssues={lintIssues}
          dryRunMode={dryRunMode}
          dryRunSteps={dryRunSteps}
          log={log}
          showRunHistory={showRunHistory}
          runHistory={runHistory}
          armed={armed}
          liveStatus={liveStatus}
          updateSelectedField={updateSelectedField}
          pickFolder={pickFolder}
          duplicateNode={duplicateNode}
          copySelectedNode={copySelectedNode}
          disconnectNode={disconnectNode}
          focusLintNode={focusLintNode}
          setDryRunMode={setDryRunMode}
          setDryRunSteps={setDryRunSteps}
          setShowRunHistory={setShowRunHistory}
        />
      </div>

      {menu?.kind === 'automation-node' && menuNode && (
        <WorkspaceMenuPanel variant="automation" x={menu.x} y={menu.y}>
          <WorkspaceMenuItem label="Duplicate block" icon="copy" onClick={() => duplicateNode(menuNode.id)} />
          <WorkspaceMenuItem label="Copy block" icon="copy" onClick={() => { copySelectedNode(); closeMenu(); }} />
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
          <WorkspaceMenuItem label="Add watch folder" icon="folder_open_ui" onClick={() => addNode('watchFolder')} />
          <WorkspaceMenuItem label="Add filter extension" icon="filter_ui" onClick={() => addNode('filterExtension')} />
          <WorkspaceMenuItem label="Add copy to" icon="copy" onClick={() => addNode('copyTo')} />
          <WorkspaceMenuItem label="Add branch" icon="branch" onClick={() => addNode('branch')} />
          <WorkspaceMenuItem label="Add notify" icon="bell" onClick={() => addNode('notifyToast')} />
          <WorkspaceMenuItem label="Add remote deploy" icon="cloud_ui" onClick={() => addNode('rsyncDeploy')} />
          <WorkspaceMenuItem label="Add log block" icon="notepad" onClick={() => addNode('log')} />
          <WorkspaceMenuSep />
          <WorkspaceMenuItem label="Open Sandbox" icon="layers_ui" onClick={() => { window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'project-sandbox' } })); closeMenu(); }} />
          <WorkspaceMenuItem label="Open Library Health" icon="shield_ui" onClick={() => { window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'library-health' } })); closeMenu(); }} />
          <WorkspaceMenuItem label="Open Inbound Volume" icon="download_ui" onClick={() => { window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'inbound-volume' } })); closeMenu(); }} />
          <WorkspaceMenuItem label="Open Branching Time" icon="history_ui" onClick={() => { window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'branching-time' } })); closeMenu(); }} />
          <WorkspaceMenuSep />
          <WorkspaceMenuItem label="Clear pipeline" icon="delete" danger disabled={nodes.length === 0 && edges.length === 0} onClick={clearPipeline} />
        </WorkspaceMenuPanel>
      )}
    </div>
  );
}
