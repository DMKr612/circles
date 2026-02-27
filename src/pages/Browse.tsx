import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, ChevronDown, Filter, Loader2, LocateFixed, MapPin, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { geocodePlace, reverseGeocodeCity } from "@/lib/geocode";
import { formatDistanceKm, haversineKm, isLocationStale, movedMoreThanMeters, type LatLng } from "@/lib/location";
import { GAME_LIST } from "@/lib/constants";
import { fetchGroupRatingSnapshots, type GroupRatingSnapshot } from "@/lib/groupRatings";
import "./Browse.css";

type LocationMode = "gps" | "profile_city";

type SortOption =
  | "most_active"
  | "most_members"
  | "most_groups"
  | "nearest"
  | "newest"
  | "upcoming";

type ProfileLocation = {
  city: string | null;
  lat: number | null;
  lng: number | null;
  location_updated_at: string | null;
  location_source: "gps" | "manual" | null;
};

type AllowedActivityRow = {
  id: string;
  name: string;
  category: string | null;
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
  category: string | null;
  lat: number | null;
  lng: number | null;
  distance_km?: number | null;
};

type RpcNearbyRow = {
  id: string;
  distance_km: number | null;
};

type GroupMemberRow = {
  group_id: string;
  status: string | null;
};

type GroupEventRow = {
  group_id: string;
  starts_at: string | null;
};

type GroupPollRow = {
  group_id: string;
  status: string | null;
  closes_at: string | null;
};

type ActivityBadge = "New" | "Hot" | "Planning" | null;

type ActivityCard = {
  key: string;
  slug: string;
  name: string;
  category: string | null;
  emoji: string | null;
  groupCount: number;
  memberTotal: number;
  meetupWeekCount: number;
  planningGroups: number;
  latestCreatedTs: number;
  nearestKm: number | null;
  cityRank: number;
  newGroups: number;
  activeScore: number;
  badge: ActivityBadge;
};

const DEFAULT_CITY = "Freiburg";
const DISCOVERY_RADIUS_KM = 120;
const GROUP_FETCH_LIMIT = 1200;
const LOCATION_MODE_KEY = "circles.browse.location_mode.v1";
const GEO_AUTO_PROMPT_KEY = "circles.geo.prompted.v1";
const DEFAULT_SORT: SortOption = "most_active";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

const SORT_OPTIONS: Array<{ key: SortOption; label: string }> = [
  { key: "most_active", label: "Most Active" },
  { key: "most_members", label: "Most Members" },
  { key: "most_groups", label: "Most Groups" },
  { key: "nearest", label: "Nearest" },
  { key: "newest", label: "Newest" },
  { key: "upcoming", label: "Upcoming Meetups" },
];

const GROUP_SELECT_FULL = "id,title,city,capacity,created_at,game,category,lat,lng";
const GROUP_SELECT_FALLBACK = "id,title,city,capacity,created_at,game,category";

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

function hasColumnError(error: any): boolean {
  return String(error?.code || "") === "42703";
}

function isActiveMemberStatus(status: string | null | undefined): boolean {
  const s = String(status || "").toLowerCase();
  return !s || s === "active" || s === "accepted";
}

function readSavedLocationMode(): LocationMode {
  try {
    const raw = localStorage.getItem(LOCATION_MODE_KEY);
    return raw === "profile_city" ? "profile_city" : "gps";
  } catch {
    return "gps";
  }
}

function persistLocationMode(mode: LocationMode) {
  try {
    localStorage.setItem(LOCATION_MODE_KEY, mode);
  } catch {
    // no-op
  }
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

function mapSnapshotToGroupRow(row: GroupRatingSnapshot): GroupRow {
  return {
    id: row.groupId,
    title: row.groupTitle,
    city: row.groupCity,
    capacity: row.capacity,
    created_at: row.createdAt || new Date(0).toISOString(),
    game: row.game,
    category: row.category,
    lat: row.lat,
    lng: row.lng,
    distance_km: null,
  };
}

async function queryGroupsByCity(city: string | null): Promise<GroupRow[]> {
  const rows = (await fetchGroupRatingSnapshots()).map(mapSnapshotToGroupRow);
  if (!city) return rows.slice(0, GROUP_FETCH_LIMIT);
  const target = normalizeCity(city);
  return rows
    .filter((row) => normalizeCity(row.city) === target)
    .slice(0, GROUP_FETCH_LIMIT);
}

async function queryRecentGroups(): Promise<GroupRow[]> {
  return (await fetchGroupRatingSnapshots()).map(mapSnapshotToGroupRow).slice(0, GROUP_FETCH_LIMIT);
}

async function queryGroupsByGps(coords: LatLng, radiusKm: number): Promise<GroupRow[]> {
  const rpc = await supabase.rpc("get_nearby_circles", {
    p_user_lat: coords.lat,
    p_user_lng: coords.lng,
    p_radius_km: radiusKm,
  });

  if (!rpc.error) {
    const nearby = (rpc.data || []) as RpcNearbyRow[];
    if (nearby.length === 0) return [];

    const ids = nearby.map((row) => String(row.id)).filter(Boolean);
    const distanceById = new Map<string, number>();
    nearby.forEach((row) => {
      const id = String(row.id || "");
      if (!id || typeof row.distance_km !== "number") return;
      distanceById.set(id, row.distance_km);
    });

    const rows = (await fetchGroupRatingSnapshots(ids)).map(mapSnapshotToGroupRow);
    return rows
      .map((row) => ({ ...row, distance_km: distanceById.get(row.id) ?? null }))
      .sort((a, b) => (a.distance_km ?? Number.POSITIVE_INFINITY) - (b.distance_km ?? Number.POSITIVE_INFINITY));
  }

  const fallback = await supabase
    .from("groups")
    .select(GROUP_SELECT_FULL)
    .not("lat", "is", null)
    .not("lng", "is", null)
    .order("created_at", { ascending: false })
    .limit(420);

  if (fallback.error && hasColumnError(fallback.error)) {
    return [];
  }
  if (fallback.error) throw fallback.error;

  return ((fallback.data || []) as GroupRow[])
    .map((row) => {
      if (typeof row.lat !== "number" || typeof row.lng !== "number") return null;
      const distanceKm = haversineKm(coords, { lat: row.lat, lng: row.lng });
      if (distanceKm > radiusKm) return null;
      return { ...row, distance_km: distanceKm };
    })
    .filter(Boolean) as GroupRow[];
}

function deriveBadge(card: Pick<ActivityCard, "newGroups" | "meetupWeekCount" | "planningGroups" | "activeScore">): ActivityBadge {
  if (card.newGroups >= 2) return "New";
  if (card.meetupWeekCount >= 2 || card.activeScore >= 20) return "Hot";
  if (card.planningGroups > 0) return "Planning";
  return null;
}

function makeFallbackActivities(catalog: ActivityCatalogItem[]): ActivityCard[] {
  return catalog.map((item) => ({
    key: item.id,
    slug: item.slug,
    name: item.name,
    category: item.category,
    emoji: item.emoji,
    groupCount: 0,
    memberTotal: 0,
    meetupWeekCount: 0,
    planningGroups: 0,
    latestCreatedTs: 0,
    nearestKm: null,
    cityRank: 99,
    newGroups: 0,
    activeScore: 0,
    badge: null,
  }));
}

function buildActivityCards(args: {
  groups: GroupRow[];
  members: GroupMemberRow[];
  events: GroupEventRow[];
  polls: GroupPollRow[];
  catalog: ActivityCatalogItem[];
  activeCoords: LatLng | null;
  effectiveCity: string | null;
}): ActivityCard[] {
  const { groups, members, events, polls, catalog, activeCoords, effectiveCity } = args;
  const nowTs = Date.now();
  const weekCutoff = nowTs + SEVEN_DAYS_MS;

  const memberCountByGroup: Record<string, number> = {};
  members.forEach((row) => {
    if (!isActiveMemberStatus(row.status)) return;
    const gid = String(row.group_id || "");
    if (!gid) return;
    memberCountByGroup[gid] = (memberCountByGroup[gid] || 0) + 1;
  });

  const meetupWeekByGroup: Record<string, number> = {};
  events.forEach((row) => {
    const gid = String(row.group_id || "");
    const ts = new Date(row.starts_at || "").getTime();
    if (!gid || !Number.isFinite(ts) || ts < nowTs || ts > weekCutoff) return;
    meetupWeekByGroup[gid] = (meetupWeekByGroup[gid] || 0) + 1;
  });

  const planningByGroup = new Set<string>();
  polls.forEach((row) => {
    const gid = String(row.group_id || "");
    if (!gid) return;
    if (String(row.status || "").toLowerCase() !== "open") return;
    const closesAt = row.closes_at ? new Date(row.closes_at).getTime() : null;
    if (Number.isFinite(closesAt as number) && (closesAt as number) < nowTs) return;
    planningByGroup.add(gid);
  });

  const catalogById = new Map<string, ActivityCatalogItem>();
  const catalogBySlug = new Map<string, ActivityCatalogItem>();
  catalog.forEach((item) => {
    catalogById.set(normalizeLoose(item.id), item);
    catalogBySlug.set(item.slug, item);
  });

  const activityBySlug = new Map<string, ActivityCard>();

  groups.forEach((group) => {
    const baseKey = String(group.game || group.category || "activity").trim();
    if (!baseKey) return;

    const baseSlug = slugify(baseKey) || "activity";
    const gameMeta = catalogById.get(normalizeLoose(group.game)) || catalogBySlug.get(baseSlug) || null;
    const groupTitleLoose = normalizeLoose(group.title);
    const guessedMeta =
      !gameMeta && groupTitleLoose
        ? catalog.find((item) => {
            const idLoose = normalizeLoose(item.id);
            const nameLoose = normalizeLoose(item.name);
            return (
              (!!idLoose && groupTitleLoose.includes(idLoose)) ||
              (!!nameLoose && groupTitleLoose.includes(nameLoose))
            );
          }) || null
        : null;
    const resolvedMeta = gameMeta || guessedMeta;

    const slug = resolvedMeta?.slug || baseSlug;
    const key = resolvedMeta?.id || baseKey;
    const name = resolvedMeta?.name || toTitleCase(baseKey);
    const category = resolvedMeta?.category || group.category || null;
    const emoji = resolvedMeta?.emoji || null;

    const groupId = String(group.id || "");
    const memberCount = memberCountByGroup[groupId] || 0;
    const meetupWeekCount = meetupWeekByGroup[groupId] || 0;
    const planning = planningByGroup.has(groupId) ? 1 : 0;

    const createdTs = new Date(group.created_at).getTime();
    const isNewGroup = Number.isFinite(createdTs) && nowTs - createdTs <= TWO_WEEKS_MS;

    const distanceKm =
      typeof group.distance_km === "number"
        ? group.distance_km
        : activeCoords && typeof group.lat === "number" && typeof group.lng === "number"
          ? haversineKm(activeCoords, { lat: group.lat, lng: group.lng })
          : null;

    const existing = activityBySlug.get(slug) || {
      key,
      slug,
      name,
      category,
      emoji,
      groupCount: 0,
      memberTotal: 0,
      meetupWeekCount: 0,
      planningGroups: 0,
      latestCreatedTs: 0,
      nearestKm: null,
      cityRank: 99,
      newGroups: 0,
      activeScore: 0,
      badge: null,
    };

    existing.groupCount += 1;
    existing.memberTotal += memberCount;
    existing.meetupWeekCount += meetupWeekCount;
    existing.planningGroups += planning;
    existing.latestCreatedTs = Math.max(existing.latestCreatedTs, Number.isFinite(createdTs) ? createdTs : 0);
    existing.cityRank = Math.min(existing.cityRank, cityDistanceRank(group.city, effectiveCity));
    if (typeof distanceKm === "number") {
      existing.nearestKm = existing.nearestKm == null ? distanceKm : Math.min(existing.nearestKm, distanceKm);
    }
    if (isNewGroup) existing.newGroups += 1;

    existing.activeScore += meetupWeekCount * 4;
    existing.activeScore += planning ? 2 : 0;
    existing.activeScore += Math.min(memberCount, 20) * 0.8;
    if (isNewGroup) existing.activeScore += 2;

    activityBySlug.set(slug, existing);
  });

  catalog.forEach((item) => {
    if (activityBySlug.has(item.slug)) return;
    activityBySlug.set(item.slug, {
      key: item.id,
      slug: item.slug,
      name: item.name,
      category: item.category,
      emoji: item.emoji,
      groupCount: 0,
      memberTotal: 0,
      meetupWeekCount: 0,
      planningGroups: 0,
      latestCreatedTs: 0,
      nearestKm: null,
      cityRank: 99,
      newGroups: 0,
      activeScore: 0,
      badge: null,
    });
  });

  return Array.from(activityBySlug.values()).map((card) => ({
    ...card,
    badge: deriveBadge(card),
  }));
}

function sortActivities(input: ActivityCard[], sortBy: SortOption): ActivityCard[] {
  const rows = [...input];
  rows.sort((a, b) => {
    if (sortBy === "most_members") {
      if (b.memberTotal !== a.memberTotal) return b.memberTotal - a.memberTotal;
      if (b.groupCount !== a.groupCount) return b.groupCount - a.groupCount;
      return a.name.localeCompare(b.name);
    }

    if (sortBy === "most_groups") {
      if (b.groupCount !== a.groupCount) return b.groupCount - a.groupCount;
      if (b.memberTotal !== a.memberTotal) return b.memberTotal - a.memberTotal;
      return a.name.localeCompare(b.name);
    }

    if (sortBy === "nearest") {
      const aDist = a.nearestKm ?? Number.POSITIVE_INFINITY;
      const bDist = b.nearestKm ?? Number.POSITIVE_INFINITY;
      if (aDist !== bDist) return aDist - bDist;
      if (a.cityRank !== b.cityRank) return a.cityRank - b.cityRank;
      if (b.memberTotal !== a.memberTotal) return b.memberTotal - a.memberTotal;
      return a.name.localeCompare(b.name);
    }

    if (sortBy === "newest") {
      if (b.latestCreatedTs !== a.latestCreatedTs) return b.latestCreatedTs - a.latestCreatedTs;
      if (b.newGroups !== a.newGroups) return b.newGroups - a.newGroups;
      return a.name.localeCompare(b.name);
    }

    if (sortBy === "upcoming") {
      if (b.meetupWeekCount !== a.meetupWeekCount) return b.meetupWeekCount - a.meetupWeekCount;
      if (b.planningGroups !== a.planningGroups) return b.planningGroups - a.planningGroups;
      return a.name.localeCompare(b.name);
    }

    if (b.activeScore !== a.activeScore) return b.activeScore - a.activeScore;
    if (b.meetupWeekCount !== a.meetupWeekCount) return b.meetupWeekCount - a.meetupWeekCount;
    if (b.memberTotal !== a.memberTotal) return b.memberTotal - a.memberTotal;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

function toneClassForCategory(category: string | null | undefined): string {
  const value = normalizeLoose(category);
  if (value.includes("game") || value.includes("board") || value.includes("card")) return "tile-games";
  if (value.includes("sport") || value.includes("run") || value.includes("hike") || value.includes("outdoor")) {
    return "tile-outdoors";
  }
  if (value.includes("food") || value.includes("coffee") || value.includes("drink")) return "tile-food";
  if (value.includes("creative") || value.includes("art") || value.includes("music")) return "tile-creative";
  if (value.includes("language") || value.includes("study") || value.includes("book")) return "tile-learning";
  return "tile-social";
}

function iconForCategory(label: string): string {
  const value = normalizeLoose(label);
  if (value.includes("game")) return "🎲";
  if (value.includes("sport") || value.includes("outdoor")) return "🏃";
  if (value.includes("food")) return "🍜";
  if (value.includes("creative") || value.includes("art")) return "🎨";
  if (value.includes("language") || value.includes("learning")) return "🗣️";
  return "✨";
}

export default function BrowsePage() {
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [profileLocation, setProfileLocation] = useState<ProfileLocation>({
    city: null,
    lat: null,
    lng: null,
    location_updated_at: null,
    location_source: null,
  });

  const [locationMode, setLocationMode] = useState<LocationMode>(() => readSavedLocationMode());
  const [geoStatus, setGeoStatus] = useState<"idle" | "requesting" | "granted" | "denied">("idle");
  const [gpsCoords, setGpsCoords] = useState<LatLng | null>(null);
  const [gpsCity, setGpsCity] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<ActivityCatalogItem[]>(() =>
    GAME_LIST.map((entry) => ({
      id: entry.id,
      name: entry.name,
      category: entry.tag || null,
      emoji: entry.image || null,
      slug: slugify(entry.id || entry.name),
    }))
  );
  const [rawActivities, setRawActivities] = useState<ActivityCard[]>([]);

  const [sortBy, setSortBy] = useState<SortOption>(DEFAULT_SORT);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [manualCityInput, setManualCityInput] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);

  const [refreshTick, setRefreshTick] = useState(0);

  const locationPanelRef = useRef<HTMLDivElement | null>(null);
  const filterPanelRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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

  const effectiveCity = useMemo(() => {
    if (locationMode === "gps") return gpsCity || profileLocation.city || DEFAULT_CITY;
    return profileLocation.city || DEFAULT_CITY;
  }, [gpsCity, locationMode, profileLocation.city]);

  const usingGps = locationMode === "gps" && !!activeCoords;

  const activeSortLabel = useMemo(
    () => SORT_OPTIONS.find((option) => option.key === sortBy)?.label || "Most Active",
    [sortBy]
  );

  const sortedActivities = useMemo(() => sortActivities(rawActivities, sortBy), [rawActivities, sortBy]);

  const spotlightActivities = useMemo(
    () => sortedActivities.filter((item) => item.badge === "Hot" || item.badge === "New").slice(0, 3),
    [sortedActivities]
  );

  const categoryTabs = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    sortedActivities.forEach((item) => {
      const raw = String(item.category || "Social");
      const key = slugify(raw) || "social";
      const entry = counts.get(key) || { label: raw, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    });

    const tabs = Array.from(counts.entries())
      .map(([key, value]) => ({ key, label: value.label, count: value.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    return [{ key: "all", label: "All", count: sortedActivities.length }, ...tabs];
  }, [sortedActivities]);

  const visibleActivities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedActivities.filter((item) => {
      const categoryKey = slugify(item.category || "Social") || "social";
      const categoryMatch = activeCategory === "all" || categoryKey === activeCategory;
      const searchMatch =
        q.length === 0 ||
        String(item.name || "").toLowerCase().includes(q) ||
        String(item.category || "").toLowerCase().includes(q);
      return categoryMatch && searchMatch;
    });
  }, [activeCategory, searchQuery, sortedActivities]);

  const featuredActivities = useMemo(() => {
    const picks: ActivityCard[] = [];
    const seen = new Set<string>();
    const push = (item: ActivityCard | undefined) => {
      if (!item || seen.has(item.slug)) return;
      seen.add(item.slug);
      picks.push(item);
    };
    spotlightActivities.forEach((item) => push(item));
    sortedActivities.forEach((item) => push(item));
    return picks.slice(0, 3);
  }, [sortedActivities, spotlightActivities]);

  const heroFeature = featuredActivities[0] || null;
  const sideFeatures = featuredActivities.slice(1, 3);

  useEffect(() => {
    if (activeCategory === "all") return;
    if (!categoryTabs.some((tab) => tab.key === activeCategory)) {
      setActiveCategory("all");
    }
  }, [activeCategory, categoryTabs]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!locationOpen) return;
    setManualCityInput(effectiveCity || "");
  }, [effectiveCity, locationOpen]);

  useEffect(() => {
    if (isMobile) return;

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;

      if (locationPanelRef.current && !locationPanelRef.current.contains(target)) {
        setLocationOpen(false);
      }
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
      try {
        const { data: authData } = await supabase.auth.getUser();
        const uid = authData?.user?.id ?? null;
        if (!mounted) return;
        setUserId(uid);
        if (uid) {
          const location = await fetchProfileLocation(uid);
          if (!mounted) return;
          setProfileLocation(location);
        }
      } catch (error) {
        console.warn("[browse] auth/profile bootstrap failed", error);
      } finally {
        if (mounted) setAuthReady(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

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
        const { data, error } = await supabase
          .from("allowed_games")
          .select("id, name, category")
          .eq("is_active", true)
          .order("name", { ascending: true });

        if (!mounted) return;
        if (error || !data || data.length === 0) {
          setCatalog(fallback);
          return;
        }

        const emojiById = new Map(
          GAME_LIST.map((entry) => [normalizeLoose(entry.id), entry.image || null] as const)
        );

        const rows = (data as AllowedActivityRow[])
          .map((row) => {
            const id = String(row.id || "").trim();
            if (!id) return null;
            return {
              id,
              name: String(row.name || id),
              category: row.category || null,
              emoji: emojiById.get(normalizeLoose(id)) || null,
              slug: slugify(id),
            } as ActivityCatalogItem;
          })
          .filter(Boolean) as ActivityCatalogItem[];

        setCatalog(rows.length > 0 ? rows : fallback);
      } catch (error) {
        console.warn("[browse] failed to load allowed games", error);
        if (!mounted) return;
        setCatalog(fallback);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const refreshLocation = useCallback(
    async (manual: boolean) => {
      if (!("geolocation" in navigator)) {
        setGeoStatus("denied");
        if (!manual) {
          setLocationMode("profile_city");
          persistLocationMode("profile_city");
        }
        return;
      }

      if (!manual) {
        try {
          localStorage.setItem(GEO_AUTO_PROMPT_KEY, "1");
        } catch {
          // no-op
        }
      }

      setLocationBusy(true);
      setGeoStatus("requesting");

      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const nextCoords = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            };

            setGpsCoords(nextCoords);
            setGeoStatus("granted");

            const reversed = await reverseGeocodeCity(nextCoords);
            if (reversed?.city) setGpsCity(reversed.city);

            if (userId) {
              const shouldPersist =
                manual ||
                isLocationStale(profileLocation.location_updated_at, 30) ||
                movedMoreThanMeters(profileCoords, nextCoords, 500);

              if (shouldPersist) {
                const nowIso = new Date().toISOString();
                const payload: Record<string, any> = {
                  lat: nextCoords.lat,
                  lng: nextCoords.lng,
                  location_updated_at: nowIso,
                  location_source: "gps",
                };
                if (reversed?.city) payload.city = reversed.city;

                const update = await supabase.from("profiles").update(payload).eq("user_id", userId);
                if (update.error && hasColumnError(update.error)) {
                  if (reversed?.city) {
                    await supabase.from("profiles").update({ city: reversed.city }).eq("user_id", userId);
                  }
                } else if (update.error) {
                  console.warn("[browse] gps profile update failed", update.error.message);
                }

                setProfileLocation((prev) => ({
                  ...prev,
                  city: reversed?.city || prev.city,
                  lat: nextCoords.lat,
                  lng: nextCoords.lng,
                  location_updated_at: nowIso,
                  location_source: "gps",
                }));
              }
            }

            resolve();
          },
          () => {
            setGeoStatus("denied");
            if (!manual) {
              setLocationMode("profile_city");
              persistLocationMode("profile_city");
            }
            resolve();
          },
          {
            enableHighAccuracy: false,
            timeout: 12000,
            maximumAge: 5 * 60 * 1000,
          }
        );
      });

      setLocationBusy(false);
    },
    [profileCoords, profileLocation.location_updated_at, userId]
  );

  useEffect(() => {
    if (!authReady || locationMode !== "gps") return;

    let cancelled = false;

    (async () => {
      try {
        if (navigator.permissions?.query) {
          const permission = await navigator.permissions.query({ name: "geolocation" });
          if (cancelled) return;

          if (permission.state === "denied") {
            setGeoStatus("denied");
            setLocationMode("profile_city");
            persistLocationMode("profile_city");
            return;
          }

          if (permission.state === "prompt") {
            const alreadyPrompted = localStorage.getItem(GEO_AUTO_PROMPT_KEY) === "1";
            if (alreadyPrompted) return;
          }

          await refreshLocation(false);
          return;
        }

        const alreadyPrompted = localStorage.getItem(GEO_AUTO_PROMPT_KEY) === "1";
        if (!alreadyPrompted) {
          await refreshLocation(false);
        }
      } catch (error) {
        console.warn("[browse] automatic gps check failed", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, locationMode, refreshLocation]);

  const applyManualCity = useCallback(async () => {
    const input = manualCityInput.trim();
    if (!input) return;

    setLocationBusy(true);
    setLocationMode("profile_city");
    persistLocationMode("profile_city");

    let city = input;
    let nextCoords: LatLng | null = null;

    try {
      const geocoded = await geocodePlace(input);
      if (geocoded) {
        city = geocoded.city || input;
        nextCoords = { lat: geocoded.lat, lng: geocoded.lng };
      }

      const nowIso = new Date().toISOString();
      if (userId) {
        const payload: Record<string, any> = {
          city,
          location_source: "manual",
          location_updated_at: nowIso,
          lat: nextCoords?.lat ?? null,
          lng: nextCoords?.lng ?? null,
        };

        const update = await supabase.from("profiles").update(payload).eq("user_id", userId);
        if (update.error && hasColumnError(update.error)) {
          await supabase.from("profiles").update({ city }).eq("user_id", userId);
        } else if (update.error) {
          console.warn("[browse] manual city update failed", update.error.message);
        }
      }

      setProfileLocation((prev) => ({
        ...prev,
        city,
        lat: nextCoords?.lat ?? null,
        lng: nextCoords?.lng ?? null,
        location_updated_at: nowIso,
        location_source: "manual",
      }));
      setLocationOpen(false);
      setGpsCity(null);
    } catch (error) {
      console.warn("[browse] manual city update error", error);
    } finally {
      setLocationBusy(false);
    }
  }, [manualCityInput, userId]);

  const loadDiscovery = useCallback(async () => {
    if (!authReady) return;

    setLoading(true);
    setLoadError(null);

    try {
      const allGroups = await queryRecentGroups();
      let groups: GroupRow[] = allGroups;

      // Fallbacks for edge cases where broad fetch returns no rows.
      if (groups.length === 0 && locationMode === "gps" && activeCoords) {
        groups = await queryGroupsByGps(activeCoords, DISCOVERY_RADIUS_KM);
      }
      if (groups.length === 0) {
        groups = await queryGroupsByCity(effectiveCity || null);
      }

      const groupIds = Array.from(new Set(groups.map((group) => String(group.id || "")).filter(Boolean)));

      let members: GroupMemberRow[] = [];
      let events: GroupEventRow[] = [];
      let polls: GroupPollRow[] = [];

      if (groupIds.length > 0) {
        const [membersRes, eventsRes, pollsRes] = await Promise.all([
          supabase.from("group_members").select("group_id,status").in("group_id", groupIds),
          supabase
            .from("group_events")
            .select("group_id,starts_at")
            .in("group_id", groupIds)
            .not("starts_at", "is", null)
            .gte("starts_at", new Date().toISOString())
            .limit(1000),
          supabase
            .from("group_polls")
            .select("group_id,status,closes_at")
            .in("group_id", groupIds)
            .eq("status", "open")
            .limit(1000),
        ]);

        if (membersRes.error) throw membersRes.error;
        if (eventsRes.error) throw eventsRes.error;
        if (pollsRes.error) throw pollsRes.error;

        members = (membersRes.data || []) as GroupMemberRow[];
        events = (eventsRes.data || []) as GroupEventRow[];
        polls = (pollsRes.data || []) as GroupPollRow[];
      }

      const nextActivities = buildActivityCards({
        groups,
        members,
        events,
        polls,
        catalog,
        activeCoords,
        effectiveCity,
      });

      setRawActivities(nextActivities);
    } catch (error: any) {
      console.error("[browse] failed to load discovery data", error);
      setLoadError(error?.message || "Could not load activities right now.");
      setRawActivities(makeFallbackActivities(catalog));
    } finally {
      setLoading(false);
    }
  }, [activeCoords, authReady, catalog, effectiveCity, locationMode]);

  useEffect(() => {
    void loadDiscovery();
  }, [loadDiscovery, refreshTick]);

  useEffect(() => {
    const channel = supabase
      .channel("browse-discovery-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, () =>
        setRefreshTick((value) => value + 1)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "group_members" }, () =>
        setRefreshTick((value) => value + 1)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () =>
        setRefreshTick((value) => value + 1)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "group_events" }, () =>
        setRefreshTick((value) => value + 1)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "group_polls" }, () =>
        setRefreshTick((value) => value + 1)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filterLabel = sortBy === DEFAULT_SORT ? "Sort" : activeSortLabel;
  const locationStatus = usingGps ? "Using GPS" : "Using profile city";

  return (
    <>
      <main className="browse-page">
        <div className="browse-grain" aria-hidden />

        <div className="browse-shell">
          <header className="browse-topbar reveal d1">
            <Link to="/" className="browse-logo">
              <span className="browse-logo-rings" aria-hidden>
                <span className="r r1" />
                <span className="r r2" />
                <span className="r r3" />
              </span>
              <span>Circles</span>
            </Link>

            <div className="browse-top-actions">
              <div ref={locationPanelRef} className="browse-popover">
                <button
                  type="button"
                  onClick={() => setLocationOpen((open) => !open)}
                  className="location-pill"
                  aria-label="Open location picker"
                >
                  <MapPin className="h-4 w-4" />
                  <span className="txt">
                    <strong>{effectiveCity || DEFAULT_CITY}</strong>
                    <small>{locationStatus}</small>
                  </span>
                  <ChevronDown className="h-4 w-4 chevron" />
                </button>

                {!isMobile && locationOpen && (
                  <div className="browse-menu browse-menu-location">
                    <button
                      type="button"
                      disabled={locationBusy}
                      onClick={async () => {
                        setLocationMode("gps");
                        persistLocationMode("gps");
                        await refreshLocation(true);
                        setLocationOpen(false);
                      }}
                      className="menu-chip"
                    >
                      <LocateFixed className="h-3.5 w-3.5" />
                      Use GPS
                    </button>

                    <div className="menu-fields">
                      <label>Choose city manually</label>
                      <input
                        value={manualCityInput}
                        onChange={(event) => setManualCityInput(event.target.value)}
                        placeholder="Type a city"
                      />
                      <button
                        type="button"
                        disabled={locationBusy || manualCityInput.trim().length === 0}
                        onClick={() => void applyManualCity()}
                        className="menu-primary"
                      >
                        Use city
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div ref={filterPanelRef} className="browse-popover">
                <button
                  type="button"
                  onClick={() => setFilterOpen((open) => !open)}
                  className="nav-icon-btn"
                  aria-label="Open sort options"
                >
                  <Filter className="h-4 w-4" />
                </button>

                {!isMobile && filterOpen && (
                  <div className="browse-menu browse-menu-filter">
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
                          className={`menu-option ${active ? "active" : ""}`}
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
                      className="menu-option reset"
                    >
                      Reset to default
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setRefreshTick((value) => value + 1)}
                className="nav-icon-btn"
                aria-label="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "spin" : ""}`} />
              </button>

              <Link to="/notifications" className="nav-icon-btn has-pip" aria-label="Open activity">
                <Bell className="h-4 w-4" />
                <span className="pip" />
              </Link>
            </div>
          </header>

          <section className="ed-header reveal d2">
            <div>
              <p className="ed-kicker">Live Discovery</p>
              <h1 className="ed-title">
                Find your <em>circles.</em>
              </h1>
              <p className="ed-sub">
                Explore active groups around {effectiveCity || DEFAULT_CITY} and jump into what feels right this week.
              </p>
              <div className="ed-meta">
                <span className="live-chip">
                  <span className="dot" />
                  Live now
                </span>
                <span className="soft-chip">{sortedActivities.length} activities</span>
              </div>
            </div>

            <button type="button" className="loc-block" onClick={() => setLocationOpen(true)}>
              <MapPin className="h-4 w-4" />
              <span>
                <strong>{effectiveCity || DEFAULT_CITY}</strong>
                <small>{locationStatus}</small>
              </span>
              <ChevronDown className="h-4 w-4" />
            </button>
          </section>

          <section className="browse-controls reveal d3">
            <label className="search-wrap">
              <Search className="h-4 w-4" />
              <input
                id="searchInput"
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search circles, games, activities..."
              />
              <kbd className="kbd">⌘K</kbd>
            </label>

            <button type="button" onClick={() => setFilterOpen((open) => !open)} className="fpill">
              <Filter className="h-3.5 w-3.5" />
              {filterLabel}
            </button>

            <button type="button" disabled title="Coming soon" className="fpill ghost">
              Matching now
            </button>
          </section>

          <section className="cat-rail reveal d4">
            {categoryTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveCategory(tab.key)}
                className={`ctab ${activeCategory === tab.key ? "active" : ""}`}
              >
                <span className="ct-icon">{iconForCategory(tab.label)}</span>
                <span>{tab.label}</span>
                <span className="ct-n">{tab.count}</span>
              </button>
            ))}
          </section>

          {loadError && <div className="state-banner error reveal d4">{loadError}</div>}
          {geoStatus === "denied" && (
            <div className="state-banner warn reveal d4">
              GPS access is off. Showing activity around your profile city.
            </div>
          )}

          {heroFeature && (
            <section className="editorial-grid reveal d5">
              <Link to={`/browse/${heroFeature.slug}`} className="hf">
                <div className="hf-mesh" aria-hidden />
                <div className="hf-grid" aria-hidden />
                <div className="hf-diag" aria-hidden />
                <span className="hf-pill">Feature</span>
                <h2>{heroFeature.emoji ? `${heroFeature.emoji} ` : ""}{heroFeature.name}</h2>
                <p>
                  {heroFeature.groupCount} groups, {heroFeature.memberTotal} members, and {heroFeature.meetupWeekCount} meetup
                  {heroFeature.meetupWeekCount === 1 ? "" : "s"} planned this week.
                </p>
                <div className="hf-meta">
                  <span>{heroFeature.badge || "Growing"}</span>
                  <span>{heroFeature.nearestKm != null ? formatDistanceKm(heroFeature.nearestKm) : "Near you"}</span>
                </div>
                <span className="hf-cta">Open activity →</span>
              </Link>

              {sideFeatures.map((item, index) => (
                <Link key={item.slug} to={`/browse/${item.slug}`} className={`sf sf-${index + 1}`}>
                  <span className="sf-emoji-wrap">{item.emoji || "✨"}</span>
                  <div className="sf-kicker">{item.category || "Activity"}</div>
                  <h3>{item.name}</h3>
                  <p>{item.groupCount} groups · {item.memberTotal} members</p>
                </Link>
              ))}
            </section>
          )}

          <section className="tile-grid reveal d6">
            {loading
              ? Array.from({ length: 8 }).map((_, index) => (
                  <div key={`sk-${index}`} className="tile-skeleton" />
                ))
              : visibleActivities.map((item) => (
                  <Link
                    key={item.slug}
                    to={`/browse/${item.slug}`}
                    className={`tile ${toneClassForCategory(item.category)}`}
                    data-cat={slugify(item.category || "social")}
                    data-name={item.name}
                  >
                    <div className="tile-cat">{item.category || "Activity"}</div>
                    <div className="tile-icon">{item.emoji || "✨"}</div>
                    <h2 className="tile-name">{item.name}</h2>
                    <p className="tile-meta">
                      {item.groupCount} groups · {item.memberTotal} members
                    </p>
                    <div className="tile-footer">
                      <span>
                        {item.meetupWeekCount > 0
                          ? `${item.meetupWeekCount} meetup${item.meetupWeekCount === 1 ? "" : "s"} this week`
                          : item.planningGroups > 0
                            ? `${item.planningGroups} planning now`
                            : "Growing communities"}
                      </span>
                      <span className="tile-join">Open</span>
                    </div>
                  </Link>
                ))}
          </section>

          {!loading && visibleActivities.length === 0 && (
            <div className="empty-block reveal d7">No activities match your search or selected category yet.</div>
          )}

          {loading && (
            <div className="loading-row">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Refreshing live activity signals...
            </div>
          )}
        </div>
      </main>

      {isMobile && locationOpen && (
        <div className="browse-sheet-wrap">
          <button
            type="button"
            onClick={() => setLocationOpen(false)}
            className="browse-sheet-backdrop"
            aria-label="Close location picker"
          />
          <div className="browse-sheet">
            <div className="sheet-handle" />
            <div className="sheet-title">Location</div>
            <p className="sheet-sub">{locationStatus}</p>

            <button
              type="button"
              disabled={locationBusy}
              onClick={async () => {
                setLocationMode("gps");
                persistLocationMode("gps");
                await refreshLocation(true);
                setLocationOpen(false);
              }}
              className="menu-chip mt"
            >
              <LocateFixed className="h-3.5 w-3.5" />
              Use GPS
            </button>

            <div className="menu-fields">
              <label>Choose city manually</label>
              <input
                value={manualCityInput}
                onChange={(event) => setManualCityInput(event.target.value)}
                placeholder="Type a city"
              />
              <button
                type="button"
                disabled={locationBusy || manualCityInput.trim().length === 0}
                onClick={() => void applyManualCity()}
                className="menu-primary"
              >
                Use city
              </button>
            </div>
          </div>
        </div>
      )}

      {isMobile && filterOpen && (
        <div className="browse-sheet-wrap">
          <button
            type="button"
            onClick={() => setFilterOpen(false)}
            className="browse-sheet-backdrop"
            aria-label="Close filter menu"
          />
          <div className="browse-sheet">
            <div className="sheet-handle" />
            <div className="sheet-title">Sort by</div>
            <div className="sheet-options">
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
                    className={`menu-option ${active ? "active" : ""}`}
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
              className="menu-option reset"
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </>
  );
}
