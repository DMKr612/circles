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
};

// Who can manage announcements (front-end gating only; secure rules must be enforced server-side)
export const ANNOUNCEMENT_ADMINS = [
  "media@meincircles.com",
];

export const ANNOUNCEMENT_VISIBILITY_DAYS = 15;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  evt: Pick<Announcement, "created_at" | "created_by" | "datetime">,
  opts: { viewerId?: string | null; viewerEmail?: string | null; nowMs?: number } = {}
): boolean {
  const { viewerId = null, viewerEmail = null, nowMs = Date.now() } = opts;

  // Official media/admin account should keep seeing all announcements for management.
  if (isAnnouncementAdminEmail(viewerEmail)) return true;
  if (viewerId && evt.created_by && evt.created_by === viewerId) return true;

  const base = evt.created_at || evt.datetime;
  if (!base) return true;
  const createdMs = new Date(base).getTime();
  if (Number.isNaN(createdMs)) return true;

  return createdMs >= nowMs - ANNOUNCEMENT_VISIBILITY_DAYS * MS_PER_DAY;
}
