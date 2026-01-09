import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';

/**
 * API Endpoint: Update player GPS position
 *
 * Refactored to safe no-op for AWS Runtime migration.
 * Position updates should now be sent via WebSocket (useTeamWebSocket).
 */

interface UpdatePositionRequest {
    sessionId: string;
    position: GeolocationPosition;
}

interface UpdatePositionResponse {
    success: boolean;
    message?: string;
    position?: {
        lat: number;
        lng: number;
        accuracy: number;
        timestamp: string;
    };
    error?: string;
}

export async function POST(request: NextRequest) {
    try {
        const body: UpdatePositionRequest = await request.json();
        const { sessionId, position } = body;

        // Validate required fields
        if (!sessionId || !position) {
            return NextResponse.json(
                { success: false, error: 'Missing required fields' },
                { status: 400 }
            );
        }

        console.log('[API /api/quest/update-position] Legacy position update received - ignoring (use WebSocket)');

        // Return fake success to keep legacy client happy
        return NextResponse.json({
            success: true,
            message: 'Position update acknowledged (legacy)',
            position: {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: new Date().toISOString()
            }
        } as UpdatePositionResponse);

    } catch (error) {
        console.error('[API /update-position] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error'
            } as UpdatePositionResponse,
            { status: 500 }
        );
    }
}
