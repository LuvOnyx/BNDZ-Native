/**
 * Colors tab field schema — maps to Settings colorConfig1–49.
 * Values are solid hex (#rrggbb[aa]) or gradient JSON (see colorFill.ts).
 */

export type ColorFillMode = 'any' | 'gradient';

export interface ColorConfigField {
  key: string;
  label: string;
  default: string;
  previewText?: string;
  section: string;
  /** UI: solid|gradient, or force gradient (plugin heroes). */
  fillMode?: ColorFillMode;
  /** Minimum stops when editing as gradient (plugin heroes: 3). */
  minStops?: number;
  /**
   * How the value is applied to CSS:
   * - background: solid or full gradient
   * - foreground: solid only (first stop if gradient)
   */
  applyAs?: 'background' | 'foreground';
}

export const COLOR_CONFIG_SECTIONS: { id: string; title: string; description?: string }[] = [
  { id: 'tree', title: 'Navigation Tree', description: 'Sidebar tree text and background' },
  { id: 'tabs', title: 'Tabs', description: 'List tabs — active/inactive text and backgrounds' },
  { id: 'list', title: 'File List', description: 'List view foreground, background, and selection' },
  { id: 'breadcrumb', title: 'Breadcrumb & Toolbar', description: 'Path bar and toolbar chrome' },
  { id: 'details', title: 'Details & Preview', description: 'Column headers, per-column accents, and preview panel' },
  { id: 'chrome', title: 'Status Bar & Accents', description: 'Status bar, neon accent, and highlights' },
  { id: 'tags', title: 'Tags & Menus', description: 'Tag badges and context menus' },
  { id: 'selection', title: 'Control Selections', description: 'Focused and unfocused control highlights' },
  { id: 'tracing', title: 'Tree Tracing & Pins', description: 'Path tracing and recent location pins' },
  {
    id: 'plugin-heroes',
    title: 'Plugin Heroes',
    description: 'Mandatory multi-stop gradient for bottom plugin hero panels',
  },
  {
    id: 'command-deck',
    title: 'Command Deck',
    description: 'Floating context bar above the bottom plugin panel',
  },
];

/** Default plugin hero — classic left wash → mid → cyan veil (visible over panel bg). */
export const PLUGIN_HERO_DEFAULT =
  '{"mode":"gradient","angle":90,"stops":[{"color":"#0c1220f7","pos":0},{"color":"#080a1094","pos":52},{"color":"#38bdf812","pos":100}]}';

export const COLOR_CONFIG_FIELDS: ColorConfigField[] = [
  { key: 'colorConfig1', label: 'Tree Text', default: '#d4d4d4', previewText: '#111111', section: 'tree', applyAs: 'foreground' },
  { key: 'colorConfig2', label: 'Tree Background', default: '#111111', previewText: '#d4d4d4', section: 'tree', applyAs: 'background' },

  { key: 'colorConfig6', label: 'Active Tab Text', default: '#ffffff', previewText: '#2d2d30', section: 'tabs', applyAs: 'foreground' },
  { key: 'colorConfig7', label: 'Active Tab Background', default: '#2d2d30', previewText: '#ffffff', section: 'tabs', applyAs: 'background' },
  { key: 'colorConfig8', label: 'Inactive Tab Text', default: '#888888', previewText: '#1a1a1a', section: 'tabs', applyAs: 'foreground' },
  { key: 'colorConfig9', label: 'Inactive Tab Background', default: '#1a1a1a', previewText: '#888888', section: 'tabs', applyAs: 'background' },

  { key: 'colorConfig10', label: 'List Text', default: '#e0e0e0', previewText: '#1c1c1c', section: 'list', applyAs: 'foreground' },
  { key: 'colorConfig11', label: 'List Background', default: '#1c1c1c', previewText: '#e0e0e0', section: 'list', applyAs: 'background' },
  { key: 'colorConfig12', label: 'Alternate Row', default: '#222222', previewText: '#e0e0e0', section: 'list', applyAs: 'background' },
  { key: 'colorConfig13', label: 'Hover Row', default: '#2a2d2e', previewText: '#ffffff', section: 'list', applyAs: 'background' },
  { key: 'colorConfig14', label: 'Selected Row', default: '#264f78', previewText: '#ffffff', section: 'list', applyAs: 'background' },
  { key: 'colorConfig15', label: 'Focused Item', default: '#007acc', previewText: '#ffffff', section: 'list', applyAs: 'foreground' },

  { key: 'colorConfig22', label: 'Breadcrumb Text', default: '#cccccc', previewText: '#1a1a1a', section: 'breadcrumb', applyAs: 'foreground' },
  { key: 'colorConfig23', label: 'Breadcrumb Background', default: '#1a1a1a', previewText: '#cccccc', section: 'breadcrumb', applyAs: 'background' },
  { key: 'colorConfig3', label: 'Toolbar Text', default: '#e0e0e0', previewText: '#252526', section: 'breadcrumb', applyAs: 'foreground' },
  { key: 'colorConfig4', label: 'Toolbar Background', default: '#252526', previewText: '#e0e0e0', section: 'breadcrumb', applyAs: 'background' },

  { key: 'colorConfig16', label: 'Column Header Text', default: '#aaaaaa', previewText: '#1a1a1a', section: 'details', applyAs: 'foreground' },
  { key: 'colorConfig17', label: 'Column Header Background', default: '#1a1a1a', previewText: '#aaaaaa', section: 'details', applyAs: 'background' },
  { key: 'colorConfig36', label: 'Name Column Accent', default: '#38bdf8', previewText: '#0f172a', section: 'details', applyAs: 'foreground' },
  { key: 'colorConfig37', label: 'Type Column Accent', default: '#a78bfa', previewText: '#0f172a', section: 'details', applyAs: 'foreground' },
  { key: 'colorConfig38', label: 'Size Column Accent', default: '#fbbf24', previewText: '#0f172a', section: 'details', applyAs: 'foreground' },
  { key: 'colorConfig39', label: 'Modified Column Accent', default: '#2dd4bf', previewText: '#0f172a', section: 'details', applyAs: 'foreground' },
  { key: 'colorConfig40', label: 'Created Column Accent', default: '#67e8f9', previewText: '#0f172a', section: 'details', applyAs: 'foreground' },
  { key: 'colorConfig41', label: 'Attributes Column Accent', default: '#94a3b8', previewText: '#0f172a', section: 'details', applyAs: 'foreground' },
  { key: 'colorConfig42', label: 'Tags Column Accent', default: '#ef4444', previewText: '#0f172a', section: 'details', applyAs: 'foreground' },
  { key: 'colorConfig43', label: 'Label Column Accent', default: '#c084fc', previewText: '#0f172a', section: 'details', applyAs: 'foreground' },
  { key: 'colorConfig44', label: 'Comment Column Accent', default: '#fb923c', previewText: '#0f172a', section: 'details', applyAs: 'foreground' },
  { key: 'colorConfig45', label: 'Path Column Accent', default: '#60a5fa', previewText: '#0f172a', section: 'details', applyAs: 'foreground' },
  { key: 'colorConfig18', label: 'Preview Panel Background', default: '#151515', previewText: '#e0e0e0', section: 'details', applyAs: 'background' },
  { key: 'colorConfig19', label: 'Preview Panel Text', default: '#e0e0e0', previewText: '#151515', section: 'details', applyAs: 'foreground' },

  { key: 'colorConfig5', label: 'Status Bar Text', default: '#aaaaaa', previewText: '#1a1a1f', section: 'chrome', applyAs: 'foreground' },
  { key: 'colorConfig46', label: 'Status Bar Background', default: '#1a1a1f', previewText: '#aaaaaa', section: 'chrome', applyAs: 'background' },
  { key: 'colorConfig20', label: 'Sidebar / Neon Accent', default: '#007acc', previewText: '#ffffff', section: 'chrome', applyAs: 'foreground' },
  { key: 'colorConfig21', label: 'Pane Divider', default: '#333333', previewText: '#ffffff', section: 'chrome', applyAs: 'foreground' },
  { key: 'colorConfig24', label: 'Search Match Highlight', default: '#fbbf24', previewText: '#000000', section: 'chrome', applyAs: 'background' },

  { key: 'colorConfig25', label: 'Tag Badge Background', default: '#3b82f6', previewText: '#ffffff', section: 'tags', applyAs: 'background' },
  { key: 'colorConfig26', label: 'Tag Badge Text', default: '#ffffff', previewText: '#3b82f6', section: 'tags', applyAs: 'foreground' },
  { key: 'colorConfig27', label: 'Context Menu Background', default: '#1e1e1e', previewText: '#e0e0e0', section: 'tags', applyAs: 'background' },
  { key: 'colorConfig28', label: 'Context Menu Text', default: '#e0e0e0', previewText: '#1e1e1e', section: 'tags', applyAs: 'foreground' },
  { key: 'colorConfig29', label: 'Scrollbar Thumb', default: '#555555', previewText: '#ffffff', section: 'tags', applyAs: 'background' },

  { key: 'colorConfig30', label: 'Focused Selection Text', default: '#FFFFFF', previewText: '#5096E2', section: 'selection', applyAs: 'foreground' },
  { key: 'colorConfig31', label: 'Focused Selection Background', default: '#5096E2', previewText: '#FFFFFF', section: 'selection', applyAs: 'background' },
  { key: 'colorConfig32', label: 'Unfocused Selection Text', default: '#000000', previewText: '#D0DBE6', section: 'selection', applyAs: 'foreground' },
  { key: 'colorConfig33', label: 'Unfocused Selection Background', default: '#D0DBE6', previewText: '#000000', section: 'selection', applyAs: 'background' },

  { key: 'colorConfig34', label: 'Tree Path Tracing', default: '#B6E956', previewText: '#000000', section: 'tracing', applyAs: 'foreground' },
  { key: 'colorConfig35', label: 'Recent Location Pins', default: '#E956B6', previewText: '#ffffff', section: 'tracing', applyAs: 'foreground' },

  {
    key: 'colorConfig47',
    label: 'Plugin Hero Gradient',
    default: PLUGIN_HERO_DEFAULT,
    previewText: '#e0f2fe',
    section: 'plugin-heroes',
    fillMode: 'gradient',
    minStops: 3,
    applyAs: 'background',
  },

  {
    key: 'colorConfig50',
    label: 'Command Deck Fill',
    default: '{"mode":"gradient","angle":165,"stops":[{"color":"#161c26f0","pos":0},{"color":"#0e1016fa","pos":100}]}',
    previewText: '#e0f2fe',
    section: 'command-deck',
    fillMode: 'any',
    applyAs: 'background',
  },
  {
    key: 'colorConfig51',
    label: 'Command Deck Border / Accent',
    default: '#99c9f038',
    previewText: '#0e1016',
    section: 'command-deck',
    applyAs: 'foreground',
  },
];

/** Legacy keys merged into colorConfig47. */
export const LEGACY_PLUGIN_HERO_KEYS = ['colorConfig48', 'colorConfig49'] as const;

export function getColorConfigDefaults(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of COLOR_CONFIG_FIELDS) out[f.key] = f.default;
  return out;
}

export function getColorFieldMeta(key: string): ColorConfigField | undefined {
  return COLOR_CONFIG_FIELDS.find(f => f.key === key);
}
