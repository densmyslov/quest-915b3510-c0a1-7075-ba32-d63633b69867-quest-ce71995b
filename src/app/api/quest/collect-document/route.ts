import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';
import type { QuestSessionState } from '@/types/quest';

interface CollectDocumentRequest {
    sessionId: string;
    timestamp: string;
}

export async function POST(request: NextRequest) {
    try {
        const body: CollectDocumentRequest = await request.json();
        const { sessionId } = body;

        console.warn('[API /api/quest/collect-document] Feature not implemented in AWS Runtime - ignoring');

        if (!sessionId) {
            return NextResponse.json({ success: false, error: 'Missing sessionId' }, { status: 400 });
        }

        // Return empty/dummy session to pacify client
        return NextResponse.json({
            success: true,
            session: {
                sessionId,
                documents: [] // Dummy
            } as unknown as QuestSessionState
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}
