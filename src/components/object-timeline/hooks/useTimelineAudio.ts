'use client';

import { useCallback } from 'react';

import type { NormalizedMediaTimelineItem } from '@/lib/mediaTimeline';
import type { Transcription } from '@/types/transcription';

import { getTimelineAudioTranscription, getTimelineAudioUrl } from '../utils';

export type TimelineTextDisplayConfig = { mode: 'seconds' | 'until_close'; seconds: number };

export type QuestAudioAdapter = {
  playBackgroundAudio: (params: {
    url: string;
    loop?: boolean;
    volume?: number;
    continueIfAlreadyPlaying?: boolean;
  }) => void | Promise<void>;
  stopBackgroundAudio: () => void;
  backgroundUrl: string | null;
};

type TimelineAudioPayload = {
  url: string;
  objectName: string;
  objectId: string;
  transcription: Transcription | null;
  loop?: boolean;
  volume?: number;
  panelAutoCloseAfterEndedMs?: number | null;
};

type TimelineEffectAudioPayload = {
  url: string;
  objectName: string;
  objectId: string;
  loop?: boolean;
  volume?: number;
};

export function useTimelineAudio(params: {
  debugEnabled: boolean;
  addLog: (level: 'info' | 'warn' | 'error', message: string, data?: unknown) => void;
  questAudio: QuestAudioAdapter;
  playAudio: (payload: TimelineAudioPayload) => void;
  playAudioBlocking: (payload: TimelineAudioPayload) => Promise<void>;
  playEffectAudio: (payload: TimelineEffectAudioPayload) => void;
  playEffectAudioBlocking: (payload: TimelineEffectAudioPayload) => Promise<void>;
  stopAudio: () => void;
  stopEffectAudio: () => void;
}) {
  const {
    debugEnabled,
    addLog,
    questAudio,
    playAudio,
    playAudioBlocking,
    playEffectAudio,
    playEffectAudioBlocking,
    stopAudio,
    stopEffectAudio,
  } = params;

  const stopTimelineAudioItem = useCallback(
    (item: NormalizedMediaTimelineItem) => {
      if (item.type !== 'audio' && item.type !== 'streaming_text_audio') return;

      const role = (item as any).role as string | undefined;
      if (role === 'background') {
        const url = getTimelineAudioUrl(item);
        if (url && questAudio.backgroundUrl === url) {
          questAudio.stopBackgroundAudio();
        }
        return;
      }

      if (item.type === 'audio') stopEffectAudio();
      else stopAudio();
    },
    [questAudio, stopAudio, stopEffectAudio]
  );

  const playTimelineAudioItem = useCallback(
    async (args: {
      item: NormalizedMediaTimelineItem;
      idx: number;
      timelineItems: NormalizedMediaTimelineItem[];
      objectId: string;
      objectName: string;
      getTextDisplayConfig: (item: any) => TimelineTextDisplayConfig;
    }) => {
      const { item, idx, timelineItems, objectId, objectName, getTextDisplayConfig } = args;
      if (item.type !== 'audio' && item.type !== 'streaming_text_audio') return;

      const url = getTimelineAudioUrl(item);
      console.log('[useObjectTimeline] Audio item processing', {
        idx,
        key: item.key,
        type: item.type,
        url,
        role: (item as any).role,
        blocking: (item as any).blocking,
        media_url: (item as any).media_url,
        mediaUrl: (item as any).mediaUrl,
        rawUrl: (item as any).url,
        itemKeys: Object.keys(item as any),
      });

      if (!url) {
        console.warn('[useObjectTimeline] Audio item has no URL, skipping and completing node', { idx, key: item.key, item });
        return;
      }

      const role = (item as any).role as string | undefined;
      if (role === 'background') {
        console.log('[useObjectTimeline] Playing background audio', { url });
        void questAudio.playBackgroundAudio({
          url,
          loop: (item as any).loop,
          volume: (item as any).volume,
          continueIfAlreadyPlaying: true,
        });
        return;
      }

      if (item.type === 'audio') {
        // Default to blocking unless explicitly set to false
        // This ensures server-side blocking nodes are respected
        const shouldBlockEffect = (item as any).blocking !== false;
        if (shouldBlockEffect) {
          // Respect blocking flag for effect audio - wait for playback to complete
          console.log('[useObjectTimeline] Playing blocking effect audio', { url, key: item.key });
          try {
            await Promise.race([
              playEffectAudioBlocking({
                url,
                objectName,
                objectId,
                loop: false,
                volume: (item as any).volume,
              }),
              new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error('effect audio playback timeout')), 5 * 60 * 1000)
              ),
            ]);
            console.log('[useObjectTimeline] Blocking effect audio completed', { key: item.key });
          } catch (err: any) {
            console.warn('[useObjectTimeline] Blocking effect audio failed or timed out', { key: item.key, err });
          }
          return;
        }

        // Non-blocking effect audio - fire and forget
        playEffectAudio({
          url,
          objectName,
          objectId,
          loop: (item as any).loop,
          volume: (item as any).volume,
        });
        return;
      }

      const shouldBlock = (item as any).blocking === true;
      if (shouldBlock) {
        const { mode, seconds } = getTextDisplayConfig(item);
        const transcription = getTimelineAudioTranscription(item);
        if (debugEnabled) {
          const wordCount = transcription?.words?.length ?? 0;
          addLog('info', '[useObjectTimeline] streaming_text_audio payload', {
            objectId,
            key: item.key,
            url,
            mode,
            hasTranscription: !!transcription,
            wordCount,
          });
        }

        console.log('[useObjectTimeline] Playing blocking streaming_text_audio', { url });
        try {
          await Promise.race([
            playAudioBlocking({
              url,
              objectName,
              objectId,
              transcription: transcription ?? null,
              loop: false,
              volume: (item as any).volume,
              panelAutoCloseAfterEndedMs: mode === 'seconds' ? seconds * 1000 : null,
            }),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('streaming_text_audio playback timeout')), 5 * 60 * 1000)
            ),
          ]);
          console.log('[useObjectTimeline] Blocking streaming_text_audio completed', { key: item.key });
        } catch (err: any) {
          console.warn('[useObjectTimeline] Blocking streaming_text_audio failed or timed out, completing anyway', { key: item.key, err });
        }
        return;
      }

      playAudio({
        url,
        objectName,
        objectId,
        transcription: getTimelineAudioTranscription(item),
        loop: (item as any).loop,
        volume: (item as any).volume,
        panelAutoCloseAfterEndedMs: (() => {
          const { mode, seconds } = getTextDisplayConfig(item);
          if (mode !== 'seconds') return null;
          return Math.max(0, Math.round(seconds * 1000));
        })(),
      });
    },
    [
      addLog,
      debugEnabled,
      playAudio,
      playAudioBlocking,
      playEffectAudio,
      playEffectAudioBlocking,
      questAudio,
    ]
  );

  return { playTimelineAudioItem, stopTimelineAudioItem };
}
