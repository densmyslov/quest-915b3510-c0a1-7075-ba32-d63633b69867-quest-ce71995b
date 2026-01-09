import { test, expect } from '@playwright/test';

test.describe('Steps Mode Marker Visibility', () => {

    // Setup generic mock schema
    type MockObject = { id: string; name: string; coordinates: string; itineraryNumber: number };

    const mockObjects: MockObject[] = [
        { id: 'obj-1', name: 'Start Object', coordinates: '51.505, -0.09', itineraryNumber: 0 },
        { id: 'obj-2', name: 'Second Object', coordinates: '51.515, -0.10', itineraryNumber: 1 },
        { id: 'obj-3', name: 'Third Object', coordinates: '51.525, -0.11', itineraryNumber: 2 },
    ];

    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log(`[Browser] ${msg.text()}`));

        // Mock the quest definition
        await page.route('**/api/runtime/compiled*', async route => {
            await route.fulfill({
                json: {
                    success: true,
                    definition: {
                        objects: mockObjects,
                        timelineNodes: {}
                    }
                }
            });
        });

        // Seed basic session
        await page.addInitScript(() => {
            sessionStorage.setItem('quest_sessionId', 'vis-test-session');
        });
    });

    test('shows only current object initially', async ({ page }) => {
        // 1. Mock Session: Nothing completed, current is obj-1
        await page.route('**/api/runtime/session/start', async route => {
            await route.fulfill({
                json: {
                    success: true,
                    snapshot: {
                        sessionId: 'vis-test-session',
                        players: { 'vis-test-session': { currentObjectId: 'obj-1' } },
                        objects: {},
                        me: { currentObjectId: 'obj-1', visibleObjectIds: ['obj-1', 'ebd335c2-6d19-4391-bb3b-ead77291aed7'] },
                        completedObjects: []
                    }
                }
            });
        });

        const [response] = await Promise.all([
            page.waitForResponse(r => r.url().includes('/api/runtime/session/start')),
            page.goto('/map')
        ]);

        await page.getByTestId('mode-steps').click();

        // 2. Assertions
        // Object 1 (Sample Object) should be visible
        await expect(page.locator('.leaflet-marker-icon[alt="Sample Object"]')).toBeVisible({ timeout: 10000 });

        // Second Object (Fontana Fesa) should be HIDDEN
        await expect(page.locator('.leaflet-marker-icon[alt="Fontana Fesa"]')).toHaveCount(0);
    });

    test('shows past and current objects after progress', async ({ page }) => {
        // 1. Mock Session: obj-1 completed, current is Fontana Fesa
        await page.route('**/api/runtime/session/start', async route => {
            await route.fulfill({
                json: {
                    success: true,
                    snapshot: {
                        sessionId: 'vis-test-session',
                        players: { 'vis-test-session': { currentObjectId: 'ebd335c2-6d19-4391-bb3b-ead77291aed7' } },
                        objects: {
                            'obj-1': { completedAt: new Date().toISOString() }
                        },
                        me: { currentObjectId: 'ebd335c2-6d19-4391-bb3b-ead77291aed7', visibleObjectIds: ['obj-1', 'ebd335c2-6d19-4391-bb3b-ead77291aed7'] },
                        completedObjects: ['obj-1']
                    }
                }
            });
        });

        const [response] = await Promise.all([
            page.waitForResponse(r => r.url().includes('/api/runtime/session/start')),
            page.goto('/map')
        ]);

        await page.getByTestId('mode-steps').click();

        // 2. Assertions
        // Object 1 (Past) should be visible
        await expect(page.locator('.leaflet-marker-icon[alt="Sample Object"]')).toBeVisible({ timeout: 10000 });

        // Object 2 (Current) should be visible
        await expect(page.locator('.leaflet-marker-icon[alt="Fontana Fesa"]')).toBeVisible({ timeout: 10000 });
    });
});
