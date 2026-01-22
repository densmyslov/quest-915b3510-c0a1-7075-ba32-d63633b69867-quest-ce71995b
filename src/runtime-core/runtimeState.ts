import type { NodeId, ObjectId } from './compiledQuest';

export type RuntimeSessionStatus = 'active' | 'ended';
export type RuntimePlayerStatus = 'active' | 'left' | 'inactive';

export type RuntimeObjectLifecycle = 'HIDDEN' | 'AVAILABLE' | 'ARRIVED' | 'COMPLETED';

export type RuntimeNodeStatus = 'locked' | 'unlocked' | 'completed';
// Backend APIs may return "failure" while some client code historically used "fail".
export type RuntimeNodeOutcome = 'success' | 'fail' | 'failure';

export type RuntimePlayer = {
  playerId: string;
  playerName: string;
  joinedAt: string;
  status: RuntimePlayerStatus;
  currentObjectId: ObjectId | null;
  score: number;
};

export type RuntimeObjectState = {
  objectId: ObjectId;
  arrivedAt: string | null;
  completedAt: string | null;
};

export type RuntimeNodeState = {
  nodeId: NodeId;
  status: RuntimeNodeStatus;
  completedAt: string | null;
  outcome: RuntimeNodeOutcome | null;
  attemptGroupId: string | null;
};

export type RuntimeSessionState = {
  sessionId: string;
  questId: string;
  questVersion: string;
  status: RuntimeSessionStatus;
  createdAt: string;
  updatedAt: string;
  version: number;

  players: Record<string, RuntimePlayer>;

  /**
   * Sparse maps:
   * - if missing => defaults are applied by helpers (e.g. node locked, object hidden/unarrived/uncompleted)
   */
  objectsByPlayer: Record<string, Record<ObjectId, RuntimeObjectState>>;
  nodesByPlayer: Record<string, Record<NodeId, RuntimeNodeState>>;

  processedDedupeKeys: Set<string>;
  processedEventIds: Set<string>;
};

export type RuntimeDelta =
  | { type: 'PLAYER_JOINED'; playerId: string }
  | { type: 'OBJECT_ARRIVED'; playerId: string; objectId: ObjectId }
  | { type: 'OBJECT_COMPLETED'; playerId: string; objectId: ObjectId }
  | { type: 'NODE_UNLOCKED'; playerId: string; nodeId: NodeId }
  | { type: 'NODE_COMPLETED'; playerId: string; nodeId: NodeId; outcome?: RuntimeNodeOutcome | null }
  | { type: 'SCORE_UPDATED'; playerId: string; score: number };

export type RuntimeSnapshot = {
  sessionId: string;
  questId: string;
  questVersion: string;
  status: RuntimeSessionStatus;
  version: number;
  serverTime: string;

  players: Record<string, Pick<RuntimePlayer, 'playerId' | 'playerName' | 'status' | 'joinedAt' | 'currentObjectId' | 'score'>>;

  me: {
    playerId: string;
    visibleObjectIds: ObjectId[];
    completedObjectIds: ObjectId[];
    arrivedObjectIds: ObjectId[];
  };

  objects: Record<ObjectId, { lifecycle: RuntimeObjectLifecycle; arrivedAt: string | null; completedAt: string | null }>;
  nodes: Record<NodeId, RuntimeNodeState>;
};
