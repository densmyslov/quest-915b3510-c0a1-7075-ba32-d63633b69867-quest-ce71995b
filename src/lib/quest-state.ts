/**
 * Quest State Management
 *
 * This module handles player progression through a location-based quest,
 * implementing a "sliding window" visibility model where only 2 objects
 * are visible at any time: the current object and the previous one.
 *
 * Architecture:
 * - PlayerState: Individual player's progress, scores, and object visibility
 * - TeamState: Shared state across team members (scores, completion sync)
 * - Object visibility controlled by `visible` boolean flag
 * - State persisted server-side (DynamoDB) with optimistic client updates
 *
 * @module quest-state
 * @version 2.0.0
 */

// ============================================
// CONSTANTS
// ============================================

/**
 * Current state schema version for migration detection
 * v1 = legacy QuestSessionState
 * v2 = new PlayerState with sliding window
 */
export const STATE_VERSION = 2;

/**
 * Default GPS trigger radius in meters (can be overridden per-object)
 */
export const DEFAULT_TRIGGER_RADIUS = 30;

// ============================================
// CORE TYPES
// ============================================

/**
 * Status of an object in the player's journey
 *
 * Lifecycle: locked → available → arrived → in_progress → completed
 */
export type ObjectStatus =
  | 'locked'       // Not yet accessible (future object)
  | 'available'    // Visible on map, player can travel to it
  | 'arrived'      // Player is within geofence radius
  | 'in_progress'  // Player started but hasn't completed all puzzles
  | 'completed';   // All puzzles solved, points awarded

// Import QuestObject from types instead of redefining
import type { QuestObject } from '@/types/quest';

/**
 * Player's state for a single object
 */
export interface PlayerObjectState {
  objectId: string;
  objectNumber: number;

  /** Controls whether object appears on map (runtime state, overrides design-time visible flag) */
  visible: boolean;

  /** Current status in the object lifecycle */
  status: ObjectStatus;

  /** IDs of puzzles the player has completed for this object */
  puzzlesCompleted: string[];

  /** Total puzzles required (from QuestObject.puzzles.length or 1 if unlocksPuzzleId) */
  puzzlesTotal: number;

  /** Points earned (set on completion) */
  pointsEarned: number;

  /** Timestamps for analytics and sync */
  unlockedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * Complete player state for a quest session
 */
export interface PlayerState {
  // ─────────────────────────────────────────
  // Versioning
  // ─────────────────────────────────────────

  /** State schema version (for migration detection) */
  stateVersion: number;

  // ─────────────────────────────────────────
  // Identity
  // ─────────────────────────────────────────
  playerId: string;
  sessionId: string;
  questId: string;
  teamCode: string | null;
  playerName: string;

  // ─────────────────────────────────────────
  // Object Progression
  // ─────────────────────────────────────────

  /** State for each object (keyed by objectId) */
  objects: Record<string, PlayerObjectState>;

  /** Currently active object (next to complete) */
  currentObjectId: string | null;

  /** Most recently completed object (for sliding window) */
  previousObjectId: string | null;

  /** Highest object.number that player has completed */
  highestCompletedNumber: number;

  // ─────────────────────────────────────────
  // Position
  // ─────────────────────────────────────────

  /** Last known GPS position */
  position: {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: string;
  } | null;

  // ─────────────────────────────────────────
  // Scoring
  // ─────────────────────────────────────────

  /** Total points earned */
  score: number;

  // ─────────────────────────────────────────
  // Session Metadata
  // ─────────────────────────────────────────

  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;

  /** Optimistic locking version for server sync */
  version: number;
}

/**
 * Team member summary (stored in TeamState)
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
 * Shared team state (stored in Durable Object for real-time sync)
 */
export interface TeamState {
  teamCode: string;
  questId: string;

  /** All team members */
  members: TeamMember[];

  /** Object IDs completed by ANY team member */
  objectsCompletedByTeam: string[];

  /** Highest object.number completed across all members */
  teamHighestCompletedNumber: number;

  /** Sum of all member scores */
  teamScore: number;

  /** Individual member scores (for leaderboard) */
  memberScores: Record<string, number>;

  // ─────────────────────────────────────────
  // Narrative Progress (for "Il Giuramento")
  // ─────────────────────────────────────────

  /** Villagers convinced (increases as puzzles are solved) */
  votesFor: number;

  /** Villagers opposed (totalPoints - votesFor) */
  votesAgainst: number;

  // ─────────────────────────────────────────
  // Metadata
  // ─────────────────────────────────────────

  createdAt: string;
  lastUpdatedAt: string;
  version: number;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Normalize coordinates from quest object (handles legacy string format)
 */
function normalizeCoordinates(coords: { lat: number; lng: number } | string): { lat: number; lng: number } {
  if (typeof coords === 'string') {
    const [lat, lng] = coords.split(',').map(s => parseFloat(s.trim()));
    return { lat, lng };
  }
  return coords;
}

/**
 * Get puzzle IDs for an object (handles both new and legacy formats)
 */
function getPuzzleIds(obj: QuestObject): string[] {
  const puzzleIds: string[] = [];

  // New: media timeline can define multiple puzzles per object.
  const timelineItems = obj.mediaTimeline?.items;
  if (Array.isArray(timelineItems)) {
    for (const item of timelineItems) {
      if (!item || typeof item !== 'object') continue;
      if ((item as any).type !== 'puzzle') continue;
      if ((item as any).enabled === false) continue;
      const raw = (item as any).puzzleId ?? (item as any).puzzle_id;
      if (typeof raw === 'string' && raw.length) {
        puzzleIds.push(raw);
      }
    }
  }

  // Legacy: a single puzzle directly on the object.
  if (obj.unlocksPuzzleId) {
    puzzleIds.push(obj.unlocksPuzzleId);
  }

  // De-dupe while preserving order.
  return [...new Set(puzzleIds)];
}

/**
 * Get trigger radius for an object
 */
function getTriggerRadius(obj: QuestObject): number {
  return obj.triggerRadius ?? DEFAULT_TRIGGER_RADIUS;
}

/**
 * Get object number (with fallback for legacy data)
 */
function getObjectNumber(obj: QuestObject): number {
  return obj.number ?? obj.itineraryNumber ?? obj.itinerary_number ?? obj.itinerary ?? 0;
}

/**
 * Get object points (with fallback to 0)
 */
function getObjectPoints(obj: QuestObject): number {
  return obj.points ?? 0;
}

// ============================================
// STATE INITIALIZATION
// ============================================

/**
 * Initialize player state at quest start
 *
 * Sets up the initial sliding window: only the first object is visible.
 *
 * @param questObjects - All objects in the quest (from quest.json)
 * @param playerId - Unique player identifier
 * @param sessionId - Session identifier for this playthrough
 * @param playerName - Display name
 * @param teamCode - Optional team code for multiplayer
 */
export function initializePlayerState(
  questObjects: QuestObject[],
  playerId: string,
  sessionId: string,
  playerName: string,
  teamCode: string | null = null
): PlayerState {
  const now = new Date().toISOString();

  // Sort objects by itinerary number
  const sorted = [...questObjects].sort((a, b) => getObjectNumber(a) - getObjectNumber(b));
  const firstObject = sorted[0];

  if (!firstObject) {
    throw new Error('Quest must have at least one object');
  }

  // Initialize state for each object
  const objects: Record<string, PlayerObjectState> = {};

  for (const obj of sorted) {
    const isFirst = obj.id === firstObject.id;
    const puzzleIds = getPuzzleIds(obj);

    objects[obj.id] = {
      objectId: obj.id,
      objectNumber: getObjectNumber(obj),
      visible: isFirst,                    // Only first object visible at start
      status: isFirst ? 'available' : 'locked',
      puzzlesCompleted: [],
      puzzlesTotal: puzzleIds.length || 0,
      pointsEarned: 0,
      unlockedAt: isFirst ? now : null,
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
    };
  }

  return {
    stateVersion: STATE_VERSION,
    playerId,
    sessionId,
    questId: '', // Set by caller
    teamCode,
    playerName,
    objects,
    currentObjectId: firstObject.id,
    previousObjectId: null,
    highestCompletedNumber: 0,
    position: null,
    score: 0,
    startedAt: now,
    lastActivityAt: now,
    completedAt: null,
    version: 1,
  };
}

/**
 * Initialize team state when first player creates/joins a team
 */
export function initializeTeamState(
  teamCode: string,
  questId: string,
  totalPossiblePoints: number
): TeamState {
  const now = new Date().toISOString();

  return {
    teamCode,
    questId,
    members: [],
    objectsCompletedByTeam: [],
    teamHighestCompletedNumber: 0,
    teamScore: 0,
    memberScores: {},
    votesFor: 0,
    votesAgainst: totalPossiblePoints,
    createdAt: now,
    lastUpdatedAt: now,
    version: 1,
  };
}

// ============================================
// STATE TRANSITIONS
// ============================================

/**
 * Update state when player arrives at an object (enters geofence)
 *
 * @param state - Current player state
 * @param objectId - ID of object player arrived at
 * @returns Updated player state
 */
export function arriveAtObject(
  state: PlayerState,
  objectId: string
): PlayerState {
  const objState = state.objects[objectId];

  // Validate: object must be visible and available
  if (!objState) {
    console.warn(`Object ${objectId} not found in player state`);
    return state;
  }

  if (!objState.visible) {
    console.warn(`Object ${objectId} is not visible`);
    return state;
  }

  if (objState.status === 'completed') {
    // Already completed, no state change needed
    return state;
  }

  const now = new Date().toISOString();

  return {
    ...state,
    objects: {
      ...state.objects,
      [objectId]: {
        ...objState,
        status: 'arrived',
        arrivedAt: objState.arrivedAt ?? now,
      },
    },
    lastActivityAt: now,
    version: state.version + 1,
  };
}

/**
 * Update state when player starts working on an object's puzzles
 *
 * @param state - Current player state
 * @param objectId - ID of object player started
 * @returns Updated player state
 */
export function startObject(
  state: PlayerState,
  objectId: string
): PlayerState {
  const objState = state.objects[objectId];

  if (!objState || objState.status === 'locked' || objState.status === 'completed') {
    return state;
  }

  const now = new Date().toISOString();

  return {
    ...state,
    objects: {
      ...state.objects,
      [objectId]: {
        ...objState,
        status: 'in_progress',
        startedAt: objState.startedAt ?? now,
      },
    },
    lastActivityAt: now,
    version: state.version + 1,
  };
}

/**
 * Update state when player completes a puzzle
 *
 * If all puzzles for the object are completed, triggers object completion.
 *
 * @param state - Current player state
 * @param objectId - ID of object containing the puzzle
 * @param puzzleId - ID of completed puzzle
 * @param allObjects - All quest objects (for finding next object)
 * @returns Updated player state
 */
export function completePuzzle(
  state: PlayerState,
  objectId: string,
  puzzleId: string,
  allObjects: QuestObject[]
): PlayerState {
  const objState = state.objects[objectId];

  if (!objState || objState.status === 'completed') {
    return state;
  }

  // Check if puzzle already completed (idempotent)
  if (objState.puzzlesCompleted.includes(puzzleId)) {
    return state;
  }

  const now = new Date().toISOString();
  const updatedPuzzlesCompleted = [...objState.puzzlesCompleted, puzzleId];
  const allPuzzlesDone = updatedPuzzlesCompleted.length >= objState.puzzlesTotal;

  let newState: PlayerState = {
    ...state,
    objects: {
      ...state.objects,
      [objectId]: {
        ...objState,
        status: 'in_progress',
        puzzlesCompleted: updatedPuzzlesCompleted,
        startedAt: objState.startedAt ?? now,
      },
    },
    lastActivityAt: now,
    version: state.version + 1,
  };

  // If all puzzles done, complete the object
  if (allPuzzlesDone) {
    newState = completeObject(newState, objectId, allObjects);
  }

  return newState;
}

/**
 * Update state when player completes an object
 *
 * This is the core function that implements the sliding window:
 * 1. Marks current object as completed
 * 2. Hides the previous-previous object
 * 3. Makes the next object visible
 * 4. Shifts the window forward
 *
 * Includes sequential completion validation: objects must be completed in order.
 *
 * @param state - Current player state
 * @param objectId - ID of completed object
 * @param allObjects - All quest objects (for navigation)
 * @returns Updated player state with shifted visibility window
 * @throws Error if attempting to complete object out of sequence
 */
export function completeObject(
  state: PlayerState,
  objectId: string,
  allObjects: QuestObject[]
): PlayerState {
  const objState = state.objects[objectId];

  if (!objState) {
    console.warn(`Object ${objectId} not found`);
    return state;
  }

  // Idempotent: already completed
  if (objState.status === 'completed') {
    return state;
  }

  const now = new Date().toISOString();

  // Sort objects by itinerary number
  const sorted = [...allObjects].sort((a, b) => getObjectNumber(a) - getObjectNumber(b));
  const completedObj = sorted.find(o => o.id === objectId);

  if (!completedObj) {
    console.warn(`Object ${objectId} not found in quest objects`);
    return state;
  }

  // SEQUENTIAL COMPLETION VALIDATION
  // Prevent completing object N before completing object N-1
  const completedObjNumber = getObjectNumber(completedObj);
  if (completedObjNumber > state.highestCompletedNumber + 1) {
    throw new Error(
      `Cannot complete object ${completedObjNumber} before completing object ${state.highestCompletedNumber + 1}. ` +
      `Objects must be completed in sequence.`
    );
  }

  const completedIndex = sorted.findIndex(o => o.id === objectId);

  // Find next object (if any)
  const nextObject = sorted[completedIndex + 1] ?? null;

  // Find the object to hide (previous-previous)
  // This is the object that was previously visible as "previous"
  const objectToHide = state.previousObjectId;

  // Build updated objects map
  const updatedObjects = { ...state.objects };

  // 1. Hide the previous-previous object (if exists)
  if (objectToHide && updatedObjects[objectToHide]) {
    updatedObjects[objectToHide] = {
      ...updatedObjects[objectToHide],
      visible: false,
    };
  }

  // 2. Mark completed object as done (stays visible as "previous")
  updatedObjects[objectId] = {
    ...updatedObjects[objectId],
    visible: true,
    status: 'completed',
    pointsEarned: getObjectPoints(completedObj),
    completedAt: now,
  };

  // 3. Make next object visible and available (becomes "current")
  if (nextObject && updatedObjects[nextObject.id]) {
    updatedObjects[nextObject.id] = {
      ...updatedObjects[nextObject.id],
      visible: true,
      status: 'available',
      unlockedAt: now,
    };
  }

  // Calculate new score
  const newScore = state.score + getObjectPoints(completedObj);

  // Check if quest is complete
  const isQuestComplete = nextObject === null;

  return {
    ...state,
    objects: updatedObjects,
    // Shift the window
    previousObjectId: objectId,
    currentObjectId: nextObject?.id ?? null,
    highestCompletedNumber: completedObjNumber,
    score: newScore,
    lastActivityAt: now,
    completedAt: isQuestComplete ? now : null,
    version: state.version + 1,
  };
}

/**
 * Update player's GPS position
 */
export function updatePosition(
  state: PlayerState,
  position: GeolocationPosition
): PlayerState {
  return {
    ...state,
    position: {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: new Date(position.timestamp).toISOString(),
    },
    lastActivityAt: new Date().toISOString(),
  };
}

// ============================================
// TEAM STATE UPDATES
// ============================================

/**
 * Add a member to team state
 */
export function addTeamMember(
  teamState: TeamState,
  member: Omit<TeamMember, 'joinedAt' | 'lastSeenAt'>
): TeamState {
  const now = new Date().toISOString();

  // Check if member already exists
  const existingIndex = teamState.members.findIndex(m => m.playerId === member.playerId);

  if (existingIndex >= 0) {
    // Update existing member
    const updatedMembers = [...teamState.members];
    updatedMembers[existingIndex] = {
      ...updatedMembers[existingIndex],
      ...member,
      isOnline: true,
      lastSeenAt: now,
    };

    return {
      ...teamState,
      members: updatedMembers,
      lastUpdatedAt: now,
      version: teamState.version + 1,
    };
  }

  // Add new member
  const newMember: TeamMember = {
    ...member,
    joinedAt: now,
    lastSeenAt: now,
  };

  return {
    ...teamState,
    members: [...teamState.members, newMember],
    memberScores: {
      ...teamState.memberScores,
      [member.playerId]: member.score,
    },
    lastUpdatedAt: now,
    version: teamState.version + 1,
  };
}

/**
 * Update team state when a member completes an object
 *
 * Recalculates team score and narrative votes.
 */
export function updateTeamOnObjectComplete(
  teamState: TeamState,
  playerId: string,
  objectId: string,
  points: number,
  newPlayerScore: number,
  highestCompletedNumber: number,
  totalPossiblePoints: number
): TeamState {
  const now = new Date().toISOString();

  // Update member scores
  const updatedMemberScores = {
    ...teamState.memberScores,
    [playerId]: newPlayerScore,
  };

  // Calculate new team score
  const newTeamScore = Object.values(updatedMemberScores).reduce((sum, s) => sum + s, 0);

  // Update objects completed by team (if not already)
  const objectsCompletedByTeam = teamState.objectsCompletedByTeam.includes(objectId)
    ? teamState.objectsCompletedByTeam
    : [...teamState.objectsCompletedByTeam, objectId];

  // Update team's highest completed number
  const teamHighestCompletedNumber = Math.max(
    teamState.teamHighestCompletedNumber,
    highestCompletedNumber
  );

  // Update member in members array
  const updatedMembers = teamState.members.map(m =>
    m.playerId === playerId
      ? { ...m, score: newPlayerScore, highestCompletedNumber, lastSeenAt: now }
      : m
  );

  // Calculate narrative votes (votesFor based on team progress)
  // This can be customized based on game design
  const votesFor = newTeamScore;
  const votesAgainst = Math.max(0, totalPossiblePoints - votesFor);

  return {
    ...teamState,
    members: updatedMembers,
    objectsCompletedByTeam,
    teamHighestCompletedNumber,
    teamScore: newTeamScore,
    memberScores: updatedMemberScores,
    votesFor,
    votesAgainst,
    lastUpdatedAt: now,
    version: teamState.version + 1,
  };
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get all visible objects from player state
 *
 * @param state - Current player state
 * @param allObjects - All quest objects
 * @returns Array of visible quest objects with their state
 */
export function getVisibleObjects(
  state: PlayerState,
  allObjects: QuestObject[]
): Array<QuestObject & { state: PlayerObjectState }> {
  return allObjects
    .filter(obj => state.objects[obj.id]?.visible)
    .map(obj => ({
      ...obj,
      state: state.objects[obj.id],
    }));
}

/**
 * Get the current object (next to complete)
 */
export function getCurrentObject(
  state: PlayerState,
  allObjects: QuestObject[]
): QuestObject | null {
  if (!state.currentObjectId) return null;
  return allObjects.find(o => o.id === state.currentObjectId) ?? null;
}

/**
 * Get the previous object (just completed)
 */
export function getPreviousObject(
  state: PlayerState,
  allObjects: QuestObject[]
): QuestObject | null {
  if (!state.previousObjectId) return null;
  return allObjects.find(o => o.id === state.previousObjectId) ?? null;
}

/**
 * Calculate progress percentage
 */
export function getProgressPercentage(state: PlayerState): number {
  const completed = Object.values(state.objects).filter(
    o => o.status === 'completed'
  ).length;
  const total = Object.keys(state.objects).length;

  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

/**
 * Check if player is within an object's geofence
 *
 * @param playerPosition - Player's current position
 * @param object - Quest object to check
 * @returns true if player is within geofence radius
 */
export function isWithinGeofence(
  playerPosition: { lat: number; lng: number },
  object: QuestObject
): boolean {
  const coords = normalizeCoordinates(object.coordinates);
  const radius = getTriggerRadius(object);

  const distance = calculateDistance(
    playerPosition.lat,
    playerPosition.lng,
    coords.lat,
    coords.lng
  );

  return distance <= radius;
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 *
 * @returns Distance in meters
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Check if quest is complete
 */
export function isQuestComplete(state: PlayerState): boolean {
  return state.completedAt !== null;
}

/**
 * Get remaining time in milliseconds (for 2-hour quest limit)
 */
export function getRemainingTime(
  state: PlayerState,
  questDurationMs: number = 2 * 60 * 60 * 1000 // 2 hours default
): number {
  const startTime = new Date(state.startedAt).getTime();
  const endTime = startTime + questDurationMs;
  const now = Date.now();

  return Math.max(0, endTime - now);
}

// ============================================
// SERIALIZATION (for API/Database)
// ============================================

/**
 * Serialize player state for storage (DynamoDB)
 */
export function serializePlayerState(state: PlayerState): Record<string, unknown> {
  return {
    ...state,
    objects: JSON.stringify(state.objects),
    position: state.position ? JSON.stringify(state.position) : null,
  };
}

/**
 * Deserialize player state from storage
 */
export function deserializePlayerState(record: Record<string, unknown>): PlayerState {
  return {
    ...record,
    stateVersion: (record.stateVersion as number) ?? 1,
    objects: typeof record.objects === 'string'
      ? JSON.parse(record.objects)
      : record.objects,
    position: typeof record.position === 'string'
      ? JSON.parse(record.position)
      : record.position,
  } as PlayerState;
}

/**
 * Serialize team state for storage
 */
export function serializeTeamState(state: TeamState): Record<string, unknown> {
  return {
    ...state,
    members: JSON.stringify(state.members),
    objectsCompletedByTeam: JSON.stringify(state.objectsCompletedByTeam),
    memberScores: JSON.stringify(state.memberScores),
  };
}

/**
 * Deserialize team state from storage
 */
export function deserializeTeamState(record: Record<string, unknown>): TeamState {
  return {
    ...record,
    members: typeof record.members === 'string'
      ? JSON.parse(record.members)
      : record.members,
    objectsCompletedByTeam: typeof record.objectsCompletedByTeam === 'string'
      ? JSON.parse(record.objectsCompletedByTeam)
      : record.objectsCompletedByTeam,
    memberScores: typeof record.memberScores === 'string'
      ? JSON.parse(record.memberScores)
      : record.memberScores,
  } as TeamState;
}

// ============================================
// MIGRATION HELPERS
// ============================================

/**
 * Check if a state record is the old QuestSessionState format
 */
export function isLegacyState(record: Record<string, unknown>): boolean {
  return !record.stateVersion || (record.stateVersion as number) < STATE_VERSION;
}

/**
 * Migrate legacy QuestSessionState to new PlayerState format
 *
 * @param legacyState - Old session state
 * @param questObjects - Quest objects (needed to build object states)
 * @param playerId - Player ID for new state
 * @param playerName - Player name for new state
 * @returns New PlayerState with all objects visible (opt-out of sliding window during migration)
 */
export function migrateLegacyState(
  legacyState: any,
  questObjects: QuestObject[],
  playerId: string,
  playerName: string
): PlayerState {
  const now = new Date().toISOString();
  const sorted = [...questObjects].sort((a, b) => getObjectNumber(a) - getObjectNumber(b));

  // Build object states based on completedObjects
  const objects: Record<string, PlayerObjectState> = {};
  const completedSet = new Set(legacyState.completedObjects || []);
  const completedPuzzlesSet = new Set(legacyState.completedPuzzles || []);

  let highestCompleted = 0;
  let currentObjectId: string | null = null;
  let previousObjectId: string | null = null;

  for (const obj of sorted) {
    const isCompleted = completedSet.has(obj.id);
    const puzzleIds = getPuzzleIds(obj);
    const puzzlesCompleted = puzzleIds.filter(pid => completedPuzzlesSet.has(pid));
    const objNumber = getObjectNumber(obj);
    const objPoints = getObjectPoints(obj);

    objects[obj.id] = {
      objectId: obj.id,
      objectNumber: objNumber,
      visible: true, // Make all objects visible during migration (opt-out of sliding window)
      status: isCompleted ? 'completed' : puzzlesCompleted.length > 0 ? 'in_progress' : 'available',
      puzzlesCompleted,
      puzzlesTotal: puzzleIds.length || 0,
      pointsEarned: isCompleted ? objPoints : 0,
      unlockedAt: now,
      arrivedAt: isCompleted || puzzlesCompleted.length > 0 ? now : null,
      startedAt: puzzlesCompleted.length > 0 ? now : null,
      completedAt: isCompleted ? now : null,
    };

    if (isCompleted) {
      highestCompleted = Math.max(highestCompleted, objNumber);
      previousObjectId = obj.id;
    } else if (!currentObjectId) {
      currentObjectId = obj.id;
    }
  }

  return {
    stateVersion: STATE_VERSION,
    playerId,
    sessionId: legacyState.sessionId,
    questId: legacyState.questId,
    teamCode: legacyState.teamCode || null,
    playerName,
    objects,
    currentObjectId,
    previousObjectId,
    highestCompletedNumber: highestCompleted,
    position: null, // Legacy state didn't track position
    score: legacyState.score || 0,
    startedAt: legacyState.startedAt || now,
    lastActivityAt: legacyState.lastUpdatedAt || now,
    completedAt: legacyState.completedAt || null,
    version: legacyState.version || 1,
  };
}
