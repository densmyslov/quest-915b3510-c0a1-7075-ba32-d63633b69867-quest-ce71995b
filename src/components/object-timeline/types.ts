import type { NormalizedMediaTimelineItem } from '@/lib/mediaTimeline';

export type TimelineProgressState = {
  nextIndex: number;
  completedKeys: Record<string, true>;
  blockedByPuzzleId: string | null;
};

export type TimelineUiState = {
  objectId: string;
  objectName: string;
  version: number;
  items: NormalizedMediaTimelineItem[];
  progress: TimelineProgressState;
  isRunning: boolean;
};

export type TimelineTextOverlayState = {
  title: string;
  text: string;
  transcription?: { words: Array<{ word: string; start: number; end: number }> };
  imageUrls?: string[];
  mode: 'seconds' | 'until_close';
  seconds: number;
  objectId?: string;
  itemKey?: string;
};

export type TimelineVideoOverlayState = {
  title: string;
  url: string;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  posterUrl?: string;
};

export type TimelineChatOverlayState = {
  title: string;
  sessionId?: string | null;
  playerId?: string | null;
  firstMessage?: string;
  imageUrls?: string[];
  goal?: Record<string, any>;
};

export type TimelineActionOverlayState = {
  title: string;
  actionKind: string;
  params: Record<string, any>;
};

export type TimelineDocumentOverlayState = {
  title: string;
  media_id?: string;
  media_url?: string;
  text?: string;
  objectId?: string;
  itemKey?: string;
};

export type TimelineArOverlayState = {
  title: string;
  config: {
    task_prompt: '<OD>' | '<REFERRING_EXPRESSION_SEGMENTATION>';
    text_input?: string;
    overlay?: string; // "light" | "smoke" | "flashlight" | "none"
    origin?: 'top' | 'center';
    match_target_image_url?: string;
    match_target_image_key?: string;
  };
};

export type PulsatingCircleEffect = {
  minRadius: number;
  maxRadius: number;
  startDistance?: number;
  speed?: number;
  color: string;
};

export type PulsatingCircleSource = 'object' | 'timeline';

export type TimelinePanelItem = {
  key: string;
  type: string;
  label: string;
  done: boolean;
  current: boolean;
  canOpen: boolean;

  // GPS trigger info
  gpsLocked?: boolean;
  gpsTriggerMode?: 'approach' | 'departure' | 'distance_range' | null;
  gpsDistanceMeters?: number | null;
};

export type TimelinePanel = {
  objectId: string;
  objectName: string;
  blockedByPuzzleId: string | null;
  items: TimelinePanelItem[];
  onSkip: (key: string) => void | Promise<void>;
  onOpen: (key: string) => void;
};
