import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';
import { proxyToAwsRuntime } from '@/runtime-core/awsRuntimeProxy';
import type { RuntimeSnapshot } from '@/types/quest';

interface ArriveRequest {
    sessionId: string;
    objectId: string;
    timestamp: string;
    distance?: number;
    // Legacy fields that might pass through
    playerId?: string;
}

interface ArriveResponse {
    success: boolean;
    message?: string;
    error?: string;
}

export async function POST(request: NextRequest) {
    try {
        const body: ArriveRequest = await request.json();
        const { sessionId, objectId, timestamp, distance } = body;

        // Validate required fields
        if (!sessionId || !objectId) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields: sessionId, objectId' },
                { status: 400 }
            );
        }

        const playerId = sessionId; // Legacy assumption: sessionId used as playerId in simple mode

        // 1. Ensure session is started (implicit start if missing is common in legacy logic,
        // but for proxy we assume session exists or we rely on 'arrive' to be idempotent if runtime handles auto-creation.
        // The AWS runtime `object/arrive` might require an existing session.
        // However, let's just proxy the arrive call. If AWS 404s on session, we might fail.
        // Let's assume the client has called start.

        // Proxy to AWS Runtime API: POST /runtime/object/arrive
        const response = await proxyToAwsRuntime('/runtime/object/arrive', 'POST', {
            sessionId: sessionId, // Or mapped session ID if team? Legacy usually implies sessionId is the key.
            playerId,
            objectId,
            eventId: `LegacyArrive:${sessionId}:${objectId}:${Date.now()}`,
            dedupeKey: `arrive:${sessionId}:${objectId}`,
            timestamp: timestamp || new Date().toISOString()
        });

        const data = await response.json() as { success: boolean; snapshot?: RuntimeSnapshot; error?: string };

        if (!response.ok || !data.success) {
            return NextResponse.json(
                { success: false, error: data.error || 'Failed to record arrival' },
                { status: response.ok ? 500 : response.status }
            );
        }

        console.log('[API /api/quest/arrive] 🎯 Arrival recorded (AWS)', {
            sessionId,
            objectId,
            distance: distance ? `${distance}m` : 'unknown'
        });

        return NextResponse.json({
            success: true,
            message: `Arrival recorded for object ${objectId}`
        } as ArriveResponse);

    } catch (error) {
        console.error('[API /api/quest/arrive] Error recording arrival:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error'
            } as ArriveResponse,
            { status: 500 }
        );
    }
}
