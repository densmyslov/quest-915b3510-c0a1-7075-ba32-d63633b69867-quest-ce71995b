import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';
import { proxyToAwsRuntime } from '@/runtime-core/awsRuntimeProxy';
import type { CompleteObjectResponse, QuestSessionState, RuntimeSnapshot } from '@/types/quest';

interface CompletePuzzleRequest {
    sessionId: string;
    objectId?: string;
    puzzleId: string;
    timestamp: string;
    points?: number;
}

function mapSnapshotToSession(snapshot: RuntimeSnapshot): QuestSessionState {
    const completedObjects = Object.values(snapshot.objects)
        .filter(o => o.completedAt)
        .map(o => o.objectId);

    const completedPuzzles = Object.values(snapshot.nodes)
        .filter(n => n.nodeId.startsWith('puzzle') && n.status === 'completed')
        .map(n => n.nodeId);

    return {
        sessionId: snapshot.sessionId,
        questId: snapshot.questId,
        teamCode: undefined,
        startedAt: snapshot.serverTime,
        completedAt: undefined,
        score: snapshot.me.score,
        completedObjects,
        completedPuzzles,
        documentFragments: 0,
        villagersConverted: 0,
        lastUpdatedAt: snapshot.serverTime,
        version: snapshot.version
    };
}

export async function POST(request: NextRequest) {
    try {
        const body: CompletePuzzleRequest = await request.json();
        const { sessionId, objectId, puzzleId, timestamp, points = 0 } = body;

        // Validate required fields
        if (!sessionId || !puzzleId) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields' },
                { status: 400 }
            );
        }

        const playerId = sessionId;

        // Proxy to AWS Runtime API: POST /runtime/puzzle/submit
        const response = await proxyToAwsRuntime('/runtime/puzzle/submit', 'POST', {
            sessionId,
            playerId,
            puzzleId,
            objectId: objectId || undefined,
            points,
            outcome: 'success', // Legacy complete-puzzle implies success
            eventId: `LegacyPuzzle:${sessionId}:${puzzleId}:${Date.now()}`,
            dedupeKey: `puzzle:${sessionId}:${puzzleId}:${timestamp}`
        });

        const data = await response.json() as { success: boolean; snapshot?: RuntimeSnapshot; error?: string };

        if (!response.ok || !data.success) {
            return NextResponse.json(
                { success: false, error: data.error || 'Failed to submit puzzle' },
                { status: response.ok ? 500 : response.status }
            );
        }

        if (!data.snapshot) {
            return NextResponse.json(
                { success: false, error: 'No snapshot returned' },
                { status: 500 }
            );
        }

        const session = mapSnapshotToSession(data.snapshot);

        console.log('[API /api/quest/complete-puzzle] ✅ Puzzle completed (AWS)', { sessionId, puzzleId });

        return NextResponse.json({ success: true, session } as CompleteObjectResponse);

    } catch (error) {
        console.error('[API /api/quest/complete-puzzle] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error'
            } as CompleteObjectResponse,
            { status: 500 }
        );
    }
}
