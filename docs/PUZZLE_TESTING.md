# Puzzle Testing Guide

This document outlines the testing strategy for the various puzzle types in the Quest App.

## Overview
We use **Playwright** for end-to-end (E2E) testing. Because most puzzles use **PixiJS** (HTML5 Canvas), standard DOM selectors (like `getByText`) are often insufficient for interacting with game elements (pieces, studs, etc.).

## Supported Puzzle Types

### 1. Mozaic (`fabric_custom`)
- **Component**: `src/components/puzzles/mozaic/PuzzleGame.tsx`
- **Engine**: PixiJS
- **Testability**: **High**. The component exposes internal state globally when running in the browser.

#### Internal Hooks
The following properties are exposed on the `window` object for testing:
- `window.__pixiApp`: The main PIXI Application instance.
- `window.__pixiPieces`: A `Map<string, PIXI.Sprite>` of all puzzle pieces.
- `window.__pixiSnappedPieces`: A `Set<string>` of IDs for pieces that have been correctly placed.
- `window.__ghostRef`: Access to the ghost image sprite.
- `window.__pixiLoaded`: Boolean flag indicating if the puzzle has finished initializing.

#### Testing Strategy
1.  **Wait for Load**: `await page.waitForFunction(() => window.__pixiLoaded === true);`
2.  **Inspect State**: Use `page.evaluate()` to read `__pixiPieces` and verify counts.
3.  **Simulate Input**: Use `piece.emit('pointerdown', ...)` within `page.evaluate()` to simulate precise drags and drops without replying on fragile coordinate guessing.
4.  **Verify Result**: Check `__pixiSnappedPieces` to confirm logic (not just visual) success.

### 2. Witch Knot (`witch_knot`)
- **Component**: `src/components/puzzles/witch-knot/WitchKnotGame.tsx`
- **Engine**: PixiJS
- **Testability**: **Low**. Currently, this component does **not** expose internal state.
- **Current Strategy**:
    - Tests must rely on DOM elements for the HUD (score, time).
    - Canvas interaction requires "blind" clicking based on calculated coordinates, or visual regression testing.
    - **Recommended Improvement**: Refactor the component to expose `__witchKnotState` or similar on `window` during tests.

### 3. Witch Knot Simple (`witch_knot_simple`)
- **Component**: `src/components/puzzles/witch-knot-simple/WitchKnotSimpleGame.tsx`
- **Engine**: PixiJS
- **Testability**: **High**. Internal state is now exposed via `window.__witchKnotSimpleState`.
- **Current Strategy**:
    - **Reveal Logic**: Verify `state.currentStudIndex` and confirm the *next* stud is blinking (alpha > 0) as a hint before clicking.
    - **Interactions**: Verify Pan/Zoom by simulating touch events and checking `mainStageContainer` scale and position.
    - The state is exposed only when `typeof window !== 'undefined'` (client-side).

### 4. Witch Knot (`witch_knot`)
- **Component**: `src/components/puzzles/witch-knot/WitchKnotGame.tsx`
- **Engine**: PixiJS
- **Testability**: **Low**.
- **Current Strategy**:
    - Smoke test using `e2e/witch-knot.spec.ts`.
    - Verifies visibility of key game text ("Filo", "Nodo della Strega").

## Running Tests

### Run All Puzzle Tests
```bash
npm run test:e2e -- --project=chromium --grep "Puzzle"
```

### Run Specific Test File
```bash
npx playwright test e2e/mozaic-play.spec.ts
```

## Adding New Tests

### Best Practices
1.  **Expose State**: If checking pixel colors is flaky, expose the game state (e.g., `isComplete`, `pieceCount`) to `window` so Playwright can read it.
2.  **Avoid Visual Regression**: Unless strict UI fidelity is required, prefer logic checks (state variables) over `toHaveScreenshot()`.
3.  **Mock Assets**: Use `page.route` to intercept image requests or ensure test assets are reliable (e.g., standard placeholders).

### Example: Creating a Witch Knot Test
Since `WitchKnotGame` doesn't expose state yet, a test would currently look like this:

```typescript
test('Witch Knot loads', async ({ page }) => {
  await page.goto('/puzzle/witch-knot-id');
  // Check for DOM elements that ARE visible
  await expect(page.getByText('Nodo della Strega')).toBeVisible();
  // Check HUD
  await expect(page.getByText('0 / 0 Chiodi')).toBeVisible();
});
```

To make it better, we should add:
```typescript
// In WitchKnotGame.tsx
useEffect(() => {
  if (process.env.NODE_ENV === 'test' || typeof window !== 'undefined') {
    (window as any).__witchKnotState = state;
  }
}, [state]);
```

## Regression Prevention
- **Before Committing**: Run `npm run test:e2e` locally.
- **CI/CD**:
    - Tests run automatically on `push` and `pull_request` to `main` when changes are detected in:
        - `src/components/puzzles/**`
        - `e2e/**`
        - `src/data/quest.json`
        - `playwright.config.ts`
- **Updating Components**: If you refactor `PuzzleGame.tsx`, verify `window.__pixi*` hooks are still populated. Removing them will break tests.
