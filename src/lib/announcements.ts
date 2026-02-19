export type Announcement = {
  id: string;
  title: string;
  description: string;
  datetime: string;
  created_at?: string | null;
  created_by?: string | null;
  duration_minutes?: number | null;
  location: string;
  activities?: string[];
  link?: string | null;
  group_id?: string | null;
  scope_type?: "global" | "country" | "city" | "radius" | null;
  country?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  radius_km?: number | null;
};

// Who can manage announcements (front-end gating only; secure rules must be enforced server-side)
export const ANNOUNCEMENT_ADMINS = [
  "media@meincircles.com",
];

export const ANNOUNCEMENT_VISIBILITY_DAYS = 15;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeText(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isAnnouncementAdminEmail(email?: string | null): boolean {
  const normalized = (email || "").trim().toLowerCase();
  return !!normalized && ANNOUNCEMENT_ADMINS.includes(normalized);
}

export function announcementVisibilityCutoffIso(
  nowMs = Date.now(),
  visibilityDays = ANNOUNCEMENT_VISIBILITY_DAYS
): string {
  return new Date(nowMs - visibilityDays * MS_PER_DAY).toISOString();
}

export function isAnnouncementVisibleForViewer(
  evt: Pick<
    Announcement,
    | "created_at"
    | "created_by"
    | "datetime"
    | "scope_type"
    | "country"
    | "city"
    | "lat"
    | "lng"
    | "radius_km"
  >,
  opts: {
    viewerId?: string | null;
    viewerEmail?: string | null;
    viewerCity?: string | null;
    viewerCountry?: string | null;
    viewerCoords?: { lat: number; lng: number } | null;
    nowMs?: number;
  } = {}
): boolean {
  const {
    viewerId = null,
    viewerEmail = null,
    viewerCity = null,
    viewerCountry = null,
    viewerCoords = null,
    nowMs = Date.now(),
  } = opts;

  // Official media/admin account should keep seeing all announcements for management.
  if (isAnnouncementAdminEmail(viewerEmail)) return true;
  if (viewerId && evt.created_by && evt.created_by === viewerId) return true;

  const base = evt.created_at || evt.datetime;
  if (!base) return true;
  const createdMs = new Date(base).getTime();
  if (Number.isNaN(createdMs)) return true;
  if (createdMs < nowMs - ANNOUNCEMENT_VISIBILITY_DAYS * MS_PER_DAY) return false;

  const scope = normalizeText(evt.scope_type || "global");
  if (!scope || scope === "global") return true;

  if (scope === "country") {
    return normalizeText(evt.country) !== "" && normalizeText(evt.country) === normalizeText(viewerCountry);
  }

  if (scope === "city") {
    return normalizeText(evt.city) !== "" && normalizeText(evt.city) === normalizeText(viewerCity);
  }

  if (scope === "radius") {
    if (!viewerCoords) return false;
    if (typeof evt.lat !== "number" || typeof evt.lng !== "number") return false;
    const radiusKm = typeof evt.radius_km === "number" && evt.radius_km > 0 ? evt.radius_km : 15;
    return haversineKm(viewerCoords.lat, viewerCoords.lng, evt.lat, evt.lng) <= radiusKm;
  }

  return true;
}
