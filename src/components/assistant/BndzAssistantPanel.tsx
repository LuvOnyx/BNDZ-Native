import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Download, Sparkles } from 'lucide-react';
import { IPC } from '../../lib/ipcBridge';
import PortalComposer from '../../spacedrive/port/PortalComposer';

type Message = { role: 'user' | 'assistant'; text: string };

type Props = {
  selectedPaths: string[];
  currentPath?: string;
  initialPrompt?: string;
};

function buildContextPrompt(paths: string[], currentPath?: string, userText?: string): string {
  const lines = [
    'You are BNDZ, a helpful Windows file manager assistant. Be concise and practical.',
    currentPath ? `Current folder: ${currentPath}` : '',
    paths.length ? `Selected (${paths.length}): ${paths.slice(0, 8).join('; ')}${paths.length > 8 ? '…' : ''}` : '',
    userText ? `User: ${userText}` : '',
  ].filter(Boolean);
  return lines.join('\n');
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

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setMessages(prev => [...prev, { role: 'user', text: trimmed }]);
    setInput('');
    setBusy(true);
    try {
      const prompt = buildContextPrompt(contextPaths, currentPath, trimmed);
      const reply = await IPC.aiGenerate(prompt);
      setMessages(prev => [...prev, { role: 'assistant', text: reply || 'No response — try downloading the local model below.' }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', text: err?.message || 'Assistant request failed.' }]);
    } finally {
      setBusy(false);
      refreshStatus();
    }
  }, [busy, contextPaths, currentPath, refreshStatus]);

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
            {modelStatus.downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {modelStatus.downloading ? `Downloading ${modelStatus.progress ?? 0}%` : 'Download model'}
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-[180px] max-h-[340px] overflow-y-auto bndz-scrollbar border border-[#454545] bg-[#252525] p-2 space-y-2">
        {messages.length === 0 && !busy && (
          <p className="text-[11px] text-gray-500 px-1">Ask about your selection, folder organization, or file names.</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-[12px] px-2 py-1.5 max-w-[95%] whitespace-pre-wrap ${
              m.role === 'user' ? 'ml-auto bg-[#094771] text-white' : 'bg-[#3a3a3a] text-gray-200'
            }`}
          >
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-[11px] text-gray-400 px-1">
            <Loader2 size={12} className="animate-spin" />
            Thinking…
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
          <Sparkles size={10} className="text-sky-400 shrink-0" />
          {contextPaths.length} path(s) in context
        </p>
      )}
    </div>
  );
}
