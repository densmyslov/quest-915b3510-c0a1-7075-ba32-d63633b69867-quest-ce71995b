'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { PuzzleData } from '../../../types/puzzle';
import { useTheme } from '../../../context/ThemeContext';

interface JigsawCustomGameProps {
    puzzleData: PuzzleData;
    onComplete?: () => void;
}

// Layout constants
const HUD_HEIGHT = 60;
const BOARD_MARGIN = 20;
const REF_BOARD_WIDTH_RATIO = 0.2; // 20% of canvas width for reference board
const TRAY_HEIGHT_RATIO = 0.25; // 25% of canvas height for piece tray
const GRID_LINE_WIDTH = 1;
const SNAP_DISTANCE_PX = 30;
const PIECE_TEXTURE_PADDING_PX = 4;
const PIECE_BASE_Z_INDEX = 100;
const PIECE_DRAG_Z_INDEX = 10_000;
const WRONG_SLOT_SOUND_URL =
    'https://pub-877f23628132452cb9b12cf3cf618c69.r2.dev/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20251219-064300-9d6c2b30.mp3';

// Theme configuration
const THEMES = {
    dark: {
        bg: 0x0f172a,
        bgHex: '#0f172a',
        text: '#ffffff',
        gridLine: 0xffffff,
        gridLineAlpha: 0.3,
        hudBg: 'rgba(0, 0, 0, 0.8)',
        hudBorder: 'rgba(245, 158, 11, 0.4)',
        separator: 0xffffff,
        separatorAlpha: 0.1,
        slotBg: 0x1e293b,
        slotBgAlpha: 0.5,
        refBoardBorder: 0xf59e0b,
        refBoardAlpha: 0.6
    },
    light: {
        bg: 0xf0f4f8,
        bgHex: '#f0f4f8',
        text: '#1e293b',
        gridLine: 0x1e293b,
        gridLineAlpha: 0.2,
        hudBg: 'rgba(255, 255, 255, 0.9)',
        hudBorder: 'rgba(245, 158, 11, 0.6)',
        separator: 0x1e293b,
        separatorAlpha: 0.1,
        slotBg: 0xdbeafe,
        slotBgAlpha: 0.4,
        refBoardBorder: 0xf59e0b,
        refBoardAlpha: 0.8
    }
};

// Extend PIXI.Sprite to include custom properties for jigsaw
interface JigsawSprite extends PIXI.Sprite {
    jigsawPieceData?: any;
    trayX?: number;
    trayY?: number;
    trayScale?: number;
}

interface GridSlot {
    row: number;
    col: number;
    x: number;
    y: number;
    width: number;
    height: number;
    pieceId: string | null;
    sprite: JigsawSprite | null;
}

function clamp01(value: number) {
    return Math.max(0, Math.min(1, value));
}

function hashStringToSeed(value: string) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function mulberry32(seed: number) {
    return () => {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffleInPlace<T>(items: T[], random: () => number) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
}

export default function JigsawCustomGame({ puzzleData, onComplete }: JigsawCustomGameProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const pixiAppRef = useRef<PIXI.Application | null>(null);
    const [progress, setProgress] = useState(0);
    const [isComplete, setIsComplete] = useState(false);
    const [timeElapsed, setTimeElapsed] = useState(0);
    const sessionSeedRef = useRef<number>(Math.floor(Math.random() * 2 ** 32));
    const wrongSlotAudioRef = useRef<HTMLAudioElement | null>(null);

    // Game state refs
    const gridSlotsRef = useRef<GridSlot[][]>([]);
    const piecesRef = useRef<Map<string, JigsawSprite>>(new Map());
    const trayPiecesRef = useRef<Set<string>>(new Set());
    const objectUrlMap = useRef<Map<string, string>>(new Map());
	    const refBoardRef = useRef<PIXI.Sprite | null>(null);
	    const gridContainerRef = useRef<PIXI.Container | null>(null);
	    const gridScaleRef = useRef(1);
	    const imageDimensionsRef = useRef<{ width: number; height: number } | null>(null);
	    const loadTokenRef = useRef(0);
    const trayLayoutRef = useRef<{
        puzzleId: string;
        order: string[];
        offsetsByPieceId: Map<string, { dx: number; dy: number }>;
    } | null>(null);

    // Interaction refs
    const isDraggingRef = useRef(false);
    const dragTargetRef = useRef<JigsawSprite | null>(null);
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const dragSourceSlotRef = useRef<{ row: number; col: number } | null>(null);

    // Theme
    const { theme: currentTheme } = useTheme();
    const isDarkMode = currentTheme === 'dark';
    const theme = isDarkMode ? THEMES.dark : THEMES.light;

    // Timer
    useEffect(() => {
        if (isComplete) return;
        const timer = setInterval(() => setTimeElapsed(prev => prev + 1), 1000);
        return () => clearInterval(timer);
    }, [isComplete]);

    const metadata = puzzleData.metadata;
    const gridRows = metadata?.gridRows || 4;
    const gridCols = metadata?.gridCols || 4;

    const playWrongSlotSound = useCallback(() => {
        const audio = wrongSlotAudioRef.current;
        if (!audio) return;
        try {
            audio.currentTime = 0;
        } catch {
            // ignore
        }
        void audio.play().catch(() => {
            // Ignore autoplay/gesture restrictions and transient network errors.
        });
    }, []);

    // Update theme
    useEffect(() => {
        const app = pixiAppRef.current;
        if (!app) return;
        const renderer = (app as any).renderer as PIXI.Renderer | undefined;
        if (!renderer) return;
        renderer.background.color = theme.bg;
    }, [theme]);

    const revokeObjectUrl = useCallback((key: string) => {
        const url = objectUrlMap.current.get(key);
        if (url) {
            URL.revokeObjectURL(url);
            objectUrlMap.current.delete(key);
        }
    }, []);

    const loadTextureWithFallback = useCallback(
        async (id: string, imageUrl: string) => {
            try {
                return (await PIXI.Assets.load({
                    src: imageUrl,
                    parser: 'loadTextures'
                })) as PIXI.Texture;
            } catch (err) {
                console.warn('Assets.load failed, falling back to fetch:', imageUrl, err);
            }

            try {
                const response = await fetch(imageUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const blob = await response.blob();
                const objectUrl = URL.createObjectURL(blob);
                const texture = PIXI.Texture.from(objectUrl);
                objectUrlMap.current.set(id, objectUrl);
                texture.source.once('destroy', () => revokeObjectUrl(id));
                return texture;
            } catch (error) {
                console.error('Failed to load texture via fallback:', imageUrl, error);
                return null;
            }
        },
        [revokeObjectUrl]
    );

    // Generate piece texture from coordinates
    const generatePieceTexture = useCallback(
        (pieceData: any, originalImage: CanvasImageSource) => {
            const { shapeData } = pieceData;
            if (!shapeData || shapeData.type !== 'polygon' || !shapeData.points) {
                return null;
            }

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            shapeData.points.forEach((point: { x: number; y: number }) => {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
                maxX = Math.max(maxX, point.x);
                maxY = Math.max(maxY, point.y);
            });

            const padding = PIECE_TEXTURE_PADDING_PX;
            const width = maxX - minX;
            const height = maxY - minY;

            if (width <= 0 || height <= 0) return null;

            const canvas = document.createElement('canvas');
            canvas.width = width + padding * 2;
            canvas.height = height + padding * 2;

            const ctx = canvas.getContext('2d', { alpha: true });
            if (!ctx) return null;

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(originalImage, minX - padding, minY - padding, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);

            // Create mask
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = canvas.width;
            maskCanvas.height = canvas.height;
            const maskCtx = maskCanvas.getContext('2d', { alpha: true });
            if (!maskCtx) return null;

            maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
            maskCtx.fillStyle = '#000';
            maskCtx.beginPath();
            shapeData.points.forEach((point: { x: number; y: number }, i: number) => {
                const x = point.x - minX + padding;
                const y = point.y - minY + padding;
                if (i === 0) maskCtx.moveTo(x, y);
                else maskCtx.lineTo(x, y);
            });
            maskCtx.closePath();
            maskCtx.fill();

            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(maskCanvas, 0, 0);
            ctx.globalCompositeOperation = 'source-over';

            return PIXI.Texture.from(canvas);
        },
        []
    );

    const computePieceAnchor = useCallback((pieceData: any, texture: PIXI.Texture) => {
        const { shapeData } = pieceData;

        let minX: number | null = null;
        let minY: number | null = null;

        if (shapeData?.type === 'polygon' && Array.isArray(shapeData.points) && shapeData.points.length > 0) {
            minX = Infinity;
            minY = Infinity;
            for (const point of shapeData.points) {
                minX = Math.min(minX, point.x);
                minY = Math.min(minY, point.y);
            }
        } else if (pieceData?.boundingRect) {
            minX = pieceData.boundingRect.left;
            minY = pieceData.boundingRect.top;
        }

        const correctPosition = pieceData?.correctPosition;
        if (!correctPosition || minX === null || minY === null || texture.width <= 0 || texture.height <= 0) {
            return { x: 0.5, y: 0.5 };
        }

        const localCenterX = correctPosition.x - (minX - PIECE_TEXTURE_PADDING_PX);
        const localCenterY = correctPosition.y - (minY - PIECE_TEXTURE_PADDING_PX);
        return {
            x: clamp01(localCenterX / texture.width),
            y: clamp01(localCenterY / texture.height)
        };
    }, []);

    // Find slot at position - finds the nearest slot center within snap distance
    const findSlotAtPosition = useCallback((x: number, y: number): GridSlot | null => {
        const grid = gridSlotsRef.current;
        let nearestSlot: GridSlot | null = null;
        let minDistance = Infinity;

        for (let row = 0; row < grid.length; row++) {
            for (let col = 0; col < grid[row].length; col++) {
                const slot = grid[row][col];
                const dx = x - slot.x;
                const dy = y - slot.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Only consider slots within snap distance
                if (distance < SNAP_DISTANCE_PX && distance < minDistance) {
                    minDistance = distance;
                    nearestSlot = slot;
                }
            }
        }
        return nearestSlot;
    }, []);

    // Check if piece is in correct slot
    const isPieceInCorrectSlot = useCallback((pieceData: any, slot: GridSlot): boolean => {
        const dims = imageDimensionsRef.current || puzzleData.imageDimensions;
        const cellW = dims.width / gridCols;
        const cellH = dims.height / gridRows;
        const cx =
            typeof pieceData?.correctPosition?.x === 'number'
                ? pieceData.correctPosition.x
                : (pieceData?.boundingRect?.left ?? 0) + (pieceData?.boundingRect?.width ?? 0) / 2;
        const cy =
            typeof pieceData?.correctPosition?.y === 'number'
                ? pieceData.correctPosition.y
                : (pieceData?.boundingRect?.top ?? 0) + (pieceData?.boundingRect?.height ?? 0) / 2;

        const pieceRow = Math.max(0, Math.min(gridRows - 1, Math.floor(cy / cellH)));
        const pieceCol = Math.max(0, Math.min(gridCols - 1, Math.floor(cx / cellW)));
        return pieceRow === slot.row && pieceCol === slot.col;
    }, [puzzleData, gridRows, gridCols]);

    // Check win condition
    const checkWin = useCallback(() => {
        const grid = gridSlotsRef.current;
        let correctCount = 0;
        let totalSlots = 0;

        for (let row = 0; row < grid.length; row++) {
            for (let col = 0; col < grid[row].length; col++) {
                const slot = grid[row][col];
                totalSlots++;
                if (slot.sprite && slot.sprite.jigsawPieceData) {
                    if (isPieceInCorrectSlot(slot.sprite.jigsawPieceData, slot)) {
                        correctCount++;
                    }
                }
            }
        }

        const progressPercent = Math.floor((correctCount / totalSlots) * 100);
        setProgress(progressPercent);

        if (correctCount === totalSlots) {
            setIsComplete(true);
            onComplete?.();
        }
    }, [isPieceInCorrectSlot, onComplete]);

    // Snap piece to slot
    const snapPieceToSlot = useCallback((piece: JigsawSprite, slot: GridSlot) => {
        gsap.killTweensOf(piece);
        gsap.killTweensOf(piece.scale);

        // Remove from previous slot
        if (dragSourceSlotRef.current) {
            const { row, col } = dragSourceSlotRef.current;
            const sourceSlot = gridSlotsRef.current[row][col];
            sourceSlot.pieceId = null;
            sourceSlot.sprite = null;
        }

        // Remove piece currently in target slot (if any)
        if (slot.sprite) {
            const oldPiece = slot.sprite;
            slot.sprite = null;
            slot.pieceId = null;
            // Return old piece to tray
            if (oldPiece.jigsawPieceData) {
                trayPiecesRef.current.add(oldPiece.jigsawPieceData.id);
            }
            gsap.killTweensOf(oldPiece);
            gsap.killTweensOf(oldPiece.scale);
            oldPiece.zIndex = PIECE_DRAG_Z_INDEX - 1;
            pixiAppRef.current?.stage.sortChildren();
            gsap.to(oldPiece, {
                x: oldPiece.trayX,
                y: oldPiece.trayY,
                duration: 0.22,
                ease: 'power3.out',
                onComplete: () => {
                    oldPiece.zIndex = PIECE_BASE_Z_INDEX;
                    pixiAppRef.current?.stage.sortChildren();
                }
            });
            gsap.to(oldPiece.scale, {
                x: oldPiece.trayScale,
                y: oldPiece.trayScale,
                duration: 0.22,
                ease: 'power3.out'
            });
        }

        // Convert slot position to global coordinates
        const gridOffsetX = gridContainerRef.current?.x || 0;
        const globalX = slot.x + gridOffsetX;
        const globalY = slot.y;

        piece.zIndex = PIECE_DRAG_Z_INDEX;
        pixiAppRef.current?.stage.sortChildren();

        // Place piece in slot with global coordinates
        gsap.to(piece, {
            x: globalX,
            y: globalY,
            duration: 0.22,
            ease: 'power3.out',
            onComplete: () => {
                if (piece.jigsawPieceData) {
                    slot.pieceId = piece.jigsawPieceData.id;
                    slot.sprite = piece;
                    trayPiecesRef.current.delete(piece.jigsawPieceData.id);
                }
                dragSourceSlotRef.current = null;
                piece.zIndex = PIECE_BASE_Z_INDEX + slot.row * gridCols + slot.col;
                pixiAppRef.current?.stage.sortChildren();

                // Flash effect
                const app = pixiAppRef.current;
                if (app && gridContainerRef.current) {
                    const flash = new PIXI.Graphics();
                    flash.rect(
                        slot.x - slot.width / 2,
                        slot.y - slot.height / 2,
                        slot.width,
                        slot.height
                    );
                    flash.fill({ color: 0xffffff, alpha: 0.5 });
                    gridContainerRef.current.addChild(flash);

                    gsap.to(flash, {
                        alpha: 0,
                        duration: 0.3,
                        onComplete: () => {
                            flash.removeFromParent();
                            flash.destroy();
                        }
                    });
                }

                checkWin();
            }
        });

        gsap.to(piece.scale, {
            x: gridScaleRef.current,
            y: gridScaleRef.current,
            duration: 0.22,
            ease: 'power3.out'
        });
    }, [checkWin, gridCols]);

    // Load puzzle
    const loadPuzzle = useCallback(async () => {
        const app = pixiAppRef.current;
        if (!app || !puzzleData) return;
        const loadToken = ++loadTokenRef.current;
        const isCurrent = () => pixiAppRef.current === app && loadTokenRef.current === loadToken;

        const canvasWidth = app.renderer.width;
        const canvasHeight = app.renderer.height;

        app.stage.sortableChildren = true;

        const refBoardWidth = canvasWidth * REF_BOARD_WIDTH_RATIO;
        const trayHeight = canvasHeight * TRAY_HEIGHT_RATIO;
        const gridAreaWidth = canvasWidth - refBoardWidth;
        const gridAreaHeight = canvasHeight - trayHeight - HUD_HEIGHT;

        // Clear stage
        app.stage.removeChildren();
        objectUrlMap.current.forEach((_, key) => revokeObjectUrl(key));
        objectUrlMap.current.clear();
        piecesRef.current.clear();
        trayPiecesRef.current.clear();

        // Create reference board (prefer the board image, which matches the coordinate space)
        const imageUrl = puzzleData.boardImageDataUrl || puzzleData.boardImageUrl || puzzleData.originalImageUrl;
        if (!imageUrl) {
            console.error('No image URL!');
            return;
        }

        try {
            const loadImageElement = async () =>
                await new Promise<HTMLImageElement>((resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                    img.src = imageUrl;
                });

            const [refTexture, originalImageElement] = await Promise.all([
                loadTextureWithFallback('ref_board', imageUrl),
                loadImageElement()
            ]);
            if (!isCurrent()) return;
            if (!refTexture) return;
            if (!originalImageElement) return;

            const refBoard = new PIXI.Sprite(refTexture);
            const refScale = Math.min(
                (refBoardWidth - BOARD_MARGIN * 2) / refTexture.width,
                (gridAreaHeight - BOARD_MARGIN * 2) / refTexture.height
            );
            refBoard.anchor.set(0.5);
            refBoard.scale.set(refScale);
            refBoard.x = refBoardWidth / 2;
            refBoard.y = gridAreaHeight / 2;
            app.stage.addChild(refBoard);
            refBoardRef.current = refBoard;

            // Add border around reference board
            const refBorder = new PIXI.Graphics();
            refBorder.rect(
                refBoard.x - (refTexture.width * refScale) / 2 - 2,
                refBoard.y - (refTexture.height * refScale) / 2 - 2,
                refTexture.width * refScale + 4,
                refTexture.height * refScale + 4
            );
            refBorder.stroke({ color: theme.refBoardBorder, width: 2, alpha: theme.refBoardAlpha });
            app.stage.addChild(refBorder);

            // Create grid container
            const gridContainer = new PIXI.Container();
            gridContainer.x = refBoardWidth;
            app.stage.addChild(gridContainer);
            gridContainerRef.current = gridContainer;

            const naturalWidth = originalImageElement.naturalWidth || originalImageElement.width;
            const naturalHeight = originalImageElement.naturalHeight || originalImageElement.height;
            const imageDimensions = puzzleData.imageDimensions || { width: naturalWidth, height: naturalHeight };
            imageDimensionsRef.current = imageDimensions;
            const pieces = puzzleData.pieces || [];

            let pieceSource: CanvasImageSource = originalImageElement;
            const mismatch =
                Math.abs(naturalWidth - imageDimensions.width) > 1 ||
                Math.abs(naturalHeight - imageDimensions.height) > 1;

            if (mismatch && imageDimensions.width > 0 && imageDimensions.height > 0) {
                const normalizedCanvas = document.createElement('canvas');
                normalizedCanvas.width = Math.round(imageDimensions.width);
                normalizedCanvas.height = Math.round(imageDimensions.height);
                const ctx = normalizedCanvas.getContext('2d', { alpha: true });
                if (ctx) {
                    ctx.drawImage(originalImageElement, 0, 0, normalizedCanvas.width, normalizedCanvas.height);
                    pieceSource = normalizedCanvas;
                    console.warn('[JigsawCustomGame] Normalizing source image to puzzle coordinates to avoid seams.', {
                        naturalWidth,
                        naturalHeight,
                        coordWidth: imageDimensions.width,
                        coordHeight: imageDimensions.height
                    });
                }
            }

            // Calculate grid dimensions
            const gridWidth = gridAreaWidth - BOARD_MARGIN * 2;
            const gridHeight = gridAreaHeight - BOARD_MARGIN * 2;
            const gridScale = Math.min(
                gridWidth / imageDimensions.width,
                gridHeight / imageDimensions.height
            );
            gridScaleRef.current = gridScale;

            const boardWidthPx = imageDimensions.width * gridScale;
            const boardHeightPx = imageDimensions.height * gridScale;
            const boardOffsetX = BOARD_MARGIN + (gridWidth - boardWidthPx) / 2;
            const boardOffsetY = BOARD_MARGIN + (gridHeight - boardHeightPx) / 2;
            const slotWidth = boardWidthPx / gridCols;
            const slotHeight = boardHeightPx / gridRows;

            // Create grid slots with piece shapes
            const grid: GridSlot[][] = [];

            // Create a map of piece positions for slot shapes
            const piecesByPosition: Map<string, any> = new Map();
            for (const piece of pieces) {
                const cellW = imageDimensions.width / gridCols;
                const cellH = imageDimensions.height / gridRows;
                const cx =
                    typeof piece?.correctPosition?.x === 'number'
                        ? piece.correctPosition.x
                        : (piece?.boundingRect?.left ?? 0) + (piece?.boundingRect?.width ?? 0) / 2;
                const cy =
                    typeof piece?.correctPosition?.y === 'number'
                        ? piece.correctPosition.y
                        : (piece?.boundingRect?.top ?? 0) + (piece?.boundingRect?.height ?? 0) / 2;

                const pieceRow = Math.max(0, Math.min(gridRows - 1, Math.floor(cy / cellH)));
                const pieceCol = Math.max(0, Math.min(gridCols - 1, Math.floor(cx / cellW)));
                piecesByPosition.set(`${pieceRow},${pieceCol}`, piece);
            }

            for (let row = 0; row < gridRows; row++) {
                grid[row] = [];
                for (let col = 0; col < gridCols; col++) {
                    // Get the piece for this slot position
                    const pieceForSlot = piecesByPosition.get(`${row},${col}`);

                    // Position slot at the piece's correct position (scaled to grid)
                    let x: number, y: number;
                    if (pieceForSlot && pieceForSlot.correctPosition) {
                        x = pieceForSlot.correctPosition.x * gridScale + boardOffsetX;
                        y = pieceForSlot.correctPosition.y * gridScale + boardOffsetY;
                    } else {
                        // Fallback to uniform grid if no piece data
                        x = boardOffsetX + col * slotWidth + slotWidth / 2;
                        y = boardOffsetY + row * slotHeight + slotHeight / 2;
                    }

                    if (pieceForSlot && pieceForSlot.shapeData && pieceForSlot.shapeData.type === 'polygon') {
                        // Draw the actual piece shape as slot outline
                        const slotOutline = new PIXI.Graphics();

                        // Draw the piece shape outline at the correct position
                        const firstPoint = pieceForSlot.shapeData.points[0];
                        slotOutline.moveTo(
                            firstPoint.x * gridScale + boardOffsetX,
                            firstPoint.y * gridScale + boardOffsetY
                        );

                        for (let i = 1; i < pieceForSlot.shapeData.points.length; i++) {
                            const point = pieceForSlot.shapeData.points[i];
                            slotOutline.lineTo(
                                point.x * gridScale + boardOffsetX,
                                point.y * gridScale + boardOffsetY
                            );
                        }

                        slotOutline.closePath();
                        slotOutline.stroke({ color: theme.gridLine, width: GRID_LINE_WIDTH * 2, alpha: theme.gridLineAlpha * 2 });

                        gridContainer.addChild(slotOutline);
                    } else {
                        // Fallback to rectangle if no shape data
                        const slotBg = new PIXI.Graphics();
                        slotBg.rect(x - slotWidth / 2, y - slotHeight / 2, slotWidth, slotHeight);
                        slotBg.stroke({ color: theme.gridLine, width: GRID_LINE_WIDTH, alpha: theme.gridLineAlpha });
                        gridContainer.addChild(slotBg);
                    }

                    grid[row][col] = {
                        row,
                        col,
                        x,
                        y,
                        width: slotWidth,
                        height: slotHeight,
                        pieceId: null,
                        sprite: null
                    };
                }
            }
            gridSlotsRef.current = grid;

            if (!isCurrent()) return;

            // Generate piece textures
            const pieceTextures: Map<string, PIXI.Texture> = new Map();
            for (const pieceData of pieces) {
                const texture = generatePieceTexture(pieceData, pieceSource);
                if (texture) {
                    pieceTextures.set(pieceData.id, texture);
                }
            }

            // Create pieces in tray
            const trayX = refBoardWidth;
            const trayY = gridAreaHeight;
            const trayContentWidth = gridAreaWidth - BOARD_MARGIN * 2;
            const trayContentHeight = trayHeight - BOARD_MARGIN * 2;

            const piecesPerRow = gridCols;
            const pieceSlotWidth = trayContentWidth / piecesPerRow;
            const pieceSlotHeight = trayContentHeight / Math.ceil(pieces.length / piecesPerRow);

            const pieceDataById = new Map(pieces.map(piece => [piece.id, piece]));

            const existingLayout = trayLayoutRef.current;
            if (!existingLayout || existingLayout.puzzleId !== puzzleData.puzzleId) {
                const seed = hashStringToSeed(`${puzzleData.puzzleId}:${sessionSeedRef.current}`);
                const random = mulberry32(seed);

                const order = pieces.map(piece => piece.id);
                shuffleInPlace(order, random);

                const offsetsByPieceId = new Map<string, { dx: number; dy: number }>();
                const maxUp = Math.min(24, pieceSlotHeight * 0.25);
                const maxXJitter = pieceSlotWidth * 0.08;

                for (const pieceId of order) {
                    const dx = (random() * 2 - 1) * maxXJitter;
                    const dy = -random() * maxUp; // always perturb up within tray
                    offsetsByPieceId.set(pieceId, { dx, dy });
                }

                trayLayoutRef.current = { puzzleId: puzzleData.puzzleId, order, offsetsByPieceId };
            }

            const { order: trayOrder, offsetsByPieceId } = trayLayoutRef.current!;

            for (let pieceIndex = 0; pieceIndex < trayOrder.length; pieceIndex++) {
                const pieceId = trayOrder[pieceIndex];
                const pieceData = pieceDataById.get(pieceId);
                if (!pieceData) continue;

                const texture = pieceTextures.get(pieceData.id);
                if (!texture) continue;

                const piece = new PIXI.Sprite(texture) as JigsawSprite;
                piece.roundPixels = true;
                const anchor = computePieceAnchor(pieceData, texture);
                piece.anchor.set(anchor.x, anchor.y);

                // Scale to fit tray slot
                const maxPieceScale = Math.min(
                    pieceSlotWidth / texture.width,
                    pieceSlotHeight / texture.height
                ) * 0.8;
                piece.scale.set(maxPieceScale);

                // Position in tray
                const row = Math.floor(pieceIndex / piecesPerRow);
                const col = pieceIndex % piecesPerRow;
                const trayCellCenterX = trayX + BOARD_MARGIN + col * pieceSlotWidth + pieceSlotWidth / 2;
                const trayCellCenterY = trayY + BOARD_MARGIN + row * pieceSlotHeight + pieceSlotHeight / 2;
                const offsets = offsetsByPieceId.get(pieceId) ?? { dx: 0, dy: 0 };
                const trayVisualCenterX = trayCellCenterX + offsets.dx;
                const trayVisualCenterY = trayCellCenterY + offsets.dy;
                piece.x = trayVisualCenterX + (anchor.x - 0.5) * texture.width * maxPieceScale;
                piece.y = trayVisualCenterY + (anchor.y - 0.5) * texture.height * maxPieceScale;

                piece.eventMode = 'static';
                piece.cursor = 'pointer';
                piece.jigsawPieceData = pieceData;

                // Store tray position for reset
                piece.trayX = piece.x;
                piece.trayY = piece.y;
                piece.trayScale = maxPieceScale;
                piece.zIndex = PIECE_BASE_Z_INDEX + pieceIndex;

                // Drag events
                piece.on('pointerdown', (e) => {
                    gsap.killTweensOf(piece);
                    gsap.killTweensOf(piece.scale);
                    isDraggingRef.current = true;
                    dragTargetRef.current = piece;
                    const pos = e.global;
                    dragOffsetRef.current = { x: pos.x - piece.x, y: pos.y - piece.y };

                    // Check if piece is in a slot
                    // Convert piece position (global stage coords) to grid container local coords
                    const gridContainerX = gridContainerRef.current?.x || 0;
                    const currentSlot = findSlotAtPosition(piece.x - gridContainerX, piece.y);
                    if (currentSlot && currentSlot.sprite === piece) {
                        dragSourceSlotRef.current = { row: currentSlot.row, col: currentSlot.col };
                    } else {
                        dragSourceSlotRef.current = null;
                    }

                    piece.zIndex = PIECE_DRAG_Z_INDEX;
                    app.stage.sortChildren();
                });

                app.stage.addChild(piece);
                piecesRef.current.set(pieceData.id, piece);
                trayPiecesRef.current.add(pieceData.id);
            }

            // Global pointer events
            app.stage.eventMode = 'static';
            app.stage.hitArea = app.screen;

            app.stage.on('pointermove', (e) => {
                if (!isDraggingRef.current || !dragTargetRef.current) return;
                const piece = dragTargetRef.current;
                const pos = e.global;
                piece.x = pos.x - dragOffsetRef.current.x;
                piece.y = pos.y - dragOffsetRef.current.y;

                // Scale piece when over board area
                // Convert piece position (global stage coords) to grid container local coords
                const gridContainerX = gridContainerRef.current?.x || 0;
                const gridX = piece.x - gridContainerX;
                const gridY = piece.y;
                const dims = imageDimensionsRef.current || puzzleData.imageDimensions;
                const gridWidth = gridAreaWidth - BOARD_MARGIN * 2;
                const gridHeight = gridAreaHeight - BOARD_MARGIN * 2;
                const gridScale = gridScaleRef.current || 1;
                const boardWidthPx = (dims?.width ?? 0) * gridScale;
                const boardHeightPx = (dims?.height ?? 0) * gridScale;
                const boardOffsetX = BOARD_MARGIN + (gridWidth - boardWidthPx) / 2;
                const boardOffsetY = BOARD_MARGIN + (gridHeight - boardHeightPx) / 2;
                const isOverBoard =
                    gridX >= boardOffsetX &&
                    gridX <= boardOffsetX + boardWidthPx &&
                    gridY >= boardOffsetY &&
                    gridY <= boardOffsetY + boardHeightPx;

                if (isOverBoard) {
                    piece.scale.set(gridScale);
                } else if (piece.trayScale) {
                    piece.scale.set(piece.trayScale);
                }
            });

            app.stage.on('pointerup', () => {
                if (!isDraggingRef.current || !dragTargetRef.current) return;
                const piece = dragTargetRef.current;

                // Check if dropped on grid
                // Convert piece position (global stage coords) to grid container local coords
                const gridContainerX = gridContainerRef.current?.x || 0;
                const gridX = piece.x - gridContainerX;
                const gridY = piece.y;
                const slot = findSlotAtPosition(gridX, gridY);

                // Check if dropped within grid area
                const dims = imageDimensionsRef.current || puzzleData.imageDimensions;
                const gridWidth = gridAreaWidth - BOARD_MARGIN * 2;
                const gridHeight = gridAreaHeight - BOARD_MARGIN * 2;
                const gridScale = gridScaleRef.current || 1;
                const boardWidthPx = (dims?.width ?? 0) * gridScale;
                const boardHeightPx = (dims?.height ?? 0) * gridScale;
                const boardOffsetX = BOARD_MARGIN + (gridWidth - boardWidthPx) / 2;
                const boardOffsetY = BOARD_MARGIN + (gridHeight - boardHeightPx) / 2;
                const isOverBoard =
                    gridX >= boardOffsetX &&
                    gridX <= boardOffsetX + boardWidthPx &&
                    gridY >= boardOffsetY &&
                    gridY <= boardOffsetY + boardHeightPx;

            piece.zIndex = PIECE_DRAG_Z_INDEX;
            app.stage.sortChildren();

            if (slot) {
                // Snap to the slot (even if incorrect)
                if (piece.jigsawPieceData && !isPieceInCorrectSlot(piece.jigsawPieceData, slot)) {
                    playWrongSlotSound();
                }
                piece.scale.set(gridScale);
                snapPieceToSlot(piece, slot);
            } else if (isOverBoard && dragSourceSlotRef.current) {
                // Dropped on board but not in a slot - return to source slot
                const { row, col } = dragSourceSlotRef.current;
                    const sourceSlot = gridSlotsRef.current[row][col];
                    const gridOffsetX = gridContainerRef.current?.x || 0;
                    const globalX = sourceSlot.x + gridOffsetX;
                    const globalY = sourceSlot.y;
                    gsap.to(piece, {
                        x: globalX,
                        y: globalY,
                        duration: 0.2,
                        ease: 'power2.out',
                        onComplete: () => {
                            piece.zIndex = PIECE_BASE_Z_INDEX + row * gridCols + col;
                            app.stage.sortChildren();
                        }
                    });
                    piece.scale.set(gridScale);
                    if (piece.jigsawPieceData) {
                        sourceSlot.pieceId = piece.jigsawPieceData.id;
                    }
                    sourceSlot.sprite = piece;
                    dragSourceSlotRef.current = null;
                } else {
                    // Dropped outside board - return to tray
                    gsap.to(piece, {
                        x: piece.trayX,
                        y: piece.trayY,
                        duration: 0.2,
                        ease: 'power2.out',
                        onComplete: () => {
                            piece.zIndex = PIECE_BASE_Z_INDEX;
                            app.stage.sortChildren();
                        }
                    });
                    gsap.to(piece.scale, {
                        x: piece.trayScale,
                        y: piece.trayScale,
                        duration: 0.2,
                        ease: 'power2.out'
                    });
                    // Remove from source slot if came from one
                    if (dragSourceSlotRef.current) {
                        const { row, col } = dragSourceSlotRef.current;
                        const sourceSlot = gridSlotsRef.current[row][col];
                        sourceSlot.pieceId = null;
                        sourceSlot.sprite = null;
                        dragSourceSlotRef.current = null;
                    }
                }

                isDraggingRef.current = false;
                dragTargetRef.current = null;
                dragOffsetRef.current = { x: 0, y: 0 };
            });

        } catch (error) {
            if (isCurrent()) {
                console.error('Failed to load puzzle:', error);
            }
        }
    }, [puzzleData, theme, generatePieceTexture, computePieceAnchor, loadTextureWithFallback, revokeObjectUrl, findSlotAtPosition, snapPieceToSlot, gridRows, gridCols, isPieceInCorrectSlot, playWrongSlotSound]);

    // Initialize PIXI
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let isCleanedUp = false;
        const app = new PIXI.Application();
        pixiAppRef.current = app;
        let isDestroyed = false;

        const wrongAudio = new Audio(WRONG_SLOT_SOUND_URL);
        wrongAudio.preload = 'auto';
        wrongSlotAudioRef.current = wrongAudio;

        const safeDestroy = () => {
            if (isDestroyed) return;
            isDestroyed = true;
            loadTokenRef.current++;

            if (pixiAppRef.current === app) {
                pixiAppRef.current = null;
            }
            try {
                (app as any).stop?.();
            } catch (error) {
                console.warn('PIXI app stop failed (ignored):', error);
            }
            try {
                const rendererExists = Boolean((app as any).renderer);
                if (rendererExists) {
                    app.destroy(true, { children: true });
                } else {
                    (app as any).stage?.destroy?.({ children: true });
                }
            } catch (error) {
                console.warn('PIXI app destroy failed (ignored):', error);
            }

            try {
                wrongAudio.pause();
                wrongAudio.currentTime = 0;
            } catch {
                // ignore
            }
            if (wrongSlotAudioRef.current === wrongAudio) {
                wrongSlotAudioRef.current = null;
            }
        };

        const initPromise = app.init({
            width: window.innerWidth,
            height: window.innerHeight,
            backgroundColor: theme.bg,
            antialias: true,
            autoDensity: true,
            resolution: window.devicePixelRatio || 1,
            autoStart: false
        }).then(() => {
            if (isCleanedUp) {
                safeDestroy();
                return;
            }
            if (!container) return;
            container.appendChild(app.canvas);
            (app as any).start?.();
            loadPuzzle();
        }).catch((error) => {
            console.error('Failed to initialize PIXI application:', error);
            safeDestroy();
        });

        const handleResize = () => {
            if (isCleanedUp) return;
            const renderer = (app as any).renderer as PIXI.Renderer | undefined;
            if (!renderer) return;
            renderer.resize(window.innerWidth, window.innerHeight);
            loadPuzzle();
        };

        window.addEventListener('resize', handleResize);

        return () => {
            isCleanedUp = true;
            window.removeEventListener('resize', handleResize);
            void initPromise.finally(() => safeDestroy());
            objectUrlMap.current.forEach((_, key) => revokeObjectUrl(key));
        };
    }, []);

    return (
        <div
            ref={containerRef}
            style={{
                width: '100vw',
                height: '100vh',
                overflow: 'hidden',
                position: 'relative',
                background: theme.bgHex
            }}
        >
            {/* HUD */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: HUD_HEIGHT,
                    background: theme.hudBg,
                    borderTop: `1px solid ${theme.hudBorder}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 20px',
                    color: theme.text,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    fontSize: '14px',
                    zIndex: 1000
                }}
            >
                <div style={{ display: 'flex', gap: '30px' }}>
                    <div>
                        <strong>Progress:</strong> {progress}%
                    </div>
                    <div>
                        <strong>Time:</strong> {Math.floor(timeElapsed / 60)}:{(timeElapsed % 60).toString().padStart(2, '0')}
                    </div>
                </div>
                {isComplete && (
                    <div style={{ color: '#10b981', fontWeight: 'bold', fontSize: '16px' }}>
                        🎉 Puzzle Complete!
                    </div>
                )}
            </div>
        </div>
    );
}
