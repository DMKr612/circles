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
  | { kind: "low_confidence"; scoreText: string; confidenceLabel: string }
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
    groupRatingAvg: toNumber(row.group_rating_avg),
    groupRatingCount: toNonNegativeInt(row.group_rating_count),
  };
}

function mapFallbackRow(row: FallbackGroupRow): GroupRatingSnapshot {
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
    membersCount: 0,
    groupMembersCount: 0,
    groupRatingAvg: null,
    groupRatingCount: 0,
  };
}

async function fetchFallbackSnapshots(cleanedIds: string[]): Promise<GroupRatingSnapshot[]> {
  let fullQuery = supabase
    .from("groups")
    .select("id,title,city,capacity,created_at,game,game_slug,category,lat,lng,host_id,creator_id,requires_verification_level")
    .order("created_at", { ascending: false });
  if (cleanedIds.length > 0) fullQuery = fullQuery.in("id", cleanedIds);

  const full = await fullQuery;
  if (!full.error) {
    return ((full.data || []) as FallbackGroupRow[]).map(mapFallbackRow);
  }

  if (!hasColumnError(full.error)) throw full.error;

  let fallbackQuery = supabase
    .from("groups")
    .select("id,title,city,capacity,created_at,game,category,lat,lng,host_id,creator_id,requires_verification_level")
    .order("created_at", { ascending: false });
  if (cleanedIds.length > 0) fallbackQuery = fallbackQuery.in("id", cleanedIds);

  const fallback = await fallbackQuery;
  if (!fallback.error) {
    return ((fallback.data || []) as FallbackGroupRow[]).map((row) =>
      mapFallbackRow({ ...row, game_slug: null })
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

  return ((minimal.data || []) as FallbackGroupRow[]).map((row) =>
    mapFallbackRow({
      ...row,
      game_slug: null,
      lat: null,
      lng: null,
      host_id: null,
      creator_id: null,
      requires_verification_level: 1,
    })
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

  if (membersCount < 3) {
    return { kind: "new", label: "New" };
  }

  const avg = toNumber(input.groupRatingAvg) ?? 0;
  const scoreText = avg.toFixed(1);

  if (ratingCount < 10) {
    return {
      kind: "low_confidence",
      scoreText,
      confidenceLabel: "beta",
    };
  }

  return {
    kind: "rated",
    scoreText,
    ratingCount,
  };
}
