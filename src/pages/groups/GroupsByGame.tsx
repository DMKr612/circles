import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, ChevronDown, Filter, Loader2, MapPin, Share2, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { checkGroupJoinBlock, joinBlockMessage } from "@/lib/ratings";
import { formatDistanceKm, haversineKm, type LatLng } from "@/lib/location";
import { GAME_LIST } from "@/lib/constants";
import { useAuth } from "@/App";
import { GroupRatingBadge } from "@/components/GroupRatingBadge";
import { fetchGroupRatingSnapshots } from "@/lib/groupRatings";

type ActivitySort =
  | "newest_groups"
  | "nearest_groups"
  | "upcoming_meetups"
  | "most_members"
  | "highest_rated"
  | "most_active";

type LocationMode = "gps" | "profile_city";

type ProfileLocation = {
  city: string | null;
  lat: number | null;
  lng: number | null;
  location_updated_at: string | null;
  location_source: "gps" | "manual" | null;
};

type ActivityCatalogItem = {
  id: string;
  name: string;
  category: string | null;
  emoji: string | null;
  slug: string;
};

type GroupRow = {
  id: string;
  title: string | null;
  city: string | null;
  capacity: number | null;
  created_at: string;
  game: string | null;
  game_slug: string | null;
  category: string | null;
  lat: number | null;
  lng: number | null;
  requires_verification_level: number | null;
  members_count: number;
  group_members_count: number;
  group_rating_avg: number | null;
  group_rating_count: number;
};

type GroupEventRow = {
  group_id: string;
  title: string | null;
  starts_at: string | null;
  place: string | null;
};

type GroupPollRow = {
  group_id: string;
  status: string | null;
  closes_at: string | null;
};

type GroupReadRow = {
  group_id: string;
};

type GroupCard = {
  id: string;
  title: string;
  city: string | null;
  distanceKm: number | null;
  cityRank: number;
  memberCount: number;
  capacity: number | null;
  isJoined: boolean;
  requiresVerificationLevel: number;
  hasOpenPoll: boolean;
  nextMeetup: GroupEventRow | null;
  upcomingMeetups: number;
  pastMeetups: number;
  createdTs: number;
  activeScore: number;
  groupMembersCount: number;
  groupRatingAvg: number | null;
  groupRatingCount: number;
};

const MAX_GROUPS = 7;
const LOCATION_MODE_KEY = "circles.browse.location_mode.v1";
const DEFAULT_SORT: ActivitySort = "most_active";

const SORT_OPTIONS: Array<{ key: ActivitySort; label: string }> = [
  { key: "newest_groups", label: "Newest groups" },
  { key: "nearest_groups", label: "Nearest groups" },
  { key: "upcoming_meetups", label: "Upcoming meetups (soonest)" },
  { key: "most_members", label: "Most members" },
  { key: "highest_rated", label: "Highest rated" },
  { key: "most_active", label: "Most active" },
];

function normalizeCity(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function normalizeLoose(value: string | null | undefined): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function slugify(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function toTitleCase(value: string): string {
  const cleaned = value.replace(/[-_]+/g, " ").trim();
  if (!cleaned) return "Activity";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function cityDistanceRank(city: string | null, userCity: string | null): number {
  if (!userCity) return 1;
  if (!city) return 2;
  return normalizeCity(city) === normalizeCity(userCity) ? 0 : 1;
}

function formatMeetupDate(iso: string | null): string {
  if (!iso) return "Date TBD";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Date TBD";
  const day = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

function hasColumnError(error: any): boolean {
  return String(error?.code || "") === "42703";
}

function isActiveMemberStatus(status: string | null | undefined): boolean {
  const normalized = String(status || "").toLowerCase();
  return !normalized || normalized === "active" || normalized === "accepted";
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(max-width: 767px)");
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

function readSavedLocationMode(): LocationMode {
  try {
    const raw = localStorage.getItem(LOCATION_MODE_KEY);
    return raw === "profile_city" ? "profile_city" : "gps";
  } catch {
    return "gps";
  }
}

async function fetchProfileLocation(userId: string): Promise<ProfileLocation> {
  const full = await supabase
    .from("profiles")
    .select("city, lat, lng, location_updated_at, location_source")
    .eq("user_id", userId)
    .maybeSingle();

  if (!full.error) {
    const row = (full.data ?? null) as
      | {
          city?: string | null;
          lat?: number | null;
          lng?: number | null;
          location_updated_at?: string | null;
          location_source?: "gps" | "manual" | null;
        }
      | null;

    return {
      city: row?.city || null,
      lat: typeof row?.lat === "number" ? row.lat : null,
      lng: typeof row?.lng === "number" ? row.lng : null,
      location_updated_at: row?.location_updated_at || null,
      location_source: row?.location_source || null,
    };
  }

  if (!hasColumnError(full.error)) throw full.error;

  const fallback = await supabase.from("profiles").select("city").eq("user_id", userId).maybeSingle();
  if (fallback.error) throw fallback.error;
  const row = (fallback.data ?? null) as { city?: string | null } | null;

  return {
    city: row?.city || null,
    lat: null,
    lng: null,
    location_updated_at: null,
    location_source: null,
  };
}

function matchesActivity(group: GroupRow, routeSlug: string, meta: ActivityCatalogItem | null): boolean {
  const targetSlug = slugify(routeSlug);
  const targetLoose = normalizeLoose(routeSlug);

  const tokens = [group.game, group.game_slug, group.category].filter(Boolean) as string[];
  const tokenSlugs = tokens.map((token) => slugify(token));
  const tokenLoose = tokens.map((token) => normalizeLoose(token));

  if (targetSlug && tokenSlugs.includes(targetSlug)) return true;
  if (targetLoose && tokenLoose.includes(targetLoose)) return true;

  const titleLoose = normalizeLoose(group.title);
  if (!meta) {
    if (targetLoose && titleLoose && titleLoose.includes(targetLoose)) return true;
    // Legacy "activity" bucket: include groups with no activity/category classification.
    if (
      targetSlug === "activity" &&
      !normalizeLoose(group.game) &&
      !normalizeLoose(group.game_slug) &&
      !normalizeLoose(group.category)
    ) {
      return true;
    }
    return false;
  }

  const metaTokens = [meta.id, meta.name, meta.category];
  const metaSlugs = metaTokens.map((token) => slugify(token));
  const metaLoose = metaTokens.map((token) => normalizeLoose(token));

  if (tokenSlugs.some((token) => metaSlugs.includes(token)) || tokenLoose.some((token) => metaLoose.includes(token))) {
    return true;
  }

  // Legacy fallback: older rows may miss `game` but still include activity in title.
  const metaNameLoose = normalizeLoose(meta.name);
  const metaIdLoose = normalizeLoose(meta.id);
  const metaCategoryLoose = normalizeLoose(meta.category);
  if (!titleLoose) return false;
  return (
    (!!metaNameLoose && titleLoose.includes(metaNameLoose)) ||
    (!!metaIdLoose && titleLoose.includes(metaIdLoose)) ||
    (!!metaCategoryLoose && titleLoose.includes(metaCategoryLoose))
  );
}

function sortGroupCards(cards: GroupCard[], sortBy: ActivitySort): GroupCard[] {
  const rows = [...cards];

  rows.sort((a, b) => {
    if (sortBy === "newest_groups") {
      if (b.createdTs !== a.createdTs) return b.createdTs - a.createdTs;
      return a.title.localeCompare(b.title);
    }

    if (sortBy === "nearest_groups") {
      const aDist = a.distanceKm ?? Number.POSITIVE_INFINITY;
      const bDist = b.distanceKm ?? Number.POSITIVE_INFINITY;
      if (aDist !== bDist) return aDist - bDist;
      if (a.cityRank !== b.cityRank) return a.cityRank - b.cityRank;
      return a.title.localeCompare(b.title);
    }

    if (sortBy === "upcoming_meetups") {
      const aTs = a.nextMeetup?.starts_at ? new Date(a.nextMeetup.starts_at).getTime() : Number.POSITIVE_INFINITY;
      const bTs = b.nextMeetup?.starts_at ? new Date(b.nextMeetup.starts_at).getTime() : Number.POSITIVE_INFINITY;
      if (aTs !== bTs) return aTs - bTs;
      if (b.upcomingMeetups !== a.upcomingMeetups) return b.upcomingMeetups - a.upcomingMeetups;
      return a.title.localeCompare(b.title);
    }

    if (sortBy === "most_members") {
      if (b.memberCount !== a.memberCount) return b.memberCount - a.memberCount;
      return a.title.localeCompare(b.title);
    }

    if (sortBy === "highest_rated") {
      const aRated = a.groupMembersCount >= 3 && a.groupRatingCount >= 2 && typeof a.groupRatingAvg === "number";
      const bRated = b.groupMembersCount >= 3 && b.groupRatingCount >= 2 && typeof b.groupRatingAvg === "number";
      if (aRated !== bRated) return aRated ? -1 : 1;
      if (aRated && bRated) {
        const aScore = Number(a.groupRatingAvg || 0);
        const bScore = Number(b.groupRatingAvg || 0);
        if (bScore !== aScore) return bScore - aScore;
        if (b.groupRatingCount !== a.groupRatingCount) return b.groupRatingCount - a.groupRatingCount;
      }
      if (b.memberCount !== a.memberCount) return b.memberCount - a.memberCount;
      return a.title.localeCompare(b.title);
    }

    if (b.activeScore !== a.activeScore) return b.activeScore - a.activeScore;
    if (b.upcomingMeetups !== a.upcomingMeetups) return b.upcomingMeetups - a.upcomingMeetups;
    return a.title.localeCompare(b.title);
  });

  return rows;
}

export default function GroupsByGame() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id || null;
  const isMobile = useIsMobile();

  const { activity, game } = useParams();
  const routeToken = (activity || game || "").trim();
  const activitySlug = slugify(routeToken) || "activity";

  const [catalog, setCatalog] = useState<ActivityCatalogItem[]>(() =>
    GAME_LIST.map((entry) => ({
      id: entry.id,
      name: entry.name,
      category: entry.tag || null,
      emoji: entry.image || null,
      slug: slugify(entry.id || entry.name),
    }))
  );

  const activityMeta = useMemo(() => {
    const bySlug = catalog.find((entry) => entry.slug === activitySlug);
    if (bySlug) return bySlug;
    const byLoose = catalog.find(
      (entry) =>
        normalizeLoose(entry.id) === normalizeLoose(routeToken) ||
        normalizeLoose(entry.name) === normalizeLoose(routeToken)
    );
    return byLoose || null;
  }, [activitySlug, catalog, routeToken]);

  const displayName = activityMeta?.name || toTitleCase(routeToken || "Activity");
  const displayEmoji = activityMeta?.emoji || null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<GroupRow[]>([]);

  const [memberCountByGroup, setMemberCountByGroup] = useState<Record<string, number>>({});
  const [nextEventByGroup, setNextEventByGroup] = useState<Record<string, GroupEventRow>>({});
  const [upcomingCountByGroup, setUpcomingCountByGroup] = useState<Record<string, number>>({});
  const [pastMeetupCountByGroup, setPastMeetupCountByGroup] = useState<Record<string, number>>({});
  const [openPollByGroup, setOpenPollByGroup] = useState<Record<string, boolean>>({});
  const [recentReadsByGroup, setRecentReadsByGroup] = useState<Record<string, number>>({});

  const [joinedGroupIds, setJoinedGroupIds] = useState<Set<string>>(new Set());
  const [joinedCount, setJoinedCount] = useState(0);
  const [myVerificationLevel, setMyVerificationLevel] = useState(1);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const [profileLocation, setProfileLocation] = useState<ProfileLocation>({
    city: null,
    lat: null,
    lng: null,
    location_updated_at: null,
    location_source: null,
  });
  const [locationMode] = useState<LocationMode>(() => readSavedLocationMode());
  const [gpsCoords, setGpsCoords] = useState<LatLng | null>(null);

  const [sortBy, setSortBy] = useState<ActivitySort>(DEFAULT_SORT);
  const [nearMeOnly, setNearMeOnly] = useState(false);
  const [hasSpaceOnly, setHasSpaceOnly] = useState(false);
  const [thisWeekOnly, setThisWeekOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const filterPanelRef = useRef<HTMLDivElement | null>(null);

  const profileCoords = useMemo<LatLng | null>(() => {
    if (typeof profileLocation.lat === "number" && typeof profileLocation.lng === "number") {
      return { lat: profileLocation.lat, lng: profileLocation.lng };
    }
    return null;
  }, [profileLocation.lat, profileLocation.lng]);

  const activeCoords = useMemo<LatLng | null>(() => {
    if (locationMode === "gps") return gpsCoords || profileCoords || null;
    return profileCoords || null;
  }, [gpsCoords, locationMode, profileCoords]);

  const activeSortLabel = useMemo(
    () => SORT_OPTIONS.find((option) => option.key === sortBy)?.label || "Most active",
    [sortBy]
  );

  useEffect(() => {
    if (isMobile) return;

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (filterPanelRef.current && !filterPanelRef.current.contains(target)) {
        setFilterOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isMobile]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const fallback = GAME_LIST.map((entry) => ({
        id: entry.id,
        name: entry.name,
        category: entry.tag || null,
        emoji: entry.image || null,
        slug: slugify(entry.id || entry.name),
      }));

      try {
        const { data, error: fetchError } = await supabase
          .from("allowed_games")
          .select("id, name, category")
          .eq("is_active", true)
          .order("name", { ascending: true });

        if (!mounted) return;
        if (fetchError || !data || data.length === 0) {
          setCatalog(fallback);
          return;
        }

        const emojiById = new Map(
          GAME_LIST.map((entry) => [normalizeLoose(entry.id), entry.image || null] as const)
        );

        const rows = (data as Array<{ id: string; name: string; category: string | null }>)
          .map((item) => {
            const id = String(item.id || "").trim();
            if (!id) return null;
            return {
              id,
              name: String(item.name || id),
              category: item.category || null,
              emoji: emojiById.get(normalizeLoose(id)) || null,
              slug: slugify(id),
            } as ActivityCatalogItem;
          })
          .filter(Boolean) as ActivityCatalogItem[];

        setCatalog(rows.length ? rows : fallback);
      } catch (catalogError) {
        console.warn("[activity] failed to load activity catalog", catalogError);
        if (!mounted) return;
        setCatalog(fallback);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!userId) {
        setJoinedGroupIds(new Set());
        setJoinedCount(0);
        setMyVerificationLevel(1);
        setProfileLocation({
          city: null,
          lat: null,
          lng: null,
          location_updated_at: null,
          location_source: null,
        });
        return;
      }

      try {
        const [profileRes, membershipsRes, profileLocationRes] = await Promise.all([
          supabase.from("profiles").select("verification_level").eq("user_id", userId).maybeSingle(),
          supabase
            .from("group_members")
            .select("group_id,status", { count: "exact" })
            .eq("user_id", userId)
            .in("status", ["active", "accepted"]),
          fetchProfileLocation(userId),
        ]);

        if (!active) return;

        setMyVerificationLevel(profileRes.data?.verification_level ?? 1);

        const ids = new Set(
          ((membershipsRes.data || []) as Array<{ group_id: string | null; status: string | null }>)
            .filter((item) => !!item.group_id && isActiveMemberStatus(item.status))
            .map((item) => String(item.group_id))
        );
        setJoinedGroupIds(ids);
        setJoinedCount(membershipsRes.count ?? ids.size);

        setProfileLocation(profileLocationRes);
      } catch (bootstrapError) {
        if (!active) return;
        console.warn("[activity] failed to load user context", bootstrapError);
        setMyVerificationLevel(1);
        setJoinedGroupIds(new Set());
        setJoinedCount(0);
      }
    })();

    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (locationMode !== "gps") return;
    if (!("geolocation" in navigator)) return;

    let cancelled = false;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return;
        setGpsCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        if (cancelled) return;
        setGpsCoords(null);
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 5 * 60 * 1000,
      }
    );

    return () => {
      cancelled = true;
    };
  }, [locationMode]);

  const loadActivityGroups = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const snapshots = (await fetchGroupRatingSnapshots()).slice(0, 520);
      const groupsData: GroupRow[] = snapshots.map((row) => ({
        id: row.groupId,
        title: row.groupTitle,
        city: row.groupCity,
        capacity: row.capacity,
        created_at: row.createdAt || new Date(0).toISOString(),
        game: row.game,
        game_slug: row.gameSlug,
        category: row.category,
        lat: row.lat,
        lng: row.lng,
        requires_verification_level: row.requiresVerificationLevel,
        members_count: row.membersCount,
        group_members_count: row.groupMembersCount,
        group_rating_avg: row.groupRatingAvg,
        group_rating_count: row.groupRatingCount,
      }));

      const filteredGroups = groupsData.filter((group) => matchesActivity(group, activitySlug, activityMeta));
      setRows(filteredGroups);

      const groupIds = filteredGroups.map((group) => group.id).filter(Boolean);
      if (groupIds.length === 0) {
        setMemberCountByGroup({});
        setNextEventByGroup({});
        setUpcomingCountByGroup({});
        setPastMeetupCountByGroup({});
        setOpenPollByGroup({});
        setRecentReadsByGroup({});
        setLoading(false);
        return;
      }

      const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [eventsRes, pollsRes, readsRes] = await Promise.all([
        supabase
          .from("group_events")
          .select("group_id,title,starts_at,place")
          .in("group_id", groupIds)
          .not("starts_at", "is", null)
          .order("starts_at", { ascending: true })
          .limit(2200),
        supabase
          .from("group_polls")
          .select("group_id,status,closes_at")
          .in("group_id", groupIds)
          .eq("status", "open")
          .limit(1200),
        supabase
          .from("group_reads")
          .select("group_id")
          .in("group_id", groupIds)
          .gt("last_read_at", sinceIso)
          .limit(2000),
      ]);

      if (eventsRes.error) throw eventsRes.error;
      if (pollsRes.error) throw pollsRes.error;
      if (readsRes.error) throw readsRes.error;

      const membersMap: Record<string, number> = {};
      filteredGroups.forEach((row) => {
        const gid = String(row.id || "");
        if (!gid) return;
        membersMap[gid] = Math.max(0, Number(row.members_count || 0));
      });

      const nextEventMap: Record<string, GroupEventRow> = {};
      const upcomingCountMap: Record<string, number> = {};
      const pastMeetupCountMap: Record<string, number> = {};
      const nowTs = Date.now();
      ((eventsRes.data || []) as GroupEventRow[]).forEach((row) => {
        const gid = String(row.group_id || "");
        if (!gid) return;
        const ts = new Date(row.starts_at || "").getTime();
        if (!Number.isFinite(ts)) return;
        if (ts >= nowTs) {
          upcomingCountMap[gid] = (upcomingCountMap[gid] || 0) + 1;
          if (!nextEventMap[gid]) nextEventMap[gid] = row;
        } else {
          pastMeetupCountMap[gid] = (pastMeetupCountMap[gid] || 0) + 1;
        }
      });

      const pollMap: Record<string, boolean> = {};
      ((pollsRes.data || []) as GroupPollRow[]).forEach((row) => {
        const gid = String(row.group_id || "");
        if (!gid) return;
        const closesAt = row.closes_at ? new Date(row.closes_at).getTime() : null;
        if (Number.isFinite(closesAt as number) && (closesAt as number) < nowTs) return;
        pollMap[gid] = true;
      });

      const readsMap: Record<string, number> = {};
      ((readsRes.data || []) as GroupReadRow[]).forEach((row) => {
        const gid = String(row.group_id || "");
        if (!gid) return;
        readsMap[gid] = (readsMap[gid] || 0) + 1;
      });

      setMemberCountByGroup(membersMap);
      setNextEventByGroup(nextEventMap);
      setUpcomingCountByGroup(upcomingCountMap);
      setPastMeetupCountByGroup(pastMeetupCountMap);
      setOpenPollByGroup(pollMap);
      setRecentReadsByGroup(readsMap);
    } catch (loadErr: any) {
      console.error("[activity] failed to load groups", loadErr);
      setError(loadErr?.message || "Could not load this activity yet.");
      setRows([]);
      setMemberCountByGroup({});
      setNextEventByGroup({});
      setUpcomingCountByGroup({});
      setPastMeetupCountByGroup({});
      setOpenPollByGroup({});
      setRecentReadsByGroup({});
    } finally {
      setLoading(false);
    }
  }, [activityMeta, activitySlug]);

  useEffect(() => {
    void loadActivityGroups();
  }, [loadActivityGroups, refreshTick]);

  useEffect(() => {
    let timer: number | null = null;
    const queueRefresh = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setRefreshTick((value) => value + 1);
      }, 350);
    };

    const channel = supabase
      .channel(`groups-by-game-live:${activitySlug}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_members" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_events" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "group_polls" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, queueRefresh)
      .subscribe();

    return () => {
      if (timer != null) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [activitySlug]);

  useEffect(() => {
    const triggerRefresh = () => setRefreshTick((value) => value + 1);
    const onFocus = () => triggerRefresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") triggerRefresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(triggerRefresh, 45_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, []);

  const openGroup = useCallback(
    (groupId: string) => {
      navigate(`/group/${groupId}`);
    },
    [navigate]
  );

  async function joinGroup(card: GroupCard) {
    if (!userId) {
      setError("Sign in required.");
      return;
    }

    if (joinedCount >= MAX_GROUPS) {
      setError("You can only be in 7 circles at a time. Leave one to join another.");
      return;
    }

    if (myVerificationLevel < card.requiresVerificationLevel) {
      setError("This circle is for verified members only. Increase your verification level to join.");
      return;
    }

    const blockReason = await checkGroupJoinBlock(userId, card.id);
    if (blockReason) {
      const message = joinBlockMessage(blockReason);
      window.alert(message);
      setError(message);
      return;
    }

    setJoiningId(card.id);
    const { error: joinError } = await supabase.from("group_members").insert({
      group_id: card.id,
      user_id: userId,
      role: "member",
      status: "active",
      last_joined_at: new Date().toISOString(),
    });
    setJoiningId(null);

    if (!joinError || joinError.code === "23505") {
      const alreadyJoined = joinedGroupIds.has(card.id);
      if (!alreadyJoined) {
        setJoinedGroupIds((prev) => {
          const next = new Set(prev);
          next.add(card.id);
          return next;
        });
        setJoinedCount((value) => Math.min(MAX_GROUPS, value + 1));
        setMemberCountByGroup((prev) => ({
          ...prev,
          [card.id]: (prev[card.id] || 0) + 1,
        }));
      }
      return;
    }

    const text = String(joinError.message || "").toLowerCase();
    if (text.includes("group_join_limit")) {
      setError("You can only be in 7 circles at a time. Leave one to join another.");
      return;
    }
    if (text.includes("verification")) {
      setError("This circle is for verified members only.");
      return;
    }

    setError(joinError.message || "Could not join this circle right now.");
  }

  const cards = useMemo(() => {
    const list: GroupCard[] = rows.map((group) => {
      const groupId = group.id;
      const distanceKm =
        activeCoords && typeof group.lat === "number" && typeof group.lng === "number"
          ? haversineKm(activeCoords, { lat: group.lat, lng: group.lng })
          : null;

      const memberCount = memberCountByGroup[groupId] || 0;
      const nextMeetup = nextEventByGroup[groupId] || null;
      const upcomingMeetups = upcomingCountByGroup[groupId] || 0;
      const pastMeetups = pastMeetupCountByGroup[groupId] || 0;
      const hasOpenPoll = !!openPollByGroup[groupId];
      const recentReads = recentReadsByGroup[groupId] || 0;
      const createdTs = new Date(group.created_at || "").getTime();

      const activeScore =
        recentReads * 2 +
        upcomingMeetups * 3 +
        (hasOpenPoll ? 2 : 0) +
        Math.min(memberCount, 20) * 0.7;

      return {
        id: groupId,
        title: (group.title || "Untitled circle").trim(),
        city: group.city || null,
        distanceKm,
        cityRank: cityDistanceRank(group.city, profileLocation.city),
        memberCount,
        capacity: typeof group.capacity === "number" ? group.capacity : null,
        isJoined: joinedGroupIds.has(groupId),
        requiresVerificationLevel: Number(group.requires_verification_level ?? 1),
        hasOpenPoll,
        nextMeetup,
        upcomingMeetups,
        pastMeetups,
        createdTs: Number.isFinite(createdTs) ? createdTs : 0,
        activeScore,
        groupMembersCount: Math.max(0, Number(group.group_members_count || memberCount)),
        groupRatingAvg:
          typeof group.group_rating_avg === "number" && Number.isFinite(group.group_rating_avg)
            ? group.group_rating_avg
            : null,
        groupRatingCount: Math.max(0, Number(group.group_rating_count || 0)),
      };
    });

    return sortGroupCards(list, sortBy);
  }, [
    activeCoords,
    joinedGroupIds,
    memberCountByGroup,
    nextEventByGroup,
    openPollByGroup,
    pastMeetupCountByGroup,
    profileLocation.city,
    recentReadsByGroup,
    rows,
    sortBy,
    upcomingCountByGroup,
  ]);

  const totalMembers = useMemo(
    () => cards.reduce((sum, card) => sum + card.memberCount, 0),
    [cards]
  );

  const totalUpcomingMeetups = useMemo(
    () => cards.reduce((sum, card) => sum + card.upcomingMeetups, 0),
    [cards]
  );

  const visibleCards = useMemo(() => {
    const now = Date.now();
    const weekCutoff = now + 7 * 24 * 60 * 60 * 1000;
    return cards.filter((card) => {
      if (nearMeOnly) {
        const nearByDistance = typeof card.distanceKm === "number" && card.distanceKm <= 30;
        const nearByCity = card.cityRank === 0;
        if (!nearByDistance && !nearByCity) return false;
      }
      if (hasSpaceOnly && typeof card.capacity === "number" && card.memberCount >= card.capacity) return false;
      if (thisWeekOnly) {
        const meetupTs = card.nextMeetup?.starts_at ? new Date(card.nextMeetup.starts_at).getTime() : Number.NaN;
        if (!Number.isFinite(meetupTs) || meetupTs > weekCutoff || meetupTs < now) return false;
      }
      return true;
    });
  }, [cards, hasSpaceOnly, nearMeOnly, thisWeekOnly]);

  const heroRating = useMemo(() => {
    const rated = cards.filter((card) => card.groupRatingCount >= 2 && typeof card.groupRatingAvg === "number");
    if (rated.length === 0) return null;
    const sum = rated.reduce((acc, row) => acc + Number(row.groupRatingAvg || 0), 0);
    return sum / rated.length;
  }, [cards]);

  const nextMeetupLabel = useMemo(() => {
    const next = cards
      .map((card) => card.nextMeetup?.starts_at || null)
      .filter(Boolean)
      .map((iso) => new Date(String(iso)).getTime())
      .filter((ts) => Number.isFinite(ts))
      .sort((a, b) => a - b)[0];
    if (!next) return null;
    return formatMeetupDate(new Date(next).toISOString());
  }, [cards]);

  const activeTonight = useMemo(() => {
    const now = Date.now();
    const tonight = now + 24 * 60 * 60 * 1000;
    return cards.some((card) => {
      const ts = card.nextMeetup?.starts_at ? new Date(card.nextMeetup.starts_at).getTime() : Number.NaN;
      return Number.isFinite(ts) && ts >= now && ts <= tonight;
    });
  }, [cards]);

  const [shareCopied, setShareCopied] = useState(false);

  const ratingBasisTotal = useMemo(
    () => cards.reduce((sum, card) => sum + Math.max(0, Number(card.groupRatingCount || 0)), 0),
    [cards]
  );

  const sharePage = useCallback(async () => {
    const shareUrl = typeof window !== "undefined" ? window.location.href : "";
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1400);
    } catch (error) {
      console.warn("[groups-by-game] share copy failed", error);
    }
  }, []);

  const filterLabel = sortBy === DEFAULT_SORT ? "Filter" : `Filter · ${activeSortLabel}`;

  return (
    <>
      <main className="relative min-h-screen overflow-hidden bg-[#f7faff] px-4 pb-28 pt-5 text-slate-900">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-blue-500/14 blur-3xl" />
          <div className="absolute right-0 top-0 h-80 w-80 rounded-full bg-emerald-500/12 blur-3xl" />
          <div className="absolute bottom-0 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-sky-500/12 blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(255,255,255,0.52),transparent_36%),radial-gradient(circle_at_80%_0%,rgba(219,234,254,0.55),transparent_34%)]" />
        </div>

        <div className="relative mx-auto w-full max-w-5xl">
          <header className="mb-5">
            <Link
              to="/browse"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-sm font-semibold text-slate-700 backdrop-blur hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to browse
            </Link>

            <div className="mt-4 rounded-[28px] border border-slate-200 bg-gradient-to-br from-white via-blue-50/50 to-emerald-50/45 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.12)] md:p-7">
              <div className="grid gap-6 md:grid-cols-[1fr_180px] md:items-start">
                <div>
                  <h1 className="text-4xl font-black tracking-tight text-slate-900 md:text-5xl">
                    {displayEmoji ? `${displayEmoji} ` : ""}
                    {displayName}
                  </h1>
                  <p className="mt-2 text-sm text-slate-600">
                    {(cards[0]?.city || "Freiburg im Breisgau")} · {activityMeta?.category || "Social circles"}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                      {cards.length} groups
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                      {totalMembers} members
                    </span>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      {activeTonight ? "Active tonight" : "Planning mode"}
                    </span>
                    {nextMeetupLabel && (
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                        Next: {nextMeetupLabel}
                      </span>
                    )}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                      to="/create"
                      className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-900/35 hover:brightness-110"
                    >
                      + Create a group
                    </Link>
                    <button
                      type="button"
                      onClick={() => void sharePage()}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Share2 className="h-4 w-4" />
                      {shareCopied ? "Copied" : "Share"}
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-center">
                  <div className="text-5xl font-black text-amber-600">{heroRating == null ? "—" : heroRating.toFixed(1)}</div>
                  <div className="mt-1 text-sm font-semibold text-amber-500">★★★★★★</div>
                  <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Avg. Rating</div>
                  <div className="mt-2 inline-flex rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
                    basis {ratingBasisTotal}
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                {error}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div ref={filterPanelRef} className="relative">
                <button
                  type="button"
                  onClick={() => setFilterOpen((open) => !open)}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Filter className="h-4 w-4" />
                  {filterLabel}
                  <ChevronDown className="h-4 w-4" />
                </button>

                {!isMobile && filterOpen && (
                  <div className="absolute left-0 top-[calc(100%+8px)] z-40 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
                    {SORT_OPTIONS.map((option) => {
                      const active = option.key === sortBy;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => {
                            setSortBy(option.key);
                            setFilterOpen(false);
                          }}
                          className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${active ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        setSortBy(DEFAULT_SORT);
                        setFilterOpen(false);
                      }}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Reset to default
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setNearMeOnly((value) => !value)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${nearMeOnly ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700"}`}
              >
                📍 Near me
              </button>
              <button
                type="button"
                onClick={() => setHasSpaceOnly((value) => !value)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${hasSpaceOnly ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700"}`}
              >
                👥 Has space
              </button>
              <button
                type="button"
                onClick={() => setThisWeekOnly((value) => !value)}
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${thisWeekOnly ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700"}`}
              >
                📅 This week
              </button>
              <span className="ml-auto text-xs font-semibold text-slate-500">{visibleCards.length} groups found</span>
            </div>
          </header>

          <section>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="h-36 animate-pulse rounded-3xl border border-slate-200 bg-slate-100" />
                ))}
                <div className="inline-flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading groups for this activity...
                </div>
              </div>
            ) : visibleCards.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
                No groups match these filters right now.
              </div>
            ) : (
              <ul className="space-y-4">
                {visibleCards.map((card) => {
                  const isFull = typeof card.capacity === "number" && card.memberCount >= card.capacity;
                  const memberLine =
                    typeof card.capacity === "number" ? `${card.memberCount} / ${card.capacity}` : `${card.memberCount}`;

                  const meetupInfo = card.nextMeetup?.starts_at ? formatMeetupDate(card.nextMeetup.starts_at) : "Not scheduled";
                  const meetupHint = card.hasOpenPoll ? "Vote open soon" : "No meetup yet";

                  return (
                    <li
                      key={card.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openGroup(card.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openGroup(card.id);
                        }
                      }}
                      aria-label={`Open ${card.title}`}
                      className="cursor-pointer rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_12px_35px_rgba(15,23,42,0.10)] transition hover:border-slate-300 hover:shadow-[0_18px_50px_rgba(15,23,42,0.14)]"
                    >
                      <div className="flex flex-col gap-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <h2 className="truncate text-3xl font-black tracking-tight text-slate-900">{card.title}</h2>
                            <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                              <MapPin className="h-3.5 w-3.5" />
                              {card.city || "City TBD"}
                              {typeof card.distanceKm === "number" ? ` · ${formatDistanceKm(card.distanceKm)} away` : ""}
                            </div>
                          </div>

                          <div
                            className="flex shrink-0 flex-col items-end gap-2"
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            <GroupRatingBadge
                              groupMembersCount={card.groupMembersCount}
                              groupRatingAvg={card.groupRatingAvg}
                              groupRatingCount={card.groupRatingCount}
                              className="shrink-0"
                            />
                            {card.isJoined ? (
                              <Link
                                to={`/group/${card.id}`}
                                onClick={(event) => event.stopPropagation()}
                                className="rounded-full border border-emerald-300 bg-emerald-50 px-4 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                              >
                                Joined
                              </Link>
                            ) : isFull ? (
                              <Link
                                to={`/group/${card.id}`}
                                onClick={(event) => event.stopPropagation()}
                                className="rounded-full border border-slate-300 bg-slate-50 px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
                              >
                                View
                              </Link>
                            ) : (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void joinGroup(card);
                                }}
                                disabled={joiningId === card.id || joinedCount >= MAX_GROUPS}
                                className="rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-60"
                              >
                                {joiningId === card.id ? "Joining..." : joinedCount >= MAX_GROUPS ? "Limit reached" : "Join"}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Members</div>
                            <div className="mt-1 text-xl font-black text-slate-900">{memberLine}</div>
                            <div className="text-xs text-slate-600">
                              {typeof card.capacity === "number" ? `${Math.max(card.capacity - card.memberCount, 0)} spots left` : "Open capacity"}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Next meetup</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">{meetupInfo}</div>
                            <div className="text-xs text-slate-600">{meetupHint}</div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Meetups held</div>
                            <div className="mt-1 text-xl font-black text-slate-900">{card.pastMeetups}</div>
                            <div className="text-xs text-slate-600">All time</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <Users className="h-3.5 w-3.5 text-slate-500" />
                            <span>{card.memberCount} members</span>
                          </div>
                          <div className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
                            <CalendarDays className="h-3.5 w-3.5" />
                            {card.nextMeetup?.starts_at ? "Meetup scheduled" : "No meetup yet"}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </main>

      {isMobile && filterOpen && (
        <div className="fixed inset-0 z-[120]">
          <button
            type="button"
            onClick={() => setFilterOpen(false)}
            className="absolute inset-0 bg-black/30"
            aria-label="Close activity filter"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border border-slate-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
            <div className="text-sm font-semibold text-slate-900">Sort groups by</div>
            <div className="mt-3 space-y-2">
              {SORT_OPTIONS.map((option) => {
                const active = option.key === sortBy;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => {
                      setSortBy(option.key);
                      setFilterOpen(false);
                    }}
                    className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${active ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-700"}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                setSortBy(DEFAULT_SORT);
                setFilterOpen(false);
              }}
              className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </>
  );
}
