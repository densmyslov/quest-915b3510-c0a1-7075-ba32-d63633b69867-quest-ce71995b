'use client';

import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';

// ============================================================================
// TYPES
// ============================================================================

interface Point {
    x: number; // Absolute texture coordinate
    y: number;
    rx?: number; // Relative coordinate (0-1 range) for consistent positioning
    ry?: number;
}

interface DifferenceRegion {
    id: string;
    points: Point[];
    centerX: number;
    centerY: number;
}

interface SpotDifferenceData {
    puzzleId: string;
    originalImageUrl: string;
    diffImageUrl: string;
    regions: DifferenceRegion[];
    boardImageUrl?: string;
    boardImageDataUrl?: string;
    pieces?: Array<{
        id: string;
        vertices?: Array<{ x: number; y: number }>;
    }>;
    imageDimensions: {
        width: number;
        height: number;
    };
}

interface SpotDifferenceGameProps {
    puzzleData: SpotDifferenceData;
    onComplete?: () => void;
}

// ============================================================================
// COORDINATE TRANSFORMATION HELPERS
// ============================================================================

/**
 * Convert relative (0-1 range) coordinates back to absolute texture coordinates.
 */
const relativeToTexture = (
    rx: number,
    ry: number,
    textureWidth: number,
    textureHeight: number
): { x: number; y: number } => {
    return {
        x: rx * textureWidth,
        y: ry * textureHeight
    };
};

/**
 * Get display coordinates for a point, preferring relative coordinates when available.
 * Falls back to absolute coordinates for backward compatibility.
 */
const getDisplayCoords = (
    point: Point,
    textureWidth: number,
    textureHeight: number
): { x: number; y: number } => {
    if (point.rx !== undefined && point.ry !== undefined) {
        return relativeToTexture(point.rx, point.ry, textureWidth, textureHeight);
    }
    return { x: point.x, y: point.y };
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function SpotDifferenceGame({
    puzzleData,
    onComplete
}: SpotDifferenceGameProps) {
    // Refs
    const containerRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<PIXI.Application | null>(null);
    const diffSpriteRef = useRef<PIXI.Sprite | null>(null);
    const revealContainerRef = useRef<PIXI.Container | null>(null);
    const originalTextureRef = useRef<PIXI.Texture | null>(null);
    const objectUrlMapRef = useRef<Map<string, string>>(new Map());
    const textureDimensionsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
    const regionScaleRef = useRef<{ x: number; y: number }>({ x: 1, y: 1 });
    const dataToTextureScaleRef = useRef<{ x: number; y: number }>({ x: 1, y: 1 });
    const foundRegionsRef = useRef<Set<string>>(new Set());
    const gameStatusRef = useRef<'playing' | 'won' | 'lost' | 'completed'>('playing');

    const debugEnabled =
        typeof window !== 'undefined'
        && (
            (window as any).__spotDiffDebug === true
            || new URLSearchParams(window.location.search).has('spotDiffDebug')
        );

    // Gameplay Constants
    const GAME_DURATION = 120; // seconds

    // State
    const [isReady, setIsReady] = useState(false);
    const [foundRegions, setFoundRegions] = useState<Set<string>>(new Set());
    const [mistakes, setMistakes] = useState(0);
    const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
    const [gameStatus, setGameStatus] = useState<'playing' | 'won' | 'lost' | 'completed'>('playing');
    const [clickFeedback, setClickFeedback] = useState<{ x: number; y: number; correct: boolean } | null>(null);
    const [showReference, setShowReference] = useState(false);

    type HitRegion = { id: string; points: Array<{ x: number; y: number }> };

    const totalDifferences = (() => {
        const pieces = Array.isArray(puzzleData.pieces) ? puzzleData.pieces : [];
        const pieceCount = pieces.filter((p) => Array.isArray(p?.vertices) && (p.vertices?.length ?? 0) >= 3).length;
        return pieceCount > 0 ? pieceCount : puzzleData.regions.length;
    })();
    const foundCount = foundRegions.size;

    useEffect(() => {
        foundRegionsRef.current = foundRegions;

        // Check win condition
        if (totalDifferences > 0 && foundRegions.size === totalDifferences && gameStatus === 'playing') {
            setGameStatus('won');

            // Replace board image with original image
            if (diffSpriteRef.current && originalTextureRef.current) {
                const diffSprite = diffSpriteRef.current;
                const originalTexture = originalTextureRef.current;

                // Smooth transition: fade to original
                const startTime = Date.now();
                const duration = 800; // ms

                const animate = () => {
                    const elapsed = Date.now() - startTime;
                    const progress = Math.min(elapsed / duration, 1);

                    // Fade out current texture and fade in original
                    diffSprite.alpha = 1 - (progress * 0.3); // Slight fade

                    if (progress >= 0.5 && diffSprite.texture !== originalTexture) {
                        // Switch texture at halfway point
                        diffSprite.texture = originalTexture;
                        diffSprite.alpha = 0.7; // Start fading in
                    }

                    if (progress > 0.5) {
                        // Fade back in
                        diffSprite.alpha = 0.7 + ((progress - 0.5) * 0.6);
                    }

                    if (progress < 1) {
                        requestAnimationFrame(animate);
                    } else {
                        diffSprite.alpha = 1; // Ensure fully visible
                    }
                };

                animate();
            }

            // Don't auto-call onComplete - let user close modal manually
        }
    }, [foundRegions, totalDifferences, gameStatus]);

    useEffect(() => {
        gameStatusRef.current = gameStatus;
    }, [gameStatus]);

    // ========================================================================
    // TIMER LOGIC
    // ========================================================================
    useEffect(() => {
        if (!isReady || gameStatus !== 'playing') return;

        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    setGameStatus('lost');
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [isReady, gameStatus]);

    // Format time mm:ss
    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // ========================================================================
    // PIXI INITIALIZATION
    // ========================================================================

    useEffect(() => {
        if (!containerRef.current || appRef.current) return;

        const app = new PIXI.Application();

        // Get container dimensions or use defaults
        const containerWidth = containerRef.current.clientWidth || 800;
        const containerHeight = containerRef.current.clientHeight || 600;

        // Use responsive dimensions based on viewport
        const canvasWidth = Math.min(containerWidth, window.innerWidth - 40);
        const canvasHeight = Math.min(containerHeight, window.innerHeight - 200);

        app.init({
            width: canvasWidth,
            height: canvasHeight,
            backgroundColor: 0x1a1a2e,
            antialias: true,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
        }).then(() => {
            if (containerRef.current) {
                containerRef.current.appendChild(app.canvas);
                appRef.current = app;

                // Create container for revealed pieces
                const revealContainer = new PIXI.Container();
                revealContainerRef.current = revealContainer;

                // ----------------------------------------------------------------
                // E2E TESTING HOOKS
                // ----------------------------------------------------------------
                // Expose internal state to window for Playwright tests
                if (process.env.NODE_ENV === 'test' || process.env.NEXT_PUBLIC_E2E_TESTING === 'true' || new URLSearchParams(window.location.search).has('e2e')) {
                    console.log('SpotDifference: Exposing hooks to window');
                    (window as any).__spotDiffApp = app;
                    (window as any).__spotDiffLoaded = true;
                    (window as any).__spotDiffState = {
                        get foundRegions() { return Array.from(foundRegionsRef.current); },
                        get totalRegions() { return totalDifferences; },
                        get gameStatus() { return gameStatusRef.current; }
                    };
                }

                setIsReady(true);
            }
        });

        const urlMap = objectUrlMapRef.current;
        return () => {
            if (appRef.current) {
                appRef.current.destroy(true);
                appRef.current = null;
            }
            urlMap.forEach((url) => URL.revokeObjectURL(url));
            urlMap.clear();

            // Cleanup hooks
            if (process.env.NODE_ENV === 'test' || process.env.NEXT_PUBLIC_E2E_TESTING === 'true') {
                delete (window as any).__spotDiffApp;
                delete (window as any).__spotDiffLoaded;
                delete (window as any).__spotDiffState;
            }
        };
    }, [totalDifferences]);

    const revokeObjectUrl = (key: string) => {
        const url = objectUrlMapRef.current.get(key);
        if (url) {
            URL.revokeObjectURL(url);
            objectUrlMapRef.current.delete(key);
        }
    };

    const loadTextureWithFallback = async (id: string, imageUrl: string) => {
        try {
            // Cloudflare Images URLs often end with a variant like `/public` (no file extension),
            // which makes Pixi's default parser detection fail. Force the texture parser.
            return (await PIXI.Assets.load({
                src: imageUrl,
                parser: 'loadTextures'
            })) as PIXI.Texture;
        } catch (err) {
            console.warn('Assets.load failed, falling back to fetch:', imageUrl, err);
        }

        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        revokeObjectUrl(id);
        objectUrlMapRef.current.set(id, objectUrl);
        const texture = PIXI.Texture.from(objectUrl);
        texture.source.once('destroy', () => revokeObjectUrl(id));
        return texture;
    };

    const getHitRegions = (): HitRegion[] => {
        const { width: texWidth, height: texHeight } = textureDimensionsRef.current;

        // If texture dimensions not set yet, return empty array
        if (texWidth === 0 || texHeight === 0) return [];

        const dataScale = dataToTextureScaleRef.current;
        const pieces = Array.isArray(puzzleData.pieces) ? puzzleData.pieces : [];

        // Try using pieces.vertices first (for puzzles with piece data)
        const pieceHits = pieces
            .filter((p) => p && typeof p.id === 'string' && Array.isArray(p.vertices) && p.vertices.length >= 3)
            .map((p) => ({
                id: p.id,
                points: p.vertices!.map((pt) => {
                    // If vertices have relative coordinates, use them
                    if ('rx' in pt && 'ry' in pt && pt.rx !== undefined && pt.ry !== undefined) {
                        return getDisplayCoords(pt as Point, texWidth, texHeight);
                    }
                    // Otherwise scale by dataScale (legacy format)
                    return { x: pt.x * dataScale.x, y: pt.y * dataScale.y };
                })
            }));

        if (pieceHits.length > 0) {
            return pieceHits;
        }

        // Fall back to regions.points (for simpler puzzles)
        return puzzleData.regions.map((r) => ({
            id: r.id,
            points: r.points.map(p => getDisplayCoords(p, texWidth, texHeight))
        }));
    };

    const computeDataToTextureScale = (diffTexture: PIXI.Texture) => {
        const dataW = puzzleData?.imageDimensions?.width;
        const dataH = puzzleData?.imageDimensions?.height;

        const scaleX = typeof dataW === 'number' && dataW > 0 ? diffTexture.width / dataW : 1;
        const scaleY = typeof dataH === 'number' && dataH > 0 ? diffTexture.height / dataH : 1;

        dataToTextureScaleRef.current = { x: scaleX, y: scaleY };

        if (debugEnabled) {
            const pieces = Array.isArray(puzzleData.pieces) ? puzzleData.pieces : [];
            let maxVX = 0;
            let maxVY = 0;
            for (const p of pieces) {
                for (const v of p.vertices || []) {
                    if (typeof v?.x === 'number') maxVX = Math.max(maxVX, v.x);
                    if (typeof v?.y === 'number') maxVY = Math.max(maxVY, v.y);
                }
            }

            console.log('[SpotDifference] data->texture scale', {
                imageDimensions: puzzleData.imageDimensions,
                texture: { width: diffTexture.width, height: diffTexture.height },
                scale: { x: scaleX, y: scaleY },
                verticesMax: { x: maxVX, y: maxVY }
            });
        }
    };

    const computeRegionScale = (diffTexture: PIXI.Texture) => {
        const targetW = diffTexture.width;
        const targetH = diffTexture.height;
        const dataW = puzzleData?.imageDimensions?.width;
        const dataH = puzzleData?.imageDimensions?.height;

        let maxX = 0;
        let maxY = 0;
        for (const region of puzzleData.regions) {
            for (const p of region.points) {
                if (typeof p?.x === 'number') maxX = Math.max(maxX, p.x);
                if (typeof p?.y === 'number') maxY = Math.max(maxY, p.y);
            }
        }

        let scaleX = 1;
        let scaleY = 1;
        let source: 'imageDimensions' | 'regionsMaxHeuristic' | 'none' = 'none';

        // Prefer using the declared imageDimensions when region points appear to be in that coordinate space.
        if (
            typeof dataW === 'number'
            && typeof dataH === 'number'
            && dataW > 0
            && dataH > 0
            && maxX > 0
            && maxY > 0
            && maxX <= dataW * 1.05
            && maxY <= dataH * 1.05
        ) {
            scaleX = targetW / dataW;
            scaleY = targetH / dataH;
            source = 'imageDimensions';
        } else {
            // If region points extend beyond the texture size, they're likely in the original (pre-scaled) image space.
            scaleX = maxX > targetW * 1.05 && maxX > 0 ? targetW / maxX : 1;
            scaleY = maxY > targetH * 1.05 && maxY > 0 ? targetH / maxY : 1;
            source = 'regionsMaxHeuristic';
        }

        regionScaleRef.current = { x: scaleX, y: scaleY };

        if (debugEnabled) {
            console.log('[SpotDifference] region scale', {
                texture: { width: targetW, height: targetH },
                imageDimensions: puzzleData.imageDimensions,
                regionsMax: { x: maxX, y: maxY },
                scale: { x: scaleX, y: scaleY },
                source,
                sample: puzzleData.regions[0]?.id
            });
        }
    };

    // ========================================================================
    // LOAD IMAGES
    // ========================================================================

    useEffect(() => {
        if (!isReady || !appRef.current) return;

        const loadImages = async () => {
            try {
                const app = appRef.current!;

                const boardUrl = puzzleData.boardImageUrl || puzzleData.boardImageDataUrl || puzzleData.diffImageUrl;
                if (debugEnabled) {
                    console.log('[SpotDifference] board url', {
                        boardImageUrl: puzzleData.boardImageUrl,
                        boardImageDataUrl: puzzleData.boardImageDataUrl ? '(inline)' : undefined,
                        diffImageUrl: puzzleData.diffImageUrl,
                        using: boardUrl
                    });
                }

                // Load both textures
                const [diffTexture, originalTexture] = await Promise.all([
                    loadTextureWithFallback('diff', boardUrl),
                    loadTextureWithFallback('original', puzzleData.originalImageUrl)
                ]);

                // Store texture dimensions for coordinate transformation
                textureDimensionsRef.current = {
                    width: diffTexture.width,
                    height: diffTexture.height
                };

                computeDataToTextureScale(diffTexture);
                computeRegionScale(diffTexture);
                originalTextureRef.current = originalTexture;

                // Create diff sprite (the board)
                const diffSprite = new PIXI.Sprite(diffTexture);

                // Calculate scale to fit screen
                const maxWidth = app.screen.width - 40;
                const maxHeight = app.screen.height - 40; // Maximize space

                const scale = Math.min(
                    maxWidth / diffTexture.width,
                    maxHeight / diffTexture.height,
                    1
                );

                diffSprite.scale.set(scale);
                diffSprite.x = (app.screen.width - diffTexture.width * scale) / 2;
                diffSprite.y = (app.screen.height - diffTexture.height * scale) / 2;
                diffSprite.eventMode = 'static';
                diffSprite.cursor = 'pointer';
                // Explicitly set hitArea to ensure clicks work even on transparent pixels
                // or if the texture loading behaves oddly in CI.
                diffSprite.hitArea = new PIXI.Rectangle(0, 0, diffTexture.width, diffTexture.height);

                app.stage.addChild(diffSprite);
                diffSpriteRef.current = diffSprite;

                // Add reveal container on top
                if (revealContainerRef.current) {
                    app.stage.addChild(revealContainerRef.current);
                }

                // Add click handler
                diffSprite.on('pointerdown', handleCanvasClick);

                if (debugEnabled) {
                    const hitRegions = getHitRegions();
                    console.log('[SpotDifference] hit regions source', {
                        using: Array.isArray(puzzleData.pieces) && puzzleData.pieces.some(p => Array.isArray(p.vertices) && p.vertices.length >= 3)
                            ? 'pieces.vertices'
                            : 'regions.points',
                        count: hitRegions.length,
                        example: hitRegions[0]
                            ? { id: hitRegions[0].id, points0: hitRegions[0].points[0], pointsLen: hitRegions[0].points.length }
                            : null
                    });
                }

            } catch (err) {
                console.error('Error loading images:', err);
            }
        };

        loadImages();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isReady, puzzleData]);

    // ========================================================================
    // CLICK HANDLING
    // ========================================================================

    const handleCanvasClick = (event: PIXI.FederatedPointerEvent) => {
        if (!diffSpriteRef.current || gameStatusRef.current !== 'playing') return;

        const diffSprite = diffSpriteRef.current;
        const localPos = diffSprite.toLocal(event.global);

        if (debugEnabled) {
            console.log('[SpotDifference] click', {
                global: { x: event.global.x, y: event.global.y },
                local: { x: localPos.x, y: localPos.y },
                texture: { width: diffSprite.texture.width, height: diffSprite.texture.height },
                sprite: { x: diffSprite.x, y: diffSprite.y, scaleX: diffSprite.scale.x, scaleY: diffSprite.scale.y },
                regionScale: regionScaleRef.current,
                dataToTextureScale: dataToTextureScaleRef.current,
            });
        }

        const hitRegions = getHitRegions();

        // Check which region (if any) was clicked
        const clickedRegion = hitRegions.find(region => {
            if (foundRegionsRef.current.has(region.id)) return false; // Already found
            return isPointInPolygon(localPos, region.points);
        });

        if (clickedRegion) {
            if (foundRegionsRef.current.has(clickedRegion.id)) return;
            // Correct click!
            setFoundRegions((prev) => {
                const next = new Set(prev);
                next.add(clickedRegion.id);
                return next;
            });

            // Show correct feedback
            setClickFeedback({ x: event.global.x, y: event.global.y, correct: true });

            // Reveal the original image piece
            revealRegion(clickedRegion);
        } else {
            // Wrong click
            setMistakes(prev => prev + 1);
            setClickFeedback({ x: event.global.x, y: event.global.y, correct: false });

            if (debugEnabled) {
                // Log a quick "nearest region" hint to diagnose coordinate mismatch.
                let nearest: { id: string; dist2: number; centroid: { x: number; y: number } } | null = null;
                for (const region of hitRegions) {
                    if (!region.points.length) continue;
                    const centroid = region.points.reduce(
                        (acc, p) => ({ x: acc.x + p.x / region.points.length, y: acc.y + p.y / region.points.length }),
                        { x: 0, y: 0 }
                    );

                    const dx = localPos.x - centroid.x;
                    const dy = localPos.y - centroid.y;
                    const dist2 = dx * dx + dy * dy;
                    if (!nearest || dist2 < nearest.dist2) nearest = { id: region.id, dist2, centroid };
                }
                console.log('[SpotDifference] miss', { nearest });
            }
        }

        // Clear feedback after animation
        setTimeout(() => setClickFeedback(null), 800);
    };

    // ========================================================================
    // REVEAL REGION
    // ========================================================================

    const revealRegion = (region: HitRegion) => {
        if (!originalTextureRef.current || !diffSpriteRef.current || !revealContainerRef.current || !appRef.current) return;

        const diffSprite = diffSpriteRef.current;
        const originalTexture = originalTextureRef.current;

        // Create a sprite with the original image
        const revealSprite = new PIXI.Sprite(originalTexture);
        revealSprite.scale.set(diffSprite.scale.x, diffSprite.scale.y);
        revealSprite.x = diffSprite.x;
        revealSprite.y = diffSprite.y;

        // Create a mask from the polygon
        const mask = new PIXI.Graphics();

        const scaledPoints = region.points.map(p => ({
            x: diffSprite.x + p.x * diffSprite.scale.x,
            y: diffSprite.y + p.y * diffSprite.scale.y
        }));

        if (scaledPoints.length > 0) {
            mask.moveTo(scaledPoints[0].x, scaledPoints[0].y);
            for (let i = 1; i < scaledPoints.length; i++) {
                mask.lineTo(scaledPoints[i].x, scaledPoints[i].y);
            }
            mask.closePath();
            // Pixi v8: fill after path definition.
            mask.fill({ color: 0xffffff, alpha: 1 });
        }

        // Apply mask to reveal sprite
        revealSprite.mask = mask;

        // Add to stage
        revealContainerRef.current.addChild(mask);
        revealContainerRef.current.addChild(revealSprite);

        // Animate in
        revealSprite.alpha = 0;
        animateFadeIn(revealSprite);
    };

    const animateFadeIn = (sprite: PIXI.Sprite) => {
        const startTime = Date.now();
        const duration = 300;

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            sprite.alpha = progress;

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };

        animate();
    };

    // ========================================================================
    // POINT IN POLYGON TEST
    // ========================================================================

    const isPointInPolygon = (point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean => {
        let inside = false;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x;
            const yi = polygon[i].y;
            const xj = polygon[j].x;
            const yj = polygon[j].y;

            const intersect = ((yi > point.y) !== (yj > point.y)) &&
                (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);

            if (intersect) inside = !inside;
        }

        return inside;
    };

    // ========================================================================
    // RENDER
    // ========================================================================

    return (
        <div className="flex flex-col items-center min-h-screen bg-gray-900 text-white relative overflow-hidden">
            {/* Header / HUD */}
            <div className="w-full bg-gray-800/80 backdrop-blur-md border-b border-gray-700 p-4 flex justify-between items-center z-10 shadow-lg">
                <div className="px-4 py-2 bg-gray-700 rounded-lg flex flex-col items-center min-w-[100px]">
                    <span className="text-xs text-gray-400 uppercase tracking-wider">Time</span>
                    <span className={`text-2xl font-mono font-bold ${timeLeft < 10 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                        {formatTime(timeLeft)}
                    </span>
                </div>

                <div className="flex flex-col items-center">
                    <h1 className="text-xl md:text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                        Spot {totalDifferences} Differences
                    </h1>
                    <div className="flex gap-4 mt-1 text-sm text-gray-300">
                        <div>Found: <span className="text-green-400 font-bold">{foundCount}</span> / {totalDifferences}</div>
                        <div>Mistakes: <span className="text-red-400 font-bold">{mistakes}</span></div>
                    </div>
                </div>

                <button
                    onClick={() => setShowReference(true)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-semibold shadow-md"
                >
                    Show Original
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 w-full relative flex items-center justify-center bg-black/50 p-4">
                {/* Game Canvas */}
                <div
                    ref={containerRef}
                    className="rounded-lg shadow-2xl border-4 border-gray-700 overflow-hidden relative max-w-full"
                    style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                />

                {/* Click Feedback Overlay */}
                {clickFeedback && (
                    <div
                        className={`absolute pointer-events-none animate-ping z-20 ${clickFeedback.correct ? 'text-green-500' : 'text-red-500'
                            }`}
                        style={{
                            left: clickFeedback.x,
                            top: clickFeedback.y,
                            fontSize: '48px',
                            fontWeight: 'bold',
                            transform: 'translate(-50%, -50%)'
                        }}
                    >
                        {clickFeedback.correct ? '✓' : '✗'}
                    </div>
                )}
            </div>

            {/* Reference Image Modal */}
            {showReference && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowReference(false)}>
                    <div className="bg-white p-2 rounded-lg max-w-4xl max-h-[90vh] overflow-auto relative shadow-2xl animate-in fade-in zoom-in duration-200">
                        <button
                            className="absolute top-4 right-4 bg-red-500 text-white rounded-full p-2 w-8 h-8 flex items-center justify-center shadow-lg hover:bg-red-600 z-10"
                            onClick={() => setShowReference(false)}
                        >
                            ✕
                        </button>
                        <img
                            src={puzzleData.originalImageUrl}
                            alt="Reference"
                            className="max-w-full max-h-[85vh] object-contain rounded"
                        />
                        <p className="text-center text-gray-800 mt-2 font-semibold">Original Image (Reference)</p>
                    </div>
                </div>
            )}

            {/* Game Over / Win Modal */}
            {gameStatus !== 'playing' && gameStatus !== 'completed' && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-md">
                    <div className="bg-gray-800 border border-gray-600 p-8 rounded-xl shadow-2xl text-center max-w-md w-full m-4 transform transition-all scale-100">
                        {gameStatus === 'won' ? (
                            <>
                                <div className="text-6xl mb-4 animate-bounce">🎉</div>
                                <h2 className="text-3xl font-bold text-white mb-6">Excellent!</h2>
                                <button
                                    onClick={() => {
                                        setGameStatus('completed');
                                        onComplete?.();
                                    }}
                                    className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold rounded-lg w-full transition-transform hover:scale-105"
                                >
                                    Close
                                </button>
                            </>
                        ) : (
                            <>
                                <div className="text-6xl mb-4">⏰</div>
                                <h2 className="text-3xl font-bold text-white mb-2">Time&apos;s Up!</h2>
                                <p className="text-gray-300 mb-6">You found {foundCount} out of {totalDifferences} differences.</p>
                                <button
                                    onClick={() => window.location.reload()}
                                    className="px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold rounded-lg w-full transition-transform hover:scale-105"
                                >
                                    Play Again
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
