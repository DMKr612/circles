import { supabase } from "@/lib/supabase";

let liveRatingRpcUnavailable = false;

export type GroupRatingSnapshot = {
  groupId: string;
  groupTitle: string | null;
  groupCity: string | null;
  capacity: number | null;
  createdAt: string | null;
  game: string | null;
  gameSlug: string | null;
  category: string | null;
  lat: number | null;
  lng: number | null;
  hostId: string | null;
  creatorId: string | null;
  requiresVerificationLevel: number;
  membersCount: number;
  groupMembersCount: number;
  groupRatingAvg: number | null;
  groupRatingCount: number;
};

type RpcGroupRatingRow = {
  id: string;
  title: string | null;
  city: string | null;
  capacity: number | null;
  created_at: string | null;
  game: string | null;
  game_slug: string | null;
  category: string | null;
  lat: number | null;
  lng: number | null;
  host_id: string | null;
  creator_id: string | null;
  requires_verification_level: number | null;
  members_count: number | null;
  group_members_count: number | null;
  group_rating_avg: number | string | null;
  group_rating_count: number | null;
  avg_member_rating?: number | string | null;
  member_ratings_count?: number | null;
};

type FallbackGroupRow = {
  id: string;
  title: string | null;
  city: string | null;
  capacity: number | null;
  created_at: string | null;
  game: string | null;
  game_slug?: string | null;
  category: string | null;
  lat?: number | null;
  lng?: number | null;
  host_id?: string | null;
  creator_id?: string | null;
  requires_verification_level?: number | null;
};

export type GroupRatingDisplay =
  | { kind: "new"; label: string }
  | { kind: "low_confidence"; scoreText: string; ratingCount: number; label: string }
  | { kind: "rated"; scoreText: string; ratingCount: number };

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNonNegativeInt(value: unknown): number {
  const parsed = toNumber(value);
  if (parsed == null) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function hasColumnError(error: any): boolean {
  return String(error?.code || "") === "42703";
}

function isMissingRpc(error: any): boolean {
  const code = String(error?.code || "");
  return code === "42883" || code === "PGRST202";
}

function mapRpcRow(row: RpcGroupRatingRow): GroupRatingSnapshot {
  const membersCount = toNonNegativeInt(row.members_count);
  const groupMembersCount = toNonNegativeInt(row.group_members_count) || membersCount;
  const avgMemberRating = toNumber(row.avg_member_rating ?? row.group_rating_avg);
  const memberRatingsCount = toNonNegativeInt(row.member_ratings_count ?? row.group_rating_count);
  return {
    groupId: String(row.id),
    groupTitle: row.title ?? null,
    groupCity: row.city ?? null,
    capacity: row.capacity == null ? null : toNonNegativeInt(row.capacity),
    createdAt: row.created_at ?? null,
    game: row.game ?? null,
    gameSlug: row.game_slug ?? null,
    category: row.category ?? null,
    lat: toNumber(row.lat),
    lng: toNumber(row.lng),
    hostId: row.host_id ?? null,
    creatorId: row.creator_id ?? null,
    requiresVerificationLevel: Math.max(1, toNonNegativeInt(row.requires_verification_level) || 1),
    membersCount,
    groupMembersCount,
    groupRatingAvg: avgMemberRating,
    groupRatingCount: memberRatingsCount,
  };
}

function mapFallbackRow(
  row: FallbackGroupRow,
  rollup?: { membersCount: number; memberRatingsCount: number; avgMemberRating: number | null }
): GroupRatingSnapshot {
  const membersCount = Math.max(0, Number(rollup?.membersCount || 0));
  const memberRatingsCount = Math.max(0, Number(rollup?.memberRatingsCount || 0));
  return {
    groupId: String(row.id || ""),
    groupTitle: row.title ?? null,
    groupCity: row.city ?? null,
    capacity: row.capacity == null ? null : toNonNegativeInt(row.capacity),
    createdAt: row.created_at ?? null,
    game: row.game ?? null,
    gameSlug: row.game_slug ?? null,
    category: row.category ?? null,
    lat: toNumber(row.lat),
    lng: toNumber(row.lng),
    hostId: row.host_id ?? null,
    creatorId: row.creator_id ?? null,
    requiresVerificationLevel: Math.max(1, toNonNegativeInt(row.requires_verification_level) || 1),
    membersCount,
    groupMembersCount: membersCount,
    groupRatingAvg: rollup?.avgMemberRating ?? null,
    groupRatingCount: memberRatingsCount,
  };
}

async function attachFallbackRatings(baseRows: FallbackGroupRow[]): Promise<GroupRatingSnapshot[]> {
  if (baseRows.length === 0) return [];

  const groupIds = baseRows.map((row) => String(row.id || "")).filter(Boolean);
  const { data: memberRows, error: memberErr } = await supabase
    .from("group_members")
    .select("group_id,user_id,status")
    .in("group_id", groupIds);
  if (memberErr) throw memberErr;

  const activeMemberships = ((memberRows || []) as Array<{ group_id: string; user_id: string; status: string | null }>)
    .filter((row) => {
      const status = String(row?.status ?? "active").trim().toLowerCase();
      return status === "active" || status === "accepted";
    })
    .map((row) => ({ groupId: String(row.group_id || ""), userId: String(row.user_id || "") }))
    .filter((row) => row.groupId && row.userId);

  const uniqueUserIds = Array.from(new Set(activeMemberships.map((row) => row.userId)));
  const { data: profileRows, error: profileErr } =
    uniqueUserIds.length > 0
      ? await supabase.from("profiles").select("user_id,rating_avg,rating_count").in("user_id", uniqueUserIds)
      : { data: [], error: null as any };
  if (profileErr) throw profileErr;

  const profileMap = new Map(
    ((profileRows || []) as Array<{ user_id: string; rating_avg: number | null; rating_count: number | null }>).map((row) => [
      String(row.user_id || ""),
      {
        ratingAvg: toNumber(row.rating_avg),
        ratingCount: toNonNegativeInt(row.rating_count),
      },
    ])
  );

  const rollupByGroup = new Map<string, { membersCount: number; memberRatingsCount: number; weightedRatingSum: number }>();
  activeMemberships.forEach((membership) => {
    const current = rollupByGroup.get(membership.groupId) || {
      membersCount: 0,
      memberRatingsCount: 0,
      weightedRatingSum: 0,
    };
    current.membersCount += 1;
    const profile = profileMap.get(membership.userId);
    if (profile && profile.ratingCount > 0 && profile.ratingAvg != null) {
      current.memberRatingsCount += profile.ratingCount;
      current.weightedRatingSum += profile.ratingAvg * profile.ratingCount;
    }
    rollupByGroup.set(membership.groupId, current);
  });

  return baseRows.map((row) => {
    const key = String(row.id || "");
    const current = rollupByGroup.get(key);
    const avgMemberRating =
      current && current.memberRatingsCount > 0 ? current.weightedRatingSum / current.memberRatingsCount : null;
    return mapFallbackRow(row, {
      membersCount: current?.membersCount || 0,
      memberRatingsCount: current?.memberRatingsCount || 0,
      avgMemberRating,
    });
  });
}

async function fetchFallbackSnapshots(cleanedIds: string[]): Promise<GroupRatingSnapshot[]> {
  let fullQuery = supabase
    .from("groups")
    .select("id,title,city,capacity,created_at,game,game_slug,category,lat,lng,host_id,creator_id,requires_verification_level")
    .order("created_at", { ascending: false });
  if (cleanedIds.length > 0) fullQuery = fullQuery.in("id", cleanedIds);

  const full = await fullQuery;
  if (!full.error) {
    const baseRows = (full.data || []) as FallbackGroupRow[];
    return attachFallbackRatings(baseRows);
  }

  if (!hasColumnError(full.error)) throw full.error;

  let fallbackQuery = supabase
    .from("groups")
    .select("id,title,city,capacity,created_at,game,category,lat,lng,host_id,creator_id,requires_verification_level")
    .order("created_at", { ascending: false });
  if (cleanedIds.length > 0) fallbackQuery = fallbackQuery.in("id", cleanedIds);

  const fallback = await fallbackQuery;
  if (!fallback.error) {
    return attachFallbackRatings(
      ((fallback.data || []) as FallbackGroupRow[]).map((row) => ({ ...row, game_slug: null }))
    );
  }

  if (!hasColumnError(fallback.error)) throw fallback.error;

  let minimalQuery = supabase
    .from("groups")
    .select("id,title,city,capacity,created_at,game,category")
    .order("created_at", { ascending: false });
  if (cleanedIds.length > 0) minimalQuery = minimalQuery.in("id", cleanedIds);

  const minimal = await minimalQuery;
  if (minimal.error) throw minimal.error;

  return attachFallbackRatings(
    ((minimal.data || []) as FallbackGroupRow[]).map((row) => ({
      ...row,
      game_slug: null,
      lat: null,
      lng: null,
      host_id: null,
      creator_id: null,
      requires_verification_level: 1,
    }))
  );
}

export async function fetchGroupRatingSnapshots(groupIds?: string[]): Promise<GroupRatingSnapshot[]> {
  const cleanedIds = Array.from(
    new Set((groupIds || []).map((id) => String(id || "").trim()).filter(Boolean))
  );

  if (liveRatingRpcUnavailable) {
    return fetchFallbackSnapshots(cleanedIds);
  }

  const payload = { p_group_ids: cleanedIds.length > 0 ? cleanedIds : null };
  const { data, error } = await supabase.rpc("list_groups_with_live_rating", payload);
  if (error) {
    if (!isMissingRpc(error)) throw error;
    liveRatingRpcUnavailable = true;
    return fetchFallbackSnapshots(cleanedIds);
  }
  return ((data || []) as RpcGroupRatingRow[]).map(mapRpcRow);
}

export function buildGroupRatingMap(
  rows: GroupRatingSnapshot[]
): Record<string, GroupRatingSnapshot> {
  const map: Record<string, GroupRatingSnapshot> = {};
  rows.forEach((row) => {
    const key = String(row.groupId || "");
    if (!key) return;
    map[key] = row;
  });
  return map;
}

export function getGroupRatingDisplay(input: {
  groupMembersCount: number | null | undefined;
  groupRatingAvg: number | null | undefined;
  groupRatingCount: number | null | undefined;
}): GroupRatingDisplay {
  const membersCount = toNonNegativeInt(input.groupMembersCount);
  const ratingCount = toNonNegativeInt(input.groupRatingCount);
  const avg = toNumber(input.groupRatingAvg);
  if (membersCount < 3 || ratingCount < 2 || avg == null) {
    return { kind: "new", label: "New" };
  }
  if (ratingCount < 10) {
    return {
      kind: "low_confidence",
      scoreText: avg.toFixed(1),
      ratingCount,
      label: "beta",
    };
  }
  return {
    kind: "rated",
    scoreText: avg.toFixed(1),
    ratingCount,
  };
}
