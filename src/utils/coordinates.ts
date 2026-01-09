export type LatLngTuple = [number, number];

type DynamoDbNumber = { N?: unknown };
type DynamoDbString = { S?: unknown };

function coerceNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (typeof value === "string") {
    const n = Number.parseFloat(value.trim());
    return Number.isFinite(n) ? n : null;
  }

  if (typeof value === "object") {
    const maybeN = (value as DynamoDbNumber).N;
    if (typeof maybeN === "string" || typeof maybeN === "number") return coerceNumber(maybeN);

    const maybeS = (value as DynamoDbString).S;
    if (typeof maybeS === "string" || typeof maybeS === "number") return coerceNumber(maybeS);
  }

  return null;
}

export function parseLatLng(value: unknown): LatLngTuple | null {
  if (value == null) return null;

  if (Array.isArray(value)) {
    if (value.length < 2) return null;
    const lat = coerceNumber(value[0]);
    const lng = coerceNumber(value[1]);
    if (lat == null || lng == null) return null;
    return [lat, lng];
  }

  if (typeof value === "string") {
    const parts = value.split(",").map((s) => s.trim());
    if (parts.length !== 2) return null;
    const lat = coerceNumber(parts[0]);
    const lng = coerceNumber(parts[1]);
    if (lat == null || lng == null) return null;
    return [lat, lng];
  }

  if (typeof value === "object") {
    const coords = value as { lat?: unknown; lng?: unknown };
    const lat = coerceNumber(coords.lat);
    const lng = coerceNumber(coords.lng);
    if (lat == null || lng == null) return null;
    return [lat, lng];
  }

  return null;
}

export function formatLatLng(coords: LatLngTuple): string {
  return `${coords[0]}, ${coords[1]}`;
}
