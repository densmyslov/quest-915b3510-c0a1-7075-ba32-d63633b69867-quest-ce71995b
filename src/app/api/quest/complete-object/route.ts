import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';
import { proxyToAwsRuntime } from '@/runtime-core/awsRuntimeProxy';
import { sanitizeIdPart } from '@/runtime-core/compileQuest';
import type { CompleteObjectResponse, QuestSessionState, RuntimeSnapshot } from '@/types/quest';

interface CompleteObjectRequest {
    sessionId: string;
    objectId: string;
    timestamp: string;
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
        const body: CompleteObjectRequest = await request.json();
        const { sessionId, objectId, timestamp } = body;

        console.warn('[DEPRECATED] /api/quest/complete-object called - proxying to AWS Runtime');

        // Validate required fields
        if (!sessionId || !objectId) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields' },
                { status: 400 }
            );
        }

        const playerId = sessionId;
        const endNodeId = `tl_${sanitizeIdPart(objectId)}__end`;

        // Proxy to AWS Runtime API: POST /runtime/node/complete
        // We try to find the standard end node for the object timeline
        const response = await proxyToAwsRuntime('/runtime/node/complete', 'POST', {
            sessionId,
            playerId,
            nodeId: endNodeId,
            eventId: `LegacyForceComplete:${sessionId}:${endNodeId}:${Date.now()}`,
            dedupeKey: `forceCompleteObject:${sessionId}:${objectId}`
        });

        // Use any response from runtime
        const data = await response.json() as { success: boolean; snapshot?: RuntimeSnapshot; error?: string };

        if (!response.ok || !data.success) {
            console.error('[API /api/quest/complete-object] Failed to proxy completion', data.error);
            // Even if failure, we might want to return success to legacy client if it's just a timing issue
            // But let's return error to be safe.
            return NextResponse.json(
                { success: false, error: data.error || 'Failed to complete object' },
                { status: response.ok ? 500 : response.status }
            );
        }

        if (!data.snapshot) {
            return NextResponse.json(
                { success: false, error: 'No snapshot' },
                { status: 500 }
            );
        }

        const session = mapSnapshotToSession(data.snapshot);

        return NextResponse.json({ success: true, session } as CompleteObjectResponse);

    } catch (error) {
        console.error('[API /complete-object] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error'
            } as CompleteObjectResponse,
            { status: 500 }
        );
    }
}
