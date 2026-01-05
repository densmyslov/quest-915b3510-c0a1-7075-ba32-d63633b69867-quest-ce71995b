'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getQuestApiUrl } from '@/utils/apiConfig';
import type { TimelineChatOverlayState } from './types';

type TimelineChatOverlayPalette = {
  gold: string;
  goldLight: string;
  parchment: string;
};

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  text: string;
  imageUrls?: string[];
};

type TimelineChatOverlayProps = {
  overlay: TimelineChatOverlayState | null;
  onClose: () => void;
  palette: TimelineChatOverlayPalette;
};

const parseChatText = (text: string | null): string => {
  if (!text) return '';
  try {
    // Check if valid JSON object with "message" field
    if (text.trim().startsWith('{')) {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string') {
        return parsed.message;
      }
    }
  } catch {
    // ignore
  }
  return text;
};

function readChatResponseText(raw: unknown): string | null {
  try {
    const text = (raw as any)?.[0]?.output?.[0]?.content?.[0]?.text;
    return typeof text === 'string' && text.trim().length ? parseChatText(text) : null;
  } catch {
    return null;
  }
}

export default function TimelineChatOverlay({ overlay, onClose, palette }: TimelineChatOverlayProps) {
  const apiBaseUrl = useMemo(() => `${getQuestApiUrl()}/api/v1`, []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null);

  const appendedImageUrls = useMemo(() => {
    const urls = overlay?.imageUrls ?? [];
    return Array.isArray(urls) ? urls.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
  }, [overlay?.imageUrls]);

  useEffect(() => {
    if (!overlay) return;
    const initialMessages: ChatMessage[] = [];
    const firstMessageText = overlay.firstMessage?.trim() ?? '';
    if (firstMessageText.length > 0 || appendedImageUrls.length > 0) {
      initialMessages.push({ role: 'assistant', text: firstMessageText, imageUrls: appendedImageUrls });
    }
    setMessages(initialMessages);
    setDraft('');
    setSending(false);
    setError(null);
    setExpandedUrl(null);
  }, [appendedImageUrls, overlay]);

  useEffect(() => {
    if (!overlay) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [overlay, messages.length]);

  useEffect(() => {
    if (!expandedUrl) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedUrl(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expandedUrl]);

  const send = useCallback(async () => {
    if (!overlay) return;
    const message = draft.trim();
    if (!message || sending) return;

    setSending(true);
    setError(null);
    setDraft('');
    setMessages((prev) => [...prev, { role: 'user', text: message }]);

    try {
      const res = await fetch(`${apiBaseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          sessionId: overlay.sessionId ?? undefined,
          playerId: overlay.playerId ?? undefined
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status} ${res.statusText}`.trim());
      }
      const json = (await res.json()) as unknown;
      const reply = readChatResponseText(json);
      if (!reply) {
        throw new Error('Unexpected response shape from chat API');
      }
      setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMessages((prev) => [...prev, { role: 'system', text: `Error: ${msg}` }]);
    } finally {
      setSending(false);
    }
  }, [apiBaseUrl, draft, overlay, sending]);

  if (!overlay) return null;

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: '70px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 5200,
          width: 'min(720px, calc(100vw - 32px))',
          maxHeight: 'min(70vh, 560px)',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, rgba(26, 21, 16, 0.96) 0%, rgba(44, 36, 28, 0.96) 100%)',
          border: `2px solid ${palette.gold}`,
          boxShadow: '0 10px 36px rgba(0,0,0,0.55), inset 0 1px 0 rgba(201, 169, 97, 0.2)',
          color: palette.parchment,
          pointerEvents: 'auto',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '12px 14px' }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: "'Cinzel', serif",
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '1.2px',
                textTransform: 'uppercase',
                color: palette.goldLight,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {overlay.title}
            </div>
            <div style={{ fontSize: 11, opacity: 0.72, marginTop: 4 }}>Send a message to the portal</div>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }}
            onTouchStart={(event) => event.stopPropagation()}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: `1px solid ${palette.gold}`,
              color: palette.gold,
              width: 32,
              height: 32,
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: "'Cinzel', serif",
              fontSize: 16,
              lineHeight: '30px',
            }}
          >
            &times;
          </button>
        </div>

        <div
          style={{
            padding: '12px 14px',
            borderTop: '1px solid rgba(201, 169, 97, 0.25)',
            borderBottom: '1px solid rgba(201, 169, 97, 0.25)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            flex: 1,
          }}
        >
          {messages.length === 0 ? (
            <div style={{ opacity: 0.7, fontSize: 13, fontStyle: 'italic' }}>Write your first message…</div>
          ) : (
            messages.map((m, idx) => {
              const isUser = m.role === 'user';
              const isSystem = m.role === 'system';
              const align: 'flex-start' | 'flex-end' = isUser ? 'flex-end' : 'flex-start';
              const bg = isUser
                ? 'rgba(201, 169, 97, 0.16)'
                : isSystem
                  ? 'rgba(114, 47, 55, 0.18)'
                  : 'rgba(255,255,255,0.06)';
              const border = isUser
                ? '1px solid rgba(201, 169, 97, 0.35)'
                : isSystem
                  ? '1px solid rgba(114, 47, 55, 0.35)'
                  : '1px solid rgba(255,255,255,0.10)';
              const text = parseChatText(m.text);
              const messageImageUrls = Array.isArray(m.imageUrls)
                ? m.imageUrls.filter((v): v is string => typeof v === 'string' && v.length > 0)
                : [];
              return (
                <div key={idx} style={{ display: 'flex', justifyContent: align }}>
                  <div
                    style={{
                      maxWidth: '92%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: bg,
                      border,
                      fontFamily: "'Crimson Text', Georgia, serif",
                      fontSize: 14,
                      lineHeight: 1.4,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {text && <div>{text}</div>}

                    {messageImageUrls.length > 0 && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: text ? 10 : 0 }}>
                        {messageImageUrls.map((url) => (
                          <button
                            key={url}
                            type="button"
                            onClick={() => setExpandedUrl(url)}
                            style={{
                              padding: 0,
                              border: '1px solid rgba(255,255,255,0.14)',
                              borderRadius: 8,
                              overflow: 'hidden',
                              background: 'rgba(0,0,0,0.2)',
                              cursor: 'pointer',
                              width: 120,
                              height: 90,
                            }}
                            aria-label="Expand image"
                            title="Click to expand"
                          >
                            <img
                              src={url}
                              alt=""
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <div style={{ padding: '12px 14px' }}>
        {error && (
          <div style={{ marginBottom: 8, fontSize: 12, color: 'rgba(255, 180, 180, 0.95)' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={sending ? 'Waiting for reply…' : 'Type a message…'}
            disabled={sending}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid rgba(201, 169, 97, 0.35)`,
              background: 'rgba(0,0,0,0.25)',
              color: palette.parchment,
              fontFamily: "'Crimson Text', Georgia, serif",
              fontSize: 14,
              outline: 'none',
            }}
          />
          <button
            type="button"
            disabled={sending || !draft.trim().length}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void send();
            }}
            onTouchStart={(event) => event.stopPropagation()}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              border: `1px solid ${palette.gold}`,
              background: sending ? 'rgba(201, 169, 97, 0.15)' : 'rgba(201, 169, 97, 0.24)',
              color: palette.gold,
              cursor: sending ? 'not-allowed' : 'pointer',
              fontFamily: "'Cinzel', serif",
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              opacity: sending || !draft.trim().length ? 0.6 : 1,
            }}
          >
            Send
          </button>
        </div>
        </div>
      </div>

      {expandedUrl && (
        <div
          onClick={() => setExpandedUrl(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 5400,
            background: 'rgba(0,0,0,0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: 'min(980px, calc(100vw - 32px))',
              maxHeight: 'min(90vh, 720px)',
              borderRadius: 10,
              overflow: 'hidden',
              border: `2px solid ${palette.gold}`,
              background: 'rgba(0,0,0,0.6)',
              boxShadow: '0 14px 40px rgba(0,0,0,0.55)',
            }}
          >
            <img
              src={expandedUrl}
              alt=""
              style={{ display: 'block', maxWidth: '100%', maxHeight: '90vh', objectFit: 'contain' }}
            />
            <button
              type="button"
              onClick={() => setExpandedUrl(null)}
              aria-label="Close image"
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'rgba(0,0,0,0.55)',
                border: `1px solid ${palette.gold}`,
                color: palette.gold,
                cursor: 'pointer',
                fontFamily: "'Cinzel', serif",
                fontSize: 18,
                lineHeight: '32px',
              }}
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </>
  );
}
