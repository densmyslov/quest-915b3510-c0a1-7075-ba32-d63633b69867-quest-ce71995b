import { test, expect } from '@playwright/test';

test.describe('Quest Map Regression', () => {

    test('should display map, compass, and controls', async ({ page }) => {
        // 1. Mock the Quest Context/Data if necessary?
        // Actually, usually the template app looks for local JSON or fetches.
        // If running `npm run dev` in template, it might use mock data or fail if no quest ID is passed?
        // But defaults usually work. Let's see.
        // The `Page` component uses `useQuest()`.
        // If it relies on `QuestContext` which fetches from URL or local `src/data/quest.json`.
        // We should assume `src/data/quest.json` exists in the template.

        // Navigate to map page
        await page.goto('/map');

        // Select Play mode (GPS + compass controls are Play-only)
        await page.getByTestId('mode-play').click();

        // 2. Initial Loading State might appear
        // await expect(page.getByText('Loading map...')).toBeVisible();

        // 3. Verify Map Container is present
        // The container has `leaflet-container` class usually added by Leaflet,
        // OR we check for our wrapper.
        const mapWrapper = page.locator('.leaflet-container');
        await expect(mapWrapper).toBeVisible({ timeout: 30000 });

        // 4. Verify Compass Overlay (Bottom Right)
        // Compass is a SVG overlay; use stable test id.
        await expect(page.getByTestId('compass-rose')).toBeVisible();

        // 5. Verify GPS Button
        await expect(page.getByTestId('gps-toggle')).toBeVisible();

        // 6. Verify Tiles are loading (or at least 1 tile exists)
        // Leaflet tiles have class `leaflet-tile`
        const tile = page.locator('.leaflet-tile').first();
        await expect(tile).toBeVisible();
    });

    test('should handle GPS toggle and compass rotation', async ({ page, context }) => {
        // Mock Geolocation
        await context.grantPermissions(['geolocation']);
        await context.setGeolocation({ latitude: 51.505, longitude: -0.09 });

        await page.goto('/map');

        // Select Play mode (GPS + compass controls are Play-only)
        await page.getByTestId('mode-play').click();

        // Click Enable GPS
        const gpsButton = page.getByTestId('gps-toggle');
        await gpsButton.click();

        // Verify button state changes
        await expect(gpsButton).toHaveAttribute('aria-label', /Disattiva bussola|Espandi controllo bussola/);

        // Verify "You are here" marker appears (Leaflet marker shadow/icon usually indicates it)
        // or check for the popup text "You are here" if we clicked it, but let's check marker existence.
        // The user marker is added to the map.
        // Just checking that we don't crash is a good start, but let's check for the marker.
        // We can check for the alt text "Marker" or similar if Leaflet provides it, or just generic marker count.
        // Leaflet default markers have class `leaflet-marker-icon`.
        // Initial map might have objects. User marker is one more.
        await expect(page.locator('.leaflet-marker-icon')).not.toHaveCount(0);

        // Test Compass Rotation
        // Dispatch deviceorientation event
        await page.evaluate(() => {
            let event;
            try {
                // Try standard constructor
                event = new DeviceOrientationEvent('deviceorientation', {
                    alpha: 90,
                    beta: 0,
                    gamma: 0,
                    absolute: true
                });
            } catch (e) {
                // Fallback for environments where constructor is not available
                event = new Event('deviceorientation');
                Object.defineProperty(event, 'alpha', { value: 90 });
            }

            (event as any).webkitCompassHeading = null; // Ensure we test alpha path
            window.dispatchEvent(event);
        });

        // Compass should rotate -90deg (to point North relative to phone facing East)
        // Wait for usage of style
        const compassContainer = page.getByTestId('compass-rose');

        // Note: The smoothing transition might take a moment, but `expect` retries.
        // Check for the style attribute containing the rotation
        // 360 - 90 = 270 or -90. The logic was: compass = 360 - alpha -> 270.
        // transform: rotate(-heading deg) -> rotate(-270deg).
        // Wait, logic in QuestMap:
        // non-iOS: compass = 360 - alpha.
        // alpha = 90 (East). compass = 270 (West? No. 360-90 = 270).
        // If alpha is 90, Heading is 270?
        // Standard: Alpha 0 = North, 90 = East, 180 = South, 270 = West.
        // Compass heading usually means "Degree from North".
        // modifying QuestMap: `compass = 360 - event.alpha`.
        // If alpha=90 (East), compass=270.
        // Transform: `rotate(${-heading}deg)` -> `rotate(-270deg)`.

        await expect(compassContainer).toHaveAttribute('style', /rotate\(-270deg\)/);

        // Compass updates are throttled; wait before sending the next event.
        await page.waitForTimeout(150);

        // Simulate another angle
        await page.evaluate(() => {
            let event;
            try {
                event = new DeviceOrientationEvent('deviceorientation', {
                    alpha: 180,
                    beta: 0,
                    gamma: 0,
                    absolute: true
                });
            } catch (e) {
                event = new Event('deviceorientation');
                Object.defineProperty(event, 'alpha', { value: 180 });
            }
            (event as any).webkitCompassHeading = null;
            window.dispatchEvent(event);
        });

        // alpha=180 -> compass=180 -> rotate(-180deg)
        await expect(compassContainer).toHaveAttribute('style', /rotate\(-180deg\)/);
    });

});
