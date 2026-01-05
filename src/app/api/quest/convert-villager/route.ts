import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';
import type { QuestSessionState } from '@/types/quest';

interface ConvertVillagerRequest {
    sessionId: string;
    timestamp: string;
}

export async function POST(request: NextRequest) {
    try {
        const body: ConvertVillagerRequest = await request.json();
        const { sessionId } = body;

        console.warn('[API /api/quest/convert-villager] Feature not implemented in AWS Runtime - ignoring');

        if (!sessionId) {
            return NextResponse.json({ success: false, error: 'Missing sessionId' }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            session: {
                sessionId,
                villagers: []
            } as unknown as QuestSessionState
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}
