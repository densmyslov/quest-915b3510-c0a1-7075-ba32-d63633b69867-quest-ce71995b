
import { parseLatLng } from "./coordinates";

type Coordinate = [number, number];

export function calculateBounds(userLocation: Coordinate | null, objects: any[]): [Coordinate, Coordinate] | null {
    const points: Coordinate[] = [];

    if (userLocation) {
        points.push(userLocation);
    }

    objects.forEach(obj => {
        const coords = parseLatLng(obj?.coordinates);
        if (coords) points.push(coords);
    });

    if (points.length === 0) return null;

    let minLat = points[0][0];
    let maxLat = points[0][0];
    let minLng = points[0][1];
    let maxLng = points[0][1];

    points.forEach(p => {
        minLat = Math.min(minLat, p[0]);
        maxLat = Math.max(maxLat, p[0]);
        minLng = Math.min(minLng, p[1]);
        maxLng = Math.max(maxLng, p[1]);
    });

    // Add some padding (approx 10% or fixed amount)
    // For simplicity, we return exact bounds, Leaflet fitBounds handles padding
    return [[minLat, minLng], [maxLat, maxLng]];
}
