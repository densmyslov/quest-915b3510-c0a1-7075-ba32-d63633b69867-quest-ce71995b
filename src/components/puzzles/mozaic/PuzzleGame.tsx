'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { PuzzleData } from '../../../types/puzzle';
import { useTheme } from '../../../context/ThemeContext';

interface PuzzleGameProps {
  puzzleData: PuzzleData;
  onComplete?: () => void;
}

const HUD_HEIGHT = 60;
const BOARD_MARGIN = 20;
const TRAY_MAX_ROWS_PER_COLUMN = 6;
const BOARD_MIN_HEIGHT = 200;
const TRAY_HEIGHT_RATIO_PORTRAIT = 0.38;
const TRAY_HEIGHT_RATIO_LANDSCAPE = 0.28;
const TRAY_MIN_HEIGHT = 160;
const TRAY_MAX_HEIGHT = 360;
const TRAY_PADDING = 16;
const TRAY_LABEL_HEIGHT = 30;
const TRAY_GAP_X = 14;
const TRAY_GAP_Y = 14;
const SNAP_DISTANCE_PX = 5;
const SNAP_ROTATION_DEG = 5;
const ROTATE_STEP_DEG = 5;
const ROTATE_STEP_DEG_FAST = 10;
const ROTATE_HANDLE_RADIUS = 10;
const ROTATE_HANDLE_PADDING = 18;
const DRAG_HANDLE_RADIUS = 14;
const DRAG_HANDLE_PADDING = 22;
const BOARD_SCALE_MARGIN = 0;
const BOARD_SCALE_HYSTERESIS = 24;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.2;

const THEMES = {
  dark: {
    bg: 0x0f172a,
    bgHex: '#0f172a',
    text: '#ffffff',
    trayHeader: 'rgba(255, 255, 255, 0.5)',
    trayBorder: 'rgba(255, 255, 255, 0.1)',
    hudBg: 'rgba(0, 0, 0, 0.8)',
    hudBorder: 'rgba(245, 158, 11, 0.4)',
    separator: 0xffffff,
    separatorAlpha: 0.1,
    ghostAlpha: 1
  },
  light: {
    bg: 0xf0f4f8,
    bgHex: '#f0f4f8',
    text: '#1e293b',
    trayHeader: 'rgba(30, 41, 59, 0.5)',
    trayBorder: 'rgba(30, 41, 59, 0.1)',
    hudBg: 'rgba(255, 255, 255, 0.9)',
    hudBorder: 'rgba(245, 158, 11, 0.6)',
    separator: 0x1e293b,
    separatorAlpha: 0.1,
    ghostAlpha: 1
  }
};

const inferTextureFormat = (
  src: string
): 'png' | 'jpg' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'svg' => {
  if (src.startsWith('data:image/')) {
    if (src.startsWith('data:image/png')) return 'png';
    if (src.startsWith('data:image/jpeg')) return 'jpeg';
    if (src.startsWith('data:image/jpg')) return 'jpg';
    if (src.startsWith('data:image/webp')) return 'webp';
    if (src.startsWith('data:image/avif')) return 'avif';
    if (src.startsWith('data:image/gif')) return 'gif';
    if (src.startsWith('data:image/svg')) return 'svg';
  }

  const match = src.match(/\.(png|jpe?g|webp|avif|gif|svg)(?:$|[/?#])/i);
  if (match?.[1]) {
    const ext = match[1].toLowerCase();
    if (ext === 'jpg') return 'jpg';
    if (ext === 'jpeg') return 'jpeg';
    if (ext === 'png') return 'png';
    if (ext === 'webp') return 'webp';
    if (ext === 'avif') return 'avif';
    if (ext === 'gif') return 'gif';
    if (ext === 'svg') return 'svg';
  }

  return 'png';
};

const loadTexture = async (src: string): Promise<PIXI.Texture> => {
  if (!src) throw new Error('Missing texture src');

  const format = inferTextureFormat(src);

  try {
    // First attempt with CORS
    const texture = await PIXI.Assets.load({
      src,
      format,
      parser: 'loadTextures',
      data: {
        crossOrigin: 'anonymous'
      }
    });
    if (texture) return texture as PIXI.Texture;
  } catch (corsError) {
    console.warn('CORS load failed, trying without CORS attribute:', corsError);
  }

  // Fallback: try loading without explicit CORS
  try {
    const texture = await PIXI.Assets.load({
      src,
      format,
      parser: 'loadTextures'
    });
    if (texture) return texture as PIXI.Texture;
  } catch (fallbackError) {
    console.error('Both CORS and non-CORS loading failed:', fallbackError);
    throw fallbackError;
  }

  throw new Error(`Failed to load texture: ${src}`);
};

export default function PuzzleGame({ puzzleData, onComplete }: PuzzleGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pixiAppRef = useRef<PIXI.Application | null>(null);
  const loadPuzzleRef = useRef<(() => Promise<void>) | null>(null);

  const [progress, setProgress] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [trayHeaderBounds, setTrayHeaderBounds] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  const ghostRef = useRef<PIXI.Sprite | null>(null);
  const piecesRef = useRef<Map<string, PIXI.Sprite>>(new Map());
  const snappedPiecesRef = useRef<Set<string>>(new Set());
  const boardScaleRef = useRef(1);
  const baseBoardScaleRef = useRef(1);
  const pieceScaleRef = useRef(1);
  const basePieceScaleRef = useRef(1);
  const zoomLevelRef = useRef(1);
  const objectUrlMap = useRef<Map<string, string>>(new Map());
  const rotationEnabledRef = useRef(false);
  const rotationHandlesRef = useRef<Map<string, PIXI.Graphics>>(new Map());
  const dragHandlesRef = useRef<Map<string, PIXI.Graphics>>(new Map());
  const layoutRef = useRef<{
    boardAreaWidth: number;
    boardAreaHeight: number;
    trayX: number;
    trayY: number;
    trayW: number;
    trayH: number;
  } | null>(null);

  const isDraggingRef = useRef(false);
  const dragTargetRef = useRef<PIXI.Sprite | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const dragPointerPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragModeRef = useRef<'piece' | 'handle'>('piece');

  const selectedPieceRef = useRef<PIXI.Sprite | null>(null);
  const isRotatingRef = useRef(false);
  const rotatingPieceRef = useRef<PIXI.Sprite | null>(null);
  const rotatingPointerIdRef = useRef<number | null>(null);
  const rotateOffsetDegRef = useRef(0);
  const checkSnapRef = useRef<((piece: PIXI.Sprite) => boolean) | null>(null);

  const isPinchZoomingRef = useRef(false);
  const pinchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPinchDistRef = useRef<number | null>(null);

  const loadSeqRef = useRef(0);
  const loadingRef = useRef(false);

  const { theme: currentTheme, toggleTheme } = useTheme();
  const isDarkMode = currentTheme === 'dark';
  const theme = isDarkMode ? THEMES.dark : THEMES.light;

  useEffect(() => {
    if (isComplete) return;
    const timer = setInterval(() => setTimeElapsed(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, [isComplete]);

  useEffect(() => {
    const checkMobile = () => {
      const isMobileDevice =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 1;
      setIsMobile(isMobileDevice);
    };
    checkMobile();
  }, []);

  const rotationEnabled = puzzleData.enableRotation ?? true;

  useEffect(() => {
    rotationEnabledRef.current = rotationEnabled;
  }, [rotationEnabled]);

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
        // Cloudflare Images URLs often end with a variant like `/public` (no file extension),
        // which makes Pixi's default parser detection fail. Force the texture parser.
        return (await PIXI.Assets.load({
          src: imageUrl,
          parser: 'loadTextures'
        })) as PIXI.Texture;
      } catch (err) {
        console.warn('Assets.load failed, falling back to fetch:', imageUrl, err);
      }

      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
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

  // Generate piece texture dynamically from shape coordinates
  const generatePieceTexture = useCallback(
    (pieceData: any, originalImage: HTMLImageElement) => {
      const { shapeData } = pieceData;
      if (!shapeData) {
        console.warn('No shapeData for piece:', pieceData.id);
        return null;
      }

      // Calculate bounding box from normalized shape points
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      if (shapeData.type === 'polygon' && shapeData.points) {
        if (!Array.isArray(shapeData.points) || shapeData.points.length === 0) {
          console.warn('Invalid or empty points array for piece:', pieceData.id);
          return null;
        }

        shapeData.points.forEach((point: { x: number; y: number }) => {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        });

        console.log(`Piece ${pieceData.id} bounds:`, {
          minX, minY, maxX, maxY,
          width: maxX - minX,
          height: maxY - minY,
          pointCount: shapeData.points.length,
          imageSize: `${originalImage.width}x${originalImage.height}`
        });
      } else {
        console.warn('Unsupported shape type for coordinate-based rendering:', shapeData.type);
        return null;
      }

      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        console.error('Invalid bounding box calculated for piece:', pieceData.id);
        return null;
      }

      const padding = 4;
      const width = maxX - minX;
      const height = maxY - minY;

      if (width <= 0 || height <= 0) {
        console.error('Invalid dimensions for piece:', pieceData.id, { width, height });
        return null;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width + padding * 2;
      canvas.height = height + padding * 2;

      const ctx = canvas.getContext('2d', { alpha: true });
      if (!ctx) {
        console.error('Failed to get 2D context for piece:', pieceData.id);
        return null;
      }

      // Clear to transparent
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw the original image portion (coordinates are already normalized to image)
      try {
        ctx.drawImage(
          originalImage,
          minX - padding, minY - padding, canvas.width, canvas.height,
          0, 0, canvas.width, canvas.height
        );
      } catch (error) {
        console.error('Failed to draw image for piece:', pieceData.id, error);
        return null;
      }

      // Create mask from shape
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = canvas.width;
      maskCanvas.height = canvas.height;
      const maskCtx = maskCanvas.getContext('2d', { alpha: true });
      if (!maskCtx) {
        console.error('Failed to get mask context for piece:', pieceData.id);
        return null;
      }

      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      maskCtx.fillStyle = '#000';

      if (shapeData.type === 'polygon' && shapeData.points) {
        maskCtx.beginPath();
        shapeData.points.forEach((point: { x: number; y: number }, i: number) => {
          // Translate points relative to the piece canvas
          const x = point.x - minX + padding;
          const y = point.y - minY + padding;
          if (i === 0) maskCtx.moveTo(x, y);
          else maskCtx.lineTo(x, y);
        });
        maskCtx.closePath();
        maskCtx.fill();
      }

      // Apply mask
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(maskCanvas, 0, 0);
      ctx.globalCompositeOperation = 'source-over';

      // Convert to PIXI texture
      try {
        const texture = PIXI.Texture.from(canvas);
        console.log(`✓ Successfully generated texture for piece ${pieceData.id}`);
        return texture;
      } catch (error) {
        console.error('Failed to create PIXI texture for piece:', pieceData.id, error);
        return null;
      }
    },
    []
  );

  const updateRotationHandlePosition = useCallback((piece: PIXI.Sprite) => {
    const handle = piece.rotationHandle;
    if (!handle || !handle.parent) return;

    const scale = Math.max(piece.scale.x, piece.scale.y);
    const size = Math.max(piece.texture.width, piece.texture.height) * scale;
    const dist = size / 2 + ROTATE_HANDLE_PADDING;
    const theta = ((piece.angle - 90) * Math.PI) / 180;

    handle.x = piece.x + Math.cos(theta) * dist;
    handle.y = piece.y + Math.sin(theta) * dist;
  }, []);

  const updateDragHandlePosition = useCallback((piece: PIXI.Sprite) => {
    const handle = piece.dragHandle;
    if (!handle || !handle.parent) return;

    const scale = Math.max(piece.scale.x, piece.scale.y);
    const size = Math.max(piece.texture.width, piece.texture.height) * scale;
    const dist = size / 2 + DRAG_HANDLE_PADDING;
    const theta = ((piece.angle + 90) * Math.PI) / 180;

    handle.x = piece.x + Math.cos(theta) * dist;
    handle.y = piece.y + Math.sin(theta) * dist;
  }, []);

  const positionPieceForDragHandle = useCallback((piece: PIXI.Sprite, pointer: { x: number; y: number }) => {
    const scale = Math.max(piece.scale.x, piece.scale.y);
    const size = Math.max(piece.texture.width, piece.texture.height) * scale;
    const dist = size / 2 + DRAG_HANDLE_PADDING;
    const theta = ((piece.angle + 90) * Math.PI) / 180;

    piece.x = pointer.x - Math.cos(theta) * dist;
    piece.y = pointer.y - Math.sin(theta) * dist;
  }, []);

  const applyZoom = useCallback(
    (zoomDelta: number) => {
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevelRef.current + zoomDelta));
      if (newZoom === zoomLevelRef.current) return;

      zoomLevelRef.current = newZoom;
      setZoomLevel(newZoom);
      pieceScaleRef.current = basePieceScaleRef.current * newZoom;

      piecesRef.current.forEach(piece => {
        if (snappedPiecesRef.current.has(piece.pieceData?.id || '')) return;

        const targetScale = piece.inBoardZone ? boardScaleRef.current : pieceScaleRef.current;
        gsap.to(piece.scale, {
          x: targetScale,
          y: targetScale,
          duration: 0.2,
          ease: 'power2.out',
          onUpdate: () => {
            updateRotationHandlePosition(piece);
            updateDragHandlePosition(piece);
          }
        });
      });
    },
    [updateRotationHandlePosition, updateDragHandlePosition]
  );

  const updateScaleForBoardHover = useCallback(
    (piece: PIXI.Sprite) => {
      const ghost = ghostRef.current;
      if (!ghost) return;

      const currentBoardScale = boardScaleRef.current;
      const boardW = ghost.texture.width * currentBoardScale;
      const boardH = ghost.texture.height * currentBoardScale;
      const boardLeft = ghost.x - boardW / 2;
      const boardTop = ghost.y - boardH / 2;
      const boardRight = boardLeft + boardW;
      const boardBottom = boardTop + boardH;

      const margin = piece.inBoardZone === true ? BOARD_SCALE_MARGIN + BOARD_SCALE_HYSTERESIS : BOARD_SCALE_MARGIN;

      const inBoard =
        piece.x >= boardLeft - margin &&
        piece.x <= boardRight + margin &&
        piece.y >= boardTop - margin &&
        piece.y <= boardBottom + margin;

      if (piece.inBoardZone === inBoard) return;
      piece.inBoardZone = inBoard;

      const targetScale = inBoard ? currentBoardScale : pieceScaleRef.current;
      gsap.killTweensOf(piece.scale);
      gsap.to(piece.scale, {
        x: targetScale,
        y: targetScale,
        duration: 0.12,
        ease: 'power2.out',
        onUpdate: () => {
          if (
            isDraggingRef.current &&
            dragTargetRef.current === piece &&
            dragModeRef.current === 'handle' &&
            dragPointerPosRef.current
          ) {
            positionPieceForDragHandle(piece, dragPointerPosRef.current);
          }
          updateRotationHandlePosition(piece);
          updateDragHandlePosition(piece);
        }
      });
    },
    [positionPieceForDragHandle, updateRotationHandlePosition, updateDragHandlePosition]
  );

  const rotateSelectedPiece = useCallback(
    (deltaDeg: number) => {
      if (!rotationEnabledRef.current) return;
      const piece = dragTargetRef.current ?? selectedPieceRef.current ?? null;
      if (!piece) return;
      if (piece.eventMode === 'none') return;

      piece.angle += deltaDeg;

      if (
        isDraggingRef.current &&
        dragTargetRef.current === piece &&
        dragModeRef.current === 'handle' &&
        dragPointerPosRef.current
      ) {
        positionPieceForDragHandle(piece, dragPointerPosRef.current);
      }

      updateRotationHandlePosition(piece);
      updateDragHandlePosition(piece);
    },
    [positionPieceForDragHandle, updateRotationHandlePosition, updateDragHandlePosition]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) {
        if (event.key === '=' || event.key === '+') {
          event.preventDefault();
          applyZoom(ZOOM_STEP);
          return;
        } else if (event.key === '-' || event.key === '_') {
          event.preventDefault();
          applyZoom(-ZOOM_STEP);
          return;
        } else if (event.key === '0') {
          event.preventDefault();
          zoomLevelRef.current = 1;
          setZoomLevel(1);
          pieceScaleRef.current = basePieceScaleRef.current;
          piecesRef.current.forEach(piece => {
            if (snappedPiecesRef.current.has(piece.pieceData?.id || '')) return;
            const targetScale = piece.inBoardZone ? boardScaleRef.current : pieceScaleRef.current;
            gsap.to(piece.scale, {
              x: targetScale,
              y: targetScale,
              duration: 0.2,
              ease: 'power2.out',
              onUpdate: () => {
                updateRotationHandlePosition(piece);
                updateDragHandlePosition(piece);
              }
            });
          });
          return;
        }
      }

      if (!rotationEnabledRef.current) return;
      if (!selectedPieceRef.current && !dragTargetRef.current) return;

      const step = event.shiftKey ? ROTATE_STEP_DEG_FAST : ROTATE_STEP_DEG;
      if (event.key === 'q' || event.key === 'Q') {
        event.preventDefault();
        rotateSelectedPiece(-step);
      } else if (event.key === 'e' || event.key === 'E') {
        event.preventDefault();
        rotateSelectedPiece(step);
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (!rotationEnabledRef.current) return;
      if (!isDraggingRef.current) return;
      if (!selectedPieceRef.current && !dragTargetRef.current) return;
      event.preventDefault();
      const delta = event.deltaY < 0 ? ROTATE_STEP_DEG : -ROTATE_STEP_DEG;
      rotateSelectedPiece(delta);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onWheel);
    };
  }, [rotateSelectedPiece, applyZoom]);

  const angleDelta = (a: number, b: number) => {
    const normalize = (v: number) => ((v % 360) + 360) % 360;
    const diff = Math.abs(normalize(a) - normalize(b));
    return Math.min(diff, 360 - diff);
  };

  const checkWin = useCallback(() => {
    const total = puzzleData.pieces.length;
    const completed = snappedPiecesRef.current.size;
    setProgress(Math.floor((completed / total) * 100));

    if (completed === total) {
      setIsComplete(true);
      onComplete?.();
    }
  }, [puzzleData, onComplete]);

  const checkSnap = useCallback(
    (piece: PIXI.Sprite) => {
      const ghost = ghostRef.current;
      if (!ghost || !piece.pieceData || !pixiAppRef.current) return false;

      const data = piece.pieceData;
      const currentBoardScale = boardScaleRef.current;

      const boardW = ghost.texture.width * currentBoardScale;
      const boardH = ghost.texture.height * currentBoardScale;

      const boardLeft = ghost.x - boardW / 2;
      const boardTop = ghost.y - boardH / 2;

      const targetX = boardLeft + data.correctX * currentBoardScale;
      const targetY = boardTop + data.correctY * currentBoardScale;

      const dist = Math.sqrt(Math.pow(piece.x - targetX, 2) + Math.pow(piece.y - targetY, 2));

      if (dist < SNAP_DISTANCE_PX) {
        if (rotationEnabledRef.current) {
          const rotationDist = angleDelta(piece.angle, data.correctRotation || 0);
          if (rotationDist > SNAP_ROTATION_DEG) return false;
        }

        gsap.to(piece, {
          x: targetX,
          y: targetY,
          angle: data.correctRotation || 0,
          duration: 0.15,
          ease: 'power2.out',
          onUpdate: () => {
            updateRotationHandlePosition(piece);
            updateDragHandlePosition(piece);
          },
          onComplete: () => {
            piece.eventMode = 'none';
            piece.cursor = 'default';
            piece.alpha = 1;

            if (piece.rotationHandle) {
              piece.rotationHandle.eventMode = 'none';
              piece.rotationHandle.visible = false;
            }
            if (piece.dragHandle) {
              piece.dragHandle.eventMode = 'none';
              piece.dragHandle.visible = false;
            }

            snappedPiecesRef.current.add(data.id);

            const app = pixiAppRef.current;
            if (app) {
              const flash = new PIXI.Graphics();
              const flashWidth = piece.texture.width * currentBoardScale;
              const flashHeight = piece.texture.height * currentBoardScale;
              flash.rect(targetX - flashWidth / 2, targetY - flashHeight / 2, flashWidth, flashHeight);
              flash.fill({ color: 0xffffff, alpha: 0.5 });
              app.stage.addChild(flash);

              gsap.to(flash, {
                alpha: 0,
                duration: 0.3,
                onComplete: () => {
                  app.stage.removeChild(flash);
                  flash.destroy();
                }
              });
            }

            checkWin();
          }
        });

        gsap.to(piece.scale, {
          x: currentBoardScale,
          y: currentBoardScale,
          duration: 0.15,
          ease: 'power2.out',
          onUpdate: () => {
            updateRotationHandlePosition(piece);
            updateDragHandlePosition(piece);
          }
        });

        return true;
      }

      return false;
    },
    [checkWin, updateRotationHandlePosition, updateDragHandlePosition]
  );

  useEffect(() => {
    checkSnapRef.current = checkSnap;
  }, [checkSnap]);

  const loadPuzzle = useCallback(async () => {
    const app = pixiAppRef.current;
    if (!app || !puzzleData) return;

    const seq = ++loadSeqRef.current;
    loadingRef.current = true;

    try {
      const canvasWidth = app.renderer.width;
      const canvasHeight = app.renderer.height;

      const usableHeight = canvasHeight - HUD_HEIGHT;
      const isPortrait = canvasHeight >= canvasWidth;
      const trayRatio = isPortrait ? TRAY_HEIGHT_RATIO_PORTRAIT : TRAY_HEIGHT_RATIO_LANDSCAPE;
      let trayH = Math.round(usableHeight * trayRatio);
      trayH = Math.min(TRAY_MAX_HEIGHT, Math.max(TRAY_MIN_HEIGHT, trayH));
      trayH = Math.min(trayH, Math.max(0, usableHeight - BOARD_MIN_HEIGHT));

      const boardAreaWidth = canvasWidth;
      const boardAreaHeight = Math.max(0, usableHeight - trayH);

      const trayX = 0;
      const trayY = boardAreaHeight;
      const trayW = canvasWidth;

      setTrayHeaderBounds(
        trayH > 0
          ? {
            left: trayX,
            top: trayY + 10,
            width: trayW
          }
          : null
      );

      layoutRef.current = {
        boardAreaWidth,
        boardAreaHeight,
        trayX,
        trayY,
        trayW,
        trayH
      };

      // ✅ Clear stage safely: DO NOT destroy textures/textureSource (shared/cached)
      const oldChildren = [...app.stage.children];
      app.stage.removeChildren();
      oldChildren.forEach(child => {
        if ((child as any)?.destroy) {
          (child as any).destroy({ children: true });
        }
      });

      objectUrlMap.current.forEach((_, key) => revokeObjectUrl(key));
      objectUrlMap.current.clear();
      rotationHandlesRef.current.clear();
      dragHandlesRef.current.clear();
      ghostRef.current = null;
      piecesRef.current.clear();
      snappedPiecesRef.current.clear();
      isDraggingRef.current = false;
      dragTargetRef.current = null;
      dragPointerIdRef.current = null;
      dragOffsetRef.current = null;
      selectedPieceRef.current = null;
      isRotatingRef.current = false;
      rotatingPieceRef.current = null;
      rotatingPointerIdRef.current = null;
      rotateOffsetDegRef.current = 0;

      if (seq !== loadSeqRef.current) return;

      const separator = new PIXI.Graphics();
      separator.rect(0, boardAreaHeight, boardAreaWidth, 2);
      separator.fill({ color: theme.separator, alpha: theme.separatorAlpha });
      separator.label = 'separator';
      app.stage.addChild(separator);

      const imageUrl = puzzleData.boardImageDataUrl || puzzleData.boardImageUrl || puzzleData.originalImageUrl;
      if (!imageUrl) return;

      const ghostTexture = await loadTexture(imageUrl);
      if (seq !== loadSeqRef.current) return;

      const ghost = new PIXI.Sprite(ghostTexture);

      const availWidth = boardAreaWidth - BOARD_MARGIN * 2;
      const availHeight = boardAreaHeight - BOARD_MARGIN * 2;

      const scale = Math.min(availWidth / ghost.texture.width, availHeight / ghost.texture.height);

      boardScaleRef.current = scale;
      baseBoardScaleRef.current = scale;

      ghost.anchor.set(0.5);
      ghost.scale.set(scale);
      ghost.x = boardAreaWidth / 2;
      ghost.y = boardAreaHeight / 2;
      ghost.alpha = theme.ghostAlpha;

      app.stage.addChild(ghost);
      ghostRef.current = ghost;

      const pieces = puzzleData.pieces;
      if (!pieces?.length) return;

      // Load original image for dynamic piece generation
      const originalImageUrl = puzzleData.originalImageUrl;
      if (!originalImageUrl) {
        console.error('No original image URL!');
        return;
      }

      let originalImageElement: HTMLImageElement | null = null;
      const hasShapeData = pieces.some(p => p.shapeData);

      if (hasShapeData) {
        // Load original image for coordinate-based rendering
        try {
          originalImageElement = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = originalImageUrl;
          });
          console.log('✓ Original image loaded for dynamic piece generation');
        } catch (error) {
          console.error('Failed to load original image:', error);
          return;
        }
      }

      // Tray layout
      const piecesCount = pieces.length;
      const trayContentX = trayX + TRAY_PADDING;
      const trayContentY = trayY + TRAY_PADDING + TRAY_LABEL_HEIGHT;
      const availTrayWidth = Math.max(0, trayW - TRAY_PADDING * 2);
      const availTrayHeight = Math.max(0, trayH - TRAY_PADDING * 2 - TRAY_LABEL_HEIGHT);

      const minColumns = Math.max(1, Math.ceil(piecesCount / TRAY_MAX_ROWS_PER_COLUMN));
      const maxColumns = Math.max(minColumns, piecesCount);

      let bestLayout: {
        columns: number;
        rowsPerColumn: number;
        gapX: number;
        gapY: number;
        cellWidth: number;
        cellHeight: number;
        pieceScale: number;
      } | null = null;

      const dragHandleFixed = DRAG_HANDLE_PADDING + DRAG_HANDLE_RADIUS + 6;
      const rotationHandleFixed = rotationEnabledRef.current ? ROTATE_HANDLE_PADDING + ROTATE_HANDLE_RADIUS + 6 : 0;
      const controlsFixed = Math.max(dragHandleFixed, rotationHandleFixed);

      for (let columns = minColumns; columns <= maxColumns; columns++) {
        const rowsPerColumn = Math.ceil(piecesCount / columns);
        if (rowsPerColumn > TRAY_MAX_ROWS_PER_COLUMN) continue;

        let gapX = TRAY_GAP_X;
        let gapY = TRAY_GAP_Y;

        if (columns > 1 && availTrayWidth - (columns - 1) * gapX <= 0) {
          gapX = Math.max(6, Math.floor(availTrayWidth / (columns * 8)));
        }
        if (rowsPerColumn > 1 && availTrayHeight - (rowsPerColumn - 1) * gapY <= 0) {
          gapY = Math.max(6, Math.floor(availTrayHeight / (rowsPerColumn * 8)));
        }

        const cellWidth = Math.max(0, (availTrayWidth - (columns - 1) * gapX) / columns);
        const cellHeight = Math.max(0, (availTrayHeight - (rowsPerColumn - 1) * gapY) / rowsPerColumn);
        if (cellWidth <= 0 || cellHeight <= 0) continue;

        const pieceScaleLimits = pieces.map(pieceData => {
          const w = pieceData.boundingRect?.width || 100;
          const h = pieceData.boundingRect?.height || 100;
          const diag = Math.sqrt(w * w + h * h);
          const maxDim = Math.max(w, h);

          const usableCellWidth = Math.max(0, cellWidth - controlsFixed * 2);
          const usableCellHeight = Math.max(0, cellHeight - controlsFixed * 2);

          const fitDiagW = diag > 0 ? usableCellWidth / diag : 1;
          const fitDiagH = diag > 0 ? usableCellHeight / diag : 1;

          const handleFixed = Math.max(ROTATE_HANDLE_PADDING + ROTATE_HANDLE_RADIUS, DRAG_HANDLE_PADDING + DRAG_HANDLE_RADIUS);
          const fitHandleW = maxDim > 0 ? (cellWidth - handleFixed * 2) / maxDim : 1;
          const fitHandleH = maxDim > 0 ? (cellHeight - handleFixed * 2) / maxDim : 1;

          return Math.min(fitDiagW, fitDiagH, fitHandleW, fitHandleH);
        });

        let pieceScale = Math.min(1, ...pieceScaleLimits) * 0.95;
        if (!Number.isFinite(pieceScale) || pieceScale <= 0) pieceScale = 0;

        if (!bestLayout || pieceScale > bestLayout.pieceScale) {
          bestLayout = { columns, rowsPerColumn, gapX, gapY, cellWidth, cellHeight, pieceScale };
        }
      }

      const columns = bestLayout?.columns ?? minColumns;
      const rowsPerColumn = bestLayout?.rowsPerColumn ?? Math.min(TRAY_MAX_ROWS_PER_COLUMN, piecesCount);
      const gapX = bestLayout?.gapX ?? TRAY_GAP_X;
      const gapY = bestLayout?.gapY ?? TRAY_GAP_Y;
      const cellWidth = bestLayout?.cellWidth ?? Math.max(0, availTrayWidth / columns);
      const cellHeight = bestLayout?.cellHeight ?? Math.max(0, rowsPerColumn > 0 ? availTrayHeight / rowsPerColumn : availTrayHeight);

      let finalPieceScale = bestLayout?.pieceScale ?? 0;
      if (!Number.isFinite(finalPieceScale) || finalPieceScale <= 0) finalPieceScale = 0.2;

      basePieceScaleRef.current = finalPieceScale;
      pieceScaleRef.current = finalPieceScale * zoomLevelRef.current;

      const gridWidth = columns * cellWidth + Math.max(0, columns - 1) * gapX;
      const startX = trayContentX + Math.max(0, (availTrayWidth - gridWidth) / 2) + cellWidth / 2;

      const columnStartYs: number[] = [];
      for (let c = 0; c < columns; c++) {
        const countInColumn = Math.min(rowsPerColumn, piecesCount - c * rowsPerColumn);
        const columnHeight = countInColumn * cellHeight + Math.max(0, countInColumn - 1) * gapY;
        const startY = trayContentY + Math.max(0, (availTrayHeight - columnHeight) / 2) + cellHeight / 2;
        columnStartYs.push(startY);
      }

      // Generate or load piece textures
      const pieceTextures: Map<string, PIXI.Texture> = new Map();
      for (const pieceData of pieces) {
        try {
          let texture: PIXI.Texture | null = null;

          // NEW: Try coordinate-based rendering first
          if (pieceData.shapeData && originalImageElement) {
            texture = generatePieceTexture(pieceData, originalImageElement);
            if (texture) {
              console.log(`✓ Generated texture for piece ${pieceData.id} from coordinates`);
            }
          }

          // FALLBACK: Use pre-extracted image if available
          if (!texture) {
            const imageUrl = pieceData.imageUrl || pieceData.imageDataUrl;
            if (imageUrl) {
              texture = await loadTextureWithFallback(pieceData.id, imageUrl);
              if (texture) {
                console.log(`✓ Loaded texture for piece ${pieceData.id} from URL`);
              }
            }
          }

          if (!texture) {
            console.error('Failed to generate or load texture for piece:', pieceData.id);
            continue;
          }

          pieceTextures.set(pieceData.id, texture);
        } catch (error) {
          console.error('Failed to process piece texture:', pieceData.id, error);
        }
      }

      // Filter to only pieces that successfully loaded textures
      const loadedPieces = pieces.filter(p => pieceTextures.has(p.id));
      if (!loadedPieces.length) {
        console.error('No piece textures loaded successfully');
        return;
      }

      console.log(`✓ Loaded ${loadedPieces.length}/${pieces.length} pieces`);
      if (hasShapeData) {
        console.log('   Using coordinate-based rendering');
      }

      // Now create sprites from loaded textures (using loadedPieces only)
      for (let i = 0; i < loadedPieces.length; i++) {
        if (seq !== loadSeqRef.current) return;

        const pieceData = loadedPieces[i];
        const texture = pieceTextures.get(pieceData.id);
        if (!texture) {
          console.error('Texture not loaded for piece:', pieceData.id);
          continue;
        }

        const col = Math.floor(i / rowsPerColumn);
        const row = i % rowsPerColumn;
        const x = startX + col * (cellWidth + gapX);
        const y = columnStartYs[col] + row * (cellHeight + gapY);

        const piece = new PIXI.Sprite(texture);
        piece.anchor.set(0.5);

        const initialScale = pieceScaleRef.current;
        piece.scale.set(initialScale);
        piece.x = x;
        piece.y = y;
        piece.homePosition = { x, y };
        piece.inBoardZone = false;
        piece.alpha = 1;
        piece.visible = true;

        piece.angle = rotationEnabledRef.current ? Math.random() * 360 : 0;

        piece.pieceData = {
          id: pieceData.id,
          correctX: pieceData.correctPosition.x,
          correctY: pieceData.correctPosition.y,
          correctRotation: pieceData.correctRotation || 0
        };

        piece.eventMode = 'static';
        piece.cursor = 'pointer';

        app.stage.addChild(piece);
        piecesRef.current.set(pieceData.id, piece);

        // Rotation handle
        const rotationHandle = new PIXI.Graphics();
        rotationHandle.circle(0, 0, ROTATE_HANDLE_RADIUS);
        rotationHandle.fill({ color: 0xffffff, alpha: 0.9 });
        rotationHandle.circle(0, 0, ROTATE_HANDLE_RADIUS);
        rotationHandle.stroke({ color: 0x000000, alpha: 0.25, width: 2 });
        if ((PIXI as any).Circle) rotationHandle.hitArea = new (PIXI as any).Circle(0, 0, ROTATE_HANDLE_RADIUS + 8);

        rotationHandle.eventMode = rotationEnabledRef.current ? 'static' : 'none';
        rotationHandle.cursor = rotationEnabledRef.current ? 'grab' : 'default';
        rotationHandle.visible = rotationEnabledRef.current;

        piece.rotationHandle = rotationHandle;
        rotationHandlesRef.current.set(pieceData.id, rotationHandle);
        app.stage.addChild(rotationHandle);
        updateRotationHandlePosition(piece);

        // Drag handle
        const dragHandle = new PIXI.Graphics();
        dragHandle.circle(0, 0, DRAG_HANDLE_RADIUS);
        dragHandle.fill({ color: 0x22c55e, alpha: 0.9 });
        dragHandle.circle(0, 0, DRAG_HANDLE_RADIUS);
        dragHandle.stroke({ color: 0x000000, alpha: 0.25, width: 2 });
        if ((PIXI as any).Circle) dragHandle.hitArea = new (PIXI as any).Circle(0, 0, DRAG_HANDLE_RADIUS + 12);

        dragHandle.eventMode = 'static';
        dragHandle.cursor = 'grab';

        piece.dragHandle = dragHandle;
        dragHandlesRef.current.set(pieceData.id, dragHandle);
        app.stage.addChild(dragHandle);
        updateDragHandlePosition(piece);

        rotationHandle.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
          if (!rotationEnabledRef.current) return;
          if (piece.eventMode === 'none') return;
          if (isDraggingRef.current) return;
          event.stopPropagation();

          gsap.killTweensOf(piece);
          gsap.killTweensOf(piece.scale);

          isRotatingRef.current = true;
          rotatingPieceRef.current = piece;
          rotatingPointerIdRef.current = event.pointerId;

          const pointerAngle = (Math.atan2(event.global.y - piece.y, event.global.x - piece.x) * 180) / Math.PI;
          rotateOffsetDegRef.current = pointerAngle - piece.angle;

          selectedPieceRef.current = piece;

          try {
            (rotationHandle as any).setPointerCapture?.(event.pointerId);
          } catch { }
          try {
            (app.canvas as any)?.setPointerCapture?.(event.pointerId);
          } catch { }

          app.stage.addChild(piece);
          app.stage.addChild(rotationHandle);
          updateRotationHandlePosition(piece);
          app.stage.addChild(dragHandle);
          updateDragHandlePosition(piece);
        });

        const beginDrag = (event: PIXI.FederatedPointerEvent, mode: 'piece' | 'handle') => {
          if (piece.eventMode === 'none') return;
          if (isRotatingRef.current) return;
          if (isDraggingRef.current && dragTargetRef.current && dragTargetRef.current !== piece) return;

          event.stopPropagation();

          gsap.killTweensOf(piece);
          gsap.killTweensOf(piece.scale);

          isDraggingRef.current = true;
          dragTargetRef.current = piece;
          dragPointerIdRef.current = event.pointerId;
          dragModeRef.current = mode;
          dragPointerPosRef.current = { x: event.global.x, y: event.global.y };
          dragOffsetRef.current = mode === 'piece' ? { x: piece.x - event.global.x, y: piece.y - event.global.y } : null;
          selectedPieceRef.current = piece;

          try {
            (app.canvas as any)?.setPointerCapture?.(event.pointerId);
          } catch { }

          app.stage.addChild(piece);
          app.stage.addChild(rotationHandle);
          app.stage.addChild(dragHandle);
          updateRotationHandlePosition(piece);
          updateDragHandlePosition(piece);
        };

        dragHandle.on('pointerdown', (event: PIXI.FederatedPointerEvent) => beginDrag(event, 'handle'));
        piece.on('pointerdown', (event: PIXI.FederatedPointerEvent) => beginDrag(event, 'piece'));

        updateRotationHandlePosition(piece);
        updateDragHandlePosition(piece);
      }

      if (typeof window !== 'undefined') {
        (window as any).__pixiLoaded = true;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load puzzle:', error);
    } finally {
      if (seq === loadSeqRef.current) {
        loadingRef.current = false;
      }
    }
  }, [puzzleData, theme, updateRotationHandlePosition, updateDragHandlePosition]);

  useEffect(() => {
    loadPuzzleRef.current = loadPuzzle;
  }, [loadPuzzle]);

  // ✅ Only one place triggers load (no extra init call)
  useEffect(() => {
    loadPuzzleRef.current?.();
  }, [puzzleData]);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    let app: PIXI.Application | null = null;
    let resizeRaf: number | null = null;

    const handleResize = () => {
      if (!container || !app) return;
      if (loadingRef.current) return; // ✅ avoid resize reload mid-load

      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        if (!container || !app) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        app.renderer.resize(w, h);
        loadPuzzleRef.current?.();
        resizeRaf = null;
      });
    };

    const init = async () => {
      const width = container.clientWidth;
      const height = container.clientHeight;

      app = new PIXI.Application();
      await app.init({
        width,
        height,
        backgroundColor: theme.bg,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true
      });

      container.appendChild(app.canvas);
      app.canvas.style.position = 'absolute';
      app.canvas.style.top = '0';
      app.canvas.style.left = '0';
      app.canvas.style.zIndex = '0';
      app.canvas.style.touchAction = 'none';

      pixiAppRef.current = app;

      app.stage.eventMode = 'static';
      (app.stage as any).hitArea = (app as any).screen;

      // Load puzzle after app is initialized
      loadPuzzleRef.current?.();

      const onStagePointerMove = (event: PIXI.FederatedPointerEvent) => {
        if (pinchPointersRef.current.has(event.pointerId)) {
          pinchPointersRef.current.set(event.pointerId, { x: event.global.x, y: event.global.y });

          if (pinchPointersRef.current.size === 2) {
            const pointers = Array.from(pinchPointersRef.current.values());
            const dx = pointers[1].x - pointers[0].x;
            const dy = pointers[1].y - pointers[0].y;
            const currentDist = Math.sqrt(dx * dx + dy * dy);

            if (lastPinchDistRef.current !== null) {
              const distChange = currentDist - lastPinchDistRef.current;
              const zoomDelta = distChange * 0.003;
              applyZoom(zoomDelta);
            }

            lastPinchDistRef.current = currentDist;
            isPinchZoomingRef.current = true;
            return;
          }
        }

        if (
          isRotatingRef.current &&
          rotationEnabledRef.current &&
          (rotatingPointerIdRef.current === null || event.pointerId === rotatingPointerIdRef.current)
        ) {
          const piece = rotatingPieceRef.current;
          if (piece && piece.eventMode !== 'none') {
            const pointerAngle = (Math.atan2(event.global.y - piece.y, event.global.x - piece.x) * 180) / Math.PI;
            piece.angle = pointerAngle - rotateOffsetDegRef.current;
            updateRotationHandlePosition(piece);
            updateDragHandlePosition(piece);
          }
        }

        if (
          isDraggingRef.current &&
          !isPinchZoomingRef.current &&
          (dragPointerIdRef.current === null || event.pointerId === dragPointerIdRef.current)
        ) {
          const piece = dragTargetRef.current;
          dragPointerPosRef.current = { x: event.global.x, y: event.global.y };
          const mode = dragModeRef.current;
          const offset = dragOffsetRef.current;

          if (piece && piece.eventMode !== 'none') {
            const pos = event.global;
            if (mode === 'handle') {
              positionPieceForDragHandle(piece, pos);
            } else {
              piece.x = pos.x + (offset?.x ?? 0);
              piece.y = pos.y + (offset?.y ?? 0);
            }
            updateScaleForBoardHover(piece);
            updateRotationHandlePosition(piece);
            updateDragHandlePosition(piece);
          }
        }
      };

      const endRotate = (event: PIXI.FederatedPointerEvent) => {
        if (!isRotatingRef.current) return;
        if (rotatingPointerIdRef.current !== null && event.pointerId !== rotatingPointerIdRef.current) return;

        const piece = rotatingPieceRef.current;
        const handle = piece?.rotationHandle;

        try {
          (handle as any)?.releasePointerCapture?.(event.pointerId);
        } catch { }
        try {
          (app?.canvas as any)?.releasePointerCapture?.(event.pointerId);
        } catch { }

        isRotatingRef.current = false;
        rotatingPieceRef.current = null;
        rotatingPointerIdRef.current = null;
      };

      const endDrag = (event: PIXI.FederatedPointerEvent) => {
        if (!isDraggingRef.current) return;
        if (dragPointerIdRef.current !== null && event.pointerId !== dragPointerIdRef.current) return;

        const piece = dragTargetRef.current;
        const mode = dragModeRef.current;
        const offset = dragOffsetRef.current;

        dragPointerPosRef.current = { x: event.global.x, y: event.global.y };

        isDraggingRef.current = false;
        dragTargetRef.current = null;
        dragPointerIdRef.current = null;
        dragOffsetRef.current = null;
        dragPointerPosRef.current = null;
        dragModeRef.current = 'piece';

        try {
          (app?.canvas as any)?.releasePointerCapture?.(event.pointerId);
        } catch { }

        if (!piece || piece.eventMode === 'none') return;

        if (mode === 'handle') {
          positionPieceForDragHandle(piece, event.global);
        } else {
          piece.x = event.global.x + (offset?.x ?? 0);
          piece.y = event.global.y + (offset?.y ?? 0);
        }

        updateRotationHandlePosition(piece);
        updateDragHandlePosition(piece);

        gsap.killTweensOf(piece);
        gsap.killTweensOf(piece.scale);

        const snapped = checkSnapRef.current?.(piece) ?? false;
        if (!snapped) {
          piece.inBoardZone = false;
          const home = piece.homePosition;
          if (home) {
            gsap.to(piece, {
              x: home.x,
              y: home.y,
              duration: 0.3,
              ease: 'power2.out',
              onUpdate: () => {
                updateRotationHandlePosition(piece);
                updateDragHandlePosition(piece);
              }
            });
          }

          gsap.to(piece.scale, {
            x: pieceScaleRef.current,
            y: pieceScaleRef.current,
            duration: 0.3,
            ease: 'power2.out',
            onUpdate: () => {
              updateRotationHandlePosition(piece);
              updateDragHandlePosition(piece);
            }
          });
        }
      };

      const onStagePointerDown = (event: PIXI.FederatedPointerEvent) => {
        if (app && event.target === app.stage) {
          pinchPointersRef.current.set(event.pointerId, { x: event.global.x, y: event.global.y });
          if (pinchPointersRef.current.size === 2) {
            isPinchZoomingRef.current = true;
            lastPinchDistRef.current = null;
          }
        }
      };

      const onStagePointerUp = (event: PIXI.FederatedPointerEvent) => {
        pinchPointersRef.current.delete(event.pointerId);
        if (pinchPointersRef.current.size < 2) {
          isPinchZoomingRef.current = false;
          lastPinchDistRef.current = null;
        }
        endRotate(event);
        endDrag(event);
      };

      const stageAny = app.stage as any;
      const addStageListener = (type: string, handler: any) => {
        if (typeof stageAny.addEventListener === 'function') stageAny.addEventListener(type, handler);
        else if (typeof stageAny.on === 'function') stageAny.on(type, handler);
      };

      addStageListener('pointerdown', onStagePointerDown);
      addStageListener('pointermove', onStagePointerMove);
      addStageListener('pointerup', onStagePointerUp);
      addStageListener('pointerupoutside', onStagePointerUp);

      window.addEventListener('resize', handleResize);

      if (typeof window !== 'undefined') {
        (window as any).__pixiApp = app;
        (window as any).__pixiPieces = piecesRef.current;
        (window as any).__pixiSnappedPieces = snappedPiecesRef.current;
        (window as any).__ghostRef = ghostRef;
      }
    };

    init();

    return () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      window.removeEventListener('resize', handleResize);

      // invalidate pending load runs
      loadSeqRef.current++;

      // Clean up object URLs
      objectUrlMap.current.forEach((_, key) => revokeObjectUrl(key));
      objectUrlMap.current.clear();

      if (pixiAppRef.current) {
        pixiAppRef.current.destroy(true, {
          children: true,
          texture: true,
          textureSource: true
        });
        pixiAppRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const app = pixiAppRef.current;
    if (!app) return;

    app.renderer.background.color = theme.bg;

    const separator = app.stage.children.find(child => (child as any).label === 'separator') as PIXI.Graphics;
    if (separator) {
      const layout = layoutRef.current;
      separator.clear();
      if (layout) separator.rect(0, layout.boardAreaHeight, layout.boardAreaWidth, 2);
      else separator.rect(0, 0, app.renderer.width, 2);

      separator.fill({ color: theme.separator, alpha: theme.separatorAlpha });
    }

    if (ghostRef.current) ghostRef.current.alpha = theme.ghostAlpha;
  }, [theme, isDarkMode]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div ref={containerRef} style={{ ...styles.container, backgroundColor: theme.bgHex }}>
      <button
        onClick={toggleTheme}
        style={styles.themeToggle}
        className="hover:scale-105 transition-transform"
        title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      >
        {isDarkMode ? '☀️' : '🌙'}
      </button>

      {!isMobile && (
        <div style={styles.zoomControls}>
          <button
            onClick={() => applyZoom(ZOOM_STEP)}
            style={{
              ...styles.zoomButton,
              opacity: zoomLevel >= MAX_ZOOM ? 0.5 : 1,
              cursor: zoomLevel >= MAX_ZOOM ? 'not-allowed' : 'pointer'
            }}
            className="hover:scale-110 transition-transform"
            title="Zoom In (Ctrl/Cmd + +)"
            disabled={zoomLevel >= MAX_ZOOM}
          >
            +
          </button>
          <button
            onClick={() => applyZoom(-ZOOM_STEP)}
            style={{
              ...styles.zoomButton,
              opacity: zoomLevel <= MIN_ZOOM ? 0.5 : 1,
              cursor: zoomLevel <= MIN_ZOOM ? 'not-allowed' : 'pointer'
            }}
            className="hover:scale-110 transition-transform"
            title="Zoom Out (Ctrl/Cmd + -)"
            disabled={zoomLevel <= MIN_ZOOM}
          >
            −
          </button>
          <button
            onClick={() => {
              zoomLevelRef.current = 1;
              setZoomLevel(1);
              pieceScaleRef.current = basePieceScaleRef.current;

              piecesRef.current.forEach(piece => {
                if (snappedPiecesRef.current.has(piece.pieceData?.id || '')) return;
                const targetScale = piece.inBoardZone ? boardScaleRef.current : pieceScaleRef.current;
                gsap.to(piece.scale, {
                  x: targetScale,
                  y: targetScale,
                  duration: 0.2,
                  ease: 'power2.out',
                  onUpdate: () => {
                    updateRotationHandlePosition(piece);
                    updateDragHandlePosition(piece);
                  }
                });
              });
            }}
            style={{ ...styles.zoomButton, fontSize: '14px' }}
            className="hover:scale-110 transition-transform"
            title="Reset Zoom (Ctrl/Cmd + 0)"
          >
            1×
          </button>
        </div>
      )}

      {trayHeaderBounds && (
        <div
          style={{
            ...styles.trayHeader,
            left: trayHeaderBounds.left,
            top: trayHeaderBounds.top,
            width: trayHeaderBounds.width,
            color: theme.trayHeader,
            borderBottomColor: theme.trayBorder
          }}
        >
          PIECES
        </div>
      )}

      <div style={{ ...styles.hud, height: `${HUD_HEIGHT}px` }}>
        <div style={{ ...styles.hudInner, backgroundColor: theme.hudBg, borderColor: theme.hudBorder }}>
          <div style={styles.hudItem}>
            <span style={styles.hudLabel}>PROGRESS</span>
            <span style={{ ...styles.hudValue, color: isDarkMode ? '#fbbf24' : '#d97706' }}>{progress}%</span>
          </div>
          <div style={{ ...styles.hudSeparator, backgroundColor: theme.hudBorder }} />
          <div style={styles.hudItem}>
            <span style={styles.hudLabel}>TIME</span>
            <span style={{ ...styles.hudValue, color: isDarkMode ? '#fbbf24' : '#d97706' }}>{formatTime(timeElapsed)}</span>
          </div>
        </div>
      </div>


    </div>
  );
}

declare module 'pixi.js' {
  interface Sprite {
    pieceData?: {
      id: string;
      correctX: number;
      correctY: number;
      correctRotation: number;
    };
    homePosition?: { x: number; y: number };
    rotationHandle?: PIXI.Graphics;
    dragHandle?: PIXI.Graphics;
    inBoardZone?: boolean;
  }
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    overscrollBehavior: 'none',
    transition: 'background-color 0.3s ease'
  },
  themeToggle: {
    position: 'absolute',
    top: '20px',
    left: '20px',
    zIndex: 60,
    background: 'rgba(255, 255, 255, 0.1)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '50%',
    width: '40px',
    height: '40px',
    fontSize: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    backdropFilter: 'blur(4px)',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
  },
  zoomControls: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    zIndex: 60,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  zoomButton: {
    background: 'rgba(255, 255, 255, 0.1)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '8px',
    width: '40px',
    height: '40px',
    fontSize: '20px',
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    backdropFilter: 'blur(4px)',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    color: 'white'
  },
  trayHeader: {
    position: 'absolute',
    top: '10px',
    textAlign: 'center',
    fontSize: '12px',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    pointerEvents: 'none',
    borderBottom: '1px solid',
    paddingBottom: '5px'
  },
  hud: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
    pointerEvents: 'none'
  },
  hudInner: {
    display: 'flex',
    alignItems: 'center',
    gap: '32px',
    padding: '8px 32px',
    borderRadius: '8px 8px 0 0',
    border: '1px solid',
    borderBottom: 'none',
    backdropFilter: 'blur(4px)',
    pointerEvents: 'auto',
    transition: 'all 0.3s ease'
  },
  hudItem: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px'
  },
  hudLabel: {
    color: '#f59e0b',
    fontSize: '11px',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    textTransform: 'uppercase'
  },
  hudValue: {
    fontSize: '20px',
    fontFamily: 'monospace',
    fontWeight: 'bold'
  },
  hudSeparator: {
    width: '1px',
    height: '24px'
  }
};
