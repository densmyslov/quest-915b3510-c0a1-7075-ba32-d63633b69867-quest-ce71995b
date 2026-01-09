import { test, expect } from '@playwright/test';

test.describe('Steps Mode Puzzle Integration', () => {
    test('should open puzzle from timeline in steps mode', async ({ page }) => {
        page.on('console', msg => console.log(`[Browser] ${msg.text()}`));

        // Seed Session Storage
        await page.addInitScript(() => {
            sessionStorage.setItem('quest_sessionId', 'test-session');
            sessionStorage.setItem('quest_playerName', 'Test Player');
            sessionStorage.setItem('quest_teamCode', 'test-team');
        });

        // Mock Runtime API to ensure we have a valid session and are at the object
        await page.route('**/api/runtime/compiled*', async route => {
            const json = {
                success: true,
                definition: {
                    timelineNodes: {}
                }
            };
            await route.fulfill({ json });
        });

        await page.route('**/api/runtime/session/start', async route => {
            const json = {
                success: true,
                snapshot: {
                    sessionId: 'test-session',
                    players: {
                        'test-session': { currentObjectId: 'obj-1', score: 0, status: 'playing' }
                    },
                    objects: {
                        'obj-1': { arrivedAt: new Date().toISOString() }
                    },
                    nodes: {},
                    me: { currentObjectId: 'obj-1', visibleObjectIds: ['obj-1'] }
                }
            };
            await route.fulfill({ json });
        });

        await page.route('**/api/runtime/object/arrive', async route => {
            const json = {
                success: true,
                snapshot: {
                    sessionId: 'test-session',
                    players: {
                        'test-session': { currentObjectId: 'obj-1', score: 0, status: 'playing' }
                    },
                    objects: {
                        'obj-1': { arrivedAt: new Date().toISOString() }
                    },
                    nodes: {},
                    me: { currentObjectId: 'obj-1', visibleObjectIds: ['obj-1'] }
                }
            };
            await route.fulfill({ json });
        });

        // 1. Go to map
        await Promise.all([
            page.waitForResponse(resp => resp.url().includes('/api/runtime/session/start') && resp.status() === 200),
            page.goto('/map')
        ]);

        // 2. Enable Steps Mode
        await page.getByTestId('mode-steps').click();

        // 3. Navigate to Object 1 (initial object)
        // Force arrival by clicking Prev/Next if needed (since range is [1,1] and we are at 1, prev will re-trigger 1)
        // Ensure buttons are visible
        const prevBtn = page.getByTestId('steps-prev');
        if (await prevBtn.isVisible()) {
            await prevBtn.click();
        }

        // Ensure "Timeline" is visible
        await expect(page.getByText('Timeline')).toBeVisible();

        // 4. Handle Audio Item (Skip it if present and blocking)
        // Look for the "Skip" button associated with the audio item
        // Note: CSS modules make class selection hard, rely on text
        // "audio" label or just generic "Skip" button.
        // Assuming Audio is first item.
        const skipButtons = page.getByRole('button', { name: 'Skip' });
        if (await skipButtons.count() > 0) {
            await skipButtons.first().click();
        }

        // 5. Verify Puzzle Item is now current and has Open button
        // Wait for Open button to appear
        const openBtn = page.getByRole('button', { name: 'Open' });
        await expect(openBtn).toBeVisible({ timeout: 5000 });
        await expect(openBtn).toBeEnabled();

        // 6. Click Open
        await openBtn.click();

        // 7. Verify Puzzle Overlay
        // The puzzle "Witch Knot Simple" has data-testid="game-board"
        await expect(page.getByTestId('game-board')).toBeVisible({ timeout: 10000 });
    });
});
