import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';
import { joinTeam } from '@/lib/questDb';

interface JoinTeamRequest {
    playerName: string;
}

interface JoinTeamResponse {
    teamCode: string;
    session: {
        sessionId: string;
        playerName: string;
        mode: 'team';
        teamCode: string;
    };
    websocketUrl: string;
}

function getQuestApiBaseUrl(): string | null {
    const raw = process.env.QUEST_API_URL || process.env.NEXT_PUBLIC_QUEST_API_URL || process.env.NEXT_PUBLIC_API_URL;
    if (!raw) return null;
    return raw.replace(/\/+$/, '');
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ teamCode: string }> }
) {
    try {
        const body: JoinTeamRequest = await request.json();
        const { playerName } = body;
        const { teamCode } = await params;

        // Validate required fields
        if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
            return NextResponse.json(
                { success: false, error: 'Player name is required' },
                { status: 400 }
            );
        }

        if (!teamCode || typeof teamCode !== 'string' || teamCode.trim().length === 0) {
            return NextResponse.json(
                { success: false, error: 'Team code is required' },
                { status: 400 }
            );
        }

        const upstreamBase = getQuestApiBaseUrl();
        const host = request.headers.get('host') || '';
        const shouldProxy =
            !!upstreamBase &&
            (() => {
                try {
                    return new URL(upstreamBase).host !== host;
                } catch {
                    return true;
                }
            })();

        if (shouldProxy) {
            const upstreamRes = await fetch(`${upstreamBase}/api/teams/${encodeURIComponent(teamCode.trim().toUpperCase())}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName: playerName.trim() }),
            });
            const text = await upstreamRes.text();
            return new NextResponse(text, {
                status: upstreamRes.status,
                headers: { 'content-type': upstreamRes.headers.get('content-type') || 'application/json' },
            });
        }

        // Fallback: local in-memory join (no WebSocket support)
        const result = await joinTeam(teamCode.trim().toUpperCase(), playerName.trim());
        const websocketUrl = '';

        const response: JoinTeamResponse = {
            teamCode: result.team.teamCode,
            session: {
                sessionId: result.sessionId,
                playerName: playerName.trim(),
                mode: 'team',
                teamCode: result.team.teamCode
            },
            websocketUrl
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error('Error joining team:', error);

        // Return 404 if team not found
        if (error instanceof Error && error.message === 'Team not found') {
            return NextResponse.json(
                { success: false, error: 'Team not found' },
                { status: 404 }
            );
        }

        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error'
            },
            { status: 500 }
        );
    }
}
