export type FountainMapPoint = { x: number; y: number };
export type FountainMapRegion = {
    regionId: string;
    stoneId: string;
    points: FountainMapPoint[];
};
export type FountainMap = {
    version: 1;
    coordinateSpace?: 'normalized' | 'pixels';
    imageSize?: { width: number; height: number };
    regions: FountainMapRegion[];
};

export function extractFountainMap(puzzleData: any | null): FountainMap | null {
    const fm = puzzleData?.fountainMap as FountainMap | undefined;
    if (!fm || fm.version !== 1) return null;
    if (!Array.isArray(fm.regions)) return null;
    return fm;
}

export function inferFountainMapViewBox(map: FountainMap): { x: number; y: number; w: number; h: number } {
    if (map.coordinateSpace === 'pixels' && map.imageSize?.width && map.imageSize?.height) {
        return { x: 0, y: 0, w: map.imageSize.width, h: map.imageSize.height };
    }
    const points = map.regions.flatMap(r => r.points || []);
    let maxX = 0;
    let maxY = 0;
    for (const p of points) {
        if (typeof p?.x === 'number' && Number.isFinite(p.x)) maxX = Math.max(maxX, p.x);
        if (typeof p?.y === 'number' && Number.isFinite(p.y)) maxY = Math.max(maxY, p.y);
    }
    const looksNormalized = maxX <= 1.01 && maxY <= 1.01;
    return looksNormalized ? { x: 0, y: 0, w: 1, h: 1 } : { x: 0, y: 0, w: Math.max(1, maxX), h: Math.max(1, maxY) };
}
