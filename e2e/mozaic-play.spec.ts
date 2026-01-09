import { test, expect } from '@playwright/test';

test.describe('Mozaic - Play Mode (Regression)', () => {
    test.beforeEach(async ({ page }) => {
        page.on('pageerror', err => console.log(`BROWSER ERROR: ${err.message}`));

        await page.route('https://fonts.googleapis.com/**', route => route.abort());
        await page.route('https://fonts.gstatic.com/**', route => route.abort());
    });

    test('boots Pixi and renders all pieces', async ({ page }) => {
        await page.goto('/play?id=fontana_fesa_puzzle');
        await expect(page.getByText('PROGRESS')).toBeVisible();

        await page.waitForFunction(() => (window as any).__pixiLoaded === true, { timeout: 15000 });

        const counts = await page.evaluate(() => {
            const piecesMap = (window as any).__pixiPieces as Map<string, any> | undefined;
            const snapped = (window as any).__pixiSnappedPieces as Set<string> | undefined;
            return {
                pieces: piecesMap?.size ?? 0,
                snapped: snapped?.size ?? 0,
            };
        });

        expect(counts.pieces).toBe(3);
        expect(counts.snapped).toBe(0);
    });

    test('auto-returns piece to tray when not snapped', async ({ page }) => {
        await page.goto('/play?id=fontana_fesa_puzzle');
        await page.waitForFunction(() => (window as any).__pixiLoaded === true, { timeout: 15000 });

        const returned = await page.evaluate(async () => {
            const app = (window as any).__pixiApp;
            const piecesMap = (window as any).__pixiPieces as Map<string, any> | undefined;
            const snapped = (window as any).__pixiSnappedPieces as Set<string> | undefined;
            const piece = piecesMap?.get('piece_1');
            if (!app || !piece || !piece.homePosition) return null;

            const down = {
                pointerId: 1,
                global: { x: piece.x, y: piece.y },
                stopPropagation: () => { },
            };
            const up = {
                pointerId: 1,
                global: { x: 20, y: 20 },
                stopPropagation: () => { },
            };

            piece.emit('pointerdown', down);
            app.stage.emit('pointerup', up);

            await new Promise(resolve => setTimeout(resolve, 600));

            return {
                snapped: snapped?.has('piece_1') === true,
                dx: Math.abs(piece.x - piece.homePosition.x),
                dy: Math.abs(piece.y - piece.homePosition.y),
            };
        });

        expect(returned).not.toBeNull();
        expect(returned!.snapped).toBe(false);
        expect(returned!.dx).toBeLessThan(3);
        expect(returned!.dy).toBeLessThan(3);
    });

    test('snaps at correct position and completes puzzle', async ({ page }) => {
        await page.goto('/play?id=fontana_fesa_puzzle');
        await page.waitForFunction(() => (window as any).__pixiLoaded === true, { timeout: 15000 });

        const snapPiece = async (pieceId: string) => {
            const ok = await page.evaluate(async (id: string) => {
                const app = (window as any).__pixiApp;
                const piecesMap = (window as any).__pixiPieces as Map<string, any> | undefined;
                const snapped = (window as any).__pixiSnappedPieces as Set<string> | undefined;
                const ghostRef = (window as any).__ghostRef as { current?: any } | undefined;
                const piece = piecesMap?.get(id);
                const ghost = ghostRef?.current;

                if (!app || !piece || !ghost || !piece.pieceData) return false;

                const scale = ghost.scale?.x ?? 1;
                const boardLeft = ghost.x - (ghost.texture.width * scale) / 2;
                const boardTop = ghost.y - (ghost.texture.height * scale) / 2;
                const targetX = boardLeft + (piece.pieceData?.correctX ?? 0) * scale;
                const targetY = boardTop + (piece.pieceData?.correctY ?? 0) * scale;

                piece.angle = piece.pieceData?.correctRotation ?? 0;

                const down = {
                    pointerId: 1,
                    global: { x: piece.x, y: piece.y },
                    stopPropagation: () => { },
                };
                const up = {
                    pointerId: 1,
                    global: { x: targetX, y: targetY },
                    stopPropagation: () => { },
                };

                piece.emit('pointerdown', down);
                app.stage.emit('pointerup', up);

                await new Promise(resolve => setTimeout(resolve, 300));
                return snapped?.has(id) === true;
            }, pieceId);

            expect(ok).toBe(true);
        };

        await snapPiece('piece_1');
        await snapPiece('piece_2');
        await snapPiece('piece_3');

        await expect(page.getByText('100%')).toBeVisible();
        await expect(page.getByText('Puzzle Complete!')).toBeVisible();
    });

    test('rotation is required for rotation-gated snapping', async ({ page }) => {
        await page.goto('/play?id=fontana_fesa_puzzle');
        await page.waitForFunction(() => (window as any).__pixiLoaded === true, { timeout: 15000 });

        const wrongRotationDidNotSnap = await page.evaluate(async () => {
            const app = (window as any).__pixiApp;
            const piecesMap = (window as any).__pixiPieces as Map<string, any> | undefined;
            const snapped = (window as any).__pixiSnappedPieces as Set<string> | undefined;
            const ghostRef = (window as any).__ghostRef as { current?: any } | undefined;
            const ghost = ghostRef?.current;
            const piece = piecesMap?.get('piece_2');
            if (!app || !piece || !ghost || !piece.pieceData) return null;

            piece.pieceData.correctRotation = 90;

            const scale = ghost.scale?.x ?? 1;
            const boardLeft = ghost.x - (ghost.texture.width * scale) / 2;
            const boardTop = ghost.y - (ghost.texture.height * scale) / 2;
            const targetX = boardLeft + (piece.pieceData?.correctX ?? 0) * scale;
            const targetY = boardTop + (piece.pieceData?.correctY ?? 0) * scale;

            piece.angle = 0;
            const down = {
                pointerId: 1,
                global: { x: piece.x, y: piece.y },
                stopPropagation: () => { },
            };
            const up = {
                pointerId: 1,
                global: { x: targetX, y: targetY },
                stopPropagation: () => { },
            };

            piece.emit('pointerdown', down);
            app.stage.emit('pointerup', up);

            await new Promise(resolve => setTimeout(resolve, 300));
            return snapped?.has('piece_2') === false;
        });
        expect(wrongRotationDidNotSnap).toBe(true);

        const rotated = await page.evaluate(() => {
            const app = (window as any).__pixiApp;
            const piecesMap = (window as any).__pixiPieces as Map<string, any> | undefined;
            const piece = piecesMap?.get('piece_2');
            if (!app || !piece) return null;
            piece.angle = 0;
            piece.emit('pointerdown', {
                pointerId: 1,
                global: { x: piece.x, y: piece.y },
                stopPropagation: () => { },
            });
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
            return piece.angle;
        });
        expect(rotated).not.toBeNull();
        expect(rotated!).toBeGreaterThan(0);

        const snappedCorrect = await page.evaluate(async () => {
            const app = (window as any).__pixiApp;
            const piecesMap = (window as any).__pixiPieces as Map<string, any> | undefined;
            const snapped = (window as any).__pixiSnappedPieces as Set<string> | undefined;
            const ghostRef = (window as any).__ghostRef as { current?: any } | undefined;
            const ghost = ghostRef?.current;
            const piece = piecesMap?.get('piece_2');
            if (!app || !piece || !ghost || !piece.pieceData) return null;

            piece.pieceData.correctRotation = 90;

            const scale = ghost.scale?.x ?? 1;
            const boardLeft = ghost.x - (ghost.texture.width * scale) / 2;
            const boardTop = ghost.y - (ghost.texture.height * scale) / 2;
            const targetX = boardLeft + (piece.pieceData?.correctX ?? 0) * scale;
            const targetY = boardTop + (piece.pieceData?.correctY ?? 0) * scale;

            piece.angle = 90;
            const down = {
                pointerId: 1,
                global: { x: piece.x, y: piece.y },
                stopPropagation: () => { },
            };
            const up = {
                pointerId: 1,
                global: { x: targetX, y: targetY },
                stopPropagation: () => { },
            };

            piece.emit('pointerdown', down);
            app.stage.emit('pointerup', up);

            await new Promise(resolve => setTimeout(resolve, 300));
            return snapped?.has('piece_2') === true;
        });
        expect(snappedCorrect).toBe(true);
    });
});
