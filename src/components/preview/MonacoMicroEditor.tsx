import React, { useCallback, useEffect, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { toWindowsPath } from '../../lib/pathUtils';
import { prismLanguageForExt } from '../../lib/textFileTypes';

type Props = {
  path: string;
  fileName: string;
  extension: string;
  initialContent: string;
  readOnly?: boolean;
  onSaved?: () => void;
};

export default function MonacoMicroEditor({
  path, fileName, extension, initialContent, readOnly = false, onSaved,
}: Props) {
  const [content, setContent] = useState(initialContent);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const lang = prismLanguageForExt(extension);

  useEffect(() => {
    setContent(initialContent);
    setDirty(false);
    setStatus(null);
  }, [path, initialContent]);

  const save = useCallback(async () => {
    setSaving(true);
    setStatus(null);
    try {
      const { IPC } = await import('../../lib/ipcBridge');
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
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && !readOnly) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, save]);

  const onMount: OnMount = (editor) => {
    editor.focus();
  };

  return (
    <div className="bndz-micro-editor flex flex-col h-full min-h-[240px]">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-white/[0.06] bg-[#1a1d24] shrink-0">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-white truncate">{fileName}</div>
          <div className="text-[10px] text-[#7a8088]">Zero-Launch · {lang.toUpperCase()}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status && <span className="text-[10px] text-[#7eb8e8]">{status}</span>}
          {dirty && !readOnly && <span className="text-[10px] text-[#c4a35a]">Modified</span>}
          {!readOnly && (
            <button
              type="button"
              className="bndz-lens-chip"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={lang}
          theme="vs-dark"
          value={content}
          onChange={v => { setContent(v ?? ''); setDirty(true); }}
          onMount={onMount}
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: 'JetBrains Mono, IBM Plex Mono, Consolas, monospace',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            padding: { top: 8 },
          }}
        />
      </div>
    </div>
  );
}
