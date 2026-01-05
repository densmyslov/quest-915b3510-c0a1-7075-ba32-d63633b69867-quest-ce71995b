# Audio Testing Strategy

> Comprehensive testing plan to prevent regression on audio playback and proximity triggers

**Last Updated**: 2025-12-19
**Status**: 🚧 In Progress

---

## Note (UI Change)

The legacy **audio unlock button** has been removed. Current user gestures that unlock audio are:
- Selecting `Play mode` / `Steps mode`
- Interacting with the map (tap/drag/zoom)
- In Play mode, tapping `Attiva Bussola`

## Table of Contents

1. [Current Testing State](#current-testing-state)
2. [Testing Strategy Overview](#testing-strategy-overview)
3. [Unit Tests](#1-unit-tests)
4. [Integration Tests](#2-integration-tests)
5. [E2E Tests](#3-e2e-tests)
6. [Visual Regression Tests](#4-visual-regression-tests)
7. [Manual Testing Checklist](#5-manual-testing-checklist)
8. [CI/CD Setup](#6-continuous-integration-setup)
9. [Monitoring & Logging](#7-monitoring--logging)
10. [Test Data](#8-test-data)
11. [Implementation Roadmap](#implementation-roadmap)

---

## Current Testing State

### ✅ Existing Tests

| Type | File | Coverage |
|------|------|----------|
| E2E | [`e2e/audio-trigger.spec.ts`](../e2e/audio-trigger.spec.ts) | Basic proximity trigger |
| Unit | [`src/utils/validateQuestData.test.ts`](../src/utils/validateQuestData.test.ts) | Quest data validation |
| Framework | Playwright | Configured and working |

### ❌ Testing Gaps

- No unit tests for audio unlock logic
- No tests for multi-format fallback (MP3 → WAV → OGG)
- No tests for proximity detection edge cases
- Limited E2E coverage (only happy path)
- No visual regression tests
- No performance/memory leak tests
- No CI/CD automation

---

## Testing Strategy Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Testing Pyramid                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│        E2E Tests (User Flows)                               │
│        ▲                                                    │
│       ╱ ╲   • Audio unlock workflows                        │
│      ╱   ╲  • Proximity triggers                            │
│     ╱     ╲ • Multi-device scenarios                        │
│    ╱───────╲                                                │
│   ╱         ╲                                               │
│  ╱Integration╲                                              │
│ ╱    Tests    ╲  • QuestMap + Audio                         │
│╱───────────────╲ • Proximity + GPS                          │
│                                                             │
│   Unit Tests     • audioUnlock()                            │
│  ▔▔▔▔▔▔▔▔▔▔▔▔▔   • calculateDistance()                      │
│                  • Multi-format fallback                    │
│                  • Zone detection logic                     │
└─────────────────────────────────────────────────────────────┘
```

**Testing Principles:**
- **Fast Feedback**: Unit tests run in < 1 second
- **Isolation**: Each test is independent
- **Realistic**: E2E tests use real browser behaviors
- **Comprehensive**: Cover happy path + edge cases + errors
- **Maintainable**: Clear test names, good documentation

---

## 1. Unit Tests

> **Status**: 🔴 Not Implemented
> **Priority**: 🔥 High

### 1.1 Audio Unlock Logic Tests

**File to create**: `src/utils/audioUnlock.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unlockAudio } from './audioUnlock';

describe('audioUnlock', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  describe('Multi-format fallback', () => {
    it('should try MP3 format first', async () => {
      // Mock Audio to succeed on MP3
      const mockAudio = vi.fn().mockImplementation(() => ({
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        src: ''
      }));
      global.Audio = mockAudio as any;

      const result = await unlockAudio();

      expect(result).toBe(true);
      expect(mockAudio).toHaveBeenCalledTimes(1);
      expect(mockAudio.mock.results[0].value.src).toContain('audio/mp3');
    });

    it('should fallback to WAV if MP3 fails', async () => {
      let callCount = 0;
      const mockAudio = vi.fn().mockImplementation(() => ({
        play: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error('NotSupportedError'));
          }
          return Promise.resolve();
        }),
        pause: vi.fn(),
        src: ''
      }));
      global.Audio = mockAudio as any;

      const result = await unlockAudio();

      expect(result).toBe(true);
      expect(mockAudio).toHaveBeenCalledTimes(2);
      expect(mockAudio.mock.results[1].value.src).toContain('audio/wav');
    });

    it('should fallback to OGG if WAV fails', async () => {
      let callCount = 0;
      const mockAudio = vi.fn().mockImplementation(() => ({
        play: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount <= 2) {
            return Promise.reject(new Error('NotSupportedError'));
          }
          return Promise.resolve();
        }),
        pause: vi.fn(),
        src: ''
      }));
      global.Audio = mockAudio as any;

      const result = await unlockAudio();

      expect(result).toBe(true);
      expect(mockAudio).toHaveBeenCalledTimes(3);
    });

    it('should return false if all formats fail', async () => {
      const mockAudio = vi.fn().mockImplementation(() => ({
        play: vi.fn().mockRejectedValue(new Error('NotSupportedError')),
        pause: vi.fn(),
        src: ''
      }));
      global.Audio = mockAudio as any;

      const result = await unlockAudio();

      expect(result).toBe(false);
      expect(mockAudio).toHaveBeenCalledTimes(3);
    });
  });

  describe('AudioContext unlock', () => {
    it('should unlock AudioContext', async () => {
      const mockStart = vi.fn();
      const mockConnect = vi.fn();
      const mockCreateBufferSource = vi.fn().mockReturnValue({
        buffer: null,
        connect: mockConnect,
        start: mockStart
      });
      const mockCreateBuffer = vi.fn().mockReturnValue({});

      global.AudioContext = vi.fn().mockImplementation(() => ({
        createBuffer: mockCreateBuffer,
        createBufferSource: mockCreateBufferSource,
        destination: {}
      })) as any;

      await unlockAudio();

      expect(mockCreateBuffer).toHaveBeenCalled();
      expect(mockConnect).toHaveBeenCalled();
      expect(mockStart).toHaveBeenCalledWith(0);
    });

    it('should handle missing AudioContext gracefully', async () => {
      global.AudioContext = undefined as any;
      global.webkitAudioContext = undefined as any;

      // Should still try HTML5 Audio unlock
      const mockAudio = vi.fn().mockImplementation(() => ({
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        src: ''
      }));
      global.Audio = mockAudio as any;

      const result = await unlockAudio();

      expect(result).toBe(true);
      expect(mockAudio).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle NotAllowedError', async () => {
      const mockAudio = vi.fn().mockImplementation(() => ({
        play: vi.fn().mockRejectedValue(
          Object.assign(new Error('NotAllowedError'), { name: 'NotAllowedError' })
        ),
        pause: vi.fn(),
        src: ''
      }));
      global.Audio = mockAudio as any;

      const result = await unlockAudio();

      expect(result).toBe(false);
    });

    it('should log errors to console', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const mockAudio = vi.fn().mockImplementation(() => ({
        play: vi.fn().mockRejectedValue(new Error('Test error')),
        pause: vi.fn(),
        src: ''
      }));
      global.Audio = mockAudio as any;

      await unlockAudio();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Audio unlock failed')
      );
    });
  });
});
```

### 1.2 Proximity Detection Tests

**File to create**: `src/hooks/useProximityTracker.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProximityTracker } from './useProximityTracker';

describe('useProximityTracker', () => {
  describe('calculateDistance', () => {
    it('should calculate correct distance between two points', () => {
      // London to Paris: ~343km
      const distance = calculateDistance(51.5074, -0.1278, 48.8566, 2.3522);
      expect(distance).toBeCloseTo(343000, -3); // Within 1km
    });

    it('should return 0 for identical coordinates', () => {
      const distance = calculateDistance(51.5, -0.1, 51.5, -0.1);
      expect(distance).toBe(0);
    });

    it('should handle negative coordinates', () => {
      const distance = calculateDistance(-33.8688, 151.2093, -37.8136, 144.9631);
      expect(distance).toBeGreaterThan(0);
    });
  });

  describe('Zone detection', () => {
    it('should detect zone entry at exact radius', () => {
      const onEnterZone = vi.fn();
      const stops = [{
        id: 'test',
        name: 'Test Stop',
        coordinates: '51.505, -0.09',
        triggerRadius: 20
      }];

      const { result } = renderHook(() =>
        useProximityTracker({ stops, onEnterZone })
      );

      // Simulate GPS position exactly at radius
      act(() => {
        // Position 20m away from stop
      });

      expect(onEnterZone).toHaveBeenCalled();
    });

    it('should detect zone exit when exceeding radius', () => {
      const onExitZone = vi.fn();
      const stops = [{
        id: 'test',
        name: 'Test Stop',
        coordinates: '51.505, -0.09',
        triggerRadius: 20
      }];

      const { result } = renderHook(() =>
        useProximityTracker({ stops, onExitZone })
      );

      // Enter zone
      act(() => {
        // Position inside radius
      });

      // Exit zone
      act(() => {
        // Position outside radius
      });

      expect(onExitZone).toHaveBeenCalled();
    });

    it('should use default radius of 20m if not specified', () => {
      const onEnterZone = vi.fn();
      const stops = [{
        id: 'test',
        name: 'Test Stop',
        coordinates: '51.505, -0.09'
        // No triggerRadius specified
      }];

      // Should use 20m default
    });
  });

  describe('Debouncing', () => {
    it('should debounce rapid GPS updates', async () => {
      const onEnterZone = vi.fn();
      const stops = [{
        id: 'test',
        name: 'Test Stop',
        coordinates: '51.505, -0.09',
        triggerRadius: 20
      }];

      const { result } = renderHook(() =>
        useProximityTracker({
          stops,
          onEnterZone,
          debounceMs: 1000
        })
      );

      // Trigger multiple times within 1 second
      act(() => {
        // Position update 1
      });
      act(() => {
        // Position update 2 (< 1s later)
      });

      // Should only trigger once
      expect(onEnterZone).toHaveBeenCalledTimes(1);
    });

    it('should allow trigger after debounce period', async () => {
      vi.useFakeTimers();

      const onEnterZone = vi.fn();
      const stops = [{
        id: 'test',
        name: 'Test Stop',
        coordinates: '51.505, -0.09',
        triggerRadius: 20
      }];

      const { result } = renderHook(() =>
        useProximityTracker({
          stops,
          onEnterZone,
          debounceMs: 1000
        })
      );

      act(() => {
        // Trigger 1
      });

      // Wait for debounce period
      act(() => {
        vi.advanceTimersByTime(1001);
      });

      act(() => {
        // Trigger 2 (> 1s later)
      });

      expect(onEnterZone).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('oneTimeOnly mode', () => {
    it('should trigger only once when oneTimeOnly=true', () => {
      const onEnterZone = vi.fn();
      const stops = [{
        id: 'test',
        name: 'Test Stop',
        coordinates: '51.505, -0.09',
        triggerRadius: 20
      }];

      const { result } = renderHook(() =>
        useProximityTracker({
          stops,
          onEnterZone,
          oneTimeOnly: true
        })
      );

      // Enter, exit, re-enter
      act(() => {
        // Enter zone
      });
      act(() => {
        // Exit zone
      });
      act(() => {
        // Re-enter zone
      });

      expect(onEnterZone).toHaveBeenCalledTimes(1);
    });

    it('should allow re-triggers when oneTimeOnly=false', () => {
      const onEnterZone = vi.fn();
      const stops = [{
        id: 'test',
        name: 'Test Stop',
        coordinates: '51.505, -0.09',
        triggerRadius: 20
      }];

      const { result } = renderHook(() =>
        useProximityTracker({
          stops,
          onEnterZone,
          oneTimeOnly: false
        })
      );

      // Enter, exit, re-enter
      act(() => {
        // Enter zone (trigger 1)
      });
      act(() => {
        // Exit zone
      });
      act(() => {
        // Re-enter zone (trigger 2)
      });

      expect(onEnterZone).toHaveBeenCalledTimes(2);
    });
  });
});
```

### 1.3 Audio URL Resolution Tests

**File to create**: `src/utils/audioUrlResolver.test.ts`

```typescript
describe('Audio URL Resolution', () => {
  it('should prioritize audio_effect.media_url when enabled', () => {
    const obj = {
      audio_effect: { enabled: true, media_url: 'url1.mp3' },
      audioUrl: 'url2.mp3',
      audio_url: 'url3.mp3'
    };
    expect(resolveAudioUrl(obj)).toBe('url1.mp3');
  });

  it('should skip audio_effect when disabled', () => {
    const obj = {
      audio_effect: { enabled: false, media_url: 'url1.mp3' },
      audioUrl: 'url2.mp3'
    };
    expect(resolveAudioUrl(obj)).toBe('url2.mp3');
  });

  it('should fallback to audioUrl', () => {
    const obj = {
      audioUrl: 'url2.mp3',
      audio_url: 'url3.mp3'
    };
    expect(resolveAudioUrl(obj)).toBe('url2.mp3');
  });

  it('should fallback to audio_url', () => {
    const obj = {
      audio_url: 'url3.mp3'
    };
    expect(resolveAudioUrl(obj)).toBe('url3.mp3');
  });

  it('should use image audioUrl as last resort', () => {
    const obj = {
      images: [
        { audioUrl: 'image-audio.mp3' }
      ]
    };
    expect(resolveAudioUrl(obj)).toBe('image-audio.mp3');
  });

  it('should return null if no audio URL found', () => {
    const obj = { id: 'test' };
    expect(resolveAudioUrl(obj)).toBeNull();
  });
});
```

---

## 2. Integration Tests

> **Status**: 🔴 Not Implemented
> **Priority**: 🔥 High

### 2.1 QuestMap Audio Integration

**File to create**: `src/components/QuestMap.audio.test.tsx`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuestMap from './QuestMap';

describe('QuestMap Audio Integration', () => {
  beforeEach(() => {
    // Mock geolocation
    global.navigator.geolocation = {
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn()
    };

    // Mock Audio
    global.Audio = vi.fn().mockImplementation(() => ({
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      src: '',
      currentTime: 0
    }));
  });

  describe('Audio Unlock Button', () => {
    it('should show pulsing button on mount', () => {
      render(<QuestMap />);
      const button = screen.getByTestId('audio-lock-button');
      expect(button).toBeInTheDocument();
      expect(button).toHaveStyle({ animation: expect.stringContaining('pulse') });
    });

    it('should hide button after successful unlock', async () => {
      render(<QuestMap />);
      const button = screen.getByTestId('audio-lock-button');

      fireEvent.click(button);

      await waitFor(() => {
        expect(button).not.toBeInTheDocument();
      });
    });

    it('should show "Audio attivato!" notification on unlock', async () => {
      render(<QuestMap />);
      const button = screen.getByTestId('audio-lock-button');

      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Audio attivato!')).toBeInTheDocument();
      });
    });

    it('should re-show button if unlock fails', async () => {
      global.Audio = vi.fn().mockImplementation(() => ({
        play: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
        pause: vi.fn()
      }));

      render(<QuestMap />);
      const button = screen.getByTestId('audio-lock-button');

      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toBeInTheDocument(); // Still visible
      });
    });
  });

  describe('Map Interaction Unlock', () => {
    it('should unlock audio on map click', async () => {
      render(<QuestMap />);
      const map = screen.getByTestId('leaflet-map');

      fireEvent.click(map);

      await waitFor(() => {
        expect(screen.getByText('Audio attivato!')).toBeInTheDocument();
      });
    });

    it('should unlock audio on map drag', async () => {
      render(<QuestMap />);
      const map = screen.getByTestId('leaflet-map');

      fireEvent.dragStart(map);

      await waitFor(() => {
        expect(screen.getByText('Audio attivato!')).toBeInTheDocument();
      });
    });

    it('should unlock audio on map zoom', async () => {
      render(<QuestMap />);
      const map = screen.getByTestId('leaflet-map');

      fireEvent.wheel(map); // Zoom event

      await waitFor(() => {
        expect(screen.getByText('Audio attivato!')).toBeInTheDocument();
      });
    });
  });

  describe('Proximity Trigger Integration', () => {
    it('should play audio when entering zone', async () => {
      const mockAudio = vi.fn().mockImplementation(() => ({
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        addEventListener: vi.fn()
      }));
      global.Audio = mockAudio;

      render(<QuestMap questData={testQuestData} />);

      // Simulate GPS position update (enter zone)
      act(() => {
        triggerGPSUpdate({ latitude: 51.505, longitude: -0.09 });
      });

      await waitFor(() => {
        expect(mockAudio).toHaveBeenCalled();
        expect(mockAudio.mock.results[0].value.play).toHaveBeenCalled();
      });
    });

    it('should stop audio when exiting zone', async () => {
      const mockPause = vi.fn();
      const mockAudio = vi.fn().mockImplementation(() => ({
        play: vi.fn().mockResolvedValue(undefined),
        pause: mockPause,
        addEventListener: vi.fn()
      }));
      global.Audio = mockAudio;

      render(<QuestMap questData={testQuestData} />);

      // Enter zone
      act(() => {
        triggerGPSUpdate({ latitude: 51.505, longitude: -0.09 });
      });

      // Exit zone
      act(() => {
        triggerGPSUpdate({ latitude: 51.510, longitude: -0.09 });
      });

      await waitFor(() => {
        expect(mockPause).toHaveBeenCalled();
      });
    });

    it('should allow re-entry trigger', async () => {
      const mockPlay = vi.fn().mockResolvedValue(undefined);
      const mockAudio = vi.fn().mockImplementation(() => ({
        play: mockPlay,
        pause: vi.fn(),
        addEventListener: vi.fn()
      }));
      global.Audio = mockAudio;

      render(<QuestMap questData={testQuestData} />);

      // Enter zone (trigger 1)
      act(() => {
        triggerGPSUpdate({ latitude: 51.505, longitude: -0.09 });
      });

      // Exit zone
      act(() => {
        triggerGPSUpdate({ latitude: 51.510, longitude: -0.09 });
      });

      // Re-enter zone (trigger 2)
      act(() => {
        triggerGPSUpdate({ latitude: 51.505, longitude: -0.09 });
      });

      await waitFor(() => {
        expect(mockPlay).toHaveBeenCalledTimes(2);
      });
    });
  });
});
```

---

## 3. E2E Tests

> **Status**: 🟡 Partial (Basic test exists)
> **Priority**: 🔥 High

### 3.1 Expand Existing E2E Tests

**File to enhance**: `e2e/audio-trigger.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Audio Trigger E2E', () => {
  test.beforeEach(async ({ page, context }) => {
    // Mock Audio globally
    await page.addInitScript(() => {
      (window as any)._audioInstances = [];
      const MockAudio = class {
        src: string;
        volume: number = 1;
        paused: boolean = true;

        constructor(src?: string) {
          this.src = src || '';
          (window as any)._audioInstances.push(this);
        }

        play() {
          this.paused = false;
          return Promise.resolve();
        }

        pause() {
          this.paused = true;
        }
      };

      Object.defineProperty(window, 'Audio', {
        writable: true,
        value: MockAudio
      });
    });

    // Grant geolocation permission
    await context.grantPermissions(['geolocation']);
  });

  // ✅ Existing test
  test('should trigger audio playback when approaching object', async ({ page, context }) => {
    await context.setGeolocation({ latitude: 51.51, longitude: -0.09 });
    await page.goto('/map');

    const gpsButton = page.getByTestId('gps-toggle');
    await gpsButton.click();

    await context.setGeolocation({ latitude: 51.505, longitude: -0.09 });

    await expect.poll(async () => {
      return await page.evaluate(() => {
        const instances = (window as any)._audioInstances;
        if (!instances || instances.length === 0) return null;
        const target = instances.find((i: any) => i.src.includes('example.com'));
        return target ? target.src : null;
      });
    }, {
      message: 'Audio should be instantiated',
      timeout: 10000
    }).toBe('https://example.com/audio.mp3');
  });

  // 🆕 NEW TESTS BELOW

  test('audio unlock button workflow', async ({ page }) => {
    await page.goto('/map');

    // 1. Verify button is visible and pulsing
    const audioButton = page.getByTestId('audio-lock-button');
    await expect(audioButton).toBeVisible();

    const animation = await audioButton.evaluate(el =>
      window.getComputedStyle(el).animation
    );
    expect(animation).toContain('pulse');

    // 2. Click button
    await audioButton.click();

    // 3. Verify "Audio attivato!" notification
    await expect(page.getByText('Audio attivato!')).toBeVisible();

    // 4. Verify button disappears
    await expect(audioButton).not.toBeVisible();

    // 5. Verify audio is unlocked (console test works)
    const unlocked = await page.evaluate(() => {
      const instances = (window as any)._audioInstances;
      return instances && instances.length > 0;
    });
    expect(unlocked).toBe(true);
  });

  test('map interaction unlocks audio', async ({ page }) => {
    await page.goto('/map');

    const audioButton = page.getByTestId('audio-lock-button');
    await expect(audioButton).toBeVisible();

    // Click map to unlock
    const map = page.locator('.leaflet-container');
    await map.click();

    // Verify notification
    await expect(page.getByText('Audio attivato!')).toBeVisible();

    // Verify button disappears
    await expect(audioButton).not.toBeVisible();
  });

  test('audio stops when leaving zone', async ({ page, context }) => {
    await page.goto('/map');

    // Unlock audio first
    const gpsButton = page.getByTestId('gps-toggle');
    await gpsButton.click();

    // Approach object (enter zone)
    await context.setGeolocation({ latitude: 51.505, longitude: -0.09 });

    // Wait for audio to play
    await page.waitForTimeout(2000);

    const playingAudio = await page.evaluate(() => {
      const instances = (window as any)._audioInstances;
      return instances.find((i: any) => !i.paused);
    });
    expect(playingAudio).toBeTruthy();

    // Move away from object (exit zone)
    await context.setGeolocation({ latitude: 51.510, longitude: -0.09 });

    // Wait for exit detection
    await page.waitForTimeout(2000);

    // Verify audio stopped
    const stoppedAudio = await page.evaluate(() => {
      const instances = (window as any)._audioInstances;
      return instances.every((i: any) => i.paused);
    });
    expect(stoppedAudio).toBe(true);
  });

  test('audio re-triggers on zone re-entry', async ({ page, context }) => {
    await page.goto('/map');

    const gpsButton = page.getByTestId('gps-toggle');
    await gpsButton.click();

    // First entry
    await context.setGeolocation({ latitude: 51.505, longitude: -0.09 });
    await page.waitForTimeout(2000);

    let audioCount = await page.evaluate(() =>
      (window as any)._audioInstances.length
    );
    expect(audioCount).toBeGreaterThan(0);

    // Exit zone
    await context.setGeolocation({ latitude: 51.510, longitude: -0.09 });
    await page.waitForTimeout(2000);

    // Re-enter zone
    await context.setGeolocation({ latitude: 51.505, longitude: -0.09 });
    await page.waitForTimeout(2000);

    // Should have created new audio instance
    audioCount = await page.evaluate(() =>
      (window as any)._audioInstances.length
    );
    expect(audioCount).toBeGreaterThan(1);
  });

  test('multiple audio objects', async ({ page, context }) => {
    await page.goto('/map');

    const gpsButton = page.getByTestId('gps-toggle');
    await gpsButton.click();

    // Approach object A
    await context.setGeolocation({ latitude: 51.505, longitude: -0.09 });
    await page.waitForTimeout(2000);

    const audioA = await page.evaluate(() => {
      const instances = (window as any)._audioInstances;
      return instances[instances.length - 1]?.src;
    });

    // Move to object B
    await context.setGeolocation({ latitude: 51.506, longitude: -0.09 });
    await page.waitForTimeout(2000);

    const audioB = await page.evaluate(() => {
      const instances = (window as any)._audioInstances;
      return instances[instances.length - 1]?.src;
    });

    // Verify different audio URLs
    expect(audioA).not.toBe(audioB);
  });

  test('audio unlock failure recovery', async ({ page }) => {
    // Mock Audio to fail
    await page.addInitScript(() => {
      const FailingAudio = class {
        play() {
          return Promise.reject(new Error('NotAllowedError'));
        }
      };
      (window as any).Audio = FailingAudio;
    });

    await page.goto('/map');

    const audioButton = page.getByTestId('audio-lock-button');
    await audioButton.click();

    // Button should re-appear
    await expect(audioButton).toBeVisible();

    // Error notification should show
    await expect(page.getByText(/audio/i)).toBeVisible();
  });

  test('multi-format fallback', async ({ page }) => {
    let formatAttempts: string[] = [];

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
          // Fail MP3, succeed on WAV
          if (this._src.includes('audio/mp3')) {
            return Promise.reject(new Error('NotSupportedError'));
          }
          return Promise.resolve();
        }
      };

      (window as any).Audio = FallbackAudio;
    });

    await page.goto('/map');

    const audioButton = page.getByTestId('audio-lock-button');
    await audioButton.click();

    // Wait for unlock attempt
    await page.waitForTimeout(1000);

    formatAttempts = await page.evaluate(() =>
      (window as any)._formatAttempts
    );

    // Should have tried MP3 first, then WAV
    expect(formatAttempts.length).toBeGreaterThanOrEqual(2);
    expect(formatAttempts[0]).toContain('audio/mp3');
    expect(formatAttempts[1]).toContain('audio/wav');
  });

  test('structured vs legacy audio format', async ({ page, context }) => {
    await page.goto('/map');

    const gpsButton = page.getByTestId('gps-toggle');
    await gpsButton.click();

    // Object with audio_effect (structured)
    await context.setGeolocation({ latitude: 51.505, longitude: -0.09 });
    await page.waitForTimeout(2000);

    let audioUrl = await page.evaluate(() => {
      const instances = (window as any)._audioInstances;
      return instances[instances.length - 1]?.src;
    });
    expect(audioUrl).toBeTruthy();

    // Object with audioUrl (legacy)
    await context.setGeolocation({ latitude: 51.506, longitude: -0.09 });
    await page.waitForTimeout(2000);

    audioUrl = await page.evaluate(() => {
      const instances = (window as any)._audioInstances;
      return instances[instances.length - 1]?.src;
    });
    expect(audioUrl).toBeTruthy();
  });

  test('GPS accuracy edge cases - jitter handling', async ({ page, context }) => {
    await page.goto('/map');

    const gpsButton = page.getByTestId('gps-toggle');
    await gpsButton.click();

    const initialCount = await page.evaluate(() =>
      (window as any)._audioInstances.length
    );

    // Simulate GPS jitter (rapid small position changes)
    await context.setGeolocation({ latitude: 51.5050, longitude: -0.09 });
    await page.waitForTimeout(200);
    await context.setGeolocation({ latitude: 51.5051, longitude: -0.09 });
    await page.waitForTimeout(200);
    await context.setGeolocation({ latitude: 51.5049, longitude: -0.09 });
    await page.waitForTimeout(2000);

    const finalCount = await page.evaluate(() =>
      (window as any)._audioInstances.length
    );

    // Should only trigger once due to debounce
    expect(finalCount - initialCount).toBeLessThanOrEqual(1);
  });

  test('console logs show correct workflow', async ({ page, context }) => {
    const logs: string[] = [];

    page.on('console', msg => {
      if (msg.text().includes('[QuestMap]')) {
        logs.push(msg.text());
      }
    });

    await page.goto('/map');

    const gpsButton = page.getByTestId('gps-toggle');
    await gpsButton.click();

    await context.setGeolocation({ latitude: 51.505, longitude: -0.09 });
    await page.waitForTimeout(3000);

    // Verify expected log sequence
    expect(logs).toContain(expect.stringContaining('Attempting audio unlock'));
    expect(logs).toContain(expect.stringContaining('AudioContext unlocked'));
    expect(logs).toContain(expect.stringContaining('Audio fully unlocked'));
    expect(logs).toContain(expect.stringContaining('Entering zone'));
    expect(logs).toContain(expect.stringContaining('Audio playing'));
  });
});
```

---

## 4. Visual Regression Tests

> **Status**: 🔴 Not Implemented
> **Priority**: 🟡 Medium

**File to create**: `e2e/audio-visual.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Audio UI Visual Regression', () => {
  test('audio lock button appearance', async ({ page }) => {
    await page.goto('/map');

    const button = page.getByTestId('audio-lock-button');
    await expect(button).toBeVisible();

    // Take screenshot for comparison
    await expect(button).toHaveScreenshot('audio-lock-button.png', {
      animations: 'disabled'
    });
  });

  test('audio lock button pulse animation', async ({ page }) => {
    await page.goto('/map');

    const button = page.getByTestId('audio-lock-button');

    // Verify animation is applied
    const animation = await button.evaluate(el =>
      window.getComputedStyle(el).animation
    );

    expect(animation).toMatch(/audioButtonPulse/);
    expect(animation).toMatch(/2s/); // Duration
    expect(animation).toMatch(/ease-in-out/);
    expect(animation).toMatch(/infinite/);
  });

  test('notification display', async ({ page }) => {
    await page.goto('/map');

    const audioButton = page.getByTestId('audio-lock-button');
    await audioButton.click();

    const notification = page.getByText('Audio attivato!');
    await expect(notification).toBeVisible();

    // Screenshot notification
    await expect(notification).toHaveScreenshot('audio-notification.png');
  });

  test('button positioning is correct', async ({ page }) => {
    await page.goto('/map');

    const button = page.getByTestId('audio-lock-button');
    const box = await button.boundingBox();

    expect(box).toBeTruthy();
    expect(box!.x).toBeCloseTo(16, 5); // 16px from left
    expect(box!.y).toBeCloseTo(70, 5); // 70px from top
  });
});
```

---

## 5. Manual Testing Checklist

> **Status**: 🟡 Partial (from AUDIO_QUICK_START.md)
> **Priority**: 🔥 High

**File to create**: `docs/AUDIO_TESTING_CHECKLIST.md`

```markdown
# Audio Testing Checklist

> Manual tests to run before each release

**Last Run**: ___________
**Tester**: ___________
**Build**: ___________

---

## Desktop Testing

### Chrome (Latest)

#### Audio Unlock
- [ ] Audio button appears on page load
- [ ] Button has pulsing animation
- [ ] Clicking button unlocks audio
- [ ] Console shows: `[QuestMap] ✅ Audio fully unlocked and ready`
- [ ] Button disappears after unlock
- [ ] Notification shows: "Audio attivato!"
- [ ] Notification auto-dismisses after 2 seconds

#### Map Interaction Unlock
- [ ] Map click unlocks audio
- [ ] Map drag unlocks audio
- [ ] Map zoom unlocks audio
- [ ] Each shows unlock notification

#### Console Test
After unlock, run in console:
```javascript
new Audio('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3').play()
```
- [ ] Audio plays without error

#### Proximity Trigger
- [ ] Enable GPS
- [ ] Walk/simulate to within trigger radius
- [ ] Console shows: `[QuestMap] Entering zone for [Object]`
- [ ] Console shows: `[QuestMap] Audio playing: [Object]`
- [ ] Audio plays automatically
- [ ] Walk/simulate out of zone
- [ ] Console shows: `[QuestMap] Exiting zone for [Object]`
- [ ] Audio stops
- [ ] Re-enter zone
- [ ] Audio plays again

### Firefox (Latest)

Repeat all Chrome tests:
- [ ] Audio unlock works
- [ ] Map interactions work
- [ ] Proximity triggers work
- [ ] Console logs correct

### Safari (Latest)

Repeat all Chrome tests:
- [ ] Audio unlock works
- [ ] Map interactions work
- [ ] Proximity triggers work
- [ ] Console logs correct

---

## Mobile Testing

### iOS Safari

#### Audio Unlock
- [ ] Audio button appears and pulses
- [ ] Tap button unlocks audio
- [ ] Button disappears
- [ ] Notification shows
- [ ] GPS button also unlocks audio
- [ ] Map tap/drag unlocks audio

#### Proximity Trigger (Real Device)
- [ ] Enable GPS
- [ ] Walk to real location with quest object
- [ ] Audio plays when within radius
- [ ] Audio stops when leaving
- [ ] Can re-trigger by re-entering
- [ ] Check battery usage (< 5% per hour)

#### Console Logs (Safari Web Inspector)
Connect device to Mac, open Web Inspector:
- [ ] `[QuestMap] Attempting audio unlock...`
- [ ] `[QuestMap] AudioContext unlocked`
- [ ] `[QuestMap] HTML5 Audio unlocked with format: data:audio/___`
- [ ] `[QuestMap] ✅ Audio fully unlocked and ready`
- [ ] No `NotAllowedError`
- [ ] No `NotSupportedError` (or shows fallback)

### Android Chrome

Repeat all iOS Safari tests:
- [ ] Audio unlock works
- [ ] GPS triggers work
- [ ] Console logs correct
- [ ] Battery usage acceptable

---

## Edge Cases

### GPS Accuracy
- [ ] Trigger radius = 20m works reliably
- [ ] Poor GPS (urban canyon): increase radius to 30m
- [ ] GPS accuracy reading shown in UI
- [ ] Audio doesn't trigger too early

### Rapid Zone Entry/Exit
- [ ] Enter zone quickly
- [ ] Exit zone quickly
- [ ] Re-enter zone quickly
- [ ] No console error: "interrupted by a call to pause()"
- [ ] Audio plays smoothly

### Multiple Objects
- [ ] Two objects within 50m of each other
- [ ] Walk between them
- [ ] Correct audio plays for each
- [ ] No audio overlap/conflict

### Network Issues
- [ ] Test with slow 3G connection
- [ ] Audio loads within 5 seconds
- [ ] Loading indicator (if implemented)
- [ ] Graceful timeout handling

### Airplane Mode
- [ ] Enable airplane mode
- [ ] Try to enable GPS (should fail gracefully)
- [ ] Re-enable connectivity
- [ ] GPS resumes working
- [ ] Audio triggers work

### Browser Refresh
- [ ] Audio playing
- [ ] Refresh page
- [ ] Audio state resets
- [ ] Can unlock and trigger again

### Invalid Audio URL
- [ ] Object with invalid/404 audio URL
- [ ] Console shows: `[QuestMap] Audio ERROR: Failed to load`
- [ ] Notification shown to user
- [ ] No crash/hang

### Missing Audio URL
- [ ] Object without any audio property
- [ ] No error in console
- [ ] No audio plays (expected)
- [ ] Other functionality works

---

## Performance

### Memory Leaks (Chrome DevTools)
- [ ] Open Performance Monitor
- [ ] Let app run for 5 minutes with GPS on
- [ ] Trigger audio multiple times
- [ ] Memory usage < 100MB
- [ ] No continuous memory growth

### Audio Loading
- [ ] Audio files load within 3 seconds
- [ ] No blocking of UI
- [ ] Smooth playback start

### UI Responsiveness
- [ ] Map interactions smooth during audio
- [ ] No lag when entering zones
- [ ] Button click responsive

---

## Accessibility

### Screen Readers
- [ ] Audio button has `aria-label`
- [ ] Notification announced to screen reader
- [ ] GPS toggle announced

### Keyboard Navigation
- [ ] Tab to audio button
- [ ] Enter/Space activates
- [ ] Focus visible

---

## Regression Tests

### Recent Fixes Verification

#### Multi-format Fallback (v2.1)
- [ ] Mock MP3 to fail
- [ ] Console shows: `Format failed, trying next`
- [ ] WAV format attempted
- [ ] Unlock succeeds

#### Race Condition Fix
- [ ] Enter zone
- [ ] Exit immediately (< 1 second)
- [ ] Re-enter zone
- [ ] No "interrupted by pause()" error

#### Exit Zone Cleanup
- [ ] Audio plays in zone
- [ ] Exit zone
- [ ] Console shows: `Audio stopped for [Object]`
- [ ] Audio actually stops

---

## Sign-Off

**All tests passing**: ☐ Yes ☐ No

**Issues found**:
___________________________________________
___________________________________________
___________________________________________

**Ready for release**: ☐ Yes ☐ No

**Tested by**: ___________
**Date**: ___________
**Signature**: ___________
```

---

## 6. Continuous Integration Setup

> **Status**: 🔴 Not Implemented
> **Priority**: 🟡 Medium

### 6.1 GitHub Actions Workflow

**File to create**: `.github/workflows/audio-tests.yml`

```yaml
name: Audio Tests

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main, dev]

jobs:
  unit-tests:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
          flags: unit

  e2e-tests:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Build application
        run: npm run build

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload Playwright report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: test-results/
          retention-days: 30

  visual-regression:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run visual tests
        run: npm run test:visual

      - name: Upload visual diffs
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: visual-diffs
          path: test-results/

  test-summary:
    needs: [unit-tests, e2e-tests, visual-regression]
    runs-on: ubuntu-latest
    if: always()

    steps:
      - name: Check test results
        run: |
          echo "Unit Tests: ${{ needs.unit-tests.result }}"
          echo "E2E Tests: ${{ needs.e2e-tests.result }}"
          echo "Visual Tests: ${{ needs.visual-regression.result }}"
```

### 6.2 Update package.json Scripts

```json
{
  "scripts": {
    "test": "npm run test:unit && npm run test:e2e",
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:visual": "playwright test e2e/audio-visual.spec.ts",
    "test:audio": "playwright test e2e/audio-trigger.spec.ts"
  }
}
```

---

## 7. Monitoring & Logging

> **Status**: 🔴 Not Implemented
> **Priority**: 🟡 Medium

### 7.1 Structured Audio Logger

**File to create**: `src/utils/audioLogger.ts`

```typescript
export type AudioLogLevel = 'info' | 'warn' | 'error' | 'success';

export interface AudioLogEntry {
  timestamp: number;
  level: AudioLogLevel;
  event: string;
  data?: any;
}

class AudioLogger {
  private logs: AudioLogEntry[] = [];
  private enabled: boolean = process.env.NODE_ENV === 'development';

  private log(level: AudioLogLevel, event: string, data?: any) {
    const entry: AudioLogEntry = {
      timestamp: Date.now(),
      level,
      event,
      data
    };

    this.logs.push(entry);

    // Keep only last 100 logs
    if (this.logs.length > 100) {
      this.logs.shift();
    }

    if (this.enabled) {
      const icon = {
        info: '📋',
        warn: '⚠️',
        error: '❌',
        success: '✅'
      }[level];

      const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      console[method](`[AudioTest] ${icon} ${event}`, data || '');
    }

    // Send to analytics in production
    if (process.env.NODE_ENV === 'production') {
      this.sendToAnalytics(entry);
    }
  }

  unlock(success: boolean, format?: string, error?: Error) {
    if (success) {
      this.log('success', `Audio unlocked with format: ${format}`);
    } else {
      this.log('error', 'Audio unlock failed', { error: error?.message });
    }
  }

  formatFallback(from: string, to: string, error: Error) {
    this.log('warn', `Format fallback: ${from} → ${to}`, {
      error: error.message
    });
  }

  zoneEnter(objectName: string, distance: number, audioUrl?: string) {
    this.log('info', `▶️ Entered zone: ${objectName}`, {
      distance: distance.toFixed(1),
      audioUrl
    });
  }

  zoneExit(objectName: string, distance: number) {
    this.log('info', `⏹️ Exited zone: ${objectName}`, {
      distance: distance.toFixed(1)
    });
  }

  audioPlay(objectName: string, success: boolean, error?: Error) {
    if (success) {
      this.log('success', `Audio playing: ${objectName}`);
    } else {
      this.log('error', `Audio play failed: ${objectName}`, {
        error: error?.message
      });
    }
  }

  audioStop(objectName: string) {
    this.log('info', `Audio stopped: ${objectName}`);
  }

  getLogs(): AudioLogEntry[] {
    return [...this.logs];
  }

  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  private sendToAnalytics(entry: AudioLogEntry) {
    // Integrate with your analytics service
    // Example: Google Analytics, Sentry, etc.
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'audio_event', {
        event_category: 'audio',
        event_label: entry.event,
        value: entry.level
      });
    }
  }
}

export const audioLogger = new AudioLogger();
```

### 7.2 Integration with QuestMap

Update [src/components/QuestMap.tsx](src/components/QuestMap.tsx) to use the logger:

```typescript
import { audioLogger } from '@/utils/audioLogger';

// In unlockAudio()
try {
  // ... unlock logic ...
  audioLogger.unlock(true, format);
} catch (error) {
  audioLogger.unlock(false, undefined, error);
}

// In proximity trigger
if (isInZone) {
  audioLogger.zoneEnter(obj.name, distance, audioUrl);
  // ... play audio ...
  audioLogger.audioPlay(obj.name, true);
} else {
  audioLogger.zoneExit(obj.name, distance);
  audioLogger.audioStop(obj.name);
}
```

---

## 8. Test Data

> **Status**: 🔴 Not Implemented
> **Priority**: 🔥 High

### 8.1 Test Quest Data

**File to create**: `data/quest.test.json`

```json
{
  "quest": {
    "id": "audio-test-quest",
    "title": "Audio Testing Quest",
    "description": "Quest data for automated testing"
  },
  "objects": [
    {
      "id": "test-audio-structured",
      "name": "Test Audio Structured",
      "coordinates": "51.505, -0.09",
      "audio_effect": {
        "enabled": true,
        "trigger": "proximity",
        "name": "Test Effect Structured",
        "media_url": "https://example.com/test-audio-structured.mp3",
        "triggerRadius": 20,
        "loop": false,
        "volume": 80
      }
    },
    {
      "id": "test-audio-legacy",
      "name": "Test Audio Legacy",
      "coordinates": "51.506, -0.09",
      "audioUrl": "https://example.com/test-audio-legacy.mp3",
      "triggerRadius": 15
    },
    {
      "id": "test-audio-underscore",
      "name": "Test Audio Underscore",
      "coordinates": "51.507, -0.09",
      "audio_url": "https://example.com/test-audio-underscore.mp3",
      "triggerRadius": 15
    },
    {
      "id": "test-audio-image",
      "name": "Test Audio Image",
      "coordinates": "51.508, -0.09",
      "images": [
        {
          "url": "https://example.com/image.jpg",
          "audioUrl": "https://example.com/test-audio-image.mp3"
        }
      ],
      "triggerRadius": 20
    },
    {
      "id": "test-audio-disabled",
      "name": "Test Audio Disabled",
      "coordinates": "51.509, -0.09",
      "audio_effect": {
        "enabled": false,
        "media_url": "https://example.com/should-not-play.mp3",
        "triggerRadius": 20
      },
      "audioUrl": "https://example.com/fallback-audio.mp3"
    },
    {
      "id": "test-no-audio",
      "name": "Test No Audio",
      "coordinates": "51.510, -0.09",
      "description": "Object without any audio"
    },
    {
      "id": "test-large-radius",
      "name": "Test Large Radius",
      "coordinates": "51.511, -0.09",
      "audioUrl": "https://example.com/large-radius.mp3",
      "triggerRadius": 50
    },
    {
      "id": "test-small-radius",
      "name": "Test Small Radius",
      "coordinates": "51.512, -0.09",
      "audioUrl": "https://example.com/small-radius.mp3",
      "triggerRadius": 10
    }
  ],
  "map": {
    "center": {
      "lat": 51.505,
      "lng": -0.09
    },
    "zoom": 15
  }
}
```

### 8.2 Mock Audio Files

**File to create**: `test/fixtures/audio.ts`

```typescript
// Base64-encoded silent audio files for testing
export const silentAudioMP3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v...';

export const silentAudioWAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

export const silentAudioOGG = 'data:audio/ogg;base64,T2dnUwACAAAAAAAAAABNb3ppbGxhAAAAAAAAAAAAAAAAAAAAAAAAQgAAAAAAAACHqmvJAwX/////Dwf////+//////////8VAAAAAAAAAAAA';

export const mockAudioUrls = {
  valid: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  invalid: 'https://example.com/404-not-found.mp3',
  slow: 'https://httpstat.us/200?sleep=5000' // 5 second delay
};
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)

**Priority: 🔥 Critical**

- [ ] Expand E2E tests in `e2e/audio-trigger.spec.ts`
  - [ ] Audio unlock button workflow
  - [ ] Map interaction unlock
  - [ ] Zone exit stops audio
  - [ ] Zone re-entry trigger
  - [ ] Multiple objects
- [ ] Create manual testing checklist (`docs/AUDIO_TESTING_CHECKLIST.md`)
- [ ] Create test data file (`data/quest.test.json`)
- [ ] Add data-testid attributes to components
- [ ] Run full manual test pass

**Success Criteria:**
- All new E2E tests passing
- Manual checklist completed
- No regressions found

### Phase 2: Unit Tests (Week 2)

**Priority: 🔥 High**

- [ ] Set up Vitest
- [ ] Create `audioUnlock.test.ts`
  - [ ] Multi-format fallback tests
  - [ ] AudioContext tests
  - [ ] Error handling tests
- [ ] Create `useProximityTracker.test.ts`
  - [ ] Distance calculation tests
  - [ ] Zone detection tests
  - [ ] Debounce tests
- [ ] Create `audioUrlResolver.test.ts`
  - [ ] URL resolution priority tests
- [ ] Achieve > 80% code coverage

**Success Criteria:**
- All unit tests passing
- Code coverage > 80%
- Fast test execution (< 5 seconds)

### Phase 3: Integration Tests (Week 3)

**Priority: 🟡 Medium**

- [ ] Set up React Testing Library
- [ ] Create `QuestMap.audio.test.tsx`
  - [ ] Audio button integration
  - [ ] Map interaction integration
  - [ ] Proximity trigger integration
- [ ] Mock Leaflet map
- [ ] Mock Geolocation API

**Success Criteria:**
- All integration tests passing
- Components tested in isolation
- No flaky tests

### Phase 4: CI/CD & Monitoring (Week 4)

**Priority: 🟡 Medium**

- [ ] Create `.github/workflows/audio-tests.yml`
- [ ] Configure automated test runs
- [ ] Set up test result reporting
- [ ] Create `audioLogger.ts`
- [ ] Integrate logging with analytics
- [ ] Add performance benchmarks

**Success Criteria:**
- Tests run on every PR
- Test failures block merges
- Logs available for debugging
- Performance tracked

### Phase 5: Visual & Advanced (Future)

**Priority**: 🟢 Low**

- [ ] Create visual regression tests
- [ ] Add accessibility tests
- [ ] Add performance tests
- [ ] Add memory leak tests
- [ ] Cross-browser testing (BrowserStack)
- [ ] Mobile device testing (real devices)

---

## Success Metrics

### Test Coverage Goals

| Category | Target | Current | Status |
|----------|--------|---------|--------|
| Unit Tests | > 80% | 0% | 🔴 |
| Integration Tests | > 70% | 0% | 🔴 |
| E2E Tests | All critical paths | 10% | 🔴 |
| Manual Tests | 100% before release | - | 🟡 |

### Quality Gates

Before merging to main:
- ✅ All automated tests pass
- ✅ No new console errors
- ✅ Manual checklist completed
- ✅ Code review approved
- ✅ Performance benchmarks met

---

## Related Documentation

- [Audio Quick Start](./AUDIO_QUICK_START.md) - User and developer guide
- [Audio Unlock System](./AUDIO_UNLOCK_SYSTEM.md) - Technical details
- [Audio Trigger Fix](./AUDIO_TRIGGER_FIX.md) - Recent bug fixes
- [Audio Effects](./AUDIO_EFFECTS.md) - Configuration guide

---

## Questions & Support

**Issues**: Report test failures or bugs at [GitHub Issues](https://github.com/yourorg/quest-app-template/issues)

**Slack**: #quest-testing channel

**Owner**: @engineering-team

---

**Document Version**: 1.0
**Last Updated**: 2025-12-19
**Next Review**: 2025-01-19
