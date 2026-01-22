import { COLORS } from '../components/MapStyles';
import { parseLatLng } from '@/utils/coordinates';

export const normalizeObjectImages = (obj: any): Array<{ url: string; thumbnailUrl?: string }> => {
    const rawImages = obj?.images ?? obj?.imageUrls ?? obj?.image_urls ?? [];
    const list = Array.isArray(rawImages) ? rawImages : [];

    return list
        .map((img: any) => {
            if (typeof img === 'string') {
                return { url: img };
            }

            if (!img || typeof img !== 'object') return null;

            const url = img.url || img.imageUrl || img.image_url || img.src || img.image || null;
            if (typeof url !== 'string' || !url.length) return null;

            const thumbnailUrl =
                img.thumbnailUrl || img.thumbnail_url || img.thumbUrl || img.thumb_url || undefined;
            return { url, thumbnailUrl };
        })
        .filter((img): img is { url: string; thumbnailUrl?: string } => !!img);
};

// Haversine formula for distance calculation
export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

export const toNumber = (value: any, fallback: number): number => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};

export const normalizeEffect = (effect: any) => {
    const rawMaxRadius = toNumber(effect.effectRadius ?? effect.maxRadius, 50);
    const maxRadius = Math.max(2, rawMaxRadius);

    const rawMinRadius = toNumber(effect.minRadius, maxRadius * 0.6);
    const minRadius = Math.max(1, Math.min(rawMinRadius, maxRadius - 1));

    const startDistance = Math.max(1, toNumber(effect.startEffectDistance, maxRadius));
    const speed = toNumber(effect.speed, 50);

    return {
        minRadius,
        maxRadius,
        startDistance,
        speed,
        color: effect.color || COLORS.burgundy
    };
};

export const getItineraryNumber = (obj: any): number | null => {
    const raw =
        obj?.itineraryNumber ??
        obj?.number ??
        obj?.itinerary_number ??
        obj?.itinerary ??
        obj?.['Itinerary number'] ??
        obj?.['Itinerary Number'];
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
};

export const isStartObject = (obj: any): boolean => {
    return !!(obj?.isStart ?? obj?.is_start);
};

export const getValidCoordinates = (obj: any): [number, number] | null => {
    if (!obj || !obj.coordinates) return null;
    return parseLatLng(obj.coordinates);
};
