import type { QuestSessionState } from '@/types/quest';

/**
 * Quest database operations
 *
 * NOTE: This is a placeholder implementation using in-memory storage.
 * In production, replace with DynamoDB client:
 *
 * import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
 * import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
 *
 * const client = new DynamoDBClient({ region: "us-east-1" });
 * const docClient = DynamoDBDocumentClient.from(client);
 */

// Team-related types
export interface TeamMember {
    sessionId: string;
    playerName: string;
    joinedAt: string;
}

export interface Team {
    teamCode: string;
    leaderSessionId: string;
    leaderName: string;
    members: TeamMember[];
    createdAt: string;
}

// In-memory storage (replace with DynamoDB in production)
const sessionStore = new Map<string, QuestSessionState>();
const teamStore = new Map<string, Team>();

/**
 * Get quest session by sessionId
 */
export async function getQuestSession(sessionId: string): Promise<QuestSessionState | null> {
    // TODO: Replace with DynamoDB GetCommand
    // const response = await docClient.send(new GetCommand({
    //     TableName: "quest-sessions-dev",
    //     Key: { sessionId }
    // }));
    // return response.Item as QuestSessionState | null;

    return sessionStore.get(sessionId) || null;
}

/**
 * Create new quest session
 */
export async function createQuestSession(
    sessionId: string,
    questId: string,
    teamCode?: string
): Promise<QuestSessionState> {
    const now = new Date().toISOString();
    const session: QuestSessionState = {
        sessionId,
        questId,
        teamCode,
        startedAt: now,
        score: 0,
        completedObjects: [],
        completedPuzzles: [],
        documentFragments: 0,
        villagersConverted: 0,
        lastUpdatedAt: now,
        version: 1
    };

    // TODO: Replace with DynamoDB PutCommand
    // await docClient.send(new PutCommand({
    //     TableName: "quest-sessions-dev",
    //     Item: session,
    //     ConditionExpression: "attribute_not_exists(sessionId)" // Prevent overwrites
    // }));

    sessionStore.set(sessionId, session);
    return session;
}

/**
 * Update quest session with optimistic locking
 */
export async function updateQuestSession(
    sessionId: string,
    updates: Partial<QuestSessionState>,
    expectedVersion: number
): Promise<QuestSessionState | null> {
    const session = await getQuestSession(sessionId);

    if (!session) {
        throw new Error('Session not found');
    }

    if (session.version !== expectedVersion) {
        throw new Error('Version conflict - session was modified');
    }

    const updatedSession: QuestSessionState = {
        ...session,
        ...updates,
        lastUpdatedAt: new Date().toISOString(),
        version: session.version + 1
    };

    // TODO: Replace with DynamoDB UpdateCommand with ConditionExpression
    // await docClient.send(new UpdateCommand({
    //     TableName: "quest-sessions-dev",
    //     Key: { sessionId },
    //     UpdateExpression: "SET #score = :score, #completedObjects = :completedObjects, ...",
    //     ConditionExpression: "#version = :expectedVersion",
    //     ExpressionAttributeNames: {
    //         "#score": "score",
    //         "#version": "version",
    //         // ... other fields
    //     },
    //     ExpressionAttributeValues: {
    //         ":score": updatedSession.score,
    //         ":expectedVersion": expectedVersion,
    //         // ... other values
    //     }
    // }));

    sessionStore.set(sessionId, updatedSession);
    return updatedSession;
}

/**
 * Complete an object (add to completedObjects, update score)
 */
export async function completeObject(
    sessionId: string,
    objectId: string,
    points: number = 0
): Promise<QuestSessionState | null> {
    const session = await getQuestSession(sessionId);

    if (!session) {
        throw new Error('Session not found');
    }

    // Check if already completed (idempotency)
    if (session.completedObjects.includes(objectId)) {
        return session; // Already completed, return current state
    }

    const updatedSession = await updateQuestSession(
        sessionId,
        {
            completedObjects: [...session.completedObjects, objectId],
            score: session.score + points
        },
        session.version
    );

    return updatedSession;
}

/**
 * Complete a puzzle (add to completedPuzzles, update score)
 */
export async function completePuzzle(
    sessionId: string,
    puzzleId: string,
    points: number = 0
): Promise<QuestSessionState | null> {
    const session = await getQuestSession(sessionId);

    if (!session) {
        throw new Error('Session not found');
    }

    // Check if already completed (idempotency)
    if (session.completedPuzzles.includes(puzzleId)) {
        return session;
    }

    const updatedSession = await updateQuestSession(
        sessionId,
        {
            completedPuzzles: [...session.completedPuzzles, puzzleId],
            score: session.score + points
        },
        session.version
    );

    return updatedSession;
}

/**
 * Collect document fragment
 */
export async function collectDocument(sessionId: string): Promise<QuestSessionState | null> {
    const session = await getQuestSession(sessionId);

    if (!session) {
        throw new Error('Session not found');
    }

    const updatedSession = await updateQuestSession(
        sessionId,
        {
            documentFragments: session.documentFragments + 1
        },
        session.version
    );

    return updatedSession;
}

/**
 * Convert villager
 */
export async function convertVillager(sessionId: string): Promise<QuestSessionState | null> {
    const session = await getQuestSession(sessionId);

    if (!session) {
        throw new Error('Session not found');
    }

    const updatedSession = await updateQuestSession(
        sessionId,
        {
            villagersConverted: session.villagersConverted + 1
        },
        session.version
    );

    return updatedSession;
}

/**
 * Generate a unique team code (6 characters, alphanumeric)
 */
function generateTeamCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude similar-looking characters
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * Create a new team
 */
export async function createTeam(leaderName: string): Promise<Team> {
    // Generate unique team code
    let teamCode = generateTeamCode();
    while (teamStore.has(teamCode)) {
        teamCode = generateTeamCode();
    }

    const now = new Date().toISOString();
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const team: Team = {
        teamCode,
        leaderSessionId: sessionId,
        leaderName,
        members: [
            {
                sessionId,
                playerName: leaderName,
                joinedAt: now
            }
        ],
        createdAt: now
    };

    // TODO: Replace with DynamoDB PutCommand
    teamStore.set(teamCode, team);

    // Initialize PlayerState for the leader
    const questObjects = getQuestObjects();
    const playerState = initializePlayerState(
        questObjects,
        sessionId,
        sessionId, // Use sessionId as playerId for simple setup
        leaderName,
        teamCode
    );
    playerState.questId = "sample-quest"; // Default quest ID
    await createPlayerState(playerState);

    // Initialize TeamState (v2)
    // Calculate total points
    const totalPoints = questObjects.reduce((sum, obj) => sum + (obj.points || 0), 0);
    const teamState = initializeTeamState(teamCode, "sample-quest", totalPoints);
    await createTeamStateV2(teamState);

    // Add leader to TeamState
    await updateTeamStateV2(teamCode, addTeamMember(teamState, {
        playerId: sessionId,
        playerName: leaderName,
        isOnline: true,
        score: 0,
        highestCompletedNumber: 0
    }));

    return team;
}

/**
 * Get team by team code
 */
export async function getTeam(teamCode: string): Promise<Team | null> {
    // TODO: Replace with DynamoDB GetCommand
    return teamStore.get(teamCode) || null;
}

/**
 * Join an existing team
 */
export async function joinTeam(teamCode: string, playerName: string): Promise<{ team: Team; sessionId: string }> {
    const team = await getTeam(teamCode);

    if (!team) {
        throw new Error('Team not found');
    }

    const now = new Date().toISOString();
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const newMember: TeamMember = {
        sessionId,
        playerName,
        joinedAt: now
    };

    team.members.push(newMember);

    // TODO: Replace with DynamoDB UpdateCommand
    teamStore.set(teamCode, team);

    // Initialize PlayerState for new member
    const playerState = initializePlayerState(
        getQuestObjects(),
        sessionId,
        sessionId, // Use sessionId as playerId
        playerName,
        teamCode
    );
    playerState.questId = "sample-quest";
    await createPlayerState(playerState);

    // Update TeamState (v2)
    const teamState = await getTeamStateV2(teamCode);
    if (teamState) {
        // Add member to TeamState
        await updateTeamStateV2(teamCode, addTeamMember(teamState, {
            playerId: sessionId,
            playerName: playerName,
            isOnline: true,
            score: 0,
            highestCompletedNumber: 0
        }));
    }

    return { team, sessionId };
}

// ============================================
// NEW STATE MANAGEMENT (v2.0)
// ============================================

import type { PlayerState, TeamState as TeamStateV2 } from '@/types/quest';
import {
    initializePlayerState,
    initializeTeamState,
    arriveAtObject as arriveAtObjectFn,
    completePuzzle as completePuzzleFn,
    completeObject as completeObjectFn,
    updatePosition as updatePositionFn,
    // isLegacyState,
    migrateLegacyState,
    // serializePlayerState,
    // deserializePlayerState,
    // serializeTeamState as serializeTeamStateV2,
    // deserializeTeamState as deserializeTeamStateV2,
    addTeamMember
} from '@/lib/quest-state';
import type { QuestObject } from '@/types/quest';

// Helper to safely get quest objects
function getQuestObjects(): QuestObject[] {
    try {
        // Use require for better Edge compatibility (avoid top-level JSON import if possible)
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const data = require('@/data/quest.json');
        return (data.objects || []) as unknown as QuestObject[];
    } catch {
        return [];
    }
}

// In-memory storage for new state (replace with DynamoDB in production)
const playerStateStore = new Map<string, PlayerState>();
const teamStateV2Store = new Map<string, TeamStateV2>();

/**
 * Get player state by playerId (v2.0)
 * Auto-migrates from legacy QuestSessionState if needed
 */
export async function getPlayerState(playerId: string): Promise<PlayerState | null> {
    // Try new state store first
    const state = playerStateStore.get(playerId);
    if (state) return state;

    // Check if there's a legacy session to migrate
    // In production, this would query DynamoDB with GSI on playerId
    for (const [sessionId, legacySession] of sessionStore.entries()) {
        // Simple heuristic: playerId might be embedded in sessionId or matched separately
        // In production, you'd have a proper playerId field
        if (sessionId.includes(playerId) || (legacySession as any).playerId === playerId) {
            // Auto-migrate
            console.log(`Migrating legacy session ${sessionId} to PlayerState for ${playerId}`);

            const playerName = (legacySession as any).playerName || 'Player';

            const migratedState = migrateLegacyState(
                legacySession,
                getQuestObjects(),
                playerId,
                playerName
            );

            playerStateStore.set(playerId, migratedState);
            return migratedState;
        }
    }

    return null;
}

/**
 * Create new player state (v2.0)
 */
export async function createPlayerState(
    state: PlayerState
): Promise<PlayerState> {
    // TODO: Replace with DynamoDB PutCommand
    playerStateStore.set(state.playerId, state);
    return state;
}

/**
 * Update player state with optimistic locking (v2.0)
 */
export async function updatePlayerState(
    playerId: string,
    updates: Partial<PlayerState>,
    expectedVersion: number
): Promise<PlayerState | null> {
    const state = await getPlayerState(playerId);

    if (!state) {
        throw new Error('Player state not found');
    }

    if (state.version !== expectedVersion) {
        throw new Error('Version conflict - state was modified');
    }

    const updatedState: PlayerState = {
        ...state,
        ...updates,
        lastActivityAt: new Date().toISOString(),
        version: state.version + 1,
    };

    // TODO: Replace with DynamoDB UpdateCommand with ConditionExpression
    playerStateStore.set(playerId, updatedState);
    return updatedState;
}

/**
 * Handle player arrival at an object (v2.0)
 */
export async function handleArrival(
    playerId: string,
    objectId: string
): Promise<PlayerState> {
    const state = await getPlayerState(playerId);
    if (!state) {
        throw new Error('Player state not found');
    }

    const updatedState = arriveAtObjectFn(state, objectId);

    // Persist
    playerStateStore.set(playerId, updatedState);
    return updatedState;
}

/**
 * Handle puzzle completion (v2.0)
 * May trigger object completion if all puzzles done
 */
export async function handlePuzzleComplete(
    playerId: string,
    objectId: string,
    puzzleId: string,
    allObjects: QuestObject[]
): Promise<PlayerState> {
    const state = await getPlayerState(playerId);
    if (!state) {
        throw new Error('Player state not found');
    }

    const updatedState = completePuzzleFn(state, objectId, puzzleId, allObjects);

    // Persist
    playerStateStore.set(playerId, updatedState);
    return updatedState;
}

/**
 * Handle object completion (v2.0)
 * Implements sliding window visibility
 */
export async function handleObjectComplete(
    playerId: string,
    objectId: string,
    allObjects: QuestObject[]
): Promise<PlayerState> {
    const state = await getPlayerState(playerId);
    if (!state) {
        throw new Error('Player state not found');
    }

    const updatedState = completeObjectFn(state, objectId, allObjects);

    // Persist
    playerStateStore.set(playerId, updatedState);
    return updatedState;
}

/**
 * Update player GPS position (v2.0)
 */
export async function handlePositionUpdate(
    playerId: string,
    position: GeolocationPosition
): Promise<PlayerState> {
    const state = await getPlayerState(playerId);
    if (!state) {
        throw new Error('Player state not found');
    }

    const updatedState = updatePositionFn(state, position);

    // Persist
    playerStateStore.set(playerId, updatedState);
    return updatedState;
}

/**
 * Get team state (v2.0)
 */
export async function getTeamStateV2(teamCode: string): Promise<TeamStateV2 | null> {
    // TODO: Replace with DynamoDB GetCommand
    return teamStateV2Store.get(teamCode) || null;
}

/**
 * Create team state (v2.0)
 */
export async function createTeamStateV2(state: TeamStateV2): Promise<TeamStateV2> {
    // TODO: Replace with DynamoDB PutCommand
    teamStateV2Store.set(state.teamCode, state);
    return state;
}

/**
 * Update team state (v2.0)
 */
export async function updateTeamStateV2(
    teamCode: string,
    updates: Partial<TeamStateV2>
): Promise<TeamStateV2 | null> {
    const state = await getTeamStateV2(teamCode);
    if (!state) {
        throw new Error('Team state not found');
    }

    const updatedState: TeamStateV2 = {
        ...state,
        ...updates,
        lastUpdatedAt: new Date().toISOString(),
        version: state.version + 1,
    };

    // TODO: Replace with DynamoDB UpdateCommand
    teamStateV2Store.set(teamCode, updatedState);
    return updatedState;
}
