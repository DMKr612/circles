import { supabase } from "./supabase";

export type JoinBlockReason = "low_rating" | "blocked";

export const LOW_RATING_BLOCK_THRESHOLD = 2;
export const RECONNECT_COOLDOWN_DAYS = 7;
const RECONNECT_COOLDOWN_MS = RECONNECT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export function isLowRatingBlock(stars: number) {
  return stars > 0 && stars <= LOW_RATING_BLOCK_THRESHOLD;
}

export function joinBlockMessage(reason: JoinBlockReason) {
  if (reason === "low_rating") {
    return "You rated someone in this circle 1-2 stars, so you can't join it.";
  }
  return "You blocked someone in this circle, so you can't join it.";
}

export function daysUntilReconnect(lastSentAt?: string | null) {
  if (!lastSentAt) return 0;
  const last = new Date(lastSentAt).getTime();
  if (Number.isNaN(last)) return 0;
  const next = last + RECONNECT_COOLDOWN_MS;
  const remaining = next - Date.now();
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / (24 * 60 * 60 * 1000));
}

export async function getLowRatedUserIds(raterId: string) {
  if (!raterId) return new Set<string>();
  const { data, error } = await supabase
    .from("rating_pairs")
    .select("ratee_id, stars")
    .eq("rater_id", raterId)
    .lte("stars", LOW_RATING_BLOCK_THRESHOLD);

  if (error) {
    console.warn("[ratings] failed to load low ratings", error);
    return new Set<string>();
  }

  const ids = new Set<string>();
  (data ?? []).forEach((row: any) => {
    if (row?.ratee_id) ids.add(String(row.ratee_id));
  });
  return ids;
}

export async function getBlockedUserIds(uid: string) {
  if (!uid) return new Set<string>();
  const { data, error } = await supabase
    .from("friendships")
    .select("user_id_a, user_id_b, status, requested_by")
    .or(`and(user_id_a.eq.${uid},status.eq.blocked),and(user_id_b.eq.${uid},status.eq.blocked)`);

  if (error) {
    console.warn("[ratings] failed to load blocked users", error);
    return new Set<string>();
  }

  const ids = new Set<string>();
  (data ?? []).forEach((row: any) => {
    if (row?.requested_by !== uid) return;
    const other = row.user_id_a === uid ? row.user_id_b : row.user_id_a;
    if (other) ids.add(String(other));
  });
  return ids;
}

async function getAcceptedReconnectIds(targetId: string, requesterIds: string[]) {
  if (!targetId || requesterIds.length === 0) return new Set<string>();
  const { data, error } = await supabase
    .from("reconnect_requests")
    .select("requester_id")
    .eq("target_id", targetId)
    .in("requester_id", requesterIds)
    .eq("status", "accepted");

  if (error) {
    console.warn("[ratings] failed to load accepted reconnects", error);
    return new Set<string>();
  }

  const ids = new Set<string>();
  (data ?? []).forEach((row: any) => {
    if (row?.requester_id) ids.add(String(row.requester_id));
  });
  return ids;
}

export async function checkGroupJoinBlock(uid: string, groupId: string) {
  if (!uid || !groupId) return null;

  const [lowRatedIds, blockedIds] = await Promise.all([
    getLowRatedUserIds(uid),
    getBlockedUserIds(uid),
  ]);

  if (lowRatedIds.size === 0 && blockedIds.size === 0) return null;

  const conflictIds = new Set<string>([...lowRatedIds, ...blockedIds]);
  const acceptedReconnectIds = await getAcceptedReconnectIds(uid, Array.from(conflictIds));
  const filteredLowRatedIds = new Set(
    [...lowRatedIds].filter((id) => !acceptedReconnectIds.has(id))
  );
  const filteredBlockedIds = new Set(
    [...blockedIds].filter((id) => !acceptedReconnectIds.has(id))
  );

  const { data, error } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("status", "active");

  if (error) {
    console.warn("[ratings] failed to load group members", error);
    return null;
  }

  const memberIds = (data ?? []).map((row: any) => row.user_id);
  if (memberIds.some((id) => filteredLowRatedIds.has(id))) return "low_rating";
  if (memberIds.some((id) => filteredBlockedIds.has(id))) return "blocked";
  return null;
}
