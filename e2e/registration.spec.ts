import { test, expect } from '@playwright/test';

test.describe('Registration UI Flow', () => {

    let sessionsCalled = false;

    test.beforeEach(async ({ page }) => {
        sessionsCalled = false;

        // Block Google Fonts to avoid external network dependency.
        await page.route('https://fonts.googleapis.com/**', route => route.abort());
        await page.route('https://fonts.gstatic.com/**', route => route.abort());

        await page.route('**/api/sessions', async route => {
            sessionsCalled = true;
            await route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
        });

        // Mock Quest API team endpoints (used for solo-as-team and real teams).
        await page.route('**/api/teams', async route => {
            if (route.request().method() !== 'POST') return route.fallback();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    teamCode: 'TEST-1926-MOCK',
                    websocketUrl: 'ws://localhost:8787/ws?teamCode=TEST-1926-MOCK',
                    session: {
                        sessionId: 'mock-session-id',
                        playerName: 'Test Player',
                        mode: 'team',
                        teamCode: 'TEST-1926-MOCK',
                    },
                }),
            });
        });

        await page.route('**/api/teams/*/join', async route => {
            if (route.request().method() !== 'POST') return route.fallback();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    teamCode: 'GHIT-1926-TEST',
                    websocketUrl: 'ws://localhost:8787/ws?teamCode=GHIT-1926-TEST',
                    session: {
                        sessionId: 'mock-join-session-id',
                        playerName: 'Team Member',
                        mode: 'team',
                        teamCode: 'GHIT-1926-TEST',
                    },
                }),
            });
        });

        // Navigate to landing page
        await page.goto('/');
    });

    test('should complete solo registration', async ({ page }) => {
        // 1. Wait for Skip Video button and click it to bypass video
        // The Skip Video button appears when state is VIDEO (after SPLASH approx 2s)
        const skipBtn = page.getByText('Skip Video →');
        await skipBtn.waitFor({ state: 'visible', timeout: 10000 });
        await skipBtn.click();

        // 2. Wait for Registration Form to appear
        const registerHeader = page.getByRole('heading', { name: 'Una Lettera dal Passato' });
        await registerHeader.waitFor({ state: 'visible', timeout: 5000 });

        // 3. Fill Name
        // 3. Fill Name
        const nameInput = page.getByPlaceholder('Nome / First Name');
        await nameInput.fill('Test');
        const surnameInput = page.getByPlaceholder('Cognome / Last Name');
        await surnameInput.fill('Player');

        // 4. Select Solo Mode (Default is neutral/null? UI has buttons)
        const soloBtn = page.locator('button:has-text("Solo")').first();
        await soloBtn.click();

        // 5. Click Start (Attraversa il Portale)
        // Button text changes based on mode
        const startBtn = page.locator('button:has-text("Attraversa il Portale")');
        await expect(startBtn).toBeEnabled();
        await startBtn.click();

        // 6. Wait for Transition Video (Video 2) and skip it
        const skipVideo2Btn = page.getByText('Skip →');
        await skipVideo2Btn.waitFor({ state: 'visible', timeout: 10000 });
        await skipVideo2Btn.click();

        // 7. Verify Intro starts (Text typewriter effect)
        await expect(page.getByText(/Gentile Test/)).toBeVisible();

        // 7. Verify "Begin Journey" button appears after intro (or we can skip animation)
        // The intro has a "Skip Animation" button
        const skipAnimBtn = page.getByText('Skip Animation');
        if (await skipAnimBtn.isVisible()) {
            await skipAnimBtn.click();
        }
        await expect(page.getByText('Accetta di aprire il portale temporale')).toBeVisible();

        expect(sessionsCalled).toBe(false);
    });

    test('should join a team (lobby state)', async ({ page }) => {
        // 1. Skip Video
        const skipBtn = page.getByText('Skip Video →');
        await skipBtn.waitFor({ state: 'visible', timeout: 15000 });
        await skipBtn.click();

        // 2. Fill Name
        // 2. Fill Name
        await page.getByPlaceholder('Nome / First Name').fill('Team');
        await page.getByPlaceholder('Cognome / Last Name').fill('Member');

        // 3. Select Team Mode
        await page.getByText('Travel together', { exact: true }).click();

        // 4. Select Join Team
        // Click subtitle "Join existing team"
        await page.getByText('Join existing team', { exact: true }).click();

        // 5. Enter Code
        const codeInput = page.getByPlaceholder('GHIT-1926-XXXX');
        await codeInput.fill('GHIT-1926-TEST');

        // 6. Join (button text "Unisciti alla Squadra")
        const joinStartBtn = page.getByText('Unisciti alla Squadra', { exact: true });
        await expect(joinStartBtn).toBeEnabled();
        await joinStartBtn.click();

        // 7. Waiting lobby (no game start without leader)
        await expect(page.getByText(/Waiting for the team founder to start/i)).toBeVisible();
    });

});
