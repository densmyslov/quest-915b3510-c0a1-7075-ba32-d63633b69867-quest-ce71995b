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

export function normalizeMediaTimeline(obj: QuestObject, timelineNodes?: Record<string, any>): NormalizedMediaTimeline | null {
  let raw = getRawTimeline(obj);

  // If object doesn't have mediaTimeline but we have timelineNodes, reconstruct it
  if (!raw && timelineNodes && obj.id) {
    console.log('[normalizeMediaTimeline] Object has no mediaTimeline, reconstructing from timelineNodes', {
      objectId: obj.id,
      hasTimelineNodes: !!timelineNodes,
      timelineNodeCount: timelineNodes ? Object.keys(timelineNodes).length : 0
    });
    raw = reconstructMediaTimelineFromNodes(obj.id, timelineNodes);
    if (raw) {
      console.log('[normalizeMediaTimeline] Successfully reconstructed timeline', {
        objectId: obj.id,
        itemCount: raw.items.length,
        itemTypes: raw.items.map((item: any) => item.type)
      });
    } else {
      console.warn('[normalizeMediaTimeline] Failed to reconstruct timeline from timelineNodes', {
        objectId: obj.id
      });
    }
  }

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
        // Explicitly preserve gpsTrigger if present (though spread should handle it)
        ...((item as any).gpsTrigger ? { gpsTrigger: (item as any).gpsTrigger } : {})
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

/**
 * Reconstruct mediaTimeline from compiled quest timelineNodes for a given object.
 * This is needed because the compiled quest stores timeline items in a flat graph (timelineNodes)
 * but the UI code expects per-object mediaTimeline arrays.
 */
export function reconstructMediaTimelineFromNodes(
  objectId: string,
  timelineNodes: Record<string, any>
): { version: number; items: any[] } | null {
  if (!timelineNodes) return null;

  const items: any[] = [];

  // Find the start node for this object
  const startNodeId = `tl_${objectId.replace(/[^A-Za-z0-9_\-:.]/g, '_')}__start`;
  const startNode = timelineNodes[startNodeId];
  if (!startNode || startNode.type !== 'state' || startNode.stateKind !== 'start') {
    return null;
  }

  // Traverse the timeline graph from start to end
  const visited = new Set<string>();
  let currentNodeIds = startNode.outNodeIds || [];

  while (currentNodeIds.length > 0) {
    const nodeId = currentNodeIds[0]; // Take first node (linear timeline)
    if (visited.has(nodeId)) break;
    visited.add(nodeId);

    const node = timelineNodes[nodeId];
    if (!node) break;

    // Skip state nodes (start/end markers)
    if (node.type === 'state') {
      currentNodeIds = node.outNodeIds || [];
      continue;
    }

    // Extract the item key from node ID (format: tl_objectId:itemId)
    const keyMatch = nodeId.match(/:([^:]+)$/);
    const itemKey = keyMatch ? keyMatch[1] : nodeId;

    // Convert timeline node to media timeline item format
    const item: any = {
      id: itemKey,
      key: itemKey,
      type: node.type,
      blocking: node.blocking !== false,
      enabled: true,
      order: items.length,
    };

    // Add type-specific fields
    if (node.type === 'audio') {
      Object.assign(item, {
        media_url: node.payload?.audioUrl,
        mediaUrl: node.payload?.audioUrl,
        role: node.payload?.role || 'normal',
        autoplay: node.payload?.autoplay,
        loop: node.payload?.loop,
        transcription: node.payload?.transcription,
      });
    } else if (node.type === 'video') {
      Object.assign(item, {
        media_url: node.payload?.videoUrl,
        mediaUrl: node.payload?.videoUrl,
        autoplay: node.payload?.autoplay,
        controls: node.payload?.controls,
      });
    } else if (node.type === 'text') {
      Object.assign(item, {
        title: node.payload?.title,
        text: node.payload?.markdown || node.payload?.text,
        markdown: node.payload?.markdown,
      });
    } else if (node.type === 'action') {
      Object.assign(item, {
        actionKind: node.payload?.actionKind,
        action_kind: node.payload?.actionKind,
        params: node.payload?.params || {},
        payload: node.payload,
      });
    } else if (node.type === 'puzzle') {
      Object.assign(item, {
        puzzleId: node.payload?.puzzleId,
        puzzle_id: node.payload?.puzzleId,
      });
    } else if (node.type === 'chat') {
      Object.assign(item, {
        goal_injection: node.payload?.goal_injection,
        firstMessage: node.payload?.firstMessage,
      });
    } else if (node.type === 'effect') {
      Object.assign(item, {
        effect: node.payload?.effect,
        effectKind: node.payload?.effect,
        params: node.payload?.params,
      });
    }

    items.push(item);

    // Move to next node
    currentNodeIds = node.outNodeIds || node.successOutNodeIds || [];
  }

  return { version: 1, items };
}
