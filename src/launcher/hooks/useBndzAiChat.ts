/**
 * SuperCmd useAiChat.ts port — BNDZ Launcher / flowBridge backend.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiConversation, AiMessage } from '../types';
import {
  aiCancel,
  aiChat,
  aiIsAvailable,
  deleteAiChatConversation,
  getAiChatSnapshot,
  onAIStreamChunk,
  onAIStreamDone,
  onAIStreamError,
  upsertAiChatConversation,
} from '../bridge/flowBridge';

const MAX_CONVERSATIONS = 50;

function makeTitle(text: string): string {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  if (!t) return 'New Chat';
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface UseBndzAiChatOptions {
  onExitAiMode?: () => void;
}

export function useBndzAiChat({ onExitAiMode }: UseBndzAiChatOptions = {}) {
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const [hasBeenActivated, setHasBeenActivated] = useState(false);

  const aiRequestIdRef = useRef<string | null>(null);
  const aiStreamingRef = useRef(false);
  const streamingMessageIdRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const messagesRef = useRef<AiMessage[]>([]);
  const aiInputRef = useRef<HTMLInputElement>(null);
  const aiResponseRef = useRef<HTMLDivElement>(null);

  useEffect(() => { activeConversationIdRef.current = activeConversationId; }, [activeConversationId]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const persistConversation = useCallback((conversation: AiConversation) => {
    setConversations(prev => [conversation, ...prev.filter(c => c.id !== conversation.id)].slice(0, MAX_CONVERSATIONS));
    upsertAiChatConversation(conversation);
  }, []);

  const refreshSnapshot = useCallback(() => {
    void getAiChatSnapshot().then(snap => {
      if (snap?.conversations) setConversations(snap.conversations.slice(0, MAX_CONVERSATIONS));
    });
  }, []);

  useEffect(() => {
    void aiIsAvailable().then(setAiAvailable);
  }, []);

  useEffect(() => {
    if (!hasBeenActivated) return;
    refreshSnapshot();
  }, [hasBeenActivated, refreshSnapshot]);

  useEffect(() => {
    if (!hasBeenActivated) return;

    const finalizeConversation = () => {
      const conversationId = activeConversationIdRef.current;
      if (!conversationId) return;
      setMessages(current => {
        const existing = conversations.find(c => c.id === conversationId);
        const updated: AiConversation = {
          id: conversationId,
          title: existing?.title && existing.title !== 'New Chat'
            ? existing.title
            : makeTitle(current.find(m => m.role === 'user')?.content || 'New Chat'),
          messages: current,
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
          source: existing?.source || 'local',
        };
        persistConversation(updated);
        return current;
      });
    };

    const offChunk = onAIStreamChunk(({ requestId, chunk }) => {
      if (requestId !== aiRequestIdRef.current) return;
      const msgId = streamingMessageIdRef.current;
      if (!msgId) return;
      setMessages(prev => prev.map(m => (m.id === msgId ? { ...m, content: m.content + chunk } : m)));
    });

    const offDone = onAIStreamDone(({ requestId }) => {
      if (requestId !== aiRequestIdRef.current) return;
      aiStreamingRef.current = false;
      setAiStreaming(false);
      streamingMessageIdRef.current = null;
      finalizeConversation();
    });

    const offError = onAIStreamError(({ requestId, error }) => {
      if (requestId !== aiRequestIdRef.current) return;
      const msgId = streamingMessageIdRef.current;
      if (msgId) {
        setMessages(prev => prev.map(m =>
          m.id === msgId ? { ...m, content: m.content + (m.content ? '\n\n' : '') + `Error: ${error}` } : m,
        ));
      }
      aiStreamingRef.current = false;
      setAiStreaming(false);
      streamingMessageIdRef.current = null;
      finalizeConversation();
    });

    return () => { offChunk(); offDone(); offError(); };
  }, [hasBeenActivated, conversations, persistConversation]);

  useEffect(() => {
    if (aiResponseRef.current) aiResponseRef.current.scrollTop = aiResponseRef.current.scrollHeight;
  }, [messages]);

  const sendChatTurn = useCallback((allMessages: AiMessage[]) => {
    if (aiRequestIdRef.current && aiStreamingRef.current) aiCancel(aiRequestIdRef.current);
    const requestId = uid('ai');
    aiRequestIdRef.current = requestId;
    aiStreamingRef.current = true;
    setAiStreaming(true);
    aiChat(requestId, allMessages.map(m => ({ role: m.role, content: m.content })));
  }, []);

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    let conversationId = activeConversationIdRef.current;
    if (!conversationId) {
      conversationId = uid('conv');
      activeConversationIdRef.current = conversationId;
      setActiveConversationId(conversationId);
      persistConversation({
        id: conversationId,
        title: makeTitle(trimmed),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'local',
      });
    }

    const userMessage: AiMessage = { id: uid('msg'), role: 'user', content: trimmed, createdAt: Date.now() };
    const assistantMessage: AiMessage = { id: uid('msg'), role: 'assistant', content: '', createdAt: Date.now() };
    streamingMessageIdRef.current = assistantMessage.id;

    setMessages(prev => {
      const next = [...prev, userMessage, assistantMessage];
      sendChatTurn([...prev, userMessage]);
      return next;
    });
    setAiQuery('');
  }, [persistConversation, sendChatTurn]);

  const startAiChat = useCallback((searchQuery: string) => {
    setHasBeenActivated(true);
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setMessages([]);
    const trimmed = searchQuery.trim();
    if (trimmed) setTimeout(() => sendMessage(trimmed), 0);
    else setAiQuery('');
  }, [sendMessage]);

  const stopStreaming = useCallback(() => {
    if (aiRequestIdRef.current && aiStreamingRef.current) aiCancel(aiRequestIdRef.current);
    aiStreamingRef.current = false;
    setAiStreaming(false);
    const messageId = streamingMessageIdRef.current;
    if (messageId) setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, cancelled: true } : m)));
    streamingMessageIdRef.current = null;
    aiRequestIdRef.current = null;
  }, []);

  const newChat = useCallback(() => {
    if (aiRequestIdRef.current && aiStreamingRef.current) aiCancel(aiRequestIdRef.current);
    aiRequestIdRef.current = null;
    aiStreamingRef.current = false;
    streamingMessageIdRef.current = null;
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setMessages([]);
    setAiStreaming(false);
    setAiQuery('');
    setTimeout(() => aiInputRef.current?.focus(), 0);
  }, []);

  const selectConversation = useCallback((id: string) => {
    if (aiRequestIdRef.current && aiStreamingRef.current) aiCancel(aiRequestIdRef.current);
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    activeConversationIdRef.current = id;
    setActiveConversationId(id);
    setMessages(conv.messages);
    setAiStreaming(false);
    setAiQuery('');
  }, [conversations]);

  const deleteConversation = useCallback((id: string) => {
    deleteAiChatConversation(id);
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConversationIdRef.current === id) newChat();
  }, [newChat]);

  const exitAiMode = useCallback(() => {
    onExitAiMode?.();
  }, [onExitAiMode]);

  return {
    messages,
    aiStreaming,
    aiAvailable,
    aiQuery,
    setAiQuery,
    aiInputRef,
    aiResponseRef,
    conversations,
    activeConversationId,
    startAiChat,
    sendMessage,
    stopStreaming,
    newChat,
    selectConversation,
    deleteConversation,
    exitAiMode,
  };
}
