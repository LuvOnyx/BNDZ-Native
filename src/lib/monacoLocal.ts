/**
 * Configure Monaco to load from bundled assets — never CDN (jsdelivr).
 * Workers/AMD loader are served from ./monaco/vs next to the built UI.
 */
import { loader } from '@monaco-editor/react';

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorkerUrl: (_moduleId: string, label: string) => string;
    };
  }
}

let configured = false;

function monacoVsBase(): string {
  // Built UI lives at …/Assets/ui/index.html — workers are copied beside it.
  try {
    const base = new URL('.', window.location.href);
    return new URL('monaco/vs', base).href.replace(/\/$/, '');
  } catch {
    return './monaco/vs';
  }
}

export function ensureMonacoLocal(): void {
  if (configured || typeof window === 'undefined') return;
  configured = true;

  const vs = monacoVsBase();

  window.MonacoEnvironment = {
    getWorkerUrl(_moduleId: string, label: string) {
      if (label === 'json') return `${vs}/language/json/json.worker.js`;
      if (label === 'css' || label === 'scss' || label === 'less') return `${vs}/language/css/css.worker.js`;
      if (label === 'html' || label === 'handlebars' || label === 'razor') return `${vs}/language/html/html.worker.js`;
      if (label === 'typescript' || label === 'javascript') return `${vs}/language/typescript/ts.worker.js`;
      return `${vs}/editor/editor.worker.js`;
    },
  };

  loader.config({ paths: { vs } });
}
