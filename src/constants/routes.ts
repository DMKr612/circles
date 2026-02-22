export const ROUTES = {
  HOME: "/",
  AUTH: "/auth",
  ONBOARDING: "/onboarding",
  BROWSE: "/browse",
  GROUPS: "/groups",
  ANNOUNCEMENTS: "/announcements",
  NOTIFICATIONS: "/notifications",
  PROFILE: "/profile",
  SETTINGS: "/settings",
  CREATE: "/create",
  CHATS: "/chats",
  EVENTS: "/events",
} as const;

export const routeToGroup = (groupId: string) => `/group/${groupId}`;
export const routeToUser = (userId: string) => `/users/${userId}`;
export const routeToEventRating = (eventId: string, groupId?: string) =>
  `${ROUTES.EVENTS}/${eventId}/rate${groupId ? `?groupId=${encodeURIComponent(groupId)}` : ""}`;
