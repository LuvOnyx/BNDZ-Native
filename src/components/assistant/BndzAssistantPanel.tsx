import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';
import { isTextEditableExt } from '../../lib/textFileTypes';
import { extractAssistantActions, type AssistantAction } from '../../lib/assistantActions';
import PortalComposer from '../../spacedrive/port/PortalComposer';

type Message = { role: 'user' | 'assistant'; text: string; streaming?: boolean };

type Props = {
  selectedPaths: string[];
  currentPath?: string;
  initialPrompt?: string;
};

const TEXT_SNIPPET_EXTS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'log', 'ini', 'cfg', 'yaml', 'yml']);

async function buildEnrichedContext(paths: string[], currentPath?: string, userText?: string): Promise<string> {
  const lines = [
    'You are BNDZ, a helpful Windows file manager assistant. Be concise and practical.',
    'Suggest concrete file-manager actions when relevant (rename, organize, reveal, tag).',
    currentPath ? `Current folder: ${currentPath}` : '',
  ];

  if (paths.length) {
    lines.push(`Selected files (${paths.length}):`);
    for (const p of paths.slice(0, 6)) {
      const win = toWindowsPath(p);
      const name = win.split(/[/\\]/).pop() || win;
      let detail = `  • ${name} — ${win}`;
      try {
        const meta = await IPC.getIndexedEntry(p);
        if (meta?.size) detail += ` · ${meta.size} bytes`;
        if (meta?.mediaKind) detail += ` · ${meta.mediaKind}`;
        if (meta?.modified) detail += ` · modified ${new Date(Number(meta.modified) * 1000).toLocaleString()}`;
      } catch { /* ignore */ }
      const ext = name.split('.').pop()?.toLowerCase() || '';
      if (TEXT_SNIPPET_EXTS.has(ext) || isTextEditableExt(ext)) {
        try {
          const res = await IPC.readTextFile(win);
          if (res.content && !res.error) {
            const snippet = res.content.slice(0, 1500).replace(/\r\n/g, '\n');
            detail += `\n    --- content ---\n${snippet}${res.content.length > 1500 ? '\n    …' : ''}`;
          }
        } catch { /* ignore */ }
      }
      lines.push(detail);
    }
    if (paths.length > 6) lines.push(`  … and ${paths.length - 6} more`);
  }

  if (userText) lines.push(`\nUser question: ${userText}`);
  return lines.filter(Boolean).join('\n');
}

export default function BndzAssistantPanel({ selectedPaths, currentPath, initialPrompt }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(initialPrompt || '');
  const [busy, setBusy] = useState(false);
  const [extraPaths, setExtraPaths] = useState<string[]>([]);
  const contextPaths = useMemo(
    () => [...new Set([...selectedPaths, ...extraPaths].filter(Boolean))],
    [selectedPaths, extraPaths],
  );
  const [modelStatus, setModelStatus] = useState<{
    present?: boolean; loaded?: boolean; downloading?: boolean; progress?: number; modelName?: string; sizeLabel?: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);
  const streamGenRef = useRef(0);

  const refreshStatus = useCallback(() => {
    if (!IPC.isNative) return;
    IPC.getAiModelStatus().then(setModelStatus).catch(() => setModelStatus(null));
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    if (initialPrompt) setInput(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const runAction = (verb: string, path?: string) => {
    const target = path || contextPaths[0];
    if (!target) return;
    void IPC.executeContextMenuVerb(toWindowsPath(target), verb);
  };

  const openBatchRename = () => {
    window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'batch-rename' } }));
  };

  const runAssistantAction = (action: AssistantAction) => {
    if (action.verb === 'batch-rename') openBatchRename();
    else if (action.verb === 'index') void IPC.reindexBndzDefaults();
    else if (action.verb === 'find') {
      window.dispatchEvent(new CustomEvent('bndz-new-finding-tab', { detail: { query: action.query || '' } }));
    } else if (action.path) runAction(action.verb, action.path);
  };

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const gen = ++streamGenRef.current;
    setMessages(prev => [...prev, { role: 'user', text: trimmed }, { role: 'assistant', text: '', streaming: true }]);
    setInput('');
    setBusy(true);
    try {
      const prompt = await buildEnrichedContext(contextPaths, currentPath, trimmed);
      if (streamGenRef.current !== gen) return;

      const appendChunk = (chunk: string) => {
        if (streamGenRef.current !== gen) return;
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          next[next.length - 1] = { ...last, text: last.text + chunk, streaming: true };
          return next;
        });
      };

      let reply = '';
      if (IPC.isNative) {
        reply = await IPC.aiGenerateStream(prompt, appendChunk);
      } else {
        reply = await IPC.aiGenerate(prompt);
        appendChunk(reply);
      }

      if (streamGenRef.current !== gen) return;
      const finalText = reply || 'No response — try downloading the local model below.';
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        next[next.length - 1] = { role: 'assistant', text: finalText, streaming: false };
        return next;
      });
    } catch (err: any) {
      if (streamGenRef.current !== gen) return;
      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && last.streaming) next.pop();
        return [...next, { role: 'assistant', text: err?.message || 'Assistant request failed.' }];
      });
    } finally {
      if (streamGenRef.current === gen) setBusy(false);
      refreshStatus();
    }
  }, [busy, contextPaths, currentPath, refreshStatus]);

  useEffect(() => () => { streamGenRef.current++; }, []);

  useEffect(() => {
    if (initialPrompt?.trim() && !sentInitial.current) {
      sentInitial.current = true;
      void send(initialPrompt);
    }
  }, [initialPrompt, send]);

  useEffect(() => {
    if (!IPC.isNative) return;
    return IPC.onAiDownloadProgress(p => {
      setModelStatus(prev => ({ ...prev, downloading: true, progress: p.percent }));
    });
  }, []);

  const downloadModel = async () => {
    setBusy(true);
    try {
      await IPC.downloadAiModel();
      refreshStatus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 min-h-[280px]">
      {!IPC.isNative && (
        <p className="text-[11px] text-amber-400/90">Assistant requires the native BNDZ host.</p>
      )}

      {IPC.isNative && modelStatus && !modelStatus.present && !modelStatus.loaded && (
        <div className="border border-[#454545] bg-[#333] p-3 flex flex-col gap-2">
          <p className="text-[11px] text-gray-300">
            Download {modelStatus.modelName || 'local model'} ({modelStatus.sizeLabel || '~1 GB'}) for full answers.
          </p>
          <button
            type="button"
            disabled={busy || modelStatus.downloading}
            onClick={() => void downloadModel()}
            className="flex items-center justify-center gap-2 px-3 py-1.5 text-[12px] bg-[#094771] hover:bg-[#0a5a8c] text-white disabled:opacity-50"
          >
            {modelStatus.downloading ? <Icons8Icon id="loading" size={14} spin /> : <Icons8Icon id="download" size={14} />}
            {modelStatus.downloading ? `Downloading ${modelStatus.progress ?? 0}%` : 'Download model'}
          </button>
        </div>
      )}

      {contextPaths.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => runAction('reveal')} className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#333] border border-[#454545] text-gray-300 hover:text-white">
            <Icons8Icon id="external_link" size={10} /> Reveal
          </button>
          <button type="button" onClick={openBatchRename} className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#333] border border-[#454545] text-gray-300 hover:text-white">
            <Icons8Icon id="pencil_ui" size={10} /> Batch rename
          </button>
          <button type="button" onClick={() => runAction('open')} className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#333] border border-[#454545] text-gray-300 hover:text-white">
            Open
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-[180px] max-h-[340px] overflow-y-auto bndz-scrollbar border border-[#454545] bg-[#252525] p-2 space-y-2">
        {messages.length === 0 && !busy && (
          <p className="text-[11px] text-gray-500 px-1">Ask about your selection — file contents and metadata are included when available.</p>
        )}
        {messages.map((m, i) => {
          const actions = m.role === 'assistant' && !m.streaming && m.text
            ? extractAssistantActions(m.text, contextPaths)
            : [];
          return (
          <div key={i} className="space-y-1">
            <div
              className={`text-[12px] px-2 py-1.5 max-w-[95%] whitespace-pre-wrap ${
                m.role === 'user' ? 'ml-auto bg-[#094771] text-white' : 'bg-[#3a3a3a] text-gray-200'
              }`}
            >
              {m.text}
              {m.streaming && <span className="inline-block w-1.5 h-3 ml-0.5 bg-sky-400/80 animate-pulse align-middle" />}
            </div>
            {actions.length > 0 && (
              <div className="flex flex-wrap gap-1 pl-1">
                {actions.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => runAssistantAction(a)}
                    className="px-2 py-0.5 text-[10px] bg-[#094771]/60 hover:bg-[#094771] border border-[#0a5a8c]/50 text-sky-100"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          );
        })}
        {busy && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex items-center gap-2 text-[11px] text-gray-400 px-1">
            <Icons8Icon id="loading" size={12} spin />
            Reading context…
          </div>
        )}
      </div>

      <PortalComposer
        draft={input}
        onDraftChange={setInput}
        onSend={() => void send(input)}
        disabled={busy}
        pendingPaths={contextPaths.slice(0, 12)}
        onRemovePath={i => {
          const removed = contextPaths[i];
          if (!removed) return;
          if (extraPaths.includes(removed)) {
            setExtraPaths(prev => prev.filter(p => p !== removed));
          }
        }}
        onAttachPaths={paths => setExtraPaths(prev => [...new Set([...prev, ...paths])])}
        placeholder="Ask about selected files…"
      />

      {contextPaths.length > 0 && (
        <p className="text-[10px] text-gray-500 font-mono truncate flex items-center gap-1">
          <Icons8Icon id="sparkles_ui" size={10} className="text-sky-400 shrink-0" />
          {contextPaths.length} path(s) in context with metadata
        </p>
      )}
    </div>
  );
}
