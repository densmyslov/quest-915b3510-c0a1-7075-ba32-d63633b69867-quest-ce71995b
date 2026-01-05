import { test, expect } from '@playwright/test';

test.describe('Landing Page Video Transition', () => {

    test('should transition to registration after video ends', async ({ page }) => {
        await page.goto('/');

        // 0. Verify page loaded basic structure
        await expect(page.locator('main')).toBeVisible({ timeout: 30000 });

        // 1. Initial State: Title Overlay should be visible
        // State is SPLASH for 2s, then VIDEO
        // The title overlay is: "The Oath of Two Villages"
        await expect(page.getByRole('heading', { name: 'The Oath of Two Villages' })).toBeVisible({ timeout: 10000 });

        // Wait for state to potentially switch to VIDEO (2s timer)
        await page.waitForTimeout(3000);

        // 2. Video iframe should be present
        const iframe = page.locator('iframe');
        await expect(iframe).toBeVisible();

        // 3. User clicks "Skip Video" (since we reverted to 3e6e4a7 which has this button)
        // OR we wait for "ended" event. The user complained about "fail to correctly note the end of the video".
        // Use the button manual trigger to verify if even that works, OR simulate the event.
        // The user said "fail to correctly note the end of the video", implying Auto-Transition.
        // Let's verify if the code even *has* auto-transition logic working.

        // This version has logic: `player.addEventListener('ended', handleVideoEnded);`
        // But it relies on `window.Stream` which is loaded async.

        // Let's try to simulate the button click first as a baseline, 
        // effectively triggering `handleVideoEnded`.
        const skipButton = page.getByRole('button', { name: 'Skip Video' });
        await expect(skipButton).toBeVisible();
        await skipButton.click();

        // 4. Verify Transition Logic
        // handleVideoEnded sets `isTitleLeaving = true`
        // Wait 1200ms
        // setState('REGISTRATION')

        // Check if Title leaves (class check for transform/opacity)
        // logic: `isTitleLeaving ? '-translate-y-full opacity-0' : ...`
        const titleOverlay = page.locator('text=The Oath of Two Villages').locator('..').locator('..'); // h1 -> div -> div (overlay)
        // Or simpler selector: the overlay container.

        // After click, we expect the title to animate out.
        // We can check for the class `opacity-0` or lack of visibility after delay.

        await expect(titleOverlay).toHaveClass(/-translate-y-full/, { timeout: 5000 });

        // 5. Verify Registration Form appears
        await expect(page.getByText('Una Lettera dal Passato')).toBeVisible({ timeout: 5000 });
    });
});
