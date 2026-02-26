import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronDown, Filter, Loader2, MapPin } from "lucide-react";
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

  const tokens = [group.game, group.game_slug].filter(Boolean) as string[];
  const tokenSlugs = tokens.map((token) => slugify(token));
  const tokenLoose = tokens.map((token) => normalizeLoose(token));

  if (targetSlug && tokenSlugs.includes(targetSlug)) return true;
  if (targetLoose && tokenLoose.includes(targetLoose)) return true;

  if (!meta) return false;

  const metaTokens = [meta.id, meta.name];
  const metaSlugs = metaTokens.map((token) => slugify(token));
  const metaLoose = metaTokens.map((token) => normalizeLoose(token));

  if (tokenSlugs.some((token) => metaSlugs.includes(token)) || tokenLoose.some((token) => metaLoose.includes(token))) {
    return true;
  }

  // Legacy fallback: older rows may miss `game` but still include activity in title.
  const titleLoose = normalizeLoose(group.title);
  const metaNameLoose = normalizeLoose(meta.name);
  const metaIdLoose = normalizeLoose(meta.id);
  if (!titleLoose) return false;
  return (!!metaNameLoose && titleLoose.includes(metaNameLoose)) || (!!metaIdLoose && titleLoose.includes(metaIdLoose));
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
  const [filterOpen, setFilterOpen] = useState(false);
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
          .gte("starts_at", new Date().toISOString())
          .order("starts_at", { ascending: true })
          .limit(1200),
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
      ((eventsRes.data || []) as GroupEventRow[]).forEach((row) => {
        const gid = String(row.group_id || "");
        if (!gid) return;
        upcomingCountMap[gid] = (upcomingCountMap[gid] || 0) + 1;
        if (!nextEventMap[gid]) nextEventMap[gid] = row;
      });

      const nowTs = Date.now();
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
      setOpenPollByGroup(pollMap);
      setRecentReadsByGroup(readsMap);
    } catch (loadErr: any) {
      console.error("[activity] failed to load groups", loadErr);
      setError(loadErr?.message || "Could not load this activity yet.");
      setRows([]);
      setMemberCountByGroup({});
      setNextEventByGroup({});
      setUpcomingCountByGroup({});
      setOpenPollByGroup({});
      setRecentReadsByGroup({});
    } finally {
      setLoading(false);
    }
  }, [activityMeta, activitySlug]);

  useEffect(() => {
    void loadActivityGroups();
  }, [loadActivityGroups]);

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

  const filterLabel = sortBy === DEFAULT_SORT ? "Filter" : `Filter · ${activeSortLabel}`;

  return (
    <>
      <main className="mx-auto w-full max-w-4xl px-4 pb-28 pt-5">
        <header className="mb-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <Link
            to="/browse"
            className="inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to browse
          </Link>

          <h1 className="mt-3 text-2xl font-black tracking-tight text-neutral-900">
            {displayEmoji ? `${displayEmoji} ` : ""}
            {displayName}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            {cards.length} group{cards.length === 1 ? "" : "s"} · {totalMembers} member
            {totalMembers === 1 ? "" : "s"}
            {totalUpcomingMeetups > 0 ? ` · ${totalUpcomingMeetups} meetup${totalUpcomingMeetups === 1 ? "" : "s"} coming up` : ""}
          </p>

          {error && (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {error}
            </div>
          )}

          <div ref={filterPanelRef} className="relative mt-4">
            <button
              type="button"
              onClick={() => setFilterOpen((open) => !open)}
              className="inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-50"
            >
              <Filter className="h-4 w-4" />
              {filterLabel}
              <ChevronDown className="h-4 w-4" />
            </button>

            {!isMobile && filterOpen && (
              <div className="absolute left-0 top-[calc(100%+8px)] z-40 w-72 rounded-2xl border border-neutral-200 bg-white p-2 shadow-xl">
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
                      className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                        active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"
                      }`}
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
                  className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2 text-left text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  Reset to default
                </button>
              </div>
            )}
          </div>
        </header>

        <section>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-28 animate-pulse rounded-2xl border border-neutral-200 bg-neutral-100" />
              ))}
              <div className="inline-flex items-center gap-2 text-xs text-neutral-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading groups for this activity...
              </div>
            </div>
          ) : cards.length === 0 ? (
            <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-6 text-sm text-neutral-600">
              No groups in this activity yet.
            </div>
          ) : (
            <ul className="space-y-3">
              {cards.map((card) => {
                const isFull = typeof card.capacity === "number" && card.memberCount >= card.capacity;
                const memberLine =
                  typeof card.capacity === "number"
                    ? `${card.memberCount}/${card.capacity} members`
                    : `${card.memberCount} members`;

                let statusText = "No meetup yet";
                let statusTone = "text-neutral-600";
                if (card.nextMeetup?.starts_at) {
                  statusText = `Meetup scheduled · ${formatMeetupDate(card.nextMeetup.starts_at)}`;
                  statusTone = "text-emerald-700";
                } else if (card.hasOpenPoll) {
                  statusText = "Poll open · planning";
                  statusTone = "text-amber-700";
                }

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
                    className="cursor-pointer rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-neutral-300"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h2 className="truncate text-base font-bold text-neutral-900">{card.title}</h2>
                          <GroupRatingBadge
                            groupMembersCount={card.groupMembersCount}
                            groupRatingAvg={card.groupRatingAvg}
                            groupRatingCount={card.groupRatingCount}
                            className="shrink-0"
                          />
                        </div>

                        <p className="mt-1 flex items-center gap-1 text-xs text-neutral-600">
                          <MapPin className="h-3.5 w-3.5" />
                          {card.city || "City TBD"}
                          {typeof card.distanceKm === "number" ? ` · ${formatDistanceKm(card.distanceKm)} away` : ""}
                        </p>

                        <p className="mt-1 text-xs text-neutral-600">{memberLine}</p>

                        <p className={`mt-2 text-xs font-semibold ${statusTone}`}>
                          {statusText}
                          {card.nextMeetup?.place ? ` · ${card.nextMeetup.place}` : ""}
                        </p>
                      </div>

                      <div
                        className="shrink-0"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        {card.isJoined ? (
                          <Link
                            to={`/group/${card.id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                          >
                            Joined
                          </Link>
                        ) : isFull ? (
                          <Link
                            to={`/group/${card.id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
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
                            className="rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-neutral-800 disabled:opacity-60"
                          >
                            {joiningId === card.id
                              ? "Joining..."
                              : joinedCount >= MAX_GROUPS
                                ? "Limit reached"
                                : "Join"}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      {isMobile && filterOpen && (
        <div className="fixed inset-0 z-[120]">
          <button
            type="button"
            onClick={() => setFilterOpen(false)}
            className="absolute inset-0 bg-black/45"
            aria-label="Close activity filter"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border border-neutral-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-neutral-200" />
            <div className="text-sm font-semibold text-neutral-900">Sort groups by</div>
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
                    className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                      active ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700"
                    }`}
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
              className="mt-3 w-full rounded-xl border border-neutral-200 px-3 py-2 text-left text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </>
  );
}
