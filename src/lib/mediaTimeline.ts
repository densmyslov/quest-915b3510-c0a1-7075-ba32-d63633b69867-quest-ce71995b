import type {
  MediaTimeline,
  MediaTimelineItem,
  MediaTimelineRole,
  QuestObject,
} from '@/types/quest';

export type NormalizedMediaTimelineItem = MediaTimelineItem & {
  key: string;
  enabled: boolean;
  order: number;
  delayMs: number;
  blocking: boolean;
  role: MediaTimelineRole;
};

export type NormalizedMediaTimeline = {
  version: number;
  items: NormalizedMediaTimelineItem[];
};

function clampNonNegative(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

function getRawTimeline(obj: QuestObject): MediaTimeline | null {
  const raw = (obj as any).mediaTimeline ?? (obj as any).media_timeline ?? (obj as any).media ?? null;
  if (!raw) return null;
  // If raw is array, treat as items list
  if (Array.isArray(raw)) {
    return { version: 1, items: raw } as MediaTimeline;
  }
  const version = typeof (raw as any).version === 'number' ? (raw as any).version : 1;
  const items = Array.isArray((raw as any).items) ? (raw as any).items : [];
  return { version, items } as MediaTimeline;
}

export function normalizeMediaTimeline(obj: QuestObject): NormalizedMediaTimeline | null {
  const raw = getRawTimeline(obj);

  if (!raw) {
    return null;
  }

  const items: NormalizedMediaTimelineItem[] = raw.items
    .map((item: any, idx: number) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const type = item.type as MediaTimelineItem['type'] | undefined;
      if (!type) {
        return null;
      }

      const enabled = item.enabled !== false;
      const order = typeof item.order === 'number' ? item.order : idx;
      const delayMs = clampNonNegative(item.delayMs, 0);
      const role: MediaTimelineRole =
        item.role === 'background' || item.role === 'normal' ? item.role : 'normal';
      const defaultBlocking = true; // All items blocking by default for sequential playback
      let blocking = typeof item.blocking === 'boolean' ? item.blocking : defaultBlocking;

      // Enforce invariants: puzzles/chats/actions always block; background audio never blocks.
      if (type === 'puzzle' || type === 'chat' || type === 'action') {
        blocking = true;
      } else if ((type === 'audio' || type === 'streaming_text_audio') && role === 'background') {
        blocking = false;
      }

      const key =
        typeof item.id === 'string' && item.id.length
          ? item.id
          : `${type}:${typeof item.order === 'number' ? item.order : idx}`;

      return {
        ...(item as MediaTimelineItem),
        key,
        enabled,
        order,
        delayMs,
        blocking,
        role,
      };
    })
    .filter((v): v is NormalizedMediaTimelineItem => !!v)
    .sort((a, b) => a.order - b.order);

  return { version: raw.version, items };
}

export function getTimelinePuzzleIds(obj: QuestObject): string[] {
  const timeline = normalizeMediaTimeline(obj);
  if (!timeline) return [];
  const ids = timeline.items
    .filter((item) => item.type === 'puzzle' && item.enabled)
    .map((item) => (item as any).puzzleId ?? (item as any).puzzle_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids)];
}
