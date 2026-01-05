export type ObjectId = string;
export type NodeId = string;

export type CompiledSchemaVersion = string;
export type QuestId = string;
export type QuestVersion = string;

export type GateScope = 'player' | 'current_object' | 'session';

export type GateType =
  | 'none'
  | 'arrival_required'
  | 'player_done'
  | 'all_players_done'
  | 'any_player_done'
  | 'player_success'
  | 'all_players_success'
  | 'any_player_success'
  | 'min_players_done'
  | 'min_players_success';

export type GateNone = { type: 'none' };

export type Gate = {
  type: Exclude<GateType, 'none'>;
  scope: GateScope;
  minCount?: number;
  players?: string[];
  requireSameAttempt?: boolean;
};

export type GateSpec = GateNone | Gate;

export type ObjectVisibilityPolicy = {
  mode: 'sliding_window';
  windowSize: number;
  includeCompletedInWindow: boolean;
};

export type TimelinePolicy = {
  defaultBlocking: boolean;
};

export type CompiledPolicies = {
  objectVisibility: ObjectVisibilityPolicy;
  timeline: TimelinePolicy;
};

export type ObjectDef = {
  title: string;
  entryNodeId: NodeId;
  objectGates: GateSpec;
  outObjectIds: ObjectId[];
  coordinates?: {
    lat: number;
    lng: number;
  };
};

export type TimelineNodeCommon = {
  objectId: ObjectId;
  type: TimelineNodeType;
  blocking: boolean;
  gates?: GateSpec;
  payload: Record<string, unknown>;
};

export type TimelineNodeType =
  | 'state'
  | 'text'
  | 'chat'
  | 'audio'
  | 'video'
  | 'image'
  | 'puzzle'
  | 'action'
  | 'effect';

export type AdjacencyLinear = {
  outNodeIds: NodeId[];
};

export type AdjacencyBranching = {
  successOutNodeIds: NodeId[];
  failureOutNodeIds?: NodeId[];
};

export type StateNode = TimelineNodeCommon &
  AdjacencyLinear & {
    type: 'state';
    stateKind: 'start' | 'end';
    payload: {
      onEnter?: string[];
    };
  };

export type TextNode = TimelineNodeCommon &
  AdjacencyLinear & {
    type: 'text';
    payload: {
      title?: string;
      markdown: string;
    };
  };

export type ChatNode = TimelineNodeCommon &
  AdjacencyLinear & {
    type: 'chat';
    payload: Record<string, unknown>;
  };

export type TranscriptionWord = {
  word: string;
  start: number;
  end: number;
};

export type Transcription = {
  words: TranscriptionWord[];
  fullText?: string;
};

export type AudioNode = TimelineNodeCommon &
  AdjacencyLinear & {
    type: 'audio';
    payload: {
      audioUrl: string;
      audioKind?: 'audio' | 'narration';
      role?: 'normal' | 'background';
      autoplay?: boolean;
      loop?: boolean;
      volume?: number;
      startAtMs?: number;
      transcription?: Transcription;
    };
  };

export type VideoNode = TimelineNodeCommon &
  AdjacencyLinear & {
    type: 'video';
    payload: {
      videoUrl: string;
      autoplay?: boolean;
      controls?: boolean;
    };
  };

export type ImageNode = TimelineNodeCommon &
  AdjacencyLinear & {
    type: 'image';
    payload: {
      imageUrl: string;
      alt?: string;
      caption?: string;
      fit?: 'contain' | 'cover' | 'fill';
      allowZoom?: boolean;
      completeOn?: 'render' | 'close' | 'timer';
      durationMs?: number;
    };
  };

export type PuzzleNode = TimelineNodeCommon &
  AdjacencyBranching & {
    type: 'puzzle';
    payload: {
      puzzleId: string;
    };
  };

export type ActionNode = TimelineNodeCommon &
  AdjacencyBranching & {
    type: 'action';
    attemptPolicy?: {
      maxAttemptsPerPlayer?: number;
      cooldownMs?: number;
    };
    payload: {
      actionKind: 'image_match' | 'knockknock';
      params: Record<string, unknown>;
    };
  };

export type EffectNode = TimelineNodeCommon &
  AdjacencyLinear & {
    type: 'effect';
    payload: {
      effect:
      | 'pulsating_circles'
      | 'unlock_next_object'
      | 'complete_object_and_advance'
      | 'emit_event'
      | 'show_hint';
      params?: Record<string, unknown>;
    };
  };

export type TimelineNode = StateNode | TextNode | ChatNode | AudioNode | VideoNode | ImageNode | PuzzleNode | ActionNode | EffectNode;

export type CompiledQuestDefinition = {
  schemaVersion: CompiledSchemaVersion;
  questId: QuestId;
  questVersion: QuestVersion;
  publishedAt: string;
  metadata?: {
    name: string;
    description?: string;
    audioUrl?: string | null;
  };
  map?: {
    center: { lat: number; lng: number };
    zoom: number;
    style: string;
  };
  policies: CompiledPolicies;
  start: { objectId: ObjectId };
  end: { objectId: ObjectId };
  objects: Record<ObjectId, ObjectDef>;
  timelineNodes: Record<NodeId, TimelineNode>;
  puzzles?: Record<string, any>; // Puzzle definitions (pieces, board, etc)
};

export const OBJECT_ID_RE = /^[A-Za-z0-9_\-:.]{1,128}$/;
export const NODE_ID_RE = /^[A-Za-z0-9_\-:.]{1,160}$/;

export function isObjectId(value: unknown): value is ObjectId {
  return typeof value === 'string' && OBJECT_ID_RE.test(value);
}

export function isNodeId(value: unknown): value is NodeId {
  return typeof value === 'string' && NODE_ID_RE.test(value);
}
