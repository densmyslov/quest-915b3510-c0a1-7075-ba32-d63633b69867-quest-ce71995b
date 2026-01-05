import { normalizeTranscription } from '@/lib/transcriptionUtils';
import type { Transcription } from '@/types/transcription';

export const getTimelineAudioUrl = (item: any): string | null => {
  const mediaUrl = item?.media_url ?? item?.mediaUrl ?? item?.url ?? null;
  return typeof mediaUrl === 'string' && mediaUrl.length ? mediaUrl : null;
};

export const getTimelineVideoUrl = (item: any): string | null => {
  const mediaUrl = item?.media_url ?? item?.mediaUrl ?? item?.url ?? null;
  if (typeof mediaUrl !== 'string' || !mediaUrl.length) return null;

  // Cloudflare Stream "watch" URLs are HTML pages, not playable <video> sources.
  // Convert to a direct MP4 download endpoint which the browser can play.
  // Example:
  //   https://customer-<id>.cloudflarestream.com/<uid>/watch
  // ->https://customer-<id>.cloudflarestream.com/<uid>/downloads/default.mp4
  try {
    const url = new URL(mediaUrl);
    if (url.hostname.endsWith('cloudflarestream.com')) {
      if (url.pathname.endsWith('/watch')) {
        url.pathname = url.pathname.replace(/\/watch$/, '/downloads/default.mp4');
        url.search = '';
        url.hash = '';
        return url.toString();
      }
    }
  } catch {
    // ignore parsing errors; fall back to raw string
  }

  return mediaUrl;
};

export const getTimelineAudioTranscription = (item: any): Transcription | null => {
  if (!item || typeof item !== 'object') return null;

  const words =
    item.transcription_words ??
    item.transcription?.words ??
    item.transcription_data?.words;

  const rawText =
    item.transcription_text ??
    (typeof item.transcription === 'object' && item.transcription !== null && 'text' in item.transcription
      ? item.transcription.text
      : undefined) ??
    (typeof item.transcription === 'object' && item.transcription !== null && 'fullText' in item.transcription
      ? item.transcription.fullText
      : undefined) ??
    item.transcription_data?.text;

  if (!words && !rawText) return null;

  return normalizeTranscription({
    words: words ?? undefined,
    fullText: rawText ?? ''
  });
};
