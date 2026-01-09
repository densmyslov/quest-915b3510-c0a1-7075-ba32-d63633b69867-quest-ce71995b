'use client';

/**
 * React Component Wrapper for Witch's Knot Puzzle
 * FIXED: Uses refs to avoid stale closure in PixiJS event handlers
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as PIXI from 'pixi.js';

// ============================================================================
// TYPES
// ============================================================================

interface WitchKnotGameProps {
  puzzleData: any;
  onComplete?: () => void;
}

interface PuzzleState {
  isLoading: boolean;
  error: string | null;
  showCompletion: boolean;
  currentStudIndex: number;
  totalStuds: number;
  correctClicks: number;
  wrongClicks: number;
  timeElapsed: number;
  isRunning: boolean;
}

interface Point {
  x: number;
  y: number;
  // Relative coordinates (0-1 range) for consistent positioning across different canvas sizes
  rx?: number;
  ry?: number;
}

interface Stud extends Point {
  id?: string;
}

interface Pattern {
  name?: string;
  color?: string;
  points: number[];
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Calculate image transformation (scale and offset) for a given canvas
 */
const getImageTransform = (
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number
) => {
  const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const scaledWidth = imageWidth * scale;
  const scaledHeight = imageHeight * scale;
  const offsetX = (canvasWidth - scaledWidth) / 2;
  const offsetY = (canvasHeight - scaledHeight) / 2;

  return { scale, offsetX, offsetY, scaledWidth, scaledHeight };
};

/**
 * Convert canvas coordinates to image-relative coordinates (0-1 range)
 */
const canvasToImageRelative = (
  canvasX: number,
  canvasY: number,
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number
): Point => {
  const { scale, offsetX, offsetY } = getImageTransform(imageWidth, imageHeight, canvasWidth, canvasHeight);

  // Remove offset to get position relative to image top-left
  const imageX = (canvasX - offsetX) / scale;
  const imageY = (canvasY - offsetY) / scale;

  // Convert to 0-1 range relative to image dimensions
  return {
    x: imageX / imageWidth,
    y: imageY / imageHeight
  };
};

/**
 * Convert image-relative coordinates (0-1 range) to canvas coordinates
 */
const imageRelativeToCanvas = (
  relativeX: number,
  relativeY: number,
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number
): Point => {
  const { scale, offsetX, offsetY } = getImageTransform(imageWidth, imageHeight, canvasWidth, canvasHeight);

  // Convert from 0-1 range to image pixel coordinates
  const imageX = relativeX * imageWidth;
  const imageY = relativeY * imageHeight;

  // Apply scale and offset to get canvas coordinates
  return {
    x: imageX * scale + offsetX,
    y: imageY * scale + offsetY
  };
};

/**
 * Get display coordinates from a point (uses relative coords if available, falls back to absolute)
 */
const getDisplayCoords = (
  point: Point,
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  sourceCanvasWidth?: number,
  sourceCanvasHeight?: number
): Point => {
  if (point.rx !== undefined && point.ry !== undefined) {
    return imageRelativeToCanvas(point.rx, point.ry, imageWidth, imageHeight, canvasWidth, canvasHeight);
  }
  if (sourceCanvasWidth && sourceCanvasHeight) {
    const rel = canvasToImageRelative(point.x, point.y, imageWidth, imageHeight, sourceCanvasWidth, sourceCanvasHeight);
    return imageRelativeToCanvas(rel.x, rel.y, imageWidth, imageHeight, canvasWidth, canvasHeight);
  }
  // Fallback to absolute coords
  return { x: point.x, y: point.y };
};

const formatTime = (timeSeconds: number) => {
  const minutes = Math.floor(timeSeconds / 60);
  const seconds = timeSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const drawRopeKnot = (
  graphics: PIXI.Graphics,
  pattern: Pattern,
  studsList: Stud[],
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  sourceCanvasWidth?: number,
  sourceCanvasHeight?: number
) => {
  if (!pattern.points || pattern.points.length < 2) return;

  const color = parseInt((pattern.color || '#cc3333').replace('#', '0x'), 16);

  // Get all display coordinates for the pattern
  const displayPoints = pattern.points
    .map((idx) =>
      getDisplayCoords(
        studsList[idx],
        imageWidth,
        imageHeight,
        canvasWidth,
        canvasHeight,
        sourceCanvasWidth,
        sourceCanvasHeight
      )
    )
    .filter((p) => p !== null);

  if (displayPoints.length < 2) return;

  // Helper function to draw a smooth curve through points using quadratic curves
  const drawSmoothCurve = (points: Point[], offsetX: number, offsetY: number, strokeStyle: any) => {
    if (points.length < 2) return;

    graphics.moveTo(points[0].x + offsetX, points[0].y + offsetY);

    if (points.length === 2) {
      // For just 2 points, draw a straight line
      graphics.lineTo(points[1].x + offsetX, points[1].y + offsetY);
    } else {
      // For multiple points, use quadratic curves for smoothness
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i + 1];

        if (i === points.length - 2) {
          // Last segment - draw directly to the end point
          graphics.lineTo(p1.x + offsetX, p1.y + offsetY);
        } else {
          // Create a smooth curve using the midpoint as control point
          const p2 = points[i + 2];
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;

          // Draw quadratic curve to midpoint, using p1 as control point
          graphics.quadraticCurveTo(
            p1.x + offsetX,
            p1.y + offsetY,
            midX + offsetX,
            midY + offsetY
          );
        }
      }
    }

    graphics.stroke(strokeStyle);
  };

  // Draw shadow layer
  drawSmoothCurve(displayPoints, 2, 2, { width: 8, color: 0x000000, alpha: 0.3 });

  // Draw main rope
  drawSmoothCurve(displayPoints, 0, 0, { width: 6, color });

  // Draw highlight
  drawSmoothCurve(displayPoints, -1, -1, { width: 2, color: 0xffffff, alpha: 0.3 });

  // Draw knots at stud points
  pattern.points.forEach((idx) => {
    const stud = getDisplayCoords(
      studsList[idx],
      imageWidth,
      imageHeight,
      canvasWidth,
      canvasHeight,
      sourceCanvasWidth,
      sourceCanvasHeight
    );
    if (!stud) return;

    graphics.circle(stud.x, stud.y, 8);
    graphics.fill({ color });
    graphics.stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
  });
};

const renderReferenceBoard = (
  graphics: PIXI.Graphics,
  contour: Point[],
  pattern: Pattern | null,
  studsList: Stud[],
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  sourceCanvasWidth?: number,
  sourceCanvasHeight?: number
) => {
  graphics.clear();

  if (contour.length > 2) {
    const p0 = getDisplayCoords(
      contour[0],
      imageWidth,
      imageHeight,
      canvasWidth,
      canvasHeight,
      sourceCanvasWidth,
      sourceCanvasHeight
    );
    graphics.moveTo(p0.x, p0.y);
    contour.forEach((p, i) => {
      if (i > 0) {
        const displayP = getDisplayCoords(
          p,
          imageWidth,
          imageHeight,
          canvasWidth,
          canvasHeight,
          sourceCanvasWidth,
          sourceCanvasHeight
        );
        graphics.lineTo(displayP.x, displayP.y);
      }
    });
    graphics.closePath();
    graphics.fill({ color: 0x3d3428, alpha: 0.8 });
    graphics.stroke({ width: 3, color: 0x5a4a38 });
  }

  if (pattern && pattern.points?.length > 1 && studsList.length > 0) {
    drawRopeKnot(
      graphics,
      pattern,
      studsList,
      imageWidth,
      imageHeight,
      canvasWidth,
      canvasHeight,
      sourceCanvasWidth,
      sourceCanvasHeight
    );
  }
};

// ============================================================================
// COMPONENT
// ============================================================================

export default function WitchKnotGame({ puzzleData, onComplete }: WitchKnotGameProps) {
  const upperContainerRef = useRef<HTMLDivElement>(null);
  const lowerContainerRef = useRef<HTMLDivElement>(null);
  const upperAppRef = useRef<PIXI.Application | null>(null);
  const lowerAppRef = useRef<PIXI.Application | null>(null);
  const lineGraphicsRef = useRef<PIXI.Graphics | null>(null);
  const referenceGraphicsRef = useRef<PIXI.Graphics | null>(null);
  const studGraphicsRef = useRef<PIXI.Graphics[]>([]);
  const imageDimensionsRef = useRef<{
    width: number;
    height: number;
    canvasWidth: number;
    canvasHeight: number;
    sourceCanvasWidth: number;
    sourceCanvasHeight: number;
  } | null>(null);

  const [state, setState] = useState<PuzzleState>({
    isLoading: true,
    error: null,
    showCompletion: false,
    currentStudIndex: 0,
    totalStuds: 0,
    correctClicks: 0,
    wrongClicks: 0,
    timeElapsed: 0,
    isRunning: false
  });

  // Use refs to access current state in PixiJS callbacks
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Extract puzzle data
  const {
    studs = [],
    patterns = [],
    doorImageUrl,
    originalImageUrl,
    imageDimensions,
    canvas,
    doorContour = []
  } = puzzleData || {};

  const [selectedPatternIndex, setSelectedPatternIndex] = useState(0);



  const selectedPattern: Pattern | null = patterns[selectedPatternIndex] || patterns[0] || null;
  const selectedPatternRef = useRef(selectedPattern);

  useEffect(() => {
    selectedPatternRef.current = selectedPattern;
  }, [selectedPattern]);

  // Store studs in ref for access in callbacks
  const studsRef = useRef(studs);
  useEffect(() => {
    studsRef.current = studs;
  }, [studs]);

  const resetProgress = useCallback((pattern: Pattern | null) => {
    lineGraphicsRef.current?.clear();
    setState((prev) => ({
      ...prev,
      currentStudIndex: 0,
      totalStuds: pattern?.points?.length || 0,
      correctClicks: 0,
      wrongClicks: 0,
      timeElapsed: 0,
      isRunning: false,
      showCompletion: false
    }));
  }, []);

  // Clamping Effect: Ensure selected index is valid when patterns change
  // Clamping Effect: Ensure selected index is valid when patterns change
  useEffect(() => {
    if (patterns.length > 0 && selectedPatternIndex >= patterns.length) {
      const newIndex = patterns.length - 1;
      setTimeout(() => {
        setSelectedPatternIndex(newIndex);
        resetProgress(patterns[newIndex] || null);
      }, 0);
    }
  }, [patterns.length, selectedPatternIndex, resetProgress, patterns]);

  // Timer
  useEffect(() => {
    if (!state.isRunning || state.showCompletion) return;
    const timer = setInterval(() => {
      setState((prev) => ({ ...prev, timeElapsed: prev.timeElapsed + 1 }));
    }, 1000);
    return () => clearInterval(timer);
  }, [state.isRunning, state.showCompletion]);

  // Handle stud click - uses refs to get current state
  const handleStudClick = useCallback(
    (studIndex: number) => {
      const currentState = stateRef.current;
      const pattern = selectedPatternRef.current;
      const studsList = studsRef.current;
      const dims = imageDimensionsRef.current;

      if (!pattern || !pattern.points?.length || currentState.showCompletion) {
        return;
      }

      const shouldStart = !currentState.isRunning;
      const expectedIndex = pattern.points[currentState.currentStudIndex];
      if (expectedIndex === undefined) return;

      if (studIndex === expectedIndex) {
        const newIndex = currentState.currentStudIndex + 1;

        // Draw line from previous stud to this one
        if (lineGraphicsRef.current && newIndex > 1 && dims) {
          const prevStudIdx = pattern.points[newIndex - 2];
          const currStudIdx = studIndex;
          const prevStud = getDisplayCoords(
            studsList[prevStudIdx],
            dims.width,
            dims.height,
            dims.canvasWidth,
            dims.canvasHeight,
            dims.sourceCanvasWidth,
            dims.sourceCanvasHeight
          );
          const currStud = getDisplayCoords(
            studsList[currStudIdx],
            dims.width,
            dims.height,
            dims.canvasWidth,
            dims.canvasHeight,
            dims.sourceCanvasWidth,
            dims.sourceCanvasHeight
          );

          if (prevStud && currStud) {
            lineGraphicsRef.current.moveTo(prevStud.x, prevStud.y);
            lineGraphicsRef.current.lineTo(currStud.x, currStud.y);
            lineGraphicsRef.current.stroke({
              width: 4,
              color: parseInt((pattern.color || '#cc3333').replace('#', '0x'), 16)
            });
          }
        }

        const isComplete = newIndex >= pattern.points.length;
        setState((prev) => ({
          ...prev,
          currentStudIndex: newIndex,
          correctClicks: prev.correctClicks + 1,
          showCompletion: isComplete ? true : prev.showCompletion,
          isRunning: isComplete ? false : prev.isRunning || shouldStart
        }));

        if (isComplete) {
          onComplete?.();
        }
      } else {
        setState((prev) => ({
          ...prev,
          wrongClicks: prev.wrongClicks + 1,
          isRunning: prev.isRunning || shouldStart
        }));
      }
    },
    [onComplete]
  );

  // Initialize PixiJS
  useEffect(() => {
    if (!upperContainerRef.current || !lowerContainerRef.current || !puzzleData) return;

    let cancelled = false;

    // Avoid synchronous setState here to prevent "set state in effect" warning
    // If we need to reset loading state for new data, it's better done via a separate effect or key change logic
    // But since we are initializing async, we can just start the async work.

    const initPuzzle = async () => {
      try {
        // Calculate responsive canvas dimensions
        const containerWidth = upperContainerRef.current?.clientWidth || window.innerWidth;
        const maxWidth = Math.min(containerWidth - 32, 600); // Max 600px with 16px padding each side

        const width = canvas?.width || imageDimensions?.width || maxWidth;
        const height = canvas?.height || imageDimensions?.height || Math.floor(width * 1.47); // ~3:2 aspect ratio

        // Upper board (gameplay)
        const upperApp = new PIXI.Application();
        await upperApp.init({
          width,
          height,
          backgroundColor: 0x1a1a1a,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true
        });

        if (cancelled) {
          upperApp.destroy(true);
          return;
        }

        upperContainerRef.current!.innerHTML = '';
        upperContainerRef.current!.appendChild(upperApp.canvas);
        upperAppRef.current = upperApp;

        // Load door image and get its dimensions
        const imageUrl = doorImageUrl || originalImageUrl;
        let imageWidth = width;
        let imageHeight = height;

        if (imageUrl) {
          try {
            const doorTexture = await PIXI.Assets.load(imageUrl);
            const doorSprite = new PIXI.Sprite(doorTexture);

            // Store actual image dimensions for coordinate transformation
            imageWidth = doorTexture.width;
            imageHeight = doorTexture.height;

            // Scale to fit
            const scale = Math.min(width / doorTexture.width, height / doorTexture.height);
            doorSprite.scale.set(scale);
            doorSprite.x = (width - doorTexture.width * scale) / 2;
            doorSprite.y = (height - doorTexture.height * scale) / 2;

            upperApp.stage.addChild(doorSprite);
          } catch (e) {
            console.warn('Could not load door image:', e);
          }
        }

        const isImageDimensionLike = (dims?: { width: number; height: number }) => {
          if (!dims) return false;
          const wDelta = Math.abs(dims.width - imageWidth) / Math.max(1, imageWidth);
          const hDelta = Math.abs(dims.height - imageHeight) / Math.max(1, imageHeight);
          return wDelta < 0.05 && hDelta < 0.05;
        };

        const sourceCanvasWidth =
          canvas?.width || (!isImageDimensionLike(imageDimensions) ? imageDimensions?.width : undefined) || width;
        const sourceCanvasHeight =
          canvas?.height || (!isImageDimensionLike(imageDimensions) ? imageDimensions?.height : undefined) || height;

        // Store dimensions for use in callbacks
        imageDimensionsRef.current = {
          width: imageWidth,
          height: imageHeight,
          canvasWidth: width,
          canvasHeight: height,
          sourceCanvasWidth,
          sourceCanvasHeight
        };

        // Create line graphics layer
        const lineGraphics = new PIXI.Graphics();
        upperApp.stage.addChild(lineGraphics);
        lineGraphicsRef.current = lineGraphics;

        // Create invisible studs for interaction
        const studContainer = new PIXI.Container();
        upperApp.stage.addChild(studContainer);

        const activeStuds = new Set(selectedPattern?.points || []);
        studGraphicsRef.current = [];
        studs.forEach((stud: Stud, index: number) => {
          const displayStud = getDisplayCoords(
            stud,
            imageWidth,
            imageHeight,
            width,
            height,
            sourceCanvasWidth,
            sourceCanvasHeight
          );
          const studGraphic = new PIXI.Graphics();
          studGraphic.circle(0, 0, 14);
          studGraphic.fill({ color: 0xffffff, alpha: 0.001 });
          studGraphic.x = displayStud.x;
          studGraphic.y = displayStud.y;
          studGraphic.eventMode = activeStuds.has(index) ? 'static' : 'none';
          studGraphic.hitArea = new PIXI.Circle(0, 0, 14);

          studGraphic.on('pointerdown', () => {
            handleStudClick(index);
          });

          studContainer.addChild(studGraphic);
          studGraphicsRef.current.push(studGraphic);
        });

        // Lower board (reference)
        const lowerApp = new PIXI.Application();
        await lowerApp.init({
          width,
          height,
          backgroundColor: 0x1f1a13,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true
        });

        if (cancelled) {
          lowerApp.destroy(true);
          return;
        }

        lowerContainerRef.current!.innerHTML = '';
        lowerContainerRef.current!.appendChild(lowerApp.canvas);
        lowerAppRef.current = lowerApp;

        const referenceGraphics = new PIXI.Graphics();
        lowerApp.stage.addChild(referenceGraphics);
        referenceGraphicsRef.current = referenceGraphics;

        renderReferenceBoard(
          referenceGraphics,
          doorContour,
          selectedPattern,
          studs,
          imageWidth,
          imageHeight,
          width,
          height,
          sourceCanvasWidth,
          sourceCanvasHeight
        );

        setState((prev) => ({
          ...prev,
          isLoading: false,
          totalStuds: selectedPattern?.points?.length || 0
        }));
      } catch (error) {
        console.error('Failed to initialize puzzle:', error);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: 'Errore nel caricamento del puzzle'
        }));
      }
    };

    initPuzzle();

    return () => {
      cancelled = true;
      if (upperAppRef.current) {
        const view = upperAppRef.current.canvas;
        upperAppRef.current.destroy(true);
        upperAppRef.current = null;
        view?.remove();
      }
      if (lowerAppRef.current) {
        const view = lowerAppRef.current.canvas;
        lowerAppRef.current.destroy(true);
        lowerAppRef.current = null;
        view?.remove();
      }
      studGraphicsRef.current = [];
      lineGraphicsRef.current = null;
      referenceGraphicsRef.current = null;
    };
  }, [
    puzzleData,
    handleStudClick,
    selectedPattern,
    studs,
    doorContour,
    doorImageUrl,
    imageDimensions,
    originalImageUrl,
    canvas
  ]);

  useEffect(() => {
    const activeStuds = new Set(selectedPattern?.points || []);
    studGraphicsRef.current.forEach((graphic, index) => {
      graphic.eventMode = activeStuds.has(index) ? 'static' : 'none';
    });
  }, [selectedPattern]);

  // Update reference board when pattern changes
  useEffect(() => {
    if (!referenceGraphicsRef.current || !imageDimensionsRef.current) return;
    const dims = imageDimensionsRef.current;
    renderReferenceBoard(
      referenceGraphicsRef.current,
      doorContour,
      selectedPattern,
      studs,
      dims.width,
      dims.height,
      dims.canvasWidth,
      dims.canvasHeight,
      dims.sourceCanvasWidth,
      dims.sourceCanvasHeight
    );
  }, [doorContour, selectedPattern, studs]);

  // Render
  return (
    <div className="witchs-knot-container" style={styles.container}>
      {/* Loading State */}
      {state.isLoading && (
        <div style={styles.overlay}>
          <div style={styles.loadingContent}>
            <p style={styles.loadingText}>Caricamento del portone maledetto...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {state.error && (
        <div style={styles.overlay}>
          <div style={styles.errorContent}>
            <span style={styles.errorIcon}>!</span>
            <p style={styles.errorText}>{state.error}</p>
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={styles.hud}>
        <div style={styles.selectorGroup}>
          <span style={styles.selectorLabel}>Filo</span>
          <select
            style={styles.selector}
            value={selectedPatternIndex}
            onChange={(e) => {
              const newIndex = Number(e.target.value);
              setSelectedPatternIndex(newIndex);
              resetProgress(patterns[newIndex] || null);
            }}
            disabled={patterns.length === 0}
          >
            {patterns.length === 0 && <option value={0}>Nessun filo</option>}
            {patterns.map((pattern: Pattern, index: number) => (
              <option key={`${pattern.name || 'filo'}-${index}`} value={index}>
                {pattern.name || `Filo ${index + 1}`}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.statsGroup}>
          <div style={styles.statChip}>
            <span style={styles.statLabel}>Corrette</span>
            <span style={styles.statValue}>
              {state.correctClicks} / {state.totalStuds}
            </span>
          </div>
          <div style={styles.statChip}>
            <span style={styles.statLabel}>Sbagliate</span>
            <span style={styles.statValue}>{state.wrongClicks}</span>
          </div>
          <div style={styles.statChip}>
            <span style={styles.statLabel}>Tempo</span>
            <span style={styles.statValue}>{formatTime(state.timeElapsed)}</span>
          </div>
        </div>
      </div>

      {/* Boards */}
      <div style={styles.boards}>
        <div style={styles.board}>
          <div style={styles.boardTitle}>Tavola di gioco</div>
          <div ref={upperContainerRef} style={styles.canvasContainer} />
        </div>

        <div style={styles.board}>
          <div style={styles.boardTitle}>Contorno del nodo</div>
          <div ref={lowerContainerRef} style={styles.canvasContainer} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    fontFamily: '"Crimson Text", Georgia, serif',
    width: '100%',
    height: '100dvh',
    gap: '16px',
    overflowX: 'hidden',
    overflowY: 'hidden'  // Remove scroll from container
  },

  hud: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    paddingTop: '8px'
  },

  selectorGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: '#2a2318',
    borderRadius: '10px',
    border: '1px solid #4a3c28'
  },

  selectorLabel: {
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#d4c5a9'
  },

  selector: {
    backgroundColor: '#1a1510',
    color: '#e8dcc8',
    border: '1px solid #5a4a38',
    borderRadius: '6px',
    padding: '6px 10px',
    fontFamily: 'inherit',
    fontSize: '13px'
  },

  statsGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap'
  },

  statChip: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    padding: '6px 10px',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '999px',
    color: '#e8dcc8'
  },

  statLabel: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    opacity: 0.75
  },

  statValue: {
    fontSize: '13px',
    fontWeight: 700
  },

  boards: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '18px',
    width: '100%',
    minHeight: 0,
    overflowY: 'auto',  // Scrollable boards container
    overflowX: 'hidden',
    paddingBottom: '16px',
    paddingTop: '8px'
  },

  board: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px'
  },

  boardTitle: {
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: '#b0a090'
  },

  canvasContainer: {
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(255, 255, 255, 0.08)'
  },

  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    borderRadius: '8px'
  },

  loadingContent: {
    textAlign: 'center',
    color: '#d4c5a9'
  },

  loadingText: {
    fontSize: '16px',
    fontStyle: 'italic'
  },

  errorContent: {
    textAlign: 'center',
    color: '#ff6b6b',
    padding: '20px'
  },

  errorIcon: {
    fontSize: '48px',
    display: 'block',
    marginBottom: '16px'
  },

  errorText: {
    fontSize: '16px'
  }
};
