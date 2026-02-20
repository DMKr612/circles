import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Loader2, LocateFixed, SlidersHorizontal } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { reverseGeocodeCity } from "@/lib/geocode";
import { formatDistanceKm, haversineKm, isLocationStale, movedMoreThanMeters, type LatLng } from "@/lib/location";

type TimeFilter = "week" | "weekend" | "anytime";
type SortOption = "soonest" | "closest";
type LocationMode = "gps" | "profile_city";

type ProfileLocation = {
  city: string | null;
  lat: number | null;
  lng: number | null;
  location_updated_at: string | null;
  location_source: "gps" | "manual" | null;
};

type GroupRow = {
  id: string;
  title: string | null;
  city: string | null;
  capacity: number | null;
  created_at: string;
  lat: number | null;
  lng: number | null;
  distance_km?: number | null;
};

type GroupRef = {
  id: string;
  title: string | null;
  city: string | null;
  capacity: number | null;
};

type GroupEventRow = {
  id: string;
  group_id: string;
  title: string | null;
  starts_at: string | null;
  place: string | null;
  created_at: string;
  groups?: GroupRef | GroupRef[] | null;
};

type GroupMemberRow = {
  group_id: string;
  user_id: string;
  status: string | null;
};

type HappeningSoonItem = {
  eventId: string;
  groupId: string;
  groupTitle: string;
  city: string | null;
  startsAt: string;
  place: string | null;
  capacity: number | null;
  memberCount: number;
  isJoined: boolean;
  distanceKm: number | null;
};

type NearCircleItem = {
  groupId: string;
  title: string;
  city: string | null;
  memberCount: number;
  capacity: number | null;
  isJoined: boolean;
  nextMeetupAt: string | null;
  nextMeetupPlace: string | null;
  distanceKm: number | null;
};

const DEFAULT_CITY = "Freiburg";
const GEO_AUTO_PROMPT_KEY = "circles.geo.prompted.v1";
const LOCATION_MODE_KEY = "circles.browse.location_mode.v1";

function normalizeCity(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function cityDistanceRank(city: string | null, userCity: string | null): number {
  if (!userCity) return 1;
  if (!city) return 2;
  return normalizeCity(city) === normalizeCity(userCity) ? 0 : 1;
}

function toGroupRef(groupsValue: GroupRef | GroupRef[] | null | undefined): GroupRef | null {
  if (!groupsValue) return null;
  if (Array.isArray(groupsValue)) return groupsValue[0] || null;
  return groupsValue;
}

function formatMeetupDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date TBD";
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

function getUpcomingWeekendWindow(now: Date): { start: Date; end: Date } {
  const day = now.getDay();
  const start = new Date(now);

  if (day === 6) {
    start.setHours(0, 0, 0, 0);
  } else if (day === 0) {
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(start.getDate() + (6 - day));
    start.setHours(0, 0, 0, 0);
  }

  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function passesTimeFilter(iso: string, filter: TimeFilter, now: Date): boolean {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return false;

  const nowTs = now.getTime();
  if (ts < nowTs) return false;

  if (filter === "anytime") return true;

  if (filter === "week") {
    const limit = nowTs + 7 * 24 * 60 * 60 * 1000;
    return ts <= limit;
  }

  const { start, end } = getUpcomingWeekendWindow(now);
  const windowStart = Math.max(nowTs, start.getTime());
  return ts >= windowStart && ts <= end.getTime();
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
  } catch {}
}

function hasColumnError(error: any): boolean {
  return String(error?.code || "") === "42703";
}

async function fetchProfileLocation(userId: string): Promise<ProfileLocation> {
  const full = await supabase
    .from("profiles")
    .select("city, lat, lng, location_updated_at, location_source")
    .eq("user_id", userId)
    .maybeSingle();

  if (!full.error) {
    const row = (full.data ??
      null) as
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

  const fallback = await supabase
    .from("profiles")
    .select("city")
    .eq("user_id", userId)
    .maybeSingle();
  if (fallback.error) throw fallback.error;
  const fallbackRow = (fallback.data ?? null) as { city?: string | null } | null;

  return {
    city: fallbackRow?.city || null,
    lat: null,
    lng: null,
    location_updated_at: null,
    location_source: null,
  };
}

async function queryGroupsByCity(city: string, radiusKm: number): Promise<GroupRow[]> {
  let query = supabase
    .from("groups")
    .select("id, title, city, capacity, created_at, lat, lng")
    .order("created_at", { ascending: false })
    .limit(radiusKm <= 20 ? 80 : 220);

  if (radiusKm <= 20 && city) query = query.eq("city", city);
  let res = await query;

  if (res.error && hasColumnError(res.error)) {
    let fallbackQuery = supabase
      .from("groups")
      .select("id, title, city, capacity, created_at")
      .order("created_at", { ascending: false })
      .limit(radiusKm <= 20 ? 80 : 220);
    if (radiusKm <= 20 && city) fallbackQuery = fallbackQuery.eq("city", city);
    const fallback = await fallbackQuery;
    if (fallback.error) throw fallback.error;
    return (fallback.data || []).map((g: any) => ({
      ...g,
      lat: null,
      lng: null,
      distance_km: null,
    })) as GroupRow[];
  }

  if (res.error) throw res.error;
  return ((res.data || []) as GroupRow[]).map((g) => ({
    ...g,
    distance_km: null,
  }));
}

async function queryGroupsByGps(coords: LatLng, radiusKm: number): Promise<GroupRow[]> {
  const rpc = await supabase.rpc("get_nearby_circles", {
    p_user_lat: coords.lat,
    p_user_lng: coords.lng,
    p_radius_km: radiusKm,
  });

  if (!rpc.error) {
    return (rpc.data || []) as GroupRow[];
  }

  let fallback = await supabase
    .from("groups")
    .select("id, title, city, capacity, created_at, lat, lng")
    .not("lat", "is", null)
    .not("lng", "is", null)
    .order("created_at", { ascending: false })
    .limit(260);

  if (fallback.error && hasColumnError(fallback.error)) {
    // Old schema without coordinates: fall back to city matching in caller.
    return [];
  }
  if (fallback.error) throw fallback.error;

  return ((fallback.data || []) as GroupRow[])
    .map((g) => {
      if (typeof g.lat !== "number" || typeof g.lng !== "number") return null;
      const distanceKm = haversineKm(coords, { lat: g.lat, lng: g.lng });
      if (distanceKm > radiusKm) return null;
      return { ...g, distance_km: distanceKm };
    })
    .filter(Boolean) as GroupRow[];
}

export default function BrowsePage() {
  const navigate = useNavigate();

  const [timeFilter, setTimeFilter] = useState<TimeFilter>("week");
  const [sortOption, setSortOption] = useState<SortOption>("soonest");
  const [radiusKm, setRadiusKm] = useState(15);
  const [hideJoinedCircles, setHideJoinedCircles] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
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

  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<GroupEventRow[]>([]);
  const [memberCountByGroup, setMemberCountByGroup] = useState<Record<string, number>>({});
  const [isJoinedByGroup, setIsJoinedByGroup] = useState<Record<string, boolean>>({});
  const [refreshTick, setRefreshTick] = useState(0);

  const profileCoords = useMemo<LatLng | null>(() => {
    if (typeof profileLocation.lat === "number" && typeof profileLocation.lng === "number") {
      return { lat: profileLocation.lat, lng: profileLocation.lng };
    }
    return null;
  }, [profileLocation.lat, profileLocation.lng]);

  const activeCoords = useMemo<LatLng | null>(() => {
    if (locationMode !== "gps") return null;
    return gpsCoords || profileCoords || null;
  }, [gpsCoords, profileCoords, locationMode]);

  const effectiveCity = useMemo(() => {
    if (locationMode === "profile_city") return profileLocation.city || DEFAULT_CITY;
    return gpsCity || profileLocation.city || DEFAULT_CITY;
  }, [gpsCity, locationMode, profileLocation.city]);

  const usingGps = locationMode === "gps" && !!activeCoords;

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
        } catch {}
      }

      setGeoStatus("requesting");

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

          if (!userId) return;
          const shouldPersist =
            manual ||
            isLocationStale(profileLocation.location_updated_at, 30) ||
            movedMoreThanMeters(profileCoords, nextCoords, 500);
          if (!shouldPersist) return;

          const nowIso = new Date().toISOString();
          const payload: Record<string, any> = {
            lat: nextCoords.lat,
            lng: nextCoords.lng,
            location_updated_at: nowIso,
            location_source: "gps",
          };
          if (!profileLocation.city && reversed?.city) payload.city = reversed.city;

          const updateRes = await supabase.from("profiles").update(payload).eq("user_id", userId);
          if (updateRes.error && !hasColumnError(updateRes.error)) {
            console.warn("[browse] profile location update failed", updateRes.error.message);
          }

          setProfileLocation((prev) => ({
            ...prev,
            lat: nextCoords.lat,
            lng: nextCoords.lng,
            location_updated_at: nowIso,
            location_source: "gps",
            city: prev.city || reversed?.city || prev.city,
          }));
        },
        (error) => {
          console.warn("[browse] geolocation denied/error", error?.message || error);
          setGeoStatus("denied");
          if (!manual) {
            setLocationMode("profile_city");
            persistLocationMode("profile_city");
          }
        },
        {
          enableHighAccuracy: false,
          timeout: 12000,
          maximumAge: 5 * 60 * 1000,
        }
      );
    },
    [profileCoords, profileLocation.city, profileLocation.location_updated_at, userId]
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const uid = authData?.user?.id ?? null;
        if (!mounted) return;
        setUserId(uid);
        if (uid) {
          const profile = await fetchProfileLocation(uid);
          if (!mounted) return;
          setProfileLocation(profile);
        }
      } catch (error: any) {
        console.warn("[browse] profile load failed", error?.message || error);
      } finally {
        if (mounted) setAuthReady(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (locationMode !== "gps") return;

    let cancelled = false;
    (async () => {
      try {
        if ("permissions" in navigator && navigator.permissions?.query) {
          const status = await navigator.permissions.query({ name: "geolocation" });
          if (cancelled) return;
          if (status.state === "denied") {
            setGeoStatus("denied");
            setLocationMode("profile_city");
            persistLocationMode("profile_city");
            return;
          }
          if (status.state === "prompt") {
            const alreadyPrompted = localStorage.getItem(GEO_AUTO_PROMPT_KEY) === "1";
            if (alreadyPrompted) return;
          }
          await refreshLocation(false);
          return;
        }

        const alreadyPrompted = localStorage.getItem(GEO_AUTO_PROMPT_KEY) === "1";
        const shouldTryWithoutPermissionsApi =
          !alreadyPrompted ||
          !profileCoords ||
          isLocationStale(profileLocation.location_updated_at, 30);
        if (shouldTryWithoutPermissionsApi) await refreshLocation(false);
      } catch (error) {
        console.warn("[browse] auto geolocation check failed", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, locationMode, profileCoords, profileLocation.location_updated_at, refreshLocation]);

  const loadBrowseData = useCallback(async () => {
    if (!authReady) return;
    setLoading(true);
    setLoadError(null);

    try {
      let nearGroups: GroupRow[] = [];
      if (activeCoords) {
        nearGroups = await queryGroupsByGps(activeCoords, radiusKm);
        if (nearGroups.length === 0) {
          // Fallback for old schema/non-geocoded circles.
          nearGroups = await queryGroupsByCity(effectiveCity, radiusKm);
        }
      } else {
        nearGroups = await queryGroupsByCity(effectiveCity, radiusKm);
      }

      const nearGroupIds = nearGroups.map((g) => g.id).filter(Boolean);
      const uniqueGroupIds = Array.from(new Set(nearGroupIds));

      let eventsData: GroupEventRow[] = [];
      if (uniqueGroupIds.length > 0) {
        const eventsRes = await supabase
          .from("group_events")
          .select("id, group_id, title, starts_at, place, created_at, groups(id, title, city, capacity)")
          .in("group_id", uniqueGroupIds)
          .not("starts_at", "is", null)
          .gte("starts_at", new Date().toISOString())
          .order("starts_at", { ascending: true })
          .limit(280);
        if (eventsRes.error) throw eventsRes.error;
        eventsData = (eventsRes.data || []) as GroupEventRow[];
      }

      const counts: Record<string, number> = {};
      const joined: Record<string, boolean> = {};
      if (uniqueGroupIds.length > 0) {
        const membersRes = await supabase
          .from("group_members")
          .select("group_id, user_id, status")
          .in("group_id", uniqueGroupIds);
        if (membersRes.error) throw membersRes.error;

        ((membersRes.data || []) as GroupMemberRow[]).forEach((row) => {
          const gid = String(row.group_id || "");
          if (!gid) return;
          if (row.status && row.status !== "active") return;
          counts[gid] = (counts[gid] || 0) + 1;
          if (userId && row.user_id === userId) joined[gid] = true;
        });
      }

      setGroups(nearGroups);
      setUpcomingEvents(eventsData);
      setMemberCountByGroup(counts);
      setIsJoinedByGroup(joined);
    } catch (error: any) {
      console.error("[browse] load error", error);
      setLoadError(error?.message || "Could not load nearby meetups.");
      setGroups([]);
      setUpcomingEvents([]);
      setMemberCountByGroup({});
      setIsJoinedByGroup({});
    } finally {
      setLoading(false);
    }
  }, [activeCoords, authReady, effectiveCity, radiusKm, userId]);

  useEffect(() => {
    void loadBrowseData();
  }, [loadBrowseData, refreshTick]);

  useEffect(() => {
    const ch = supabase
      .channel("browse-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "group_events" }, () =>
        setRefreshTick((v) => v + 1)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "group_polls" }, () =>
        setRefreshTick((v) => v + 1)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, () =>
        setRefreshTick((v) => v + 1)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const groupById = useMemo(() => {
    const map = new Map<string, GroupRow>();
    groups.forEach((g) => {
      map.set(g.id, g);
    });
    return map;
  }, [groups]);

  const nextEventByGroup = useMemo(() => {
    const map = new Map<string, GroupEventRow>();
    upcomingEvents.forEach((ev) => {
      const gid = String(ev.group_id || "");
      if (!gid || map.has(gid)) return;
      map.set(gid, ev);
    });
    return map;
  }, [upcomingEvents]);

  const happeningSoon = useMemo(() => {
    const now = new Date();

    const rows: HappeningSoonItem[] = upcomingEvents
      .filter((ev) => !!ev.starts_at && passesTimeFilter(ev.starts_at as string, timeFilter, now))
      .map((ev) => {
        const relationGroup = toGroupRef(ev.groups);
        const gid = String(ev.group_id || relationGroup?.id || "");
        const sourceGroup = groupById.get(gid);

        const capacity =
          typeof sourceGroup?.capacity === "number"
            ? sourceGroup.capacity
            : typeof relationGroup?.capacity === "number"
              ? relationGroup.capacity
              : null;
        const memberCount = memberCountByGroup[gid] || 0;
        const distanceKm =
          typeof sourceGroup?.distance_km === "number"
            ? sourceGroup.distance_km
            : activeCoords && typeof sourceGroup?.lat === "number" && typeof sourceGroup?.lng === "number"
              ? haversineKm(activeCoords, { lat: sourceGroup.lat, lng: sourceGroup.lng })
              : null;

        return {
          eventId: ev.id,
          groupId: gid,
          groupTitle: (sourceGroup?.title || relationGroup?.title || "Circle").trim(),
          city: sourceGroup?.city || relationGroup?.city || null,
          startsAt: ev.starts_at as string,
          place: ev.place || null,
          capacity,
          memberCount,
          isJoined: !!isJoinedByGroup[gid],
          distanceKm,
        };
      })
      .filter((row) => {
        if (!row.groupId) return false;
        if (typeof row.capacity !== "number") return true;
        return row.capacity > row.memberCount;
      });

    rows.sort((a, b) => {
      if (sortOption === "closest") {
        const aHasDistance = typeof a.distanceKm === "number";
        const bHasDistance = typeof b.distanceKm === "number";
        if (aHasDistance && bHasDistance && a.distanceKm !== b.distanceKm) {
          return (a.distanceKm || 0) - (b.distanceKm || 0);
        }
        if (aHasDistance !== bHasDistance) return aHasDistance ? -1 : 1;
        const rankDiff = cityDistanceRank(a.city, effectiveCity) - cityDistanceRank(b.city, effectiveCity);
        if (rankDiff !== 0) return rankDiff;
      }
      return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    });

    return rows;
  }, [activeCoords, effectiveCity, groupById, isJoinedByGroup, memberCountByGroup, sortOption, timeFilter, upcomingEvents]);

  const nearYouCircles = useMemo(() => {
    const rows: NearCircleItem[] = groups.map((group) => {
      const next = nextEventByGroup.get(group.id);
      const distanceKm =
        typeof group.distance_km === "number"
          ? group.distance_km
          : activeCoords && typeof group.lat === "number" && typeof group.lng === "number"
            ? haversineKm(activeCoords, { lat: group.lat, lng: group.lng })
            : null;

      return {
        groupId: group.id,
        title: (group.title || "Untitled circle").trim(),
        city: group.city || null,
        memberCount: memberCountByGroup[group.id] || 0,
        capacity: typeof group.capacity === "number" ? group.capacity : null,
        isJoined: !!isJoinedByGroup[group.id],
        nextMeetupAt: next?.starts_at || null,
        nextMeetupPlace: next?.place || null,
        distanceKm,
      };
    });

    rows.sort((a, b) => {
      if (sortOption === "closest") {
        const aHasDistance = typeof a.distanceKm === "number";
        const bHasDistance = typeof b.distanceKm === "number";
        if (aHasDistance && bHasDistance && a.distanceKm !== b.distanceKm) {
          return (a.distanceKm || 0) - (b.distanceKm || 0);
        }
        if (aHasDistance !== bHasDistance) return aHasDistance ? -1 : 1;
        const rankDiff = cityDistanceRank(a.city, effectiveCity) - cityDistanceRank(b.city, effectiveCity);
        if (rankDiff !== 0) return rankDiff;
      }

      const aTs = a.nextMeetupAt ? new Date(a.nextMeetupAt).getTime() : Number.POSITIVE_INFINITY;
      const bTs = b.nextMeetupAt ? new Date(b.nextMeetupAt).getTime() : Number.POSITIVE_INFINITY;
      if (aTs !== bTs) return aTs - bTs;
      return a.title.localeCompare(b.title);
    });

    return rows;
  }, [activeCoords, effectiveCity, groups, isJoinedByGroup, memberCountByGroup, nextEventByGroup, sortOption]);

  const visibleHappeningSoon = useMemo(
    () => (hideJoinedCircles ? happeningSoon.filter((item) => !item.isJoined) : happeningSoon),
    [happeningSoon, hideJoinedCircles]
  );

  const visibleNearYouCircles = useMemo(
    () => (hideJoinedCircles ? nearYouCircles.filter((circle) => !circle.isJoined) : nearYouCircles),
    [hideJoinedCircles, nearYouCircles]
  );

  const timeFilterLabel = useMemo(() => {
    if (timeFilter === "weekend") return "this weekend";
    if (timeFilter === "anytime") return "for your current filter";
    return "this week";
  }, [timeFilter]);

  const showGpsMismatchBanner = useMemo(() => {
    if (locationMode !== "gps") return false;
    if (!gpsCity || !profileLocation.city) return false;
    return normalizeCity(gpsCity) !== normalizeCity(profileLocation.city);
  }, [gpsCity, locationMode, profileLocation.city]);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 px-4 pb-28 pt-6">
      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-neutral-900">Meetups Near You</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Real meetups first. Join quickly and show up this week.
            </p>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            Radius: <span className="font-semibold text-neutral-900">{radiusKm} km</span>
          </div>
        </div>

        {showGpsMismatchBanner && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            <span>Using your current location: {gpsCity} ({radiusKm} km radius)</span>
            <button
              type="button"
              onClick={() => void refreshLocation(true)}
              className="rounded-full border border-emerald-300 bg-white px-2.5 py-1 font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              Change
            </button>
            <button
              type="button"
              onClick={() => {
                setLocationMode("profile_city");
                persistLocationMode("profile_city");
              }}
              className="rounded-full border border-emerald-300 bg-white px-2.5 py-1 font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              Use profile city
            </button>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-neutral-600">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Search radius
          </label>
          <input
            type="range"
            min={10}
            max={50}
            step={5}
            value={radiusKm}
            onChange={(e) => setRadiusKm(Number(e.target.value))}
            className="w-48 accent-emerald-600"
          />
          <button
            type="button"
            onClick={() => setRadiusKm((v) => (v < 30 ? 30 : 50))}
            className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            Expand search radius
          </button>

          <button
            type="button"
            onClick={() => void refreshLocation(true)}
            className="inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            <LocateFixed className="h-3.5 w-3.5" />
            Refresh location
          </button>

          <button
            type="button"
            onClick={() => {
              const next: LocationMode = locationMode === "gps" ? "profile_city" : "gps";
              setLocationMode(next);
              persistLocationMode(next);
            }}
            className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            {locationMode === "gps" ? "Use profile city" : "Use GPS"}
          </button>

          <span className="text-xs text-neutral-500">
            {usingGps
              ? `Using current location${gpsCity ? ` (${gpsCity})` : ""}`
              : `Using ${effectiveCity} from profile city`}
          </span>

          {geoStatus === "denied" && (
            <span className="text-xs text-rose-600">Location denied. Showing profile city fallback.</span>
          )}

          <button
            type="button"
            onClick={() => setHideJoinedCircles((v) => !v)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              hideJoinedCircles
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            {hideJoinedCircles ? "Showing only new circles" : "Hide joined circles"}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-neutral-900">Happening Soon</h2>
          <label className="flex items-center gap-2 text-xs font-semibold text-neutral-600">
            Sort
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-800"
            >
              <option value="soonest">Soonest first</option>
              <option value="closest">Closest first</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { key: "week", label: "This week" },
            { key: "weekend", label: "This weekend" },
            { key: "anytime", label: "Anytime" },
          ].map((item) => {
            const active = timeFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTimeFilter(item.key as TimeFilter)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "border border-emerald-600 bg-emerald-600 text-white"
                    : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4 space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading nearby meetups...
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">{loadError}</div>
          ) : visibleHappeningSoon.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-5">
              <p className="text-sm font-semibold text-neutral-800">
                {hideJoinedCircles
                  ? "No unjoined meetups found near you for this filter."
                  : `No meetups scheduled near you ${timeFilterLabel}.`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to="/create"
                  className="rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  Create one
                </Link>
                <button
                  type="button"
                  onClick={() => setRadiusKm((v) => Math.max(30, v + 10))}
                  className="rounded-full border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-bold text-neutral-700 hover:bg-neutral-100"
                >
                  Expand search radius
                </button>
                {hideJoinedCircles && (
                  <button
                    type="button"
                    onClick={() => setHideJoinedCircles(false)}
                    className="rounded-full border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-bold text-neutral-700 hover:bg-neutral-100"
                  >
                    Show joined circles
                  </button>
                )}
              </div>
            </div>
          ) : (
            visibleHappeningSoon.map((item) => {
              const spotsLeft =
                typeof item.capacity === "number" ? Math.max(0, item.capacity - item.memberCount) : null;
              const spotText =
                typeof spotsLeft === "number"
                  ? `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`
                  : "Open spots available";
              const subtitle = `${formatMeetupDate(item.startsAt)}${item.place ? ` · ${item.place}` : ""}`;
              const locationLine = `${item.city || "Near you"} · ${spotText}`;
              const distanceText =
                sortOption === "closest" && typeof item.distanceKm === "number"
                  ? ` · ${formatDistanceKm(item.distanceKm)} away`
                  : "";

              return (
                <div
                  key={item.eventId}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/group/${item.groupId}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/group/${item.groupId}`);
                    }
                  }}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 transition hover:border-neutral-300 hover:bg-neutral-50"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-700 ring-1 ring-emerald-100">
                    {(item.groupTitle || "C").slice(0, 1).toUpperCase()}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-neutral-900">{item.groupTitle}</div>
                    <div className="truncate text-xs text-neutral-700">{subtitle}</div>
                    <div className="truncate text-xs text-neutral-500">
                      {locationLine}
                      {distanceText}
                    </div>
                  </div>

                  <Link
                    to={`/group/${item.groupId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    {item.isJoined ? "View" : "Join"}
                  </Link>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-neutral-900">Near You</h2>
          <span className="text-xs text-neutral-500">{visibleNearYouCircles.length} circles</span>
        </div>

        <div className="space-y-2">
          {!loading && visibleNearYouCircles.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-4 text-sm text-neutral-600">
              {hideJoinedCircles
                ? "You already joined all circles in this area. Try expanding your radius."
                : "No circles found nearby yet. Try expanding your radius."}
            </div>
          ) : (
            visibleNearYouCircles.map((circle) => {
              const nextMeetupText = circle.nextMeetupAt
                ? `${formatMeetupDate(circle.nextMeetupAt)}${circle.nextMeetupPlace ? ` · ${circle.nextMeetupPlace}` : ""}`
                : "No meetup scheduled yet";
              const capacityText =
                typeof circle.capacity === "number"
                  ? `${circle.memberCount}/${circle.capacity} members`
                  : `${circle.memberCount} members`;
              const distanceText =
                sortOption === "closest" && typeof circle.distanceKm === "number"
                  ? ` · ${formatDistanceKm(circle.distanceKm)} away`
                  : "";

              return (
                <div
                  key={circle.groupId}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/group/${circle.groupId}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/group/${circle.groupId}`);
                    }
                  }}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 transition hover:border-neutral-300 hover:bg-neutral-50"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-neutral-100 text-sm font-bold text-neutral-700">
                    {(circle.title || "C").slice(0, 1).toUpperCase()}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-neutral-900">{circle.title}</div>
                    <div className="truncate text-xs text-neutral-600">
                      {circle.city || "Near you"} · {capacityText}
                      {distanceText}
                    </div>
                    <div className="truncate text-xs text-neutral-500">{nextMeetupText}</div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {circle.isJoined && (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                        Joined
                      </span>
                    )}
                    <Link
                      to={`/group/${circle.groupId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-100"
                    >
                      View
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}
