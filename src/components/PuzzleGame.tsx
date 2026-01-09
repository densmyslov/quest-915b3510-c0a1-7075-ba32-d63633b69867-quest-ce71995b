'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Canvas, FabricImage, Point, Rect } from 'fabric';
import { PuzzleData, PieceData } from '@/types/puzzle';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    TRAY_HEIGHT_PX: 120,    // Fixed height for the tray at bottom
    PIECE_TRAY_SIZE: 80,    // "5mm on phone" -> approx 80px visual size
    SNAP_THRESHOLD: 35,     // Distance to snap
    ROTATION_THRESHOLD: 15,
};

interface PuzzleGameProps {
    puzzleData: PuzzleData;
    onComplete?: () => void;
}

export default function PuzzleGame({ puzzleData, onComplete }: PuzzleGameProps) {
    // Canvas & State
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [fabricCanvas, setFabricCanvas] = useState<Canvas | null>(null);

    // Gameplay State
    const [unplacedPieces, setUnplacedPieces] = useState<PieceData[]>([]);
    const [progress, setProgress] = useState(0);
    const [isComplete, setIsComplete] = useState(false);
    const [timeElapsed, setTimeElapsed] = useState(0);

    // Board Reference for snapping
    const boardRef = useRef<{
        scale: number;
        left: number;
        top: number;
        width: number;
        height: number;
    } | null>(null);

    // ============================================================================
    // TIMER
    // ============================================================================
    useEffect(() => {
        if (isComplete) return;
        const timer = setInterval(() => setTimeElapsed(prev => prev + 1), 1000);
        return () => clearInterval(timer);
    }, [isComplete]);

    // ============================================================================
    // SETUP CANVAS
    // ============================================================================
    useEffect(() => {
        if (!canvasRef.current) return;

        // Canvas takes full height minus tray height
        const availableHeight = window.innerHeight - CONFIG.TRAY_HEIGHT_PX;

        const canvas = new Canvas(canvasRef.current, {
            width: window.innerWidth,
            height: availableHeight,
            backgroundColor: '#1a1a2e',
            selection: false,
            // Enable touch handling manually if needed, but standard Fabric works for basic pans with some config
            allowTouchScrolling: false
        });

        setFabricCanvas(canvas);

        const handleResize = () => {
            const newHeight = window.innerHeight - CONFIG.TRAY_HEIGHT_PX;
            canvas.setWidth(window.innerWidth);
            canvas.setHeight(newHeight);
            canvas.renderAll();
        };
        window.addEventListener('resize', handleResize);

        // cleanup
        return () => {
            window.removeEventListener('resize', handleResize);
            canvas.dispose();
        };
    }, []);

    // ============================================================================
    // INITIALIZE GAME
    // ============================================================================
    useEffect(() => {
        if (!fabricCanvas || !puzzleData) return;

        const initGame = async () => {
            fabricCanvas.clear();
            fabricCanvas.backgroundColor = '#1a1a2e';

            // 1. Setup Board
            await setupBoard(fabricCanvas, puzzleData);

            // 2. Setup Unplaced Pieces (HTML Tray)
            // We only put pieces in tray initially
            setUnplacedPieces(puzzleData.pieces);

            // 3. Setup Zoom / Pan Handlers
            setupZoomPan(fabricCanvas);
        };

        initGame();

        // Listen for Snap events
        fabricCanvas.on('object:modified', (e) => {
            const target = e.target as FabricImage;
            if (!target || !(target as any).data) return;
            checkSnap(target);
        });

        // Listen for selection to bring to front
        fabricCanvas.on('selection:created', (e) => {
            if (e.selected && e.selected[0]) {
                fabricCanvas.bringObjectToFront(e.selected[0]);
            }
        });

        // Listen for touch drag end for snapping
        fabricCanvas.on('mouse:up', (e) => {
            if (e.target) {
                checkSnap(e.target as FabricImage);
                fabricCanvas.renderAll();
            }
        });

        return () => {
            fabricCanvas.off('object:modified');
            fabricCanvas.off('selection:created');
            fabricCanvas.off('mouse:up');
        };

    }, [fabricCanvas, puzzleData]);

    // ============================================================================
    // BOARD SETUP
    // ============================================================================
    const setupBoard = async (canvas: Canvas, data: PuzzleData) => {
        const bgUrl = data.boardImageDataUrl || data.boardImageUrl || data.originalImageUrl;
        if (!bgUrl) return;

        try {
            const img = await FabricImage.fromURL(bgUrl, { crossOrigin: 'anonymous' });

            // Initial positioning: Fit to screen with margin
            const margin = 0.90; // 90% of screen
            const canvasWidth = canvas.width!;
            const canvasHeight = canvas.height!;

            const scale = Math.min(
                (canvasWidth * margin) / img.width!,
                (canvasHeight * margin) / img.height!
            );

            const scaledWidth = img.width! * scale;
            const scaledHeight = img.height! * scale;

            img.set({
                left: canvasWidth / 2,
                top: canvasHeight / 2,
                originX: 'center',
                originY: 'center',
                scaleX: scale,
                scaleY: scale,
                selectable: false,
                evented: false, // Allow events to pass through for panning?
                // Actually, if we pan the VIEWPORT, we don't move the object.
                // But dragging on the background needs to trigger pan.
                opacity: 1
            });

            canvas.add(img);

            // Store reference for scaling/snapping
            boardRef.current = {
                scale: scale,
                left: canvasWidth / 2 - scaledWidth / 2,
                top: canvasHeight / 2 - scaledHeight / 2,
                width: scaledWidth,
                height: scaledHeight
            };

            canvas.renderAll();

        } catch (e) {
            console.error("Failed to setup board", e);
        }
    };

    // ============================================================================
    // ZOOM & PAN LOGIC
    // ============================================================================
    const setupZoomPan = (canvas: Canvas) => {
        let isDragging = false;
        let lastPosX = 0;
        let lastPosY = 0;

        // Touch State
        let lastTouchDistance = 0;
        let isPinching = false;

        // Mouse Wheel Zoom
        canvas.on('mouse:wheel', (opt) => {
            const delta = opt.e.deltaY;
            let zoom = canvas.getZoom();
            zoom *= 0.999 ** delta;

            // Limits
            if (zoom > 5) zoom = 5;
            if (zoom < 0.5) zoom = 0.5;

            canvas.zoomToPoint(new Point(opt.e.offsetX, opt.e.offsetY), zoom);
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });


        canvas.on('mouse:down', function (opt) {
            const evt = opt.e;

            // CHECK FOR PINCH (2 touches)
            if ('touches' in evt && evt.touches && evt.touches.length === 2) {
                isPinching = true;
                const t1 = evt.touches[0];
                const t2 = evt.touches[1];
                const dist = Math.sqrt(Math.pow(t1.clientX - t2.clientX, 2) + Math.pow(t1.clientY - t2.clientY, 2));
                lastTouchDistance = dist;
                isDragging = false; // Disable drag if pinching
                return;
            }
            isPinching = false;

            // If we clicked on an active object (piece), don't pan
            if (opt.target && opt.target.type !== 'image' && opt.target.selectable) {
                if (opt.target.selectable) return;
            }
            if (opt.target && opt.target.selectable) return;

            isDragging = true;
            // Handle Touch vs Mouse
            let clientX, clientY;
            if ('touches' in evt && evt.touches && evt.touches.length > 0) {
                // Touch (1 finger)
                clientX = evt.touches[0].clientX;
                clientY = evt.touches[0].clientY;
            } else {
                clientX = (evt as MouseEvent).clientX;
                clientY = (evt as MouseEvent).clientY;
            }

            lastPosX = clientX;
            lastPosY = clientY;
            canvas.setCursor('grabbing');
        });

        canvas.on('mouse:move', function (opt) {
            const e = opt.e;

            // PINCH ZOOM
            if (isPinching && 'touches' in e && e.touches && e.touches.length === 2) {
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                const dist = Math.sqrt(Math.pow(t1.clientX - t2.clientX, 2) + Math.pow(t1.clientY - t2.clientY, 2));

                if (lastTouchDistance > 0) {
                    const scale = dist / lastTouchDistance;
                    let zoom = canvas.getZoom() * scale;
                    // Limits
                    if (zoom > 5) zoom = 5;
                    if (zoom < 0.5) zoom = 0.5;

                    // Center of pinch
                    const cx = (t1.clientX + t2.clientX) / 2;
                    const cy = (t1.clientY + t2.clientY) / 2;

                    // We need to convert screen point to canvas point?
                    // fabric.Point takes offset relative to canvas.
                    // clientX is global.
                    // Assuming canvas fills screen or we account for offset.
                    // canvas.getSelectionElement().getBoundingClientRect() ?
                    // Since canvas is fullscreen:
                    canvas.zoomToPoint(new Point(cx, cy), zoom);
                }

                lastTouchDistance = dist;
                return;
            }

            if (isDragging) {
                let clientX, clientY;
                if ('touches' in e && e.touches && e.touches.length > 0) {
                    clientX = e.touches[0].clientX;
                    clientY = e.touches[0].clientY;
                } else {
                    clientX = (e as MouseEvent).clientX;
                    clientY = (e as MouseEvent).clientY;
                }

                const vpt = canvas.viewportTransform!;
                vpt[4] += clientX - lastPosX;
                vpt[5] += clientY - lastPosY;
                canvas.requestRenderAll();
                lastPosX = clientX;
                lastPosY = clientY;
            }
        });

        canvas.on('mouse:up', function () {
            // on mouse up we want to recalculate new interaction
            isDragging = false;
            isPinching = false;
            canvas.setViewportTransform(canvas.viewportTransform!); // Fixes controls/coords
            canvas.setCursor('default');
        });
    };

    // ============================================================================
    // MOVE FROM TRAY TO BOARD
    // ============================================================================
    const handlePieceFromTray = async (piece: PieceData) => {
        if (!fabricCanvas || !boardRef.current) return;

        // 1. Remove from HTML Tray
        setUnplacedPieces(prev => prev.filter(p => p.id !== piece.id));

        // 2. Add to Fabric Canvas
        try {
            const sourceUrl = piece.imageDataUrl || piece.imageUrl;
            if (!sourceUrl) {
                throw new Error(`Missing image source for piece ${piece.id}`);
            }

            const img = await FabricImage.fromURL(sourceUrl, { crossOrigin: 'anonymous' });

            // Calculate scale to match the BOARD's visual scale
            // The pieces in `puzzleData` are relative to the *Original Image* size.
            // Our Board is displayed at `boardRef.current.scale`.
            const pieceScale = boardRef.current.scale;

            // Place in center of VIEWPORT (not canvas constant center)
            // We need to invert viewport transform to find "center of screen in canvas coords"
            const vpt = fabricCanvas.viewportTransform!;
            // const invert = (val: number, trans: number) => (val - trans) / vpt[0]; // simplistic inverse for zoom/pan

            // Or better: canvas.getCenter()... but getCenter returns point in canvas space?
            // Let's just put it at actual center of visible area.
            // Screen center:
            const screenCenterX = fabricCanvas.width! / 2;
            const screenCenterY = fabricCanvas.height! / 2;

            // Convert to canvas coords
            // fabric keeps vpt: [scaleX, skewY, skewX, scaleY, transX, transY]
            const zoom = vpt[0];
            const transX = vpt[4];
            const transY = vpt[5];

            const canvasX = (screenCenterX - transX) / zoom;
            const canvasY = (screenCenterY - transY) / zoom;

            img.set({
                left: canvasX,
                top: canvasY,
                originX: 'center',
                originY: 'center',
                scaleX: pieceScale,
                scaleY: pieceScale,
                hasControls: puzzleData.enableRotation || false,
                hasBorders: true,
                borderColor: '#4ade80',
                cornerColor: '#4ade80',
                transparentCorners: false,
                // Metadata for snapping
                data: {
                    id: piece.id,
                    correctX: piece.correctPosition.x,
                    correctY: piece.correctPosition.y,
                    correctRotation: piece.correctRotation || 0
                }
            });

            fabricCanvas.add(img);
            fabricCanvas.setActiveObject(img);
            fabricCanvas.renderAll();

            // Re-check progress
            checkWinCondition();

        } catch (e) {
            console.error("Failed to add piece to board", e);
        }
    };

    // ============================================================================
    // SNAPPING & WIN LOGIC
    // ============================================================================
    const checkSnap = (target: FabricImage) => {
        if (!boardRef.current) return;
        const data = (target as any).data;
        if (!data) return;

        const currentX = target.left!;
        const currentY = target.top!;

        // Board position (Top-Left of the image object on canvas)
        // boardRef.left/top is the top-left coordinate
        // const boardX = boardRef.current.left;
        // const boardY = boardRef.current.top;
        // const scale = boardRef.current.scale;

        // Target Global Position = Board Origin + (Relative Correct Pos * Scale)
        // Note: puzzleData.correctPosition is usually relative to Top-Left of original image?
        // Need to verify standard. In `extractPieces`, correctPosition is bounded rect center.
        // Wait, correctPosition x/y is the CENTER of the piece in original image coords.
        // Fabric Image origin is Center.
        // So:
        // const targetX = boardX + (data.correctX * scale); // ? No.

        // Let's re-verify coordinates.
        // In most of our implementations:
        // Board is centered.
        // Pieces correct pos is relative to original image 0,0.
        // So targetX = board_top_left_x + (piece_correct_x * scale)
        // But `boardRef.current.left` IS `board_top_left_x`.
        // BUT wait, `boardRef.current` calculation:
        // `left: canvasWidth / 2 - scaledWidth / 2`
        // `top: canvasHeight / 2 - scaledHeight / 2`
        // THIS IS CORRECT.

        // HOWEVER, `data.correctX` is usually the Center X of the piece.
        // And `target.left` is Center X (originX='center').
        // So:
        const expectedX = boardRef.current.left + (data.correctX * boardRef.current.scale);
        const expectedY = boardRef.current.top + (data.correctY * boardRef.current.scale);

        const dist = Math.sqrt(Math.pow(currentX - expectedX, 2) + Math.pow(currentY - expectedY, 2));

        // Adjust threshold by zoom level to make it feel consistent?
        // Or keep absolute screen pixels? Dist is in Canvas Coords.
        // It should be fairly generous.

        if (dist < CONFIG.SNAP_THRESHOLD / (fabricCanvas?.getZoom() || 1)) {
            // SNAP!
            target.animate(
                { left: expectedX, top: expectedY, angle: data.correctRotation || 0 }, // angle?
                {
                    duration: 100,
                    onChange: () => fabricCanvas?.renderAll(),
                    onComplete: () => {
                        target.set({
                            selectable: false,
                            evented: false,
                            fill: 'brightness(1.2)' // visual feedback? No fill on image.
                        });
                        // Sparkle or flash?
                        const rect = new Rect({
                            left: expectedX,
                            top: expectedY,
                            width: target.getScaledWidth(),
                            height: target.getScaledHeight(),
                            fill: 'rgba(74, 222, 128, 0.3)',
                            originX: 'center',
                            originY: 'center',
                            rx: 5, ry: 5
                        });
                        fabricCanvas?.add(rect);
                        fabricCanvas?.renderAll();
                        setTimeout(() => {
                            fabricCanvas?.remove(rect);
                            fabricCanvas?.renderAll();
                        }, 300);

                        checkWinCondition();
                    }
                }
            );
        }
    };

    const checkWinCondition = () => {
        // We need to wait for state update? No, check manually.
        // Win = Unplaced is Empty AND Active Pieces on Canvas are all Not Selectable (Snapped)
        // Actually, easy way:
        if (!fabricCanvas) return;

        // Count snapped pieces
        const allObjects = fabricCanvas.getObjects();
        const pieces = allObjects.filter(o => (o as any).data); // All pieces have data
        const snapped = pieces.filter(o => !o.selectable);

        const total = puzzleData.pieces.length;
        const currentSnappedCount = snapped.length;

        const pct = Math.floor((currentSnappedCount / total) * 100);
        setProgress(pct);

        if (currentSnappedCount === total) {
            setIsComplete(true);
            onComplete?.();
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="flex flex-col h-[100dvh] bg-gray-900 overflow-hidden">

            {/* CANVAS AREA (Main) */}
            <div className="relative flex-grow overflow-hidden">
                <canvas ref={canvasRef} />

                {/* HUD Overlay */}
                <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
                    <div className="bg-black/60 text-white px-3 py-1 rounded backdrop-blur-sm text-sm">
                        ⏳ {formatTime(timeElapsed)}
                    </div>
                    <div className="bg-black/60 text-white px-3 py-1 rounded backdrop-blur-sm text-sm">
                        🧩 {progress}%
                    </div>
                </div>

                {/* Reset Zoom Button */}
                <button
                    onClick={() => {
                        fabricCanvas?.setViewportTransform([1, 0, 0, 1, 0, 0]);
                        fabricCanvas?.renderAll();
                    }}
                    className="absolute top-4 right-4 z-10 bg-white/20 p-2 rounded-full text-white hover:bg-white/30 backdrop-blur-sm"
                >
                    🔍 Reset
                </button>
            </div>

            {/* TRAY AREA (Bottom, Fixed) */}
            <div
                className="w-full bg-gray-800 border-t border-gray-700 z-20 flex items-center p-2 gap-2 overflow-x-auto shadow-2xl"
                style={{ height: CONFIG.TRAY_HEIGHT_PX, flexShrink: 0 }}
            >
                {unplacedPieces.length === 0 ? (
                    <div className="w-full text-center text-gray-500 text-sm">
                        All pieces on board!
                    </div>
                ) : (
                    unplacedPieces.map(piece => (
                        <div
                            key={piece.id}
                            onClick={() => handlePieceFromTray(piece)}
                            className="relative flex-shrink-0 cursor-pointer hover:scale-105 transition-transform active:scale-95"
                            style={{
                                width: CONFIG.PIECE_TRAY_SIZE,
                                height: CONFIG.PIECE_TRAY_SIZE,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            {(piece.imageDataUrl || piece.imageUrl) ? (
                                <img
                                    src={piece.imageDataUrl || piece.imageUrl}
                                    alt="puzzle piece"
                                    className="max-w-full max-h-full drop-shadow-md"
                                    style={{ pointerEvents: 'none' }}
                                />
                            ) : (
                                <div className="text-xs text-gray-400">No image</div>
                            )}
                        </div>
                    ))
                )}
            </div>

        </div>
    );
}
