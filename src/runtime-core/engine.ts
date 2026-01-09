import type { CompiledQuestDefinition, NodeId, ObjectId, TimelineNode } from './compiledQuest';
import type {
  RuntimeDelta,
  RuntimeNodeOutcome,
  RuntimeNodeState,
  RuntimeObjectState,
  RuntimePlayer,
  RuntimeSessionState,
  RuntimeSnapshot,
} from './runtimeState';

type BaseEvent = {
  eventId: string;
  dedupeKey: string;
  tsClient?: string;
};

export type StartOrJoinEvent = BaseEvent & {
  type: 'SESSION_START_OR_JOIN';
  sessionId: string;
  playerId: string;
  playerName: string;
  questId: string;
  questVersion: string;
};

export type ObjectArriveEvent = BaseEvent & {
  type: 'OBJECT_ARRIVE';
  playerId: string;
  objectId: ObjectId;
};

export type NodeCompleteEvent = BaseEvent & {
  type: 'NODE_COMPLETE';
  playerId: string;
  nodeId: NodeId;
};

export type PuzzleSubmitEvent = BaseEvent & {
  type: 'PUZZLE_SUBMIT';
  playerId: string;
  nodeId: NodeId;
  outcome: RuntimeNodeOutcome;
  points?: number;
  attemptGroupId?: string | null;
};

export type ActionSubmitEvent = BaseEvent & {
  type: 'ACTION_SUBMIT';
  playerId: string;
  nodeId: NodeId;
  outcome: RuntimeNodeOutcome;
  attemptId: string;
  attemptGroupId: string | null;
  verificationDetails?: Record<string, unknown>;
};

export type RuntimeEvent =
  | StartOrJoinEvent
  | ObjectArriveEvent
  | NodeCompleteEvent
  | PuzzleSubmitEvent
  | ActionSubmitEvent;

export type ApplyResult = {
  session: RuntimeSessionState;
  deltas: RuntimeDelta[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function ensurePlayer(session: RuntimeSessionState, playerId: string, playerName: string, deltas: RuntimeDelta[]) {
  const existing = session.players[playerId];
  if (existing) return;
  session.players[playerId] = {
    playerId,
    playerName,
    joinedAt: session.createdAt,
    status: 'active',
    currentObjectId: null,
    score: 0,
  };
  session.objectsByPlayer[playerId] = session.objectsByPlayer[playerId] ?? {};
  session.nodesByPlayer[playerId] = session.nodesByPlayer[playerId] ?? {};
  deltas.push({ type: 'PLAYER_JOINED', playerId });
}

function getObjectState(session: RuntimeSessionState, playerId: string, objectId: ObjectId): RuntimeObjectState {
  const byPlayer = session.objectsByPlayer[playerId] ?? (session.objectsByPlayer[playerId] = {});
  const existing = byPlayer[objectId];
  if (existing) return existing;
  const created: RuntimeObjectState = { objectId, arrivedAt: null, completedAt: null };
  byPlayer[objectId] = created;
  return created;
}

function getNodeState(session: RuntimeSessionState, playerId: string, nodeId: NodeId): RuntimeNodeState {
  const byPlayer = session.nodesByPlayer[playerId] ?? (session.nodesByPlayer[playerId] = {});
  const existing = byPlayer[nodeId];
  if (existing) return existing;
  const created: RuntimeNodeState = {
    nodeId,
    status: 'locked',
    completedAt: null,
    outcome: null,
    attemptGroupId: null,
  };
  byPlayer[nodeId] = created;
  return created;
}

function tryRecordIdempotency(session: RuntimeSessionState, event: BaseEvent): boolean {
  if (session.processedEventIds.has(event.eventId)) return false;
  if (session.processedDedupeKeys.has(event.dedupeKey)) return false;
  session.processedEventIds.add(event.eventId);
  session.processedDedupeKeys.add(event.dedupeKey);
  return true;
}

function unlockNode(session: RuntimeSessionState, playerId: string, nodeId: NodeId, deltas: RuntimeDelta[]) {
  const state = getNodeState(session, playerId, nodeId);
  if (state.status === 'locked') {
    state.status = 'unlocked';
    deltas.push({ type: 'NODE_UNLOCKED', playerId, nodeId });
  }
}

function completeNode(
  session: RuntimeSessionState,
  playerId: string,
  nodeId: NodeId,
  deltas: RuntimeDelta[],
  params?: { outcome?: RuntimeNodeOutcome | null; attemptGroupId?: string | null }
) {
  const state = getNodeState(session, playerId, nodeId);
  if (state.status === 'completed') return;
  state.status = 'completed';
  state.completedAt = nowIso();
  if (params?.outcome !== undefined) state.outcome = params.outcome ?? null;
  if (params?.attemptGroupId !== undefined) state.attemptGroupId = params.attemptGroupId ?? null;
  deltas.push({ type: 'NODE_COMPLETED', playerId, nodeId, outcome: state.outcome });
}

function computeAvailableObjectIds(def: CompiledQuestDefinition, completed: Set<ObjectId>): Set<ObjectId> {
  const available = new Set<ObjectId>();
  available.add(def.start.objectId);
  for (const objectId of completed) {
    const out = def.objects[objectId]?.outObjectIds ?? [];
    for (const nextId of out) available.add(nextId);
  }
  return available;
}

function computeCurrentObjectId(def: CompiledQuestDefinition, available: Set<ObjectId>, completed: Set<ObjectId>): ObjectId | null {
  const order = computeObjectOrder(def);
  for (const objectId of order) {
    if (!available.has(objectId)) continue;
    if (completed.has(objectId)) continue;
    return objectId;
  }
  // fallback: any available incomplete
  for (const objectId of available) {
    if (!completed.has(objectId)) return objectId;
  }
  return null;
}

function computePreviousCompletedObjectId(session: RuntimeSessionState, playerId: string): ObjectId | null {
  const states = session.objectsByPlayer[playerId] ?? {};
  let best: { objectId: ObjectId; completedAt: string } | null = null;
  for (const [objectId, st] of Object.entries(states) as Array<[ObjectId, RuntimeObjectState]>) {
    if (!st.completedAt) continue;
    if (!best || st.completedAt > best.completedAt) best = { objectId, completedAt: st.completedAt };
  }
  return best?.objectId ?? null;
}

export function computeVisibleObjectIds(def: CompiledQuestDefinition, session: RuntimeSessionState, playerId: string): ObjectId[] {
  const completed = getCompletedObjects(session, playerId);
  const available = computeAvailableObjectIds(def, completed);
  const current = computeCurrentObjectId(def, available, completed);
  const previous = def.policies.objectVisibility.includeCompletedInWindow
    ? computePreviousCompletedObjectId(session, playerId)
    : null;

  const visible: ObjectId[] = [];
  if (previous && previous !== current) visible.push(previous);
  if (current) visible.push(current);

  // Fill remaining window with other AVAILABLE objects (use deterministic order).
  const windowSize = Math.max(1, def.policies.objectVisibility.windowSize);
  if (visible.length < windowSize) {
    const order = computeObjectOrder(def);
    for (const objectId of order) {
      if (visible.length >= windowSize) break;
      if (!available.has(objectId)) continue;
      if (visible.includes(objectId)) continue;
      // Only show additional *available* objects; hide future locked.
      visible.push(objectId);
    }
  }

  return visible.slice(0, windowSize);
}

function computeObjectOrder(def: CompiledQuestDefinition): ObjectId[] {
  // Deterministic BFS from start using outObjectIds ordering from compiled definition.
  const out: ObjectId[] = [];
  const visited = new Set<ObjectId>();
  const queue: ObjectId[] = [def.start.objectId];
  while (queue.length) {
    const objectId = queue.shift()!;
    if (visited.has(objectId)) continue;
    visited.add(objectId);
    out.push(objectId);
    const edges = def.objects[objectId]?.outObjectIds ?? [];
    for (const next of edges) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  // Include any disconnected objects deterministically.
  const remaining = Object.keys(def.objects).filter((id) => !visited.has(id));
  remaining.sort();
  out.push(...(remaining as ObjectId[]));
  return out;
}

function getCompletedObjects(session: RuntimeSessionState, playerId: string): Set<ObjectId> {
  const states = session.objectsByPlayer[playerId] ?? {};
  const completed = new Set<ObjectId>();
  for (const [objectId, st] of Object.entries(states) as Array<[ObjectId, RuntimeObjectState]>) {
    if (st.completedAt) completed.add(objectId);
  }
  return completed;
}

function getArrivedObjects(session: RuntimeSessionState, playerId: string): Set<ObjectId> {
  const states = session.objectsByPlayer[playerId] ?? {};
  const arrived = new Set<ObjectId>();
  for (const [objectId, st] of Object.entries(states) as Array<[ObjectId, RuntimeObjectState]>) {
    if (st.arrivedAt) arrived.add(objectId);
  }
  return arrived;
}

function isStateNode(node: TimelineNode): node is TimelineNode & { type: 'state'; stateKind: 'start' | 'end' } {
  return node.type === 'state';
}

function autoAdvanceStateNodes(params: {
  def: CompiledQuestDefinition;
  session: RuntimeSessionState;
  playerIds: string[];
  startingNodeIds: NodeId[];
  deltas: RuntimeDelta[];
}) {
  const { def, session, playerIds, startingNodeIds, deltas } = params;
  const queue = [...startingNodeIds];
  const seen = new Set<string>();

  while (queue.length) {
    const nodeId = queue.shift()!;
    for (const playerId of playerIds) {
      const dedupe = `${playerId}:${nodeId}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const node = def.timelineNodes[nodeId];
      if (!node) continue;
      if (!isStateNode(node)) continue;

      const state = getNodeState(session, playerId, nodeId);
      if (state.status === 'locked') continue;
      if (state.status !== 'completed') {
        completeNode(session, playerId, nodeId, deltas, { outcome: null });

        if (node.stateKind === 'end') {
          const objState = getObjectState(session, playerId, node.objectId);
          if (!objState.completedAt) {
            objState.completedAt = nowIso();
            deltas.push({ type: 'OBJECT_COMPLETED', playerId, objectId: node.objectId });
          }
        }
      }

      // Unlock outgoing (linear only for state nodes in schema).
      for (const outId of node.outNodeIds) {
        unlockNode(session, playerId, outId, deltas);
        queue.push(outId);
      }
    }
  }
}

function evaluateAllPlayersSuccess(params: {
  session: RuntimeSessionState;
  playerIds: string[];
  nodeId: NodeId;
  requireSameAttempt: boolean;
}): boolean {
  const { session, playerIds, nodeId, requireSameAttempt } = params;
  let attemptGroup: string | null = null;

  for (const playerId of playerIds) {
    const st = getNodeState(session, playerId, nodeId);
    if (st.status !== 'completed') return false;
    if (st.outcome !== 'success') return false;
    if (requireSameAttempt) {
      if (!st.attemptGroupId) return false;
      if (!attemptGroup) attemptGroup = st.attemptGroupId;
      else if (attemptGroup !== st.attemptGroupId) return false;
    }
  }
  return true;
}

function activePlayerIds(session: RuntimeSessionState, explicit?: string[]): string[] {
  const ids = explicit?.length ? explicit : Object.keys(session.players);
  return ids.filter((id) => session.players[id]?.status === 'active');
}

function unlockOutgoingForOutcome(params: {
  def: CompiledQuestDefinition;
  session: RuntimeSessionState;
  playerId: string;
  node: TimelineNode;
  outcome: RuntimeNodeOutcome | null;
  deltas: RuntimeDelta[];
}) {
  const { def, session, playerId, node, outcome, deltas } = params;
  if (node.type === 'puzzle' || node.type === 'action') {
    const outs = outcome === 'fail' ? node.failureOutNodeIds ?? [] : node.successOutNodeIds;
    for (const outId of outs) unlockNode(session, playerId, outId, deltas);
    autoAdvanceStateNodes({ def, session, playerIds: [playerId], startingNodeIds: outs, deltas });
    return;
  }

  const outs = node.outNodeIds ?? [];
  for (const outId of outs) unlockNode(session, playerId, outId, deltas);
  autoAdvanceStateNodes({ def, session, playerIds: [playerId], startingNodeIds: outs, deltas });
}

export function applyEvent(params: {
  def: CompiledQuestDefinition;
  session: RuntimeSessionState | null;
  event: RuntimeEvent;
}): ApplyResult {
  const { def, event } = params;
  const deltas: RuntimeDelta[] = [];

  if (event.type === 'SESSION_START_OR_JOIN') {
    const now = nowIso();
    const session: RuntimeSessionState =
      params.session ??
      ({
        sessionId: event.sessionId,
        questId: event.questId,
        questVersion: event.questVersion,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        version: 1,
        players: {},
        objectsByPlayer: {},
        nodesByPlayer: {},
        processedDedupeKeys: new Set<string>(),
        processedEventIds: new Set<string>(),
      } satisfies RuntimeSessionState);

    if (!tryRecordIdempotency(session, event)) {
      return { session, deltas };
    }

    ensurePlayer(session, event.playerId, event.playerName, deltas);
    session.updatedAt = nowIso();
    session.version += 1;
    // Ensure start object exists as AVAILABLE reference for this player.
    getObjectState(session, event.playerId, def.start.objectId);
    // Compute current object id for convenience.
    const completed = getCompletedObjects(session, event.playerId);
    const available = computeAvailableObjectIds(def, completed);
    session.players[event.playerId].currentObjectId = computeCurrentObjectId(def, available, completed);

    return { session, deltas };
  }

  if (!params.session) {
    throw new Error('Session is required for this event');
  }

  const session = params.session;
  if (!tryRecordIdempotency(session, event)) {
    return { session, deltas };
  }

  session.updatedAt = nowIso();
  session.version += 1;

  if (event.type === 'OBJECT_ARRIVE') {
    const objectId = event.objectId;
    if (!(objectId in def.objects)) {
      throw new Error(`Unknown objectId: ${objectId}`);
    }

    const objState = getObjectState(session, event.playerId, objectId);
    if (!objState.arrivedAt) {
      objState.arrivedAt = nowIso();
      deltas.push({ type: 'OBJECT_ARRIVED', playerId: event.playerId, objectId });
    }

    const entryNodeId = def.objects[objectId].entryNodeId;
    unlockNode(session, event.playerId, entryNodeId, deltas);
    autoAdvanceStateNodes({ def, session, playerIds: [event.playerId], startingNodeIds: [entryNodeId], deltas });

    const completed = getCompletedObjects(session, event.playerId);
    const available = computeAvailableObjectIds(def, completed);
    session.players[event.playerId].currentObjectId = computeCurrentObjectId(def, available, completed);

    return { session, deltas };
  }

  if (event.type === 'NODE_COMPLETE') {
    const node = def.timelineNodes[event.nodeId];
    if (!node) throw new Error(`Unknown nodeId: ${event.nodeId}`);
    if (node.type === 'puzzle' || node.type === 'action') {
      throw new Error(`Use PUZZLE_SUBMIT/ACTION_SUBMIT for branching node ${event.nodeId}`);
    }

    unlockNode(session, event.playerId, event.nodeId, deltas);
    completeNode(session, event.playerId, event.nodeId, deltas, { outcome: null });
    unlockOutgoingForOutcome({ def, session, playerId: event.playerId, node, outcome: null, deltas });

    return { session, deltas };
  }

  if (event.type === 'PUZZLE_SUBMIT') {
    const node = def.timelineNodes[event.nodeId];
    if (!node) throw new Error(`Unknown nodeId: ${event.nodeId}`);
    if (node.type !== 'puzzle') throw new Error(`Node ${event.nodeId} is not a puzzle node`);

    unlockNode(session, event.playerId, event.nodeId, deltas);

    const prev = getNodeState(session, event.playerId, event.nodeId);
    const wasSuccess = prev.status === 'completed' && prev.outcome === 'success';

    // Allow overwriting fail -> success (retries) but keep completion idempotent via dedupeKey.
    prev.status = 'completed';
    prev.completedAt = nowIso();
    prev.outcome = event.outcome;
    prev.attemptGroupId = event.attemptGroupId ?? null;
    deltas.push({ type: 'NODE_COMPLETED', playerId: event.playerId, nodeId: event.nodeId, outcome: prev.outcome });

    // Score update on first SUCCESS only.
    if (event.outcome === 'success' && !wasSuccess && typeof event.points === 'number' && Number.isFinite(event.points)) {
      const player = session.players[event.playerId] as RuntimePlayer | undefined;
      if (player) {
        player.score += Math.max(0, Math.floor(event.points));
        deltas.push({ type: 'SCORE_UPDATED', playerId: event.playerId, score: player.score });
      }
    }

    const gate = node.gates ?? { type: 'none' as const };
    if (gate.type === 'none') {
      unlockOutgoingForOutcome({ def, session, playerId: event.playerId, node, outcome: event.outcome, deltas });
      return { session, deltas };
    }

    if (gate.type === 'all_players_success' && gate.scope === 'session') {
      const ids = activePlayerIds(session, gate.players);
      const ok = evaluateAllPlayersSuccess({
        session,
        playerIds: ids,
        nodeId: event.nodeId,
        requireSameAttempt: gate.requireSameAttempt === true,
      });
      if (ok) {
        for (const pid of ids) {
          for (const outId of node.successOutNodeIds) unlockNode(session, pid, outId, deltas);
        }
        autoAdvanceStateNodes({ def, session, playerIds: ids, startingNodeIds: node.successOutNodeIds, deltas });
      }
      return { session, deltas };
    }

    // Fallback: treat as per-player gate for now.
    unlockOutgoingForOutcome({ def, session, playerId: event.playerId, node, outcome: event.outcome, deltas });
    return { session, deltas };
  }

  if (event.type === 'ACTION_SUBMIT') {
    const node = def.timelineNodes[event.nodeId];
    if (!node) throw new Error(`Unknown nodeId: ${event.nodeId}`);
    if (node.type !== 'action') throw new Error(`Node ${event.nodeId} is not an action node`);

    unlockNode(session, event.playerId, event.nodeId, deltas);

    const prev = getNodeState(session, event.playerId, event.nodeId);

    // Allow overwriting fail -> success (retries) but keep completion idempotent via dedupeKey.
    prev.status = 'completed';
    prev.completedAt = nowIso();
    prev.outcome = event.outcome;
    prev.attemptGroupId = event.attemptGroupId ?? null;
    deltas.push({ type: 'NODE_COMPLETED', playerId: event.playerId, nodeId: event.nodeId, outcome: prev.outcome });

    // Action nodes don't award points directly (unlike puzzles)
    // But we could extend this in the future

    const gate = node.gates ?? { type: 'none' as const };
    if (gate.type === 'none') {
      unlockOutgoingForOutcome({ def, session, playerId: event.playerId, node, outcome: event.outcome, deltas });
      return { session, deltas };
    }

    if (gate.type === 'all_players_success' && gate.scope === 'session') {
      const ids = activePlayerIds(session, gate.players);
      const ok = evaluateAllPlayersSuccess({
        session,
        playerIds: ids,
        nodeId: event.nodeId,
        requireSameAttempt: gate.requireSameAttempt === true,
      });
      if (ok) {
        for (const pid of ids) {
          for (const outId of node.successOutNodeIds) unlockNode(session, pid, outId, deltas);
        }
        autoAdvanceStateNodes({ def, session, playerIds: ids, startingNodeIds: node.successOutNodeIds, deltas });
      }
      return { session, deltas };
    }

    // Fallback: treat as per-player gate for now.
    unlockOutgoingForOutcome({ def, session, playerId: event.playerId, node, outcome: event.outcome, deltas });
    return { session, deltas };
  }

  return { session, deltas };
}

export function buildSnapshot(params: {
  def: CompiledQuestDefinition;
  session: RuntimeSessionState;
  playerId: string;
}): RuntimeSnapshot {
  const { def, session, playerId } = params;
  const serverTime = nowIso();

  const players: RuntimeSnapshot['players'] = {};
  for (const [id, p] of Object.entries(session.players)) {
    players[id] = {
      playerId: p.playerId,
      playerName: p.playerName,
      status: p.status,
      joinedAt: p.joinedAt,
      currentObjectId: p.currentObjectId,
      score: p.score,
    };
  }

  const completed = getCompletedObjects(session, playerId);
  const arrived = getArrivedObjects(session, playerId);
  const available = computeAvailableObjectIds(def, completed);
  const visibleObjectIds = computeVisibleObjectIds(def, session, playerId);

  const objects: RuntimeSnapshot['objects'] = {};
  for (const objectId of Object.keys(def.objects) as ObjectId[]) {
    const st = session.objectsByPlayer[playerId]?.[objectId] ?? { objectId, arrivedAt: null, completedAt: null };
    const lifecycle = st.completedAt
      ? 'COMPLETED'
      : st.arrivedAt
        ? 'ARRIVED'
        : available.has(objectId)
          ? 'AVAILABLE'
          : 'HIDDEN';
    objects[objectId] = { lifecycle, arrivedAt: st.arrivedAt ?? null, completedAt: st.completedAt ?? null };
  }

  // Nodes: expose states for visible objects only (plus state nodes that might auto-complete).
  const nodes: RuntimeSnapshot['nodes'] = {};
  const visibleSet = new Set<ObjectId>(visibleObjectIds);
  for (const [nodeId, node] of Object.entries(def.timelineNodes) as Array<[NodeId, TimelineNode]>) {
    if (!visibleSet.has(node.objectId)) continue;
    nodes[nodeId] = getNodeState(session, playerId, nodeId);
  }

  return {
    sessionId: session.sessionId,
    questId: session.questId,
    questVersion: session.questVersion,
    status: session.status,
    version: session.version,
    serverTime,
    players,
    me: {
      playerId,
      visibleObjectIds,
      completedObjectIds: [...completed],
      arrivedObjectIds: [...arrived],
    },
    objects,
    nodes,
  };
}

export function findPuzzleNodeId(def: CompiledQuestDefinition, puzzleId: string, objectId?: ObjectId): NodeId | null {
  for (const [nodeId, node] of Object.entries(def.timelineNodes) as Array<[NodeId, TimelineNode]>) {
    if (node.type !== 'puzzle') continue;
    const pid = (node as any).payload?.puzzleId;
    if (pid !== puzzleId) continue;
    if (objectId && node.objectId !== objectId) continue;
    return nodeId;
  }
  return null;
}
