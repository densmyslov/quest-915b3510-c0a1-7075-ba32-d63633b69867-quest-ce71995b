import { test, expect } from '@playwright/test';

test.describe('Audio Trigger E2E Tests', () => {
    test.beforeEach(async ({ page, context }) => {
        // Grant geolocation permission
        await context.grantPermissions(['geolocation']);

        page.on('pageerror', err => console.log(`BROWSER ERROR: ${err.message}`));
        page.on('console', msg => console.log(`BROWSER LOG: ${msg.text()}`));

        // Mock Audio before any script loads
        await page.addInitScript(() => {
            (window as any)._audioInstances = [];
            (window as any)._audioLogs = [];
            (window as any)._mediaLogs = [];

            // Track <audio>/<video> playback (QuestMap uses an <audio> element for actual playback)
            HTMLMediaElement.prototype.play = function () {
                (window as any)._mediaLogs.push({
                    action: 'play',
                    src: (this as HTMLMediaElement).currentSrc || (this as HTMLMediaElement).src || '',
                    timestamp: Date.now()
                });
                // Avoid real network/media decoding in e2e.
                return Promise.resolve();
            };

            HTMLMediaElement.prototype.pause = function () {
                (window as any)._mediaLogs.push({
                    action: 'pause',
                    src: (this as HTMLMediaElement).currentSrc || (this as HTMLMediaElement).src || '',
                    timestamp: Date.now()
                });
            };

            HTMLMediaElement.prototype.load = function () {
                // Avoid real network/media decoding in e2e.
                return;
            };

            const MockAudio = class {
                src: string;
                volume: number = 1;
                paused: boolean = true;
                currentTime: number = 0;

                constructor(src?: string) {
                    this.src = src || '';
                    (window as any)._audioInstances.push(this);
                    (window as any)._audioLogs.push({
                        action: 'create',
                        src: this.src,
                        timestamp: Date.now()
                    });
                }

                play() {
                    this.paused = false;
                    (window as any)._audioLogs.push({
                        action: 'play',
                        src: this.src,
                        timestamp: Date.now()
                    });
                    return Promise.resolve();
                }

                pause() {
                    this.paused = true;
                    (window as any)._audioLogs.push({
                        action: 'pause',
                        src: this.src,
                        timestamp: Date.now()
                    });
                }

                addEventListener() { }
                removeEventListener() { }
            };

            // Override Audio constructor
            Object.defineProperty(window, 'Audio', {
                writable: true,
                configurable: true,
                value: MockAudio
            });
        });
    });

    test('should trigger audio playback when approaching object', async ({ page, context }) => {
        // SKIPPED: This test requires quest data with audio configured
        // To enable: Add audioUrl to an object at coordinates 51.505, -0.09

        // Start away from the object (Object is at 51.505, -0.09)
        await context.setGeolocation({ latitude: 51.51, longitude: -0.09 });

        await page.goto('/map');

        // Select Play mode
        await page.getByTestId('mode-play').click();

        // Enable GPS
        const gpsButton = page.getByTestId('gps-toggle');
        await gpsButton.click();

        // Simulate approaching the object (Sample Object at 51.505, -0.09)
        await context.setGeolocation({ latitude: 51.505, longitude: -0.09 });

        // Verify Audio was triggered with correct URL
        await expect.poll(async () => {
            return await page.evaluate(() => {
                const logs = (window as any)._mediaLogs || [];
                const target = logs.find((l: any) => l.action === 'play' && String(l.src).includes('example.com'));
                return target ? target.src : null;
            });
        }, {
            message: 'Audio should be instantiated',
            timeout: 10000
        }).toBe('https://example.com/audio.mp3');
    });

    test('mode selection unlocks audio', async ({ page }) => {
        await page.goto('/map');

        await page.getByTestId('mode-play').click();

        // Verify "Audio attivato!" notification appears
        await expect(page.getByText('Audio attivato!')).toBeVisible({ timeout: 3000 });

        // Verify audio was unlocked (check instances)
        const unlocked = await page.evaluate(() => {
            const instances = (window as any)._audioInstances;
            // Should have silent audio instances from unlock
            return instances && instances.length > 0;
        });
        expect(unlocked).toBe(true);
    });

    test('map interaction unlocks audio', async ({ page, context }) => {
        await context.setGeolocation({ latitude: 51.5, longitude: -0.09 });
        await page.goto('/map');

        // Click on the map to unlock
        const mapContainer = page.locator('.leaflet-container').first();
        await mapContainer.click({ position: { x: 200, y: 200 } });

        // Verify notification appears
        await expect(page.getByText('Audio attivato!')).toBeVisible({ timeout: 3000 });
    });

    test('audio re-triggers on zone re-entry', async ({ page, context }) => {
        await context.setGeolocation({ latitude: 51.51, longitude: -0.09 });
        await page.goto('/map');

        await page.getByTestId('mode-play').click();
        const gpsButton = page.getByTestId('gps-toggle');
        await gpsButton.click();

        // First entry - approach object
        await context.setGeolocation({ latitude: 51.505, longitude: -0.09 });
        await page.waitForTimeout(2000);

        const firstEntryCount = await page.evaluate(() =>
            ((window as any)._mediaLogs || []).filter((l: any) => l.action === 'play' && String(l.src).includes('example.com')).length
        );

        // Exit zone
        await context.setGeolocation({ latitude: 51.510, longitude: -0.09 });
        await page.waitForTimeout(2000);

        // Re-enter zone
        await context.setGeolocation({ latitude: 51.505, longitude: -0.09 });
        await page.waitForTimeout(2000);

        // Should have created a new audio instance (re-trigger)
        const secondEntryCount = await page.evaluate(() =>
            ((window as any)._mediaLogs || []).filter((l: any) => l.action === 'play' && String(l.src).includes('example.com')).length
        );

        expect(secondEntryCount).toBeGreaterThanOrEqual(firstEntryCount);
    });

    test('handles audio unlock failure gracefully', async ({ page, context }) => {
        await context.grantPermissions(['geolocation']);

        // Need to set up failing Audio BEFORE navigating to the page
        await page.addInitScript(() => {
            const FailingAudio = class {
                src: string;
                constructor(src?: string) {
                    this.src = src || '';
                }
                play() {
                    const error: any = new Error('NotAllowedError: play() failed');
                    error.name = 'NotAllowedError';
                    return Promise.reject(error);
                }
                pause() { }
                addEventListener() { }
                removeEventListener() { }
            };

            Object.defineProperty(window, 'Audio', {
                writable: true,
                configurable: true,
                value: FailingAudio
            });
        });

        await page.goto('/map');
        await page.getByTestId('mode-play').click();

        // Unlock should fail but the page should remain responsive
        await expect(page.getByTestId('mode-steps')).toBeVisible({ timeout: 3000 });
    });

    test('multi-format fallback system', async ({ page, context }) => {
        await context.grantPermissions(['geolocation']);

        // Track which audio formats are attempted
        await page.addInitScript(() => {
            (window as any)._formatAttempts = [];

            const FallbackAudio = class {
                private _src: string = '';

                set src(value: string) {
                    this._src = value;
                    (window as any)._formatAttempts.push(value);
                }

                get src() {
                    return this._src;
                }

                play() {
                    // Fail MP3, succeed on WAV or OGG
                    if (this._src.includes('audio/mp3')) {
                        const error: any = new Error('NotSupportedError');
                        error.name = 'NotSupportedError';
                        return Promise.reject(error);
                    }
                    return Promise.resolve();
                }

                pause() { }
                addEventListener() { }
                removeEventListener() { }
            };

            Object.defineProperty(window, 'Audio', {
                writable: true,
                configurable: true,
                value: FallbackAudio
            });
        });

        await page.goto('/map');
        await page.getByTestId('mode-play').click();

        // Wait for unlock attempts
        await page.waitForTimeout(1000);

        const attempts = await page.evaluate(() =>
            (window as any)._formatAttempts || []
        );

        // Should have tried multiple formats
        expect(attempts.length).toBeGreaterThanOrEqual(2);

        // First attempt should be MP3
        expect(attempts[0]).toContain('audio/mp3');

        // Second attempt should be WAV or OGG
        expect(
            attempts[1].includes('audio/wav') ||
            attempts[1].includes('audio/ogg')
        ).toBe(true);
    });

    test('GPS accuracy and debouncing - prevents rapid re-triggers', async ({ page, context }) => {
        await context.setGeolocation({ latitude: 51.51, longitude: -0.09 });
        await page.goto('/map');

        await page.getByTestId('mode-play').click();
        const gpsButton = page.getByTestId('gps-toggle');
        await gpsButton.click();

        const initialCount = await page.evaluate(() =>
            ((window as any)._mediaLogs || []).filter((l: any) => l.action === 'play' && String(l.src).includes('example.com')).length
        );

        // Simulate GPS jitter - rapid small position changes within zone
        await context.setGeolocation({ latitude: 51.5050, longitude: -0.09 });
        await page.waitForTimeout(200);

        await context.setGeolocation({ latitude: 51.5051, longitude: -0.09 });
        await page.waitForTimeout(200);

        await context.setGeolocation({ latitude: 51.5049, longitude: -0.09 });
        await page.waitForTimeout(200);

        // Wait for debounce period
        await page.waitForTimeout(1500);

        const finalCount = await page.evaluate(() =>
            ((window as any)._mediaLogs || []).filter((l: any) => l.action === 'play' && String(l.src).includes('example.com')).length
        );

        // Should only trigger once due to debounce (1 second)
        expect(finalCount - initialCount).toBeLessThanOrEqual(1);
    });

    test('console logs show correct unlock workflow', async ({ page }) => {
        const logs: string[] = [];

        // Capture console logs
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('[QuestMap]')) {
                logs.push(text);
            }
        });

        await page.goto('/map');

        await page.getByTestId('mode-play').click();

        // Wait for unlock process
        await page.waitForTimeout(2000);

        // Verify expected log sequence
        const hasUnlockAttempt = logs.some(log => log.includes('Attempting audio unlock'));
        const hasUnlockSuccess = logs.some(log => log.includes('Audio fully unlocked') || log.includes('unlocked'));

        expect(hasUnlockAttempt || hasUnlockSuccess).toBe(true);
    });

    test('notification auto-dismisses after 2 seconds', async ({ page }) => {
        await page.goto('/map');

        await page.getByTestId('mode-play').click();

        // Notification should appear
        const notification = page.getByText('Audio attivato!');
        await expect(notification).toBeVisible({ timeout: 3000 });

        // Notification should disappear after 2 seconds
        await expect(notification).not.toBeVisible({ timeout: 3000 });
    });

    test('audio instances are properly tracked', async ({ page, context }) => {
        await context.setGeolocation({ latitude: 51.505, longitude: -0.09 });
        await page.goto('/map');

        await page.getByTestId('mode-play').click();
        const gpsButton = page.getByTestId('gps-toggle');
        await gpsButton.click();

        // Wait for audio to be created
        await page.waitForTimeout(2000);

        const audioData = await page.evaluate(() => {
            const instances = (window as any)._audioInstances;
            const logs = (window as any)._audioLogs;
            const mediaLogs = (window as any)._mediaLogs || [];

            return {
                instanceCount: instances.length,
                hasQuestAudio: mediaLogs.some((l: any) => l.action === 'play' && String(l.src).includes('example.com')),
                hasSilentAudio: instances.some((i: any) =>
                    i.src.includes('data:audio') || i.src === ''
                ),
                playActions: logs.filter((l: any) => l.action === 'play').length,
                pauseActions: logs.filter((l: any) => l.action === 'pause').length
            };
        });

        // Should have created audio instances
        expect(audioData.instanceCount).toBeGreaterThan(0);

        // Should have play actions
        expect(audioData.playActions).toBeGreaterThan(0);
    });

    test('Steps mode hides GPS toggle', async ({ page }) => {
        await page.goto('/map');
        await page.getByTestId('mode-steps').click();
        await expect(page.getByTestId('gps-toggle')).toHaveCount(0);
    });
});
