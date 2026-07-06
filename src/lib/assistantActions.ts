export type AssistantAction = {
  id: string;
  label: string;
  verb: 'reveal' | 'open' | 'batch-rename' | 'index' | 'find';
  query?: string;
  path?: string;
};

/** Heuristic action chips from assistant reply + selection context. */
export function extractAssistantActions(text: string, contextPaths: string[]): AssistantAction[] {
  const actions: AssistantAction[] = [];
  const lower = text.toLowerCase();
  const primary = contextPaths[0];

  if (primary && /\b(reveal|show in folder|locate|explorer)\b/.test(lower)) {
    actions.push({ id: 'reveal', label: 'Reveal in folder', verb: 'reveal', path: primary });
  }
  if (/\b(batch rename|rename (all|these|files))\b/.test(lower)) {
    actions.push({ id: 'batch-rename', label: 'Batch rename', verb: 'batch-rename' });
  }
  if (primary && /\b(open file|open (it|this|the))\b/.test(lower)) {
    actions.push({ id: 'open', label: 'Open', verb: 'open', path: primary });
  }
  if (/\b(index|search index|build index|re-?index)\b/.test(lower)) {
    actions.push({ id: 'index', label: 'Build search index', verb: 'index' });
  }
  const findMatch = text.match(/(?:find|search for|look for)\s+["“']([^"”']+)["”']/i);
  if (findMatch || /\b(finding tab|search results)\b/.test(lower)) {
    actions.push({
      id: 'find',
      label: findMatch ? `Find “${findMatch[1]}”` : 'New finding tab',
      verb: 'find',
      query: findMatch?.[1],
    });
  }

  const seen = new Set<string>();
  return actions.filter(a => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  }).slice(0, 4);
}
