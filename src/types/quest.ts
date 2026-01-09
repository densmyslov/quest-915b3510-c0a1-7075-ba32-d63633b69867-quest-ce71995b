import type { TranscriptionRaw, TranscriptionWordRaw } from '@/types/transcription';

export interface PulsatingEffect {
  enabled: boolean;
  color: string;
  // Current shape
  effectType?: string; // e.g., 'pulsating_circles'
  effectRadius?: number; // Radius of the pulsating effect
  startEffectDistance?: number; // Distance at which the effect starts
  speed?: number;
  // Legacy shape support
  minRadius?: number;
  maxRadius?: number;
}

export interface AudioEffect {
  enabled: boolean;
  trigger?: string; // e.g., "proximity"
  name: string;
  media_url: string;
  triggerRadius: number;
  loop?: boolean;
  volume?: number;
  media_id?: string;
  transcription_words?: TranscriptionWordRaw[];
  transcription_text?: string;
  transcription?: TranscriptionRaw | { text?: string; words?: TranscriptionWordRaw[] };
  transcription_data?: { text?: string; words?: TranscriptionWordRaw[] };
}

// ============================================
// OBJECT MEDIA TIMELINE (v3.0)
// ============================================

export type MediaTimelineItemType =
  | 'audio'
  | 'streaming_text_audio'
  | 'video'
  | 'effect'
  | 'puzzle'
  | 'action'
  | 'chat'
  | 'text';

export type MediaTimelineRole = 'normal' | 'background';

export interface MediaTimelineItemBase {
  id?: string;
  type: MediaTimelineItemType;
  enabled?: boolean;
  order?: number;
  delayMs?: number;
  blocking?: boolean;
  role?: MediaTimelineRole;
  title?: string;
  displayMode?: 'seconds' | 'until_close';
  displaySeconds?: number;
}

export interface MediaTimelineAudioItem extends MediaTimelineItemBase {
  type: 'audio' | 'streaming_text_audio';
  media_url?: string;
  media_id?: string;
  loop?: boolean;
  volume?: number;
  transcription_words?: TranscriptionWordRaw[];
  transcription_text?: string;
  transcription?: TranscriptionRaw | { text?: string; words?: TranscriptionWordRaw[] };
  transcription_data?: { text?: string; words?: TranscriptionWordRaw[] };
}

export interface MediaTimelineVideoItem extends MediaTimelineItemBase {
  type: 'video';
  media_url?: string;
  media_id?: string;
  loop?: boolean;
  muted?: boolean;
  autoPlay?: boolean;
  autoplay?: boolean;
  poster_url?: string;
  posterUrl?: string;
}

export interface MediaTimelineEffectItem extends MediaTimelineItemBase {
  type: 'effect';
  effectType?: string;
  effectId?: string;
  payload?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

export interface MediaTimelinePuzzleItem extends MediaTimelineItemBase {
  type: 'puzzle';
  puzzleId?: string;
  puzzle_id?: string;
}

export interface MediaTimelineTextItem extends MediaTimelineItemBase {
  type: 'text';
  text?: string;
  image_urls?: string[];
  imageUrls?: string[];
}

export interface MediaTimelineChatItem extends MediaTimelineItemBase {
  type: 'chat';
  firstMessage?: string;
  first_message?: string;
  image_urls?: string[];
  imageUrls?: string[];
  goal_injection?: {
    goal: string;
    success_criteria?: string[];
    constraints?: string[];
    tone?: string[];
    cta?: any;
    failsafe_if_player_refuses?: string;
  };
}

export interface MediaTimelineActionItem extends MediaTimelineItemBase {
  type: 'action';
  actionKind?: 'image_match' | 'knockknock' | string;
  params?: Record<string, unknown>;
}

export type MediaTimelineItem =
  | MediaTimelineAudioItem
  | MediaTimelineVideoItem
  | MediaTimelineEffectItem
  | MediaTimelinePuzzleItem
  | MediaTimelineActionItem
  | MediaTimelineChatItem
  | MediaTimelineTextItem;

export interface MediaTimeline {
  version: number;
  items: MediaTimelineItem[];
}

export interface QuestObject {
  id: string;
  name: string;
  description: string;
  isMain?: boolean;
  isStart?: boolean;
  is_start?: boolean;
  number?: number;
  itineraryNumber?: number;
  itinerary_number?: number;
  itinerary?: number;
  'Itinerary number'?: number;
  'Itinerary Number'?: number;
  points?: number;
  coordinates: {
    lat: number;
    lng: number;
  } | string;
  images: Array<
    | string
    | {
      url: string;
      thumbnailUrl?: string;
      audioUrl?: string | null;
      audioUrls?: string[];
      title?: string;
    }
  >;
  status: string;
  createdAt: string;
  unlocksPuzzleId?: string; // Optional field
  pulsating_effect?: PulsatingEffect; // Map effect configuration
  triggerRadius?: number; // GPS Tolerance in meters
  // Audio configuration - supports multiple formats
  audioUrl?: string | null;           // Legacy format
  audio_url?: string | null;          // Alternative legacy format
  audio_effect?: AudioEffect | null;  // New structured format
  mediaTimeline?: MediaTimeline | null; // Ordered media per object
}

export interface QuestPuzzle {
  id: string;
  type?: string;
  data?: any;
  linked_objects?: string[];
  interaction_data?: {
    type?: string;
    puzzle_data_url?: string;
    puzzle_data?: any;
  };
  // Dynamic Puzzle Extension
  pieces?: {
    id: string;
    image: string;
    targetX: number;
    targetY: number;
    unlocked?: boolean;
  }[];
  locationTriggers?: {
    locationId: string;
    pieceId: string;
    lat: number;
    lng: number;
    unlockMessage: string;
  }[];
  boardImage?: string;
}

export interface QuestData {
  questId?: string;
  questVersion?: string;
  quest: {
    id: string;
    name: string;
    description?: string;
    audioUrl?: string | null;
    votesFor?: number;
    teamTravelMode?: 'independent' | 'co-located';
  };
  policies?: {
    teamTravelMode?: 'independent' | 'co-located';
    objectVisibility?: any;
    timeline?: any;
  };
  map: {
    center: {
      lat: number;
      lng: number;
    };
    zoom: number;
    style: string;
  };
  objects: QuestObject[];
  puzzles: QuestPuzzle[];
}

// Server-side quest session state
export interface QuestSessionState {
  sessionId: string;
  questId: string;
  teamCode?: string;
  startedAt: string; // ISO timestamp
  completedAt?: string; // ISO timestamp
  score: number;
  completedObjects: string[]; // Array of object IDs
  completedPuzzles: string[]; // Array of puzzle IDs
  documentFragments: number; // Count of collected documents
  villagersConverted: number; // Count of converted villagers
  lastUpdatedAt: string; // ISO timestamp
  version: number; // Optimistic concurrency control
}

// API request/response types
export interface StartQuestRequest {
  sessionId: string;
  questId: string;
  teamCode?: string;
}

export interface StartQuestResponse {
  success: boolean;
  session: QuestSessionState;
}

export interface CompleteObjectRequest {
  sessionId: string;
  objectId: string;
  timestamp: string; // ISO timestamp
  points?: number;
}

export interface CompleteObjectResponse {
  success: boolean;
  session: QuestSessionState;
  error?: string;
}

export interface GetSessionResponse {
  success: boolean;
  session?: QuestSessionState;
  error?: string;
}

// Client-side quest progress hook
export interface QuestProgress {
  score: number;
  completedObjects: Set<string>;
  completedPuzzles: Set<string>;
  documentFragments: number;
  villagersConverted: number;
  isLoading: boolean;
  error: string | null;
  startQuest: (questId: string, teamCode?: string) => Promise<void>;
  completeObject: (objectId: string, points?: number) => Promise<void>;
  completePuzzle: (puzzleId: string, points?: number) => Promise<void>;
  collectDocument: () => Promise<void>;
  convertVillager: () => Promise<void>;
  refresh: () => Promise<void>;
}

// ============================================
// NEW STATE MANAGEMENT (v2.0)
// ============================================

/**
 * Object status lifecycle
 * @since v2.0.0
 */
export type ObjectStatus =
  | 'locked'       // Not yet accessible (future object)
  | 'available'    // Visible on map, player can travel to it
  | 'arrived'      // Player is within geofence radius
  | 'in_progress'  // Player started but hasn't completed all puzzles
  | 'completed';   // All puzzles solved, points awarded

/**
 * Player's state for a single object
 * @since v2.0.0
 */
export interface PlayerObjectState {
  objectId: string;
  objectNumber: number;
  visible: boolean;
  status: ObjectStatus;
  puzzlesCompleted: string[];
  puzzlesTotal: number;
  pointsEarned: number;
  unlockedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * Complete player state for a quest session
 * @since v2.0.0
 */
export interface PlayerState {
  stateVersion: number;
  playerId: string;
  sessionId: string;
  questId: string;
  teamCode: string | null;
  playerName: string;
  objects: Record<string, PlayerObjectState>;
  currentObjectId: string | null;
  previousObjectId: string | null;
  highestCompletedNumber: number;
  position: {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: string;
  } | null;
  score: number;
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
  version: number;
}

/**
 * Team member summary
 * @since v2.0.0
 */
export interface TeamMember {
  playerId: string;
  playerName: string;
  joinedAt: string;
  isOnline: boolean;
  lastSeenAt: string;
  score: number;
  highestCompletedNumber: number;
}

/**
 * Shared team state
 * @since v2.0.0
 */
export interface TeamState {
  teamCode: string;
  questId: string;
  members: TeamMember[];
  objectsCompletedByTeam: string[];
  teamHighestCompletedNumber: number;
  teamScore: number;
  memberScores: Record<string, number>;
  votesFor: number;
  votesAgainst: number;
  createdAt: string;
  lastUpdatedAt: string;
  version: number;
}

// ============================================
// RUNTIME SNAPSHOT (Lambda API)
// ============================================

export interface RuntimeSnapshot {
  sessionId: string;
  questId: string;
  questVersion: string;
  version: number;
  serverTime: string;
  status: string;
  me: {
    playerId: string;
    playerName: string;
    visibleObjectIds: string[];
    currentObjectId: string | null;
    score: number;
  };
  players: Record<string, {
    playerId: string;
    playerName: string;
    status: string;
    score: number;
    currentObjectId?: string | null;
  }>;
  objects: Record<string, {
    objectId: string;
    arrivedAt: string | null;
    completedAt: string | null;
  }>;
  nodes: Record<string, {
    nodeId: string;
    status: string; // 'locked', 'unlocked', 'completed', 'active'
    outcome: string | null; // 'success', 'failure'
    completedAt: string | null;
    attemptGroupId?: string;
  }>;
}
