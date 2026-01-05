# E2E Tests

End-to-end tests using Playwright for the Quest App Template.

---

## Test Files

- **[audio-trigger.spec.ts](./audio-trigger.spec.ts)** - Audio system tests (12 tests)
- **[landing.spec.ts](./landing.spec.ts)** - Landing page tests
- **[map.spec.ts](./map.spec.ts)** - Map functionality tests
- **[mozaic-play.spec.ts](./mozaic-play.spec.ts)** - Mosaic puzzle tests
- **[witch-knot.spec.ts](./witch-knot.spec.ts)** - Witch Knot puzzle tests
- **[witch-knot-simple.spec.ts](./witch-knot-simple.spec.ts)** - Witch Knot Simple puzzle tests
- **[registration.spec.ts](./registration.spec.ts)** - User registration tests

---

## Running Tests

### All E2E Tests
```bash
npm run test:e2e
```

### Specific Test File
```bash
npm run test:e2e -- e2e/audio-trigger.spec.ts
```

### Specific Browser
```bash
npm run test:e2e -- --project=chromium
npm run test:e2e -- --project=webkit     # Safari
npm run test:e2e -- --project=Mobile\ Safari
```

### Interactive UI Mode
```bash
npm run test:e2e -- --ui
```

### Debug Mode (Step through)
```bash
npm run test:e2e -- --debug
```

### Watch Mode
```bash
npm run test:e2e -- --watch
```

### Headed Mode (See browser)
```bash
npm run test:e2e -- --headed
```

---

## Audio Tests

### Coverage

The audio tests cover the complete audio unlock and proximity trigger system:

✅ **Audio Unlock**
- Button workflow (visibility, click, notification)
- Map interaction unlock
- GPS toggle unlock
- Failure recovery

✅ **Multi-format Fallback**
- MP3 → WAV → OGG format chain
- NotSupportedError handling

✅ **Proximity Triggers**
- Zone entry/exit detection
- Re-trigger on re-entry
- GPS debouncing (prevents jitter)

✅ **UI/UX**
- Button positioning
- Animation presence
- Notification timing
- Console logging

### Mock System

Audio tests use a comprehensive mock system:

```typescript
// Track all audio instances
(window as any)._audioInstances = [...]

// Track all audio actions
(window as any)._audioLogs = [
  { action: 'create', src: '...', timestamp: ... },
  { action: 'play', src: '...', timestamp: ... },
  { action: 'pause', src: '...', timestamp: ... }
]
```

### Key Patterns

#### Force Click for Animated Elements
```typescript
// Button has pulse animation
await audioButton.click({ force: true });
```

#### Custom Audio Mock
```typescript
await context.addInitScript(() => {
  const CustomAudio = class { /* ... */ };
  Object.defineProperty(window, 'Audio', {
    writable: true,
    configurable: true,
    value: CustomAudio
  });
});
```

---

## Writing New Tests

### 1. Add Test to Appropriate File

```typescript
test('my new test', async ({ page, context }) => {
  await page.goto('/map');

  // Your test logic here

  const element = page.getByTestId('my-element');
  await expect(element).toBeVisible();
});
```

### 2. Use Existing Helpers

```typescript
// Grant geolocation permission
await context.grantPermissions(['geolocation']);

// Set GPS position
await context.setGeolocation({ latitude: 51.505, longitude: -0.09 });

// Get test element
const button = page.getByTestId('test-id');
```

### 3. Add data-testid to Components

```tsx
<button data-testid="my-button">
  Click me
</button>
```

### 4. Run Test Locally

```bash
npm run test:e2e -- e2e/your-test.spec.ts
```

---

## Test Data

### Quest Data Location
`src/data/quest.json`

### Audio Test Requirements

Some tests require audio configured in quest data:

```json
{
  "id": "obj-1",
  "coordinates": { "lat": 51.505, "lng": -0.09 },
  "audioUrl": "https://example.com/audio.mp3",
  "triggerRadius": 20
}
```

Tests that need audio data are marked with `.skip()`.

---

## CI/CD

Tests run automatically on:
- Push to main/dev branches
- Pull requests

See `.github/workflows/` for CI configuration (to be added).

---

## Debugging Tests

### Visual Debugging
```bash
npm run test:e2e -- --debug
```

### Screenshots on Failure
Screenshots are automatically saved to `test-results/` on failure.

### Video Recording
Configure in `playwright.config.ts`:
```typescript
use: {
  video: 'on-first-retry'
}
```

### Browser Console Logs
```typescript
page.on('console', msg => console.log(msg.text()));
```

### Slow Motion
```bash
npm run test:e2e -- --headed --slow-mo=1000
```

---

## Common Issues

### Issue: "Element is not stable"
**Solution:** Use `{ force: true }` on actions
```typescript
await element.click({ force: true });
```

### Issue: "Element not found"
**Solution:** Add proper timeout
```typescript
await expect(element).toBeVisible({ timeout: 5000 });
```

### Issue: "Test timeout"
**Solution:** Increase test timeout
```typescript
test('my test', async ({ page }) => {
  test.setTimeout(60000); // 60 seconds
  // ...
});
```

---

## Documentation

Comprehensive audio testing documentation:

- **[AUDIO_TESTING_SUMMARY.md](../docs/AUDIO_TESTING_SUMMARY.md)** - Implementation summary
- **[AUDIO_TESTING_STRATEGY.md](../docs/AUDIO_TESTING_STRATEGY.md)** - Full testing strategy
- **[AUDIO_TESTING_CHECKLIST.md](../docs/AUDIO_TESTING_CHECKLIST.md)** - Manual testing checklist

---

## Best Practices

1. ✅ Use `data-testid` for stable selectors
2. ✅ Wait for elements with proper timeouts
3. ✅ Clean up after tests (reset state)
4. ✅ Use `force: true` for animated elements
5. ✅ Mock external dependencies (GPS, Audio)
6. ✅ Test both happy path and error cases
7. ✅ Keep tests independent and isolated
8. ✅ Add comments for complex test logic

---

**Last Updated:** 2025-12-19
