export interface ColorConfigField {
  key: string;
  label: string;
  default: string;
  previewText?: string;
  section: string;
}

export const COLOR_CONFIG_SECTIONS: { id: string; title: string; description?: string }[] = [
  { id: 'tree', title: 'Navigation Tree', description: 'Sidebar tree text and background' },
  { id: 'tabs', title: 'Tabs', description: 'Active and inactive tab colors' },
  { id: 'list', title: 'File List', description: 'List view foreground, background, and selection' },
  { id: 'breadcrumb', title: 'Breadcrumb & Toolbar', description: 'Path bar and toolbar chrome' },
  { id: 'details', title: 'Details & Preview', description: 'Column headers and preview panel' },
  { id: 'chrome', title: 'Status & Accents', description: 'Status bar, dividers, and highlights' },
  { id: 'tags', title: 'Tags & Menus', description: 'Tag badges and context menus' },
  { id: 'selection', title: 'Control Selections', description: 'Focused and unfocused control highlights' },
  { id: 'tracing', title: 'Tree Tracing & Pins', description: 'Path tracing and recent location pins' },
];

export const COLOR_CONFIG_FIELDS: ColorConfigField[] = [
  { key: 'colorConfig1', label: 'Tree Text', default: '#d4d4d4', previewText: '#111111', section: 'tree' },
  { key: 'colorConfig2', label: 'Tree Background', default: '#111111', previewText: '#d4d4d4', section: 'tree' },

  { key: 'colorConfig6', label: 'Active Tab Text', default: '#ffffff', previewText: '#2d2d30', section: 'tabs' },
  { key: 'colorConfig7', label: 'Active Tab Background', default: '#2d2d30', previewText: '#ffffff', section: 'tabs' },
  { key: 'colorConfig8', label: 'Inactive Tab Text', default: '#888888', previewText: '#1a1a1a', section: 'tabs' },
  { key: 'colorConfig9', label: 'Inactive Tab Background', default: '#1a1a1a', previewText: '#888888', section: 'tabs' },

  { key: 'colorConfig10', label: 'List Text', default: '#e0e0e0', previewText: '#1c1c1c', section: 'list' },
  { key: 'colorConfig11', label: 'List Background', default: '#1c1c1c', previewText: '#e0e0e0', section: 'list' },
  { key: 'colorConfig12', label: 'Alternate Row', default: '#222222', previewText: '#e0e0e0', section: 'list' },
  { key: 'colorConfig13', label: 'Hover Row', default: '#2a2d2e', previewText: '#ffffff', section: 'list' },
  { key: 'colorConfig14', label: 'Selected Row', default: '#264f78', previewText: '#ffffff', section: 'list' },
  { key: 'colorConfig15', label: 'Focused Item', default: '#007acc', previewText: '#ffffff', section: 'list' },

  { key: 'colorConfig22', label: 'Breadcrumb Text', default: '#cccccc', previewText: '#1a1a1a', section: 'breadcrumb' },
  { key: 'colorConfig23', label: 'Breadcrumb Background', default: '#1a1a1a', previewText: '#cccccc', section: 'breadcrumb' },
  { key: 'colorConfig3', label: 'Toolbar Text', default: '#e0e0e0', previewText: '#252526', section: 'breadcrumb' },
  { key: 'colorConfig4', label: 'Toolbar Background', default: '#252526', previewText: '#e0e0e0', section: 'breadcrumb' },

  { key: 'colorConfig16', label: 'Column Header Text', default: '#aaaaaa', previewText: '#1a1a1a', section: 'details' },
  { key: 'colorConfig17', label: 'Column Header Background', default: '#1a1a1a', previewText: '#aaaaaa', section: 'details' },
  { key: 'colorConfig18', label: 'Preview Panel Background', default: '#151515', previewText: '#e0e0e0', section: 'details' },
  { key: 'colorConfig19', label: 'Preview Panel Text', default: '#e0e0e0', previewText: '#151515', section: 'details' },

  { key: 'colorConfig5', label: 'Status Bar Text', default: '#aaaaaa', previewText: '#007acc', section: 'chrome' },
  { key: 'colorConfig20', label: 'Sidebar Accent', default: '#007acc', previewText: '#ffffff', section: 'chrome' },
  { key: 'colorConfig21', label: 'Pane Divider', default: '#333333', previewText: '#ffffff', section: 'chrome' },
  { key: 'colorConfig24', label: 'Search Match Highlight', default: '#fbbf24', previewText: '#000000', section: 'chrome' },

  { key: 'colorConfig25', label: 'Tag Badge Background', default: '#3b82f6', previewText: '#ffffff', section: 'tags' },
  { key: 'colorConfig26', label: 'Tag Badge Text', default: '#ffffff', previewText: '#3b82f6', section: 'tags' },
  { key: 'colorConfig27', label: 'Context Menu Background', default: '#1e1e1e', previewText: '#e0e0e0', section: 'tags' },
  { key: 'colorConfig28', label: 'Context Menu Text', default: '#e0e0e0', previewText: '#1e1e1e', section: 'tags' },
  { key: 'colorConfig29', label: 'Scrollbar Thumb', default: '#555555', previewText: '#ffffff', section: 'tags' },

  { key: 'colorConfig30', label: 'Focused Selection Text', default: '#FFFFFF', previewText: '#5096E2', section: 'selection' },
  { key: 'colorConfig31', label: 'Focused Selection Background', default: '#5096E2', previewText: '#FFFFFF', section: 'selection' },
  { key: 'colorConfig32', label: 'Unfocused Selection Text', default: '#000000', previewText: '#D0DBE6', section: 'selection' },
  { key: 'colorConfig33', label: 'Unfocused Selection Background', default: '#D0DBE6', previewText: '#000000', section: 'selection' },

  { key: 'colorConfig34', label: 'Tree Path Tracing', default: '#B6E956', previewText: '#000000', section: 'tracing' },
  { key: 'colorConfig35', label: 'Recent Location Pins', default: '#E956B6', previewText: '#ffffff', section: 'tracing' },
];

export function getColorConfigDefaults(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of COLOR_CONFIG_FIELDS) out[f.key] = f.default;
  return out;
}
