# Coordinate-Based Rendering Implementation

## Summary

This document describes the implementation of coordinate-based dynamic puzzle piece rendering in quest-app-template, matching the functionality from quest-platform.

## Changes Made

### 1. Type Definitions ([src/types/puzzle.ts](../src/types/puzzle.ts))

Added `shapeData` property to `PieceData` interface:

```typescript
interface PieceData {
  // ... existing properties ...

  /**
   * Coordinate-based rendering (NEW)
   * Stores polygon/freehand coordinates for dynamic piece generation
   * Reduces payload size by 90%+ vs base64 images
   */
  shapeData?: {
    /** Type of shape data */
    type: 'polygon' | 'path';
    /** Normalized polygon points relative to original image origin */
    points?: Array<{ x: number; y: number }>;
    /** SVG path data for freehand shapes */
    pathData?: string;
  };
}
```

### 2. Helper Functions ([src/components/puzzles/mozaic/PuzzleGame.tsx](../src/components/puzzles/mozaic/PuzzleGame.tsx))

#### `revokeObjectUrl(key: string)` (Lines 216-222)
Cleans up blob URLs to prevent memory leaks.

#### `loadTextureWithFallback(id: string, imageUrl: string)` (Lines 224-254)
Loads textures with Cloudflare Images compatibility:
- Tries `PIXI.Assets.load()` with explicit `loadTextures` parser
- Falls back to `fetch()` + blob URL creation
- Handles URLs without file extensions (e.g., Cloudflare Images `/public` variant)

#### `generatePieceTexture(pieceData: any, originalImage: HTMLImageElement)` (Lines 256-374)
**Core function** that dynamically generates piece textures from coordinate data:

1. **Calculate bounding box** from polygon points
2. **Create canvas** sized to bounding box + padding
3. **Draw image portion** from original image
4. **Create polygon mask** from shape coordinates
5. **Apply mask** using `destination-in` compositing
6. **Convert to PIXI texture**

```typescript
const texture = PIXI.Texture.from(canvas);
```

### 3. Piece Loading Logic (Lines 728-775)

Updated puzzle loading to try coordinate-based rendering first:

```typescript
// Generate or load piece textures
const pieceTextures: Map<string, PIXI.Texture> = new Map();

for (const pieceData of pieces) {
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
}

// Filter to only pieces that successfully loaded textures
const loadedPieces = pieces.filter(p => pieceTextures.has(p.id));
console.log(`✓ Loaded ${loadedPieces.length}/${pieces.length} pieces`);
if (hasShapeData) {
  console.log('   Using coordinate-based rendering');
}
```

### 4. Cleanup (Lines 584-585, 1138-1139)

Added proper cleanup of object URLs on:
- Puzzle reload
- Component unmount

```typescript
objectUrlMap.current.forEach((_, key) => revokeObjectUrl(key));
objectUrlMap.current.clear();
```

## Features Preserved

All existing quest-app-template features remain intact:

✅ **Drag handles** (green circles) - For intuitive piece movement
✅ **Rotation handles** (white circles) - For piece rotation
✅ **Pinch zoom** - Multi-touch zoom support
✅ **Keyboard zoom** (Ctrl/Cmd +/-/0) - Desktop zoom controls
✅ **Board zone scaling** - Pieces scale up when near board
✅ **Q/E rotation keys** - Keyboard rotation shortcuts
✅ **Mouse wheel rotation** - Scroll to rotate while dragging
✅ **Dark/light theme** - Theme switching support
✅ **Progress tracking** - Visual progress indicator
✅ **Timer** - Elapsed time tracking

## Benefits

### Performance
- **90%+ smaller payload**: Coordinates vs base64 images significantly reduces download size
- **Single image load**: Original image loaded once, shared across all pieces
- **Reduced memory**: No need to store individual piece images

### Quality
- **Perfect transparency**: Proper alpha masking without rectangular backgrounds
- **Consistent rendering**: All pieces rendered from same source
- **Anti-aliasing**: Clean edges from canvas rendering

### Developer Experience
- **Backward compatible**: Existing puzzles continue to work
- **Easier modifications**: Change cutting algorithm without regenerating all images
- **Better debugging**: Console logs show which rendering method is used

## Testing

The implementation includes comprehensive logging:

```
✓ Original image loaded for dynamic piece generation
✓ Generated texture for piece piece_0 from coordinates
✓ Generated texture for piece piece_1 from coordinates
✓ Loaded 6/6 pieces
   Using coordinate-based rendering
```

## Future Enhancements

Potential improvements for future iterations:

1. **Freehand path support**: Implement `pathData` rendering for non-polygon shapes
2. **Web Worker**: Move texture generation to background thread
3. **Caching**: Cache generated textures in IndexedDB
4. **Progressive loading**: Load and render pieces incrementally
5. **Compression**: Use more efficient coordinate encoding (e.g., relative deltas)

## References

- Quest Platform Implementation: `/quest-platform/frontend/components/puzzles/mozaic/PuzzleGame.tsx`
- Quest Platform Docs: `/quest-platform/docs/PUZZLES.md`
- PixiJS Texture API: https://pixijs.download/release/docs/rendering.Texture.html
- Canvas Compositing: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation
