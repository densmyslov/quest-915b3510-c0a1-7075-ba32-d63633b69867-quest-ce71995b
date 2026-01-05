import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';
import type { StartQuestRequest, StartQuestResponse, QuestSessionState, RuntimeSnapshot } from '@/types/quest';
import { proxyToAwsRuntime } from '@/runtime-core/awsRuntimeProxy';

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
        teamCode: undefined, // Runtime snapshot might not have teamCode explicitly
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
        const body: StartQuestRequest = await request.json();
        const { sessionId, questId, teamCode } = body;

        // Validate required fields
        if (!sessionId || !questId) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields' },
                { status: 400 }
            );
        }

        const runtimeSessionId = teamCode ?? sessionId;
        const playerId = sessionId;
        const playerName = `Player-${sessionId.substring(0, 8)}`;
        const questVersion = 'v1';

        // Proxy to AWS Runtime API: POST /runtime/session/start
        const response = await proxyToAwsRuntime('/runtime/session/start', 'POST', {
            sessionId: runtimeSessionId,
            playerId,
            playerName,
            questId,
            questVersion,
            eventId: `LegacyStart:${runtimeSessionId}:${playerId}:${Date.now()}`,
            dedupeKey: `start:${runtimeSessionId}:${playerId}`
        });

        const data = await response.json() as {
            success: boolean;
            sessionId?: string;
            snapshot?: RuntimeSnapshot;
            error?: string
        };

        if (!response.ok || !data.success) {
            return NextResponse.json(
                { success: false, error: data.error || 'Failed to start session' },
                { status: response.ok ? 500 : response.status }
            );
        }

        if (!data.snapshot) {
            return NextResponse.json(
                { success: false, error: 'No snapshot returned from runtime' },
                { status: 500 }
            );
        }

        const session = mapSnapshotToSession(data.snapshot);
        // Inject teamCode if we have it locally, since runtime might not return it
        session.teamCode = teamCode ?? undefined;

        // Clean up legacy session ID return
        // If team code was used as runtime session ID, we still return the user's sessionId or mapping?
        // Legacy behavior: returns session object.

        return NextResponse.json({ success: true, session } as StartQuestResponse);

    } catch (error) {
        console.error('[API /api/quest/start] Error starting quest:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error'
            },
            { status: 500 }
        );
    }
}
