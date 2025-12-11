export type OfficialEvent = {
  id: string;
  title: string;
  datetime: string;
  durationMinutes?: number;
  location: string;
  description: string;
  activities: string[];
  link?: string | null;
  // Optional: attach to an existing group so joining adds you to that circle + chat
  groupId?: string | null;
};

// Who can manage announcements (front-end gating only; secure rules must be enforced server-side)
export const ANNOUNCEMENT_ADMINS = [
  'media@meincircles.com',
];

// App owner: edit this list to publish official announcements.
// Each entry shows in Browse and in the /announcements page.
export const OFFICIAL_EVENTS: OfficialEvent[] = [
  {
    id: "circles-open-night",
    title: "Circles Open Night",
    datetime: "2025-04-05T18:00:00Z",
    durationMinutes: 120,
    location: "Berlin + Online",
    description: "Community-wide hangout hosted by Circles team. Updates, Q&A, and mini-games.",
    activities: ["Product updates + live Q&A", "Open table: Uno, Catan, Chess", "After-chat for new circle ideas"],
    link: null,
    groupId: null,
  },
  {
    id: "spring-hike",
    title: "Spring Hike Weekend",
    datetime: "2025-04-12T09:00:00Z",
    durationMinutes: 240,
    location: "Black Forest",
    description: "Guided hike with no cap. Bring a friend, water, and layers.",
    activities: ["Trail briefing + safety", "Group photo + moments spotlight", "Campfire chat (weather-permitting)"],
    link: null,
    groupId: null,
  },
];
