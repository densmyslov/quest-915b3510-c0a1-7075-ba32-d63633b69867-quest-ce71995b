// Basic API client for the Quest Backend
const API_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? window.location.origin : '');

if (!API_URL && typeof window === 'undefined') {
    console.warn("Warning: NEXT_PUBLIC_API_URL is not set and window is undefined.");
}

export interface Player {
    playerId: string;
    firstName: string;
    lastName: string;
    assignedSurname: string;
    ancestorName: string;
    escapeYear: number;
    escapeDestination: string;
    occupation: string;
}

export interface RegistrationSession {
    sessionId: string;
    mode: 'solo' | 'team';
    teamCode?: string;
    teamName?: string;
    status: 'pending' | 'ready';
}

export interface RegistrationResponse {
    success: boolean;
    player: Player;
    session?: RegistrationSession;
}

export interface BaseRegistrationRequest {
    firstName: string;
    lastName: string;
    email?: string;
    deviceId: string;
    questId?: string;
}

export interface SoloRegistrationRequest extends BaseRegistrationRequest {
    mode: 'solo';
}

export interface TeamCreatorRegistrationRequest extends BaseRegistrationRequest {
    mode: 'team_create';
    teamName: string;
    expectedPlayers: number;
}

export interface TeamJoinRegistrationRequest extends BaseRegistrationRequest {
    mode: 'team_join';
    teamCode: string;
}

export type RegistrationRequest = SoloRegistrationRequest | TeamCreatorRegistrationRequest | TeamJoinRegistrationRequest;

export const questApi = {
    register: async (request: RegistrationRequest): Promise<RegistrationResponse> => {
        console.log(`[questApi] register calling: ${API_URL}/register with mode ${request.mode}`);
        const res = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Registration failed (${res.status}): ${text}`);
        }

        return res.json();
    },

    // Legacy/Helper methods (Deprecated or kept for compat/utility if needed)
    // For now we primarily use register() for everything.
};
