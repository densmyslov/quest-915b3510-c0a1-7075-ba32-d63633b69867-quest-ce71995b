import { useState, useRef, useEffect, useCallback } from 'react';
import { PuzzlePiece, TouchPoint, PuzzleGameOptions } from './puzzle-types';

export function usePuzzleGame({
    initialPieces,
    snapThreshold = 30,
    onPiecePlace,
    onPuzzleComplete
}: PuzzleGameOptions) {
    // Board zoom and pan state
    const [scale, setScale] = useState(1);
    const [translate, setTranslate] = useState({ x: 0, y: 0 });

    // Use refs for gesture tracking to avoid re-renders and stale closures during high-frequency events
    const lastTouchDistance = useRef<number | null>(null);
    const lastTouchMidpoint = useRef<TouchPoint | null>(null);

    // Puzzle pieces state
    const [pieces, setPieces] = useState<PuzzlePiece[]>(initialPieces);

    const [draggedPiece, setDraggedPiece] = useState<string | null>(null);
    const [dragOffset, setDragOffset] = useState<TouchPoint>({ x: 0, y: 0 });

    const containerRef = useRef<HTMLDivElement>(null);

    // Calculate distance between two touch points
    const getTouchDistance = (touch1: { clientX: number, clientY: number }, touch2: { clientX: number, clientY: number }): number => {
        const dx = touch1.clientX - touch2.clientX;
        const dy = touch1.clientY - touch2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    };

    // Calculate midpoint between two touch points
    const getTouchMidpoint = (touch1: { clientX: number, clientY: number }, touch2: { clientX: number, clientY: number }): TouchPoint => {
        return {
            x: (touch1.clientX + touch2.clientX) / 2,
            y: (touch1.clientY + touch2.clientY) / 2
        };
    };

    // Handle pinch zoom on the board
    const handleBoardTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 2) {
            // Pinch gesture started
            const distance = getTouchDistance(e.touches[0], e.touches[1]);
            const midpoint = getTouchMidpoint(e.touches[0], e.touches[1]);
            lastTouchDistance.current = distance;
            lastTouchMidpoint.current = midpoint;
        }
    };

    // Use non-passive event listener for board moves to prevent browser zooming/scrolling
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const onTouchMove = (e: TouchEvent) => {
            // Prevent default for ALL touches on the board to stop scrolling/zooming of the page
            if (e.cancelable) {
                e.preventDefault();
            }

            if (e.touches.length === 2 && lastTouchDistance.current !== null) {
                // 1. Measure distance between fingers
                const distance = getTouchDistance(e.touches[0], e.touches[1]);
                const midpoint = getTouchMidpoint(e.touches[0], e.touches[1]);

                // 2. Calculate scale change
                const currentDist = lastTouchDistance.current;
                const scaleChange = distance / currentDist;

                // Use functional update to ensure we have latest scale state without re-binding often
                setScale(prevScale => {
                    const newScale = Math.max(0.8, Math.min(3, prevScale * scaleChange));

                    // 3. Adjust pan to keep zoom centered on pinch point
                    // We need to access the LATEST translate state. 
                    // Since we can't easily get it inside setScale, we rely on the effect dependency.
                    // Ideally we'd calculate everything in one state update or use refs for all mutable state during drag.
                    // For now, let's just update scale and let the next frame handle pan or use refs for translate too?
                    // Actually, let's keep it simple: just update logic.
                    // BUT: 'scale' and 'translate' in this closure ARE stale if we don't re-bind. 
                    // The best way for high-perf gestures is refs for EVERYTHING mutable.
                    return newScale;
                });

                // RE-READING: To implement centered zoom correctly without stale closures, 
                // we need access to the current 'scale' and 'translate' INSIDE this event handler.
                // The easiest fix is to use refs for 'scale' and 'translate' too, OR keep re-binding.
                // Re-binding is okay if logic is fast. The issue was likely state async updates.
                // Let's stick to the previous logic but use refs for the "last" values.

                // Actually, let's rely on the dependency array re-binding the listener. 
                // The critical fix was likely `lastTouchDistance` being a ref so it updates immediately.

                // Wait, if we re-bind, we have fresh state. 
                // Let's implement the FULL logic here assuming 'scale' and 'translate' are fresh from dependency.

                const newScale = Math.max(0.8, Math.min(3, scale * scaleChange));

                const rect = container.getBoundingClientRect();
                const pinchX = midpoint.x - rect.left;
                const pinchY = midpoint.y - rect.top;

                const dx = pinchX - (pinchX - translate.x) * (newScale / scale);
                const dy = pinchY - (pinchY - translate.y) * (newScale / scale);

                setTranslate({ x: dx, y: dy });
                setScale(newScale); // logic above was just for thought process, actual update

                lastTouchDistance.current = distance;
                lastTouchMidpoint.current = midpoint;

            } else if (e.touches.length === 1 && draggedPiece === null) {
                // Single finger pan
                if (lastTouchMidpoint.current !== null) {
                    const touch = e.touches[0];
                    const dx = touch.clientX - lastTouchMidpoint.current.x;
                    const dy = touch.clientY - lastTouchMidpoint.current.y;

                    setTranslate(prev => ({
                        x: prev.x + dx,
                        y: prev.y + dy
                    }));

                    lastTouchMidpoint.current = { x: touch.clientX, y: touch.clientY };
                } else {
                    lastTouchMidpoint.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                }
            }
        };

        container.addEventListener('touchmove', onTouchMove, { passive: false });

        return () => {
            container.removeEventListener('touchmove', onTouchMove);
        };
    }, [scale, translate, draggedPiece]); // Removed lastTouch* from deps

    const handleBoardTouchEnd = () => {
        lastTouchDistance.current = null;
        lastTouchMidpoint.current = null;
    };

    // Handle piece dragging
    const handlePieceTouchStart = (e: React.TouchEvent, pieceId: string) => {
        e.stopPropagation(); // Prevent board zoom/pan

        const touch = e.touches[0];
        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();

        setDraggedPiece(pieceId);
        setDragOffset({
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        });
    };

    const handlePieceTouchMove = (e: React.TouchEvent) => {
        if (draggedPiece && containerRef.current) {
            e.preventDefault();

            const touch = e.touches[0];
            const containerRect = containerRef.current.getBoundingClientRect();

            // Convert touch position to board coordinates (accounting for zoom/pan)
            const boardX = (touch.clientX - containerRect.left - translate.x - dragOffset.x) / scale;
            const boardY = (touch.clientY - containerRect.top - translate.y - dragOffset.y) / scale;

            setPieces(prev => prev.map(piece =>
                piece.id === draggedPiece
                    ? { ...piece, currentX: boardX, currentY: boardY }
                    : piece
            ));
        }
    };

    const handlePieceTouchEnd = () => {
        if (draggedPiece) {
            const piece = pieces.find(p => p.id === draggedPiece);

            if (piece && piece.currentX !== undefined && piece.currentY !== undefined) {
                // Check if piece is close enough to target position
                const dx = Math.abs(piece.currentX - piece.targetX);
                const dy = Math.abs(piece.currentY - piece.targetY);

                if (dx < snapThreshold && dy < snapThreshold) {
                    // Snap to correct position
                    setPieces(prev => prev.map(p =>
                        p.id === draggedPiece
                            ? { ...p, currentX: p.targetX, currentY: p.targetY, placed: true }
                            : p
                    ));
                    onPiecePlace?.(draggedPiece);
                } else {
                    // Return to piece tray
                    setPieces(prev => prev.map(p =>
                        p.id === draggedPiece
                            ? { ...p, currentX: undefined, currentY: undefined, placed: false }
                            : p
                    ));
                }
            }

            setDraggedPiece(null);
            setDragOffset({ x: 0, y: 0 });
        }
    };

    // Check if puzzle is complete
    const isComplete = pieces.every(piece => piece.placed);

    useEffect(() => {
        if (isComplete) {
            onPuzzleComplete?.();
        }
    }, [isComplete, onPuzzleComplete]);

    // Expose unlockPiece for external control (Location)
    const unlockPiece = useCallback((pieceId: string) => {
        setPieces(prev => prev.map(p =>
            p.id === pieceId ? { ...p, unlocked: true } : p
        ));
    }, []);

    // Update pieces if initialPieces change (e.g. form DB/Context)
    useEffect(() => {
        // Only update if we have new data structure, to avoid resetting placement state
        // In a real app we might want deeper comparison or specific update logic
        // For now, we assume initialPieces drives the collected/unlocked state
        setPieces(current => {
            return initialPieces.map(initial => {
                const existing = current.find(c => c.id === initial.id);
                if (existing) {
                    return { ...initial, ...existing, unlocked: initial.unlocked };
                }
                return initial;
            });
        });
    }, [initialPieces]);

    return {
        pieces,
        scale,
        setScale,
        translate,
        setTranslate,
        containerRef,
        handleBoardTouchStart,
        // handleBoardTouchMove removed from return as it's handled via ref
        handleBoardTouchEnd,
        handlePieceTouchStart,
        handlePieceTouchMove,
        handlePieceTouchEnd,
        isComplete,
        unlockPiece
    };
}
