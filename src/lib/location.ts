export type LatLng = {
  lat: number;
  lng: number;
};

const EARTH_RADIUS_KM = 6371;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const y = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return EARTH_RADIUS_KM * y;
}

export function movedMoreThanMeters(prev: LatLng | null, next: LatLng, minMeters: number): boolean {
  if (!prev) return true;
  const distanceKm = haversineKm(prev, next);
  return distanceKm * 1000 >= minMeters;
}

export function isLocationStale(updatedAtIso: string | null | undefined, staleMinutes: number): boolean {
  if (!updatedAtIso) return true;
  const ts = new Date(updatedAtIso).getTime();
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts >= staleMinutes * 60 * 1000;
}

export function formatDistanceKm(km: number | null | undefined): string {
  if (!Number.isFinite(km as number)) return "";
  const value = km as number;
  if (value < 1) return `${Math.round(value * 1000)} m`;
  if (value < 10) return `${value.toFixed(1)} km`;
  return `${Math.round(value)} km`;
}
