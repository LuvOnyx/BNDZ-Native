import type { AppConfig } from '../data/configContext';

/**
 * Settings → Colors / List chrome — applied from list UI consumers (not settingsRuntime-only).
 * Keeps grid lines, sort-arrow spacing, adaptive colors, and path-trace matching live.
 */
export function applyListChromeFromConfig(config: AppConfig): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const lineSpacing = parseInt(String(config.listGridLineWidth || '2'), 10) || 2;
  const arrowSpacing = parseInt(String(config.listSortArrowSize || '6'), 10) || 6;
  root.style.setProperty('--bndz-list-line-spacing', `${lineSpacing}px`);
  root.style.setProperty('--bndz-list-overall-spacing', `${arrowSpacing}px`);
  root.style.setProperty('--bndz-list-sort-arrow-size', `${arrowSpacing}px`);

  const extraPad = parseInt(String(config.columnAutosizeExtraPadding || '0'), 10);
  root.style.setProperty(
    '--bndz-column-autosize-extra-padding',
    `${Number.isFinite(extraPad) ? Math.max(0, extraPad) : 0}px`,
  );

  root.dataset.semiTransparentGrid = config.semiTransparentGridColor ? 'true' : 'false';
  root.dataset.mirrorTreeBoxInList = config.mirrorTreeBoxColorInList ? 'true' : 'false';
  root.dataset.matchTraceBreadcrumb = config.matchColorWithBreadcrumbBar ? 'true' : 'false';
  root.dataset.matchPinTrace = config.matchColorWithTreePathTracing ? 'true' : 'false';
  root.dataset.applyTextNameOnly = config.applyTextColorsToTheNameColumnOnly ? 'true' : 'false';
  root.dataset.alignThumbsBottom = config.alignToBottom ? 'true' : 'false';
  root.dataset.lineFeedOversized = config.lineFeedOnOversizedFilenames ? 'true' : 'false';
  root.dataset.tagsStorage = String(config.tagsStorage || 'Absolute paths');

  root.classList.toggle('bndz-adaptive-colors', !!config.adaptiveColors);
  root.classList.toggle('bndz-list-styles-global', !!config.applyListStylesGlobally);
  root.classList.toggle('bndz-semi-transparent-grid', !!config.semiTransparentGridColor);
  root.classList.toggle('bndz-mirror-tree-box-list', !!config.mirrorTreeBoxColorInList);
  root.classList.toggle('bndz-match-breadcrumb-color', !!config.matchColorWithBreadcrumbBar);
  root.classList.toggle('bndz-match-tree-trace', !!config.matchColorWithTreePathTracing);
  root.classList.toggle('bndz-align-thumbs-bottom', !!config.alignToBottom);
  root.classList.toggle('bndz-line-feed-oversized', !!config.lineFeedOnOversizedFilenames);
  root.classList.toggle('bndz-file-tagging', config.fileTagging !== false && config.fileTaggingFeature !== false);

  if (config.matchColorWithBreadcrumbBar) {
    const trace = (config as any).colorConfig23;
    if (typeof trace === 'string' && trace.startsWith('#')) {
      root.style.setProperty('--tree-trace', trace);
      root.style.setProperty('--breadcrumb-accent', trace);
    }
  }
  if (config.matchColorWithTreePathTracing) {
    const pin = (config as any).colorConfig34;
    if (typeof pin === 'string' && pin.startsWith('#')) {
      root.style.setProperty('--location-pin', pin);
    }
  }
  if (config.mirrorTreeBoxColorInList) {
    const box = (config as any).colorConfig12 || (config as any).treeBoxColor;
    if (typeof box === 'string' && box.startsWith('#')) {
      root.style.setProperty('--list-focus-ring', box);
    }
  }
}
