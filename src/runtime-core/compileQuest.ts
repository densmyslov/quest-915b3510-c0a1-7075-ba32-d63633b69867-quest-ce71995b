import { normalizeMediaTimeline } from '@/lib/mediaTimeline';
import type { QuestObject } from '@/types/quest';
import type { Transcription } from '@/types/transcription';
import type {
  AudioNode,
  ChatNode,
  CompiledQuestDefinition,
  EffectNode,
  NodeId,
  ObjectDef,
  ObjectId,
  PuzzleNode,
  TextNode,
  TimelineNode,
  VideoNode,
} from './compiledQuest';
import { assertValidCompiledQuestDefinition } from './validateCompiledQuest';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clampString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length ? value : fallback;
}

function getItineraryNumber(obj: any): number | null {
  const raw =
    obj?.itineraryNumber ??
    obj?.number ??
    obj?.itinerary_number ??
    obj?.itinerary ??
    obj?.['Itinerary number'] ??
    obj?.['Itinerary Number'];
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function isStartObject(obj: any): boolean {
  return !!(obj?.isStart ?? obj?.is_start);
}

export function sanitizeIdPart(input: string): string {
  // Keep schema-friendly characters. Replace everything else with underscore.
  return input.replace(/[^A-Za-z0-9_\-:.]/g, '_');
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function makeTimelineItemNodeId(objectId: string, itemKey: string): NodeId {
  const safeObjectId = sanitizeIdPart(objectId);
  const safeKey = sanitizeIdPart(itemKey);
  const prefix = `tl_${safeObjectId}:`;
  const maxLen = 160;
  const remaining = maxLen - prefix.length;
  if (remaining <= 8) {
    return `${prefix}${fnv1a32(itemKey)}`;
  }
  if (safeKey.length <= remaining) return `${prefix}${safeKey}`;
  // Truncate and include a stable hash suffix to avoid collisions.
  const hash = fnv1a32(itemKey);
  const truncated = safeKey.slice(0, Math.max(1, remaining - 1 - hash.length));
  return `${prefix}${truncated}_${hash}`;
}

function getTimelineAudioUrl(item: any): string | null {
  const mediaUrl = item?.media_url ?? item?.mediaUrl ?? item?.url ?? null;
  return typeof mediaUrl === 'string' && mediaUrl.length ? mediaUrl : null;
}

function getTimelineVideoUrl(item: any): string | null {
  const mediaUrl = item?.media_url ?? item?.mediaUrl ?? item?.url ?? null;
  if (typeof mediaUrl !== 'string' || !mediaUrl.length) return null;
  try {
    const url = new URL(mediaUrl);
    if (url.hostname.endsWith('cloudflarestream.com') && url.pathname.endsWith('/watch')) {
      url.pathname = url.pathname.replace(/\/watch$/, '/downloads/default.mp4');
      url.search = '';
      url.hash = '';
      return url.toString();
    }
  } catch {
    // ignore parsing errors
  }
  return mediaUrl;
}

function getTimelineAudioTranscription(item: any): Transcription | null {
  if (!item || typeof item !== 'object') return null;
  const words = item.transcription_words ?? item.transcription?.words ?? item.transcription_data?.words;
  const rawText =
    item.transcription_text ??
    (typeof item.transcription === 'object' && item.transcription !== null && 'text' in item.transcription
      ? (item.transcription as any).text
      : undefined) ??
    (typeof item.transcription === 'object' && item.transcription !== null && 'fullText' in item.transcription
      ? (item.transcription as any).fullText
      : undefined) ??
    item.transcription_data?.text;

  if (!words && !rawText) return null;

  const normalizedWords = Array.isArray(words)
    ? words
      .map((w: any) => {
        const word = typeof w?.word === 'string' ? w.word : '';
        const start = typeof w?.start === 'number' ? w.start : Number(w?.start?.toNumber?.());
        const end = typeof w?.end === 'number' ? w.end : Number(w?.end?.toNumber?.());
        if (!word.trim() || !Number.isFinite(start) || !Number.isFinite(end)) return null;
        return { word, start, end };
      })
      .filter((v): v is Transcription['words'][number] => !!v)
    : [];

  return { words: normalizedWords, fullText: typeof rawText === 'string' ? rawText : undefined };
}

function readPuzzleId(item: any): string | null {
  const raw = item?.puzzleId ?? item?.puzzle_id ?? null;
  return typeof raw === 'string' && raw.trim().length ? raw : null;
}

function readTextMarkdown(item: any): { title?: string; markdown: string } | null {
  const title = typeof item?.title === 'string' && item.title.trim().length ? item.title : undefined;
  const markdown =
    (typeof item?.markdown === 'string' && item.markdown.trim().length ? item.markdown : null) ??
    (typeof item?.text === 'string' && item.text.trim().length ? item.text : null) ??
    (typeof item?.body === 'string' && item.body.trim().length ? item.body : null);
  if (!markdown) return null;
  return { title, markdown };
}

function readEffectKind(item: any): EffectNode['payload']['effect'] | null {
  const raw = item?.effect ?? item?.effectKind ?? item?.effect_kind ?? null;
  if (raw === 'pulsating_circles' || raw === 'unlock_next_object' || raw === 'complete_object_and_advance' || raw === 'emit_event' || raw === 'show_hint') {
    return raw;
  }
  // Legacy naming in this template uses "pulsating_circles" at times.
  if (raw === 'pulsating_circles') return 'pulsating_circles';
  return null;
}


export type CompileQuestOptions = {
  questId: string;
  questVersion: string;
  schemaVersion?: string;
  publishedAt?: string;
  windowSize?: number;
};

export function compileQuestFromObjects(objects: QuestObject[], options: CompileQuestOptions): CompiledQuestDefinition {
  const schemaVersion = options.schemaVersion ?? '1.0.0';
  const publishedAt = options.publishedAt ?? new Date().toISOString();
  const windowSize = Number.isFinite(options.windowSize) ? Math.max(1, Math.floor(options.windowSize!)) : 2;

  const sorted = [...objects].sort((a, b) => {
    const aNum = getItineraryNumber(a) ?? 0;
    const bNum = getItineraryNumber(b) ?? 0;
    return aNum - bNum;
  });

  const startObj = sorted.find(isStartObject) ?? sorted[0];
  const endObj = sorted[sorted.length - 1];
  if (!startObj || !endObj) {
    throw new Error('Quest must have at least 1 object');
  }

  const objectsMap: Record<ObjectId, ObjectDef> = {};
  const timelineNodes: Record<NodeId, TimelineNode> = {};

  for (let i = 0; i < sorted.length; i++) {
    const obj = sorted[i];
    const objectId = obj.id as ObjectId;
    const title = clampString((obj as any).name, objectId);
    const nextObject = sorted[i + 1];
    const outObjectIds = nextObject ? [nextObject.id as ObjectId] : [];

    const startNodeId = `tl_${sanitizeIdPart(objectId)}__start`;
    const endNodeId = `tl_${sanitizeIdPart(objectId)}__end`;

    let coordinates: { lat: number; lng: number } | undefined;
    if (obj.coordinates) {
      if (typeof obj.coordinates === 'string') {
        // Try to parse string coordinates if needed, or assume object format elsewhere
        // For now assume standard object or parsed earlier
      } else if (typeof obj.coordinates === 'object' && 'lat' in obj.coordinates && 'lng' in obj.coordinates) {
        coordinates = {
          lat: Number(obj.coordinates.lat),
          lng: Number(obj.coordinates.lng)
        };
      }
    }

    objectsMap[objectId] = {
      title,
      entryNodeId: startNodeId,
      objectGates: { type: 'none' },
      outObjectIds,
      coordinates,
    };

    const timeline = normalizeMediaTimeline(obj);
    const items = timeline?.items?.filter((it) => it.enabled) ?? [];
    const itemNodeIds: NodeId[] = items.map((it) => makeTimelineItemNodeId(objectId, it.key));

    timelineNodes[startNodeId] = {
      objectId,
      type: 'state',
      stateKind: 'start',
      blocking: false,
      payload: {},
      outNodeIds: itemNodeIds.length ? [itemNodeIds[0]] : [endNodeId],
    };

    timelineNodes[endNodeId] = {
      objectId,
      type: 'state',
      stateKind: 'end',
      blocking: false,
      payload: {},
      outNodeIds: [],
    };

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const nodeId = itemNodeIds[idx];
      const nextNodeId = itemNodeIds[idx + 1] ?? endNodeId;

      const common = {
        objectId,
        blocking: !!item.blocking,
      } satisfies Pick<TimelineNode, 'objectId' | 'blocking'>;

      const type = (item as any).type as string;
      if (type === 'audio' || type === 'streaming_text_audio') {
        const audioUrl = getTimelineAudioUrl(item);
        if (!audioUrl) throw new Error(`Missing audioUrl for ${objectId} item ${item.key}`);
        const transcription = getTimelineAudioTranscription(item);
        const node: AudioNode = {
          ...common,
          type: 'audio',
          payload: {
            audioUrl,
            audioKind: type === 'streaming_text_audio' || transcription ? 'narration' : 'audio',
            role: item.role === 'background' ? 'background' : 'normal',
            autoplay: (item as any).autoplay === true ? true : undefined,
            loop: typeof (item as any).loop === 'boolean' ? (item as any).loop : undefined,
            volume: typeof (item as any).volume === 'number' ? (item as any).volume : undefined,
            startAtMs: Number.isFinite((item as any).startAtMs) ? Math.max(0, Math.floor((item as any).startAtMs)) : undefined,
            transcription: transcription ?? undefined,
          },
          outNodeIds: [nextNodeId],
        };
        timelineNodes[nodeId] = node;
        continue;
      }

      if (type === 'video') {
        const videoUrl = getTimelineVideoUrl(item);
        if (!videoUrl) throw new Error(`Missing videoUrl for ${objectId} item ${item.key}`);
        const node: VideoNode = {
          ...common,
          type: 'video',
          payload: {
            videoUrl,
            autoplay: (item as any).autoplay === true ? true : undefined,
            controls: typeof (item as any).controls === 'boolean' ? (item as any).controls : undefined,
          },
          outNodeIds: [nextNodeId],
        };
        timelineNodes[nodeId] = node;
        continue;
      }

      if (type === 'text') {
        const text = readTextMarkdown(item);
        if (!text) throw new Error(`Missing markdown for ${objectId} item ${item.key}`);
        const node: TextNode = {
          ...common,
          type: 'text',
          payload: text,
          outNodeIds: [nextNodeId],
        };
        timelineNodes[nodeId] = node;
        continue;
      }

      if (type === 'chat') {
        const node: ChatNode = {
          ...common,
          type: 'chat',
          payload: {},
          outNodeIds: [nextNodeId],
        };
        timelineNodes[nodeId] = node;
        continue;
      }

      if (type === 'effect') {
        const effect = readEffectKind(item);
        if (!effect) throw new Error(`Missing/unknown effect kind for ${objectId} item ${item.key}`);
        const params = isRecord((item as any).params) ? ((item as any).params as Record<string, unknown>) : undefined;
        const node: EffectNode = {
          ...common,
          type: 'effect',
          payload: { effect, params },
          outNodeIds: [nextNodeId],
        };
        timelineNodes[nodeId] = node;
        continue;
      }

      if (type === 'puzzle') {
        const puzzleId = readPuzzleId(item);
        if (!puzzleId) throw new Error(`Missing puzzleId for ${objectId} item ${item.key}`);
        const node: PuzzleNode = {
          ...common,
          type: 'puzzle',
          payload: { puzzleId },
          successOutNodeIds: [nextNodeId],
          failureOutNodeIds: [],
        };
        timelineNodes[nodeId] = node;
        continue;
      }

      throw new Error(`Unsupported timeline item type "${type}" for ${objectId} item ${item.key}`);
    }
  }

  const compiled: CompiledQuestDefinition = {
    schemaVersion,
    questId: options.questId,
    questVersion: options.questVersion,
    publishedAt,
    metadata: (options as any).metadata,
    map: (options as any).map,
    puzzles: (options as any).puzzles,
    policies: {
      objectVisibility: {
        mode: 'sliding_window',
        windowSize,
        includeCompletedInWindow: true,
      },
      timeline: {
        defaultBlocking: true,
      },
    },
    start: { objectId: startObj.id },
    end: { objectId: endObj.id },
    objects: objectsMap,
    timelineNodes,
  };

  assertValidCompiledQuestDefinition(compiled);
  return compiled;
}

export function compileQuestFromQuestJson(questJson: unknown, options: CompileQuestOptions): CompiledQuestDefinition {
  if (!isRecord(questJson)) throw new Error('questJson must be an object');
  const objects = (questJson as any).objects;
  if (!Array.isArray(objects)) throw new Error('questJson.objects must be an array');

  // Extract extra data to pass to options
  const extendedOptions = {
    ...options,
    metadata: (questJson as any).quest,
    map: (questJson as any).map,
    puzzles: Array.isArray((questJson as any).puzzles)
      ? (questJson as any).puzzles.reduce((acc: any, p: any) => ({ ...acc, [p.id]: p }), {})
      : {}
  };

  return compileQuestFromObjects(objects as QuestObject[], extendedOptions);
}
