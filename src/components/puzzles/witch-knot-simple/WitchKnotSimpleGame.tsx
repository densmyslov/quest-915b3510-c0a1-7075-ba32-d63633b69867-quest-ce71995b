'use client';

/**
 * Simplified Witch Knot Game Component
 * - No contour/door logic
 * - Just studs and patterns on an image
 * - Optimized for mobile phone screens
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as PIXI from 'pixi.js';
import { distributeObjectPuzzles } from '@/utils/puzzleDistribution';

// ============================================================================
// TYPES
// ============================================================================

interface WitchKnotSimpleGameProps {
  puzzleData: any;
  onComplete?: () => void;
  // Distribution context for pattern assignment
  sessionId?: string;
  teamCode?: string;
  startedAt?: string;
  puzzleId?: string;
  teamMemberIds?: string[]; // Session IDs of all team members for distribution
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

const imageRelativeToCanvas = (
  relativeX: number,
  relativeY: number,
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number
): Point => {
  const { scale, offsetX, offsetY } = getImageTransform(imageWidth, imageHeight, canvasWidth, canvasHeight);
  const imageX = relativeX * imageWidth;
  const imageY = relativeY * imageHeight;

  return {
    x: imageX * scale + offsetX,
    y: imageY * scale + offsetY
  };
};

const getDisplayCoords = (
  point: Point,
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number
): Point => {
  if (point.rx !== undefined && point.ry !== undefined) {
    return imageRelativeToCanvas(point.rx, point.ry, imageWidth, imageHeight, canvasWidth, canvasHeight);
  }
  return { x: point.x, y: point.y };
};

const formatTime = (timeSeconds: number) => {
  const minutes = Math.floor(timeSeconds / 60);
  const seconds = timeSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};



const renderReferenceBoard = (
  graphics: PIXI.Graphics,
  pattern: Pattern | null,
  studsList: Stud[],
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  fixedScale?: number
) => {
  graphics.clear();

  if (!pattern || !pattern.points || pattern.points.length < 2 || studsList.length === 0) {
    return;
  }

  // Calculate bounding box of the pattern to zoom in on it
  const patternStuds = pattern.points.map(idx => studsList[idx]).filter(s => s);
  if (patternStuds.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  patternStuds.forEach(stud => {
    const x = stud.rx !== undefined ? stud.rx : stud.x / imageWidth;
    const y = stud.ry !== undefined ? stud.ry : stud.y / imageHeight;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });

  // Add padding around the pattern
  const padding = 0.1;
  const patternWidth = maxX - minX;
  const patternHeight = maxY - minY;
  minX -= patternWidth * padding;
  minY -= patternHeight * padding;
  maxX += patternWidth * padding;
  maxY += patternHeight * padding;

  // Create a virtual "zoomed" image dimensions
  const zoomWidth = maxX - minX;
  const zoomHeight = maxY - minY;

  // Render the knot with adjusted coordinates to center it in the reference tray
  const color = parseInt((pattern.color || '#cc3333').replace('#', '0x'), 16);

  const displayPoints = pattern.points
    .filter(idx => studsList[idx] !== undefined)
    .map(idx => {
      const stud = studsList[idx];
      const rx = stud.rx !== undefined ? stud.rx : stud.x / imageWidth;
      const ry = stud.ry !== undefined ? stud.ry : stud.y / imageHeight;

      // Transform to zoomed coordinates
      const normalizedX = (rx - minX) / zoomWidth;
      const normalizedY = (ry - minY) / zoomHeight;

      // Scale to canvas
      let scale: number;
      if (fixedScale !== undefined) {
        scale = fixedScale;
      } else {
        scale = Math.min(canvasWidth / (zoomWidth * imageWidth), canvasHeight / (zoomHeight * imageHeight));
      }

      const scaledWidth = zoomWidth * imageWidth * scale;
      const scaledHeight = zoomHeight * imageHeight * scale;
      const offsetX = (canvasWidth - scaledWidth) / 2;
      const offsetY = (canvasHeight - scaledHeight) / 2;

      return {
        x: normalizedX * scaledWidth + offsetX,
        y: normalizedY * scaledHeight + offsetY
      };
    })
    .filter(p => p !== null);

  if (displayPoints.length < 2) return;

  const drawSmoothCurve = (points: Point[], offsetX: number, offsetY: number, strokeStyle: any) => {
    if (points.length < 2) return;

    graphics.moveTo(points[0].x + offsetX, points[0].y + offsetY);

    if (points.length === 2) {
      graphics.lineTo(points[1].x + offsetX, points[1].y + offsetY);
    } else {
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i + 1];

        if (i === points.length - 2) {
          graphics.lineTo(p1.x + offsetX, p1.y + offsetY);
        } else {
          const p2 = points[i + 2];
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;

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

  // Draw shadow
  drawSmoothCurve(displayPoints, 2, 2, { width: 8, color: 0x000000, alpha: 0.3 });
  // Draw main rope
  drawSmoothCurve(displayPoints, 0, 0, { width: 6, color });
  // Draw highlight
  drawSmoothCurve(displayPoints, -1, -1, { width: 2, color: 0xffffff, alpha: 0.3 });

  // Draw knots at stud points
  displayPoints.forEach((point) => {
    // Draw filled circle
    graphics.circle(point.x, point.y, 4);
    graphics.fill({ color });

    // Draw circle outline
    graphics.circle(point.x, point.y, 4);
    graphics.stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
  });
};

// ============================================================================
// COMPONENT
// ============================================================================

export default function WitchKnotSimpleGame({
  puzzleData,
  onComplete,
  sessionId,
  teamCode,
  startedAt,
  puzzleId,
  teamMemberIds
}: WitchKnotSimpleGameProps) {
  const upperContainerRef = useRef<HTMLDivElement>(null);
  const lowerContainerRef = useRef<HTMLDivElement>(null);
  const upperAppRef = useRef<PIXI.Application | null>(null);
  const lowerAppRef = useRef<PIXI.Application | null>(null);
  const lineGraphicsRef = useRef<PIXI.Graphics | null>(null);
  const referenceGraphicsRef = useRef<PIXI.Graphics | null>(null);
  const studGraphicsRef = useRef<PIXI.Graphics[]>([]);
  const imageDimensionsRef = useRef<{ width: number; height: number; canvasWidth: number; canvasHeight: number } | null>(null);
  const mainStageContainerRef = useRef<PIXI.Container | null>(null);
  const initialPinchDistRef = useRef<number | null>(null);
  const currentScaleRef = useRef<number>(1);
  const lastTouchPosRef = useRef<{ x: number, y: number } | null>(null);
  const panPosRef = useRef<{ x: number, y: number }>({ x: 0, y: 0 });
  const baseScaleRef = useRef<number>(1);
  const clickSoundRef = useRef<HTMLAudioElement | null>(null);
  const wrongSoundRef = useRef<HTMLAudioElement | null>(null);

  const [pixiReady, setPixiReady] = useState(false);

  const [state, setState] = useState<PuzzleState>({
    isLoading: false,
    error: null,
    showCompletion: false,
    currentStudIndex: 1,
    totalStuds: 0,
    correctClicks: 0,
    wrongClicks: 0,
    timeElapsed: 0,
    isRunning: false
  });

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const {
    studs: rawStuds = [],
    patterns: rawPatterns = [],
    originalImageUrl,
    doorImageDataUrl,
    doorImageUrl,
    canvas
  } = puzzleData || {};

  // Memoize studs and patterns to prevent unnecessary re-renders
  const rawStudsStr = JSON.stringify(rawStuds);
  const studs = useMemo(() => rawStuds, [rawStudsStr]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pattern distribution: Each player gets ONE pattern instead of all patterns
  const rawPatternsStr = JSON.stringify(rawPatterns);
  const patterns = useMemo(() => {
    // If no distribution context, show all patterns (backward compatibility)
    if (!sessionId || !puzzleId || rawPatterns.length === 0) {
      return rawPatterns;
    }

    // Use distribution algorithm to select ONE pattern for this player
    const isTeamMode = !!teamCode && !!startedAt;
    const seed = isTeamMode
      ? `${teamCode}:${startedAt}:${puzzleId}`
      : `solo:${sessionId}:${puzzleId}`;

    const nowMs = isTeamMode && startedAt ? Date.parse(startedAt) : Date.now();

    // Treat patterns as "puzzles" for distribution purposes
    const patternPuzzles = rawPatterns.map((_: any, idx: number) => ({
      puzzle_id: `pattern_${idx}`
    }));

    // Use all team members for distribution to ensure unique assignments
    // when patterns >= players
    const playerIds = teamMemberIds && teamMemberIds.length > 0
      ? teamMemberIds
      : [sessionId];

    const result = distributeObjectPuzzles(
      { puzzles: patternPuzzles },
      playerIds,
      { seed, nowMs: Number.isFinite(nowMs) ? nowMs : Date.now() }
    );

    // Find which pattern was assigned to this player
    const assignment = result.assignments.find(a => a.user_id === sessionId);
    if (!assignment) return rawPatterns; // Fallback to all patterns

    const assignedPatternId = assignment.puzzle_id;
    const patternIndex = parseInt(assignedPatternId.replace('pattern_', ''), 10);

    if (isNaN(patternIndex) || patternIndex < 0 || patternIndex >= rawPatterns.length) {
      return rawPatterns; // Fallback to all patterns
    }

    // Return only the assigned pattern
    return [rawPatterns[patternIndex]];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPatternsStr, sessionId, teamCode, startedAt, puzzleId, teamMemberIds]);

  const imageUrl = originalImageUrl || doorImageUrl || doorImageDataUrl;

  const [selectedPatternIndex, setSelectedPatternIndex] = useState(0);

  useEffect(() => {
    setSelectedPatternIndex((prev) => {
      if (patterns.length === 0) return 0;
      return Math.min(prev, patterns.length - 1);
    });
  }, [patterns.length]);

  // Memoize selectedPattern to prevent unnecessary resets when pattern object reference changes
  const selectedPattern: Pattern | null = useMemo(() => {
    return patterns[selectedPatternIndex] || patterns[0] || null;
  }, [patterns, selectedPatternIndex]);

  const selectedPatternRef = useRef(selectedPattern);

  useEffect(() => {
    selectedPatternRef.current = selectedPattern;
  }, [selectedPattern]);

  const studsRef = useRef(studs);
  useEffect(() => {
    studsRef.current = studs;
  }, [studs]);

  const resetProgress = useCallback((pattern: Pattern | null) => {
    lineGraphicsRef.current?.clear();

    // Hide all studs except the first one in the pattern
    // Use alpha instead of visible so clicks still work on hidden studs
    if (pattern && pattern.points && studGraphicsRef.current.length > 0) {
      studGraphicsRef.current.forEach((studG, idx) => {
        const isFirstStud = pattern.points[0] === idx;
        studG.scale.set(1);
        studG.alpha = isFirstStud ? 1 : 0;
      });
    }

    setState(prev => ({
      ...prev,
      currentStudIndex: 1,
      totalStuds: pattern?.points?.length || 0,
      correctClicks: 0,
      wrongClicks: 0,
      timeElapsed: 0,
      isRunning: false,
      showCompletion: false
    }));
  }, []);

  // Only reset when the pattern INDEX changes, not when pattern object reference changes
  // Also wait for PIXI to be initialized before resetting
  useEffect(() => {
    if (studGraphicsRef.current.length === 0) {
      return;
    }
    resetProgress(selectedPattern);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetProgress, selectedPatternIndex]);

  // Timer
  useEffect(() => {
    if (!state.isRunning || state.showCompletion) return;
    const timer = setInterval(() => {
      setState(prev => ({ ...prev, timeElapsed: prev.timeElapsed + 1 }));
    }, 1000);
    return () => clearInterval(timer);
  }, [state.isRunning, state.showCompletion]);

  // Handle stud click
  const handleStudClick = useCallback((studIndex: number, e?: any) => {
    if (e) {
      e.stopPropagation();
    }
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
      // Play success sound
      if (clickSoundRef.current) {
        clickSoundRef.current.currentTime = 0;
        clickSoundRef.current.play().catch(err => console.log('Audio play failed:', err));
      }

      const newIndex = currentState.currentStudIndex + 1;

      // Draw line from previous stud to this one
      if (lineGraphicsRef.current && newIndex > 1 && dims) {
        const prevStudIdx = pattern.points[newIndex - 2];
        const currStudIdx = studIndex;

        if (!studsList[prevStudIdx] || !studsList[currStudIdx]) return;

        const prevStud = getDisplayCoords(studsList[prevStudIdx], dims.width, dims.height, dims.canvasWidth, dims.canvasHeight);
        const currStud = getDisplayCoords(studsList[currStudIdx], dims.width, dims.height, dims.canvasWidth, dims.canvasHeight);

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
      setState(prev => ({
        ...prev,
        currentStudIndex: newIndex,
        correctClicks: prev.correctClicks + 1,
        showCompletion: isComplete ? true : prev.showCompletion,
        isRunning: isComplete ? false : prev.isRunning || shouldStart
      }));

      // Reveal the clicked stud (if it was hidden)
      if (studGraphicsRef.current[studIndex]) {
        studGraphicsRef.current[studIndex].alpha = 1;
      }

      // DO NOT reveal the next stud automatically
      // The user must click the next hidden dot to reveal it

      if (isComplete) {
        onComplete?.();
      }
    } else {
      // Play wrong sound
      if (wrongSoundRef.current) {
        wrongSoundRef.current.currentTime = 0;
        wrongSoundRef.current.play().catch(err => console.log('Audio play failed:', err));
      }

      setState(prev => ({
        ...prev,
        wrongClicks: prev.wrongClicks + 1,
        isRunning: prev.isRunning || shouldStart
      }));
    }
  }, [onComplete]);

  const handleBackgroundClick = useCallback(() => {
    const currentState = stateRef.current;
    if (currentState.showCompletion) return;

    // Play wrong sound
    if (wrongSoundRef.current) {
      wrongSoundRef.current.currentTime = 0;
      wrongSoundRef.current.play().catch(err => console.log('Audio play failed:', err));
    }

    setState(prev => ({
      ...prev,
      wrongClicks: prev.wrongClicks + 1,
      isRunning: prev.isRunning || !prev.isRunning // Start timer on first interaction
    }));
  }, []);

  // Initialize PixiJS
  useEffect(() => {
    if (!upperContainerRef.current || !lowerContainerRef.current || !puzzleData || !imageUrl) return;

    let cancelled = false;
    setPixiReady(false);
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    const initPuzzle = async () => {
      try {
        const width = canvas?.width || 400;
        const height = canvas?.height || 600;

        // Main gameplay board
        const upperApp = new PIXI.Application();
        await upperApp.init({
          width,
          height,
          backgroundColor: 0x1a1a1a,
          antialias: true
        });

        if (cancelled) {
          if (upperApp.renderer) {
            upperApp.destroy(true);
          }
          return;
        }

        upperContainerRef.current!.innerHTML = '';
        upperContainerRef.current!.appendChild(upperApp.canvas);
        upperAppRef.current = upperApp;

        // Ensure the stage is interactive
        upperApp.stage.eventMode = 'static';
        upperApp.stage.hitArea = upperApp.screen;
        upperApp.stage.on('pointerdown', () => handleBackgroundClick());

        // Load image with CORS enabled and retry logic
        let texture;
        try {
          // First attempt with CORS
          texture = await PIXI.Assets.load({
            src: imageUrl,
            parser: 'loadTextures',
            data: {
              crossOrigin: 'anonymous'
            }
          });
        } catch (corsError) {
          console.warn('CORS load failed, trying without CORS attribute:', corsError);
          // Fallback: try loading without explicit CORS (for same-origin or permissive servers)
          try {
            texture = await PIXI.Assets.load(imageUrl);
          } catch (fallbackError) {
            console.error('Both CORS and non-CORS loading failed:', fallbackError);
            throw new Error(`Failed to load image: ${corsError instanceof Error ? corsError.message : 'CORS error'}`);
          }
        }

        if (cancelled || !upperApp.stage) {
          if (upperApp.renderer) {
            upperApp.destroy(true);
          }
          return;
        }

        // Create a main container for scaling
        const mainContainer = new PIXI.Container();
        upperApp.stage.addChild(mainContainer);
        mainStageContainerRef.current = mainContainer;

        const sprite = new PIXI.Sprite(texture);
        const scale = Math.min(width / texture.width, height / texture.height);
        baseScaleRef.current = scale;
        sprite.scale.set(scale);
        sprite.x = (width - texture.width * scale) / 2;
        sprite.y = (height - texture.height * scale) / 2;

        // Make background interactive to catch wrong clicks
        // Listener is now on stage to catch clicks outside the image too
        sprite.eventMode = 'static';

        mainContainer.addChild(sprite);

        imageDimensionsRef.current = {
          width: texture.width,
          height: texture.height,
          canvasWidth: width,
          canvasHeight: height
        };

        // Line graphics for user progress
        const lineGraphics = new PIXI.Graphics();
        mainContainer.addChild(lineGraphics);
        lineGraphicsRef.current = lineGraphics;

        // Stud graphics - only show first stud initially, rest are hidden
        const studGraphics: PIXI.Graphics[] = [];
        studs.forEach((stud: Stud, idx: number) => {
          const studPos = getDisplayCoords(stud, texture.width, texture.height, width, height);
          const studG = new PIXI.Graphics();
          studG.circle(0, 0, 6);
          studG.fill({ color: 0xff6600, alpha: 0.8 });
          studG.stroke({ width: 1, color: 0xffffff });
          studG.x = studPos.x;
          studG.y = studPos.y;
          studG.eventMode = 'static';
          studG.cursor = 'pointer';
          studG.on('pointerdown', (e) => handleStudClick(idx, e));

          // Only show the first stud in the pattern initially
          // Use alpha instead of visible so clicks still work on hidden studs
          const currentPattern = selectedPatternRef.current;
          const isFirstStud = !!(currentPattern && currentPattern.points && currentPattern.points[0] === idx);
          studG.alpha = isFirstStud ? 1 : 0;

          mainContainer.addChild(studG);
          studGraphics.push(studG);
        });
        studGraphicsRef.current = studGraphics;
        setPixiReady(true);

        // Reference tray (small preview) - knot only, no background image
        const refWidth = 400;
        const refHeight = 150;
        const lowerApp = new PIXI.Application();
        await lowerApp.init({
          width: refWidth,
          height: refHeight,
          backgroundColor: 0x2a2318,
          antialias: true
        });

        if (cancelled) {
          if (upperApp.renderer) {
            upperApp.destroy(true);
          }
          if (lowerApp.renderer) {
            lowerApp.destroy(true);
          }
          return;
        }

        lowerContainerRef.current!.innerHTML = '';
        lowerContainerRef.current!.appendChild(lowerApp.canvas);
        lowerAppRef.current = lowerApp;

        // Reference graphics - draw knot pattern only
        const refGraphics = new PIXI.Graphics();
        lowerApp.stage.addChild(refGraphics);
        referenceGraphicsRef.current = refGraphics;

        // Render just the knot pattern scaled to fit the reference tray
        renderReferenceBoard(
          refGraphics,
          selectedPatternRef.current,
          studs,
          texture.width,
          texture.height,
          refWidth,
          refHeight,
          scale
        );

        // Initialize totalStuds based on the current pattern
        const initPattern = selectedPatternRef.current;
        setState(prev => ({
          ...prev,
          isLoading: false,
          totalStuds: initPattern?.points?.length || 0
        }));
      } catch (err: any) {
        console.error('Puzzle initialization error:', err);
        if (!cancelled) {
          setState(prev => ({ ...prev, error: err.message || 'Failed to load puzzle', isLoading: false }));
        }
      }
    };

    initPuzzle();

    return () => {
      cancelled = true;
      setPixiReady(false);
      if (upperAppRef.current) {
        upperAppRef.current.destroy(true);
        upperAppRef.current = null;
      }
      if (lowerAppRef.current) {
        lowerAppRef.current.destroy(true);
        lowerAppRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzleData, imageUrl, studs]);

  // Update reference board when pattern changes
  useEffect(() => {
    if (!referenceGraphicsRef.current || !imageDimensionsRef.current) return;

    renderReferenceBoard(
      referenceGraphicsRef.current,
      selectedPattern,
      studs,
      imageDimensionsRef.current.width,
      imageDimensionsRef.current.height,
      400,
      150,
      baseScaleRef.current * currentScaleRef.current
    );
  }, [selectedPattern, studs]);

  // Blinking effect for the second stud (index 1 in pattern points)
  // This helps guide the user to the starting move
  const blinkingTickerRef = useRef<((ticker: PIXI.Ticker) => void) | null>(null);
  const blinkingStudIdxRef = useRef<number | null>(null);

  useEffect(() => {
    const app = upperAppRef.current;
    const pattern = selectedPatternRef.current;

    // Cleanup function
    const stopBlinking = () => {
      if (blinkingTickerRef.current && app) {
        app.ticker.remove(blinkingTickerRef.current);
        blinkingTickerRef.current = null;
      }

      // If we were blinking a stud, force it to be fully visible when stopping
      // unless we are resetting (logic handled by resetProgress)
      // Actually, simplest is to just ensure if it was the target, it becomes visible or handled by next state
      if (blinkingStudIdxRef.current !== null && studGraphicsRef.current[blinkingStudIdxRef.current]) {
        const studG = studGraphicsRef.current[blinkingStudIdxRef.current];
        studG.alpha = 1;
        studG.scale.set(1);
        blinkingStudIdxRef.current = null;
      }
    };

    if (!pixiReady) return;
    if (!app || !pattern || !pattern.points) return;

    // Only blink if we are looking for the second point (index 1)
    if (state.currentStudIndex === 1 && pattern.points.length > 1) {
      stopBlinking(); // Ensure clear before starting

      const studToBlinkIdx = pattern.points[1];
      const studG = studGraphicsRef.current[studToBlinkIdx];

      if (studG) {
        blinkingStudIdxRef.current = studToBlinkIdx;
        let time = 0;

        const blink = (ticker: PIXI.Ticker) => {
          if (!studG || studG.destroyed) return;
          time += 0.1 * ticker.deltaTime;
          // Make it obvious: alpha pulses and the dot slightly grows.
          const t = (Math.sin(time) + 1) / 2;
          studG.alpha = 0.15 + t * 0.85; // 0.15 → 1.0
          const s = 1 + t * 0.22; // 1.0 → 1.22
          studG.scale.set(s);
        };

        blinkingTickerRef.current = blink;
        app.ticker.add(blink);
      }
    } else {
      stopBlinking();
    }

    return () => stopBlinking();
  }, [pixiReady, state.currentStudIndex, selectedPattern]);

  // Expose state for testing
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__witchKnotSimpleState = {
        state,
        studGraphics: studGraphicsRef.current,
        mainStageContainer: mainStageContainerRef.current,
        imageDimensions: imageDimensionsRef.current
      };
    }
  }, [state]);

  if (!puzzleData) {
    return (
      <div style={styles.loading}>
        <p>In attesa dei dati del puzzle...</p>
      </div>
    );
  }

  if (state.error) {
    return <div style={styles.error}>Errore: {state.error}</div>;
  }

  if (!imageUrl) {
    return (
      <div style={styles.error}>
        <p>Errore: Nessuna immagine disponibile</p>
      </div>
    );
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      lastTouchPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialPinchDistRef.current = dist;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const mainContainer = mainStageContainerRef.current;
    if (!mainContainer || !imageDimensionsRef.current) return;

    if (e.touches.length === 1 && lastTouchPosRef.current) {
      // Pan
      const dx = e.touches[0].clientX - lastTouchPosRef.current.x;
      const dy = e.touches[0].clientY - lastTouchPosRef.current.y;

      lastTouchPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };

      const newPanX = panPosRef.current.x + dx;
      let newPanY = panPosRef.current.y + dy;

      // Constraint: scroll up to 3/4 of image height
      const currentZoom = currentScaleRef.current;
      const contentHeight = imageDimensionsRef.current.canvasHeight * currentZoom;
      const maxUpScroll = -(contentHeight * 0.75);

      if (newPanY > 0) newPanY = 0;
      if (newPanY < maxUpScroll) newPanY = maxUpScroll;

      panPosRef.current = { x: newPanX, y: newPanY };
      mainContainer.position.set(newPanX, newPanY);

    } else if (e.touches.length === 2 && initialPinchDistRef.current !== null) {
      // Zoom
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );

      const sensitivity = 0.005;
      const diff = dist - initialPinchDistRef.current;

      let targetScale = currentScaleRef.current + diff * sensitivity;
      targetScale = Math.max(1, Math.min(3, targetScale));

      currentScaleRef.current = targetScale;
      initialPinchDistRef.current = dist;

      mainContainer.scale.set(targetScale);

      // Sync reference board scale
      if (referenceGraphicsRef.current && imageDimensionsRef.current) {
        renderReferenceBoard(
          referenceGraphicsRef.current,
          selectedPatternRef.current,
          studsRef.current,
          imageDimensionsRef.current.width,
          imageDimensionsRef.current.height,
          400,
          150,
          baseScaleRef.current * targetScale
        );
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      lastTouchPosRef.current = null;
      initialPinchDistRef.current = null;
    }
  };

  return (
    <div style={styles.container}>
      {/* Loading overlay */}
      {state.isLoading && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(26, 21, 16, 0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#d4c5a9', fontSize: '18px' }}>Caricamento puzzle...</p>
          </div>
        </div>
      )}

      {/* Fixed header */}
      <div style={styles.header}>
        <h2 style={styles.title}>Nodo della Strega</h2>
        <div style={styles.stats}>
          <span style={styles.statItem}>⏱️ {formatTime(state.timeElapsed)}</span>
          <span style={styles.statItem}>✓ {state.correctClicks}</span>
          <span style={styles.statItem}>✗ {state.wrongClicks}</span>
          <span style={styles.statItem}>
            {state.currentStudIndex}/{state.totalStuds} Chiodi
          </span>
        </div>
      </div>

      {patterns.length > 1 && (
        <div style={styles.patternSelector}>
          <label style={styles.label}>Seleziona Filo:</label>
          {patterns.map((pattern: Pattern, idx: number) => (
            <button
              key={idx}
              style={idx === selectedPatternIndex ? styles.patternButtonActive : styles.patternButton}
              onClick={() => setSelectedPatternIndex(idx)}
            >
              <span style={{ color: pattern.color }}>{pattern.name || `Filo ${idx + 1}`}</span>
            </button>
          ))}
        </div>
      )}

      {/* Sticky reference tray */}
      <div style={styles.referenceTray}>
        <h3 style={styles.referenceTrayTitle}>Riferimento</h3>
        <div style={{ position: 'relative' }}>
          <div ref={lowerContainerRef} style={styles.referenceTrayCanvas} />
          <div style={styles.instructionOverlay}>
            Clicca i punti sulla porta sottostante per formare il nodo mostrato qui.
          </div>
        </div>
      </div>

      {/* Scrollable gameplay board container */}
      <div style={styles.scrollableContainer}>
        <div
          style={styles.mainBoardContainer}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          data-testid="game-board-wrapper"
        >
          <div ref={upperContainerRef} style={{ ...styles.board, touchAction: 'none' }} data-testid="game-board" />

          {/* Completion message - discreet notification above reset button */}
          {state.showCompletion && (
            <div style={styles.completionBanner}>
              <span style={styles.completionEmoji}>🎉</span>
              <div style={styles.completionInfo}>
                <strong>Completato!</strong> Tempo: {formatTime(state.timeElapsed)} |
                Clic: {state.correctClicks} ✓ {state.wrongClicks} ✗
              </div>
            </div>
          )}

          <button style={styles.resetButton} onClick={() => resetProgress(selectedPattern)}>
            Ricomincia
          </button>
        </div>
      </div>

      {/* Audio elements for sounds */}
      <audio
        ref={clickSoundRef}
        src="https://pub-877f23628132452cb9b12cf3cf618c69.r2.dev/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20251225-195816-70908bc1.mp3"
        preload="auto"
      />
      <audio
        ref={wrongSoundRef}
        src="https://pub-877f23628132452cb9b12cf3cf618c69.r2.dev/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20251219-075237-f8dda15b.mp3"
        preload="auto"
      />
    </div>
  );
}

// ============================================================================
// STYLES - Optimized for mobile phone screens
// ============================================================================

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    fontFamily: '"Crimson Text", Georgia, serif',
    backgroundColor: '#1a1510',
    height: '100vh',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden'
  },
  loading: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '18px',
    color: '#d4c5a9'
  },
  error: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '18px',
    color: '#cc3333'
  },
  header: {
    padding: '16px 12px 8px',
    backgroundColor: '#1a1510',
    zIndex: 100
  },
  title: {
    color: '#d4c5a9',
    textAlign: 'center',
    marginBottom: '8px',
    margin: 0,
    fontSize: '18px'
  },
  stats: {
    display: 'flex',
    justifyContent: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#b0a090',
    flexWrap: 'wrap'
  },
  statItem: {
    padding: '4px 8px',
    backgroundColor: '#2a2318',
    borderRadius: '4px',
    fontSize: '11px'
  },
  patternSelector: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '0 12px 8px',
    flexWrap: 'wrap',
    backgroundColor: '#1a1510',
    zIndex: 100
  },
  label: {
    color: '#d4c5a9',
    fontSize: '12px'
  },
  patternButton: {
    padding: '6px 12px',
    backgroundColor: '#2a2318',
    color: '#d4c5a9',
    border: '1px solid #4a3c28',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  patternButtonActive: {
    padding: '6px 12px',
    backgroundColor: '#8b6914',
    color: '#fff',
    border: '1px solid #8b6914',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 'bold'
  },
  referenceTray: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 12px',
    backgroundColor: '#2a2318',
    borderTop: '1px solid #4a3c28',
    borderBottom: '1px solid #4a3c28',
    position: 'sticky',
    top: 0,
    zIndex: 99
  },
  referenceTrayTitle: {
    color: '#d4c5a9',
    fontSize: '12px',
    margin: 0,
    fontWeight: 'normal'
  },
  referenceTrayCanvas: {
    border: '2px solid #5a4a38',
    borderRadius: '4px',
    overflow: 'hidden',
    maxWidth: '100%',
    width: '400px'
  },
  scrollableContainer: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden'
  },
  mainBoardContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '16px 12px',
    paddingBottom: '40vh'
  },
  board: {
    border: '2px solid #5a4a38',
    borderRadius: '8px',
    overflow: 'hidden',
    maxWidth: '100%'
  },
  resetButton: {
    padding: '8px 24px',
    backgroundColor: '#2d5a27',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold'
  },
  completionBanner: {
    backgroundColor: 'rgba(139, 105, 20, 0.25)',
    border: '1px solid rgba(139, 105, 20, 0.5)',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    maxWidth: '100%'
  },
  completionEmoji: {
    fontSize: '24px',
    flexShrink: 0
  },
  completionInfo: {
    color: '#d4c5a9',
    fontSize: '13px',
    lineHeight: '1.4'
  },
  instructionOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(26, 21, 16, 0.85)',
    color: '#d4c5a9',
    padding: '4px 8px',
    fontSize: '11px',
    textAlign: 'center',
    borderTop: '1px solid #4a3c28',
    pointerEvents: 'none'
  }
};
