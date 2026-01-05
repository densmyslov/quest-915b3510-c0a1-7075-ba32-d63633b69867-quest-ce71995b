#!/usr/bin/env node

/**
 * Verification script for team API endpoints
 *
 * This script tests:
 * 1. POST /api/teams - Create a new team
 * 2. POST /api/teams/{teamCode}/join - Join an existing team
 */

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';

interface CreateTeamResponse {
    teamCode: string;
    session: {
        sessionId: string;
        playerName: string;
        mode: string;
        teamCode: string;
    };
    websocketUrl: string;
}

interface JoinTeamResponse {
    teamCode: string;
    session: {
        sessionId: string;
        playerName: string;
        mode: string;
        teamCode: string;
    };
    websocketUrl: string;
}

async function verify() {
    console.log('Starting team API verification...\n');
    console.log(`Using API base URL: ${API_BASE_URL}\n`);

    let teamCode: string | null = null;

    // Test 1: Create a team
    console.log('Test 1: Creating a team...');
    try {
        const response = await fetch(`${API_BASE_URL}/api/teams`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                playerName: 'Test Leader',
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data: CreateTeamResponse = await response.json();
        teamCode = data.teamCode;

        console.log('✓ Team created successfully');
        console.log(`  Team Code: ${data.teamCode}`);
        console.log(`  Session ID: ${data.session.sessionId}`);
        console.log(`  Player Name: ${data.session.playerName}`);
        console.log(`  WebSocket URL: ${data.websocketUrl}`);
        console.log();
    } catch (error) {
        console.error('✗ Failed to create team:', error);
        process.exit(1);
    }

    // Test 2: Join the team
    if (!teamCode) {
        console.error('✗ No team code available for join test');
        process.exit(1);
    }

    console.log('Test 2: Joining the team...');
    try {
        const response = await fetch(`${API_BASE_URL}/api/teams/${teamCode}/join`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                playerName: 'Test Player 2',
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data: JoinTeamResponse = await response.json();

        console.log('✓ Joined team successfully');
        console.log(`  Team Code: ${data.teamCode}`);
        console.log(`  Session ID: ${data.session.sessionId}`);
        console.log(`  Player Name: ${data.session.playerName}`);
        console.log(`  WebSocket URL: ${data.websocketUrl}`);
        console.log();
    } catch (error) {
        console.error('✗ Failed to join team:', error);
        process.exit(1);
    }

    // Test 3: Try to join a non-existent team
    console.log('Test 3: Joining a non-existent team...');
    try {
        const response = await fetch(`${API_BASE_URL}/api/teams/INVALID/join`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                playerName: 'Test Player 3',
            }),
        });

        if (response.status === 404) {
            console.log('✓ Correctly returned 404 for non-existent team');
        } else {
            console.error(`✗ Expected 404, got ${response.status}`);
            process.exit(1);
        }
        console.log();
    } catch (error) {
        console.error('✗ Unexpected error:', error);
        process.exit(1);
    }

    console.log('All tests passed! ✓');
}

verify().catch((error) => {
    console.error('Verification failed:', error);
    process.exit(1);
});
