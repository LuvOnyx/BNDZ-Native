import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from './Icons8Icon';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { toWindowsPath } from '../lib/pathUtils';
import { isCodeExt, prismLanguageForExt } from '../lib/textFileTypes';

interface TextPreviewEditorProps {
  path: string;
  fileName: string;
  extension: string;
  initialContent: string;
  displayTabsAsSpaces?: boolean;
  readOnly?: boolean;
  onSaved?: () => void;
}

export default function TextPreviewEditor({
  path,
  fileName,
  extension,
  initialContent,
  displayTabsAsSpaces = false,
  readOnly = false,
  onSaved,
}: TextPreviewEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'edit' | 'view'>(readOnly ? 'view' : 'edit');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setContent(initialContent);
    setDirty(false);
    setStatus(null);
  }, [path, initialContent]);

  const displayContent = displayTabsAsSpaces
    ? content.replace(/\t/g, '    ')
    : content;

  const save = useCallback(async () => {
    setSaving(true);
    setStatus(null);
    try {
      const { IPC } = await import('../lib/ipcBridge');
      const ok = await IPC.writeTextFile(toWindowsPath(path), content);
      if (ok) {
        setDirty(false);
        setStatus('Saved');
        onSaved?.();
      } else {
        setStatus('Save failed');
      }
    } catch {
      setStatus('Save failed');
    } finally {
      setSaving(false);
    }
  }, [path, content, onSaved]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && mode === 'edit' && !readOnly) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, readOnly, save]);

  const openExternal = () => {
    import('../lib/ipcBridge').then(({ IPC }) =>
      IPC.executeContextMenuVerb(toWindowsPath(path), 'open')
    );
  };

  const ext = extension.toLowerCase().replace(/^\./, '');
  const isCode = isCodeExt(ext);

  return (
    <div className="w-full h-full flex flex-col bg-[#1e1e1e] min-h-0">
      <div className="shrink-0 flex items-center justify-between gap-2 px-2 py-1.5 border-b border-[#333] bg-[#252526]">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icons8Icon id="file_ui" size={13} className="shrink-0" />
          <span className="text-[10px] text-gray-400 truncate font-mono">{fileName}</span>
          {dirty && <span className="text-[9px] text-amber-500 font-bold">●</span>}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {!readOnly && (
            <>
              <button
                type="button"
                title={mode === 'edit' ? 'Preview' : 'Edit'}
                onClick={() => setMode(m => (m === 'edit' ? 'view' : 'edit'))}
                className="p-1.5 hover:bg-[#333] rounded text-gray-400 hover:text-white"
              >
                {mode === 'edit' ? <Icons8Icon id="eye_ui" size={13} /> : <Icons8Icon id="pencil_ui" size={13} />}
              </button>
              <button
                type="button"
                title="Revert"
                disabled={!dirty}
                onClick={() => { setContent(initialContent); setDirty(false); }}
                className="p-1.5 hover:bg-[#333] rounded text-gray-400 hover:text-white disabled:opacity-30"
              >
                <Icons8Icon id="reset_ui" size={13} />
              </button>
              <button
                type="button"
                title="Save (Ctrl+S)"
                disabled={!dirty || saving}
                onClick={() => void save()}
                className="p-1.5 hover:bg-[#333] rounded text-sky-400 hover:text-sky-300 disabled:opacity-30"
              >
                <Icons8Icon id="check" size={13} />
              </button>
            </>
          )}
          <button
            type="button"
            title="Open in default app"
            onClick={openExternal}
            className="p-1.5 hover:bg-[#333] rounded text-gray-400 hover:text-white"
          >
            <Icons8Icon id="external_link" size={13} />
          </button>
        </div>
      </div>

      {status && (
        <div className="shrink-0 px-2 py-0.5 text-[10px] text-emerald-400 bg-emerald-950/30 border-b border-emerald-900/30">
          {status}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === 'edit' && !readOnly ? (
          <textarea
            value={content}
            onChange={e => { setContent(e.target.value); setDirty(true); setStatus(null); }}
            spellCheck={false}
            className="w-full h-full resize-none bg-[#1e1e1e] text-[#d4d4d4] font-mono text-[12px] leading-relaxed p-3 outline-none border-none bndz-scrollbar"
            style={{ tabSize: 4 }}
          />
        ) : (
          <div className="w-full h-full overflow-auto bndz-scrollbar">
            <SyntaxHighlighter
              language={isCode ? prismLanguageForExt(ext) : 'text'}
              style={vscDarkPlus}
              showLineNumbers
              wrapLongLines
              customStyle={{
                margin: 0,
                padding: '0.75rem',
                background: 'transparent',
                minHeight: '100%',
                fontSize: '12px',
              }}
            >
              {displayContent}
            </SyntaxHighlighter>
          </div>
        )}
      </div>
    </div>
  );
}
