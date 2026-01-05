import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';
import { createTeam } from '@/lib/questDb';
import { proxyToAwsRuntime } from '@/runtime-core/awsRuntimeProxy';

interface CreateTeamRequest {
    playerName: string;
    questId?: string;
    questVersion?: string;
}

interface CreateTeamResponse {
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

function makeId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `evt_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export async function POST(request: NextRequest) {
    console.log('[/api/teams] POST request received');
    try {
        const body: CreateTeamRequest = await request.json();
        console.log('[/api/teams] Request body:', body);
        const { playerName, questId, questVersion } = body;

        // Validate required fields
        if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
            console.error('[/api/teams] Validation failed: missing or invalid playerName');
            return NextResponse.json(
                { success: false, error: 'Player name is required' },
                { status: 400 }
            );
        }

        console.log('[/api/teams] Validation passed', { playerName, questId, questVersion });

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

        console.log('[/api/teams] Proxy decision', { upstreamBase, host, shouldProxy });

        if (shouldProxy) {
            console.log('[/api/teams] Proxying to upstream:', upstreamBase);
            const upstreamRes = await fetch(`${upstreamBase}/api/teams`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playerName: playerName.trim(),
                    questId,
                    questVersion
                }),
            });
            const text = await upstreamRes.text();
            return new NextResponse(text, {
                status: upstreamRes.status,
                headers: { 'content-type': upstreamRes.headers.get('content-type') || 'application/json' },
            });
        }

        // Fallback: local in-memory team creation
        console.log('[/api/teams] Creating team locally');
        const team = await createTeam(playerName.trim());
        console.log('[/api/teams] Team created:', team);
        let websocketUrl = '';

        // Initialize runtime session if questId is provided
        if (questId) {
            console.log('[/api/teams] questId provided, initializing runtime session');
            try {
                const runtimePayload = {
                    sessionId: team.teamCode,
                    playerId: team.leaderSessionId,
                    playerName: team.leaderName,
                    questId,
                    questVersion: questVersion || 'v1',
                    eventId: makeId(),
                    dedupeKey: `start:${team.teamCode}:${team.leaderSessionId}`,
                };
                console.log('[/api/teams] Calling proxyToAwsRuntime with:', runtimePayload);
                const runtimeResponse = await proxyToAwsRuntime('/runtime/session/start', 'POST', runtimePayload);
                console.log('[/api/teams] proxyToAwsRuntime response status:', runtimeResponse.status);

                if (runtimeResponse.ok) {
                    const runtimeData = await runtimeResponse.json();
                    console.log('[/api/teams] Runtime session initialized successfully:', runtimeData);
                    // Get WebSocket URL from environment
                    console.log('[/api/teams] Environment variables check:', {
                        NEXT_PUBLIC_RUNTIME_WS_URL: process.env.NEXT_PUBLIC_RUNTIME_WS_URL,
                        RUNTIME_WS_URL: process.env.RUNTIME_WS_URL,
                        allEnvKeys: Object.keys(process.env).filter(k => k.includes('RUNTIME'))
                    });
                    websocketUrl = process.env.NEXT_PUBLIC_RUNTIME_WS_URL || process.env.RUNTIME_WS_URL || '';
                    console.log('[/api/teams] WebSocket URL:', websocketUrl);
                } else {
                    const errorText = await runtimeResponse.text();
                    console.error('[/api/teams] Failed to initialize runtime session:', { status: runtimeResponse.status, errorText });
                }
            } catch (runtimeError) {
                console.error('[/api/teams] Error initializing runtime session:', runtimeError);
                // Continue with team creation even if runtime initialization fails
            }
        } else {
            console.log('[/api/teams] No questId provided, skipping runtime session initialization');
        }

        if (!websocketUrl) {
            const envDebug = {
                QUEST_API_URL: !!process.env.QUEST_API_URL,
                NEXT_PUBLIC_QUEST_API_URL: !!process.env.NEXT_PUBLIC_QUEST_API_URL,
                RUNTIME_WS_URL: !!process.env.RUNTIME_WS_URL,
                NEXT_PUBLIC_RUNTIME_WS_URL: !!process.env.NEXT_PUBLIC_RUNTIME_WS_URL,
                NODE_ENV: process.env.NODE_ENV
            };
            websocketUrl = `DEBUG_MISSING_VARS: ${JSON.stringify(envDebug)}`;
        }

        const response: CreateTeamResponse = {
            teamCode: team.teamCode,
            session: {
                sessionId: team.leaderSessionId,
                playerName: team.leaderName,
                mode: 'team',
                teamCode: team.teamCode
            },
            websocketUrl
        };

        console.log('[/api/teams] Returning response:', response);
        return NextResponse.json(response);
    } catch (error) {
        console.error('[/api/teams] FATAL ERROR creating team:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error'
            },
            { status: 500 }
        );
    }
}
