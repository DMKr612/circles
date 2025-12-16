export type Announcement = {
  id: string;
  title: string;
  description: string;
  datetime: string;
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
