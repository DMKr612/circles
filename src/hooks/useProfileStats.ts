import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

const ACTIVE_MEMBER_STATUSES = ["active", "accepted"] as const;

export type ProfileStats = {
  circlesCount: number | null;
  meetupsCount: number | null;
  trustScore: number | null;
  ratingCount: number | null;
};

const EMPTY_STATS: ProfileStats = {
  circlesCount: null,
  meetupsCount: null,
  trustScore: null,
  ratingCount: null,
};

export function useProfileStats(userId: string | null) {
  const [stats, setStats] = useState<ProfileStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState<string | null>(null);

  const hasLoadedRef = useRef(false);
  const requestIdRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);

  const loadStats = useCallback(async () => {
    if (!userId) {
      setStats(EMPTY_STATS);
      setError(null);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    if (!hasLoadedRef.current) setLoading(true);

    let nextError: string | null = null;

    let circlesCount: number | null = null;
    let meetupsCount: number | null = null;
    let trustScore: number | null = null;
    let ratingCount: number | null = null;

    const nowIso = new Date().toISOString();

    const [membershipsRes, trustRes] = await Promise.all([
      supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", userId)
        .in("status", [...ACTIVE_MEMBER_STATUSES]),
      supabase
        .from("profiles")
        .select("rating_avg, rating_count")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    const membershipsError = membershipsRes.error;
    const trustError = trustRes.error;

    if (membershipsError) {
      console.error("[profile-stats] memberships load failed", membershipsError);
      nextError = membershipsError.message;
    }

    if (trustError) {
      console.error("[profile-stats] trust load failed", trustError);
      nextError = nextError || trustError.message;
    }

    const groupIds = Array.from(
      new Set((membershipsRes.data || []).map((row: any) => String(row.group_id || "")).filter(Boolean)),
    );

    if (!membershipsError) {
      circlesCount = groupIds.length;

      if (groupIds.length) {
        const { count, error: meetupsError } = await supabase
          .from("group_events")
          .select("id", { count: "exact", head: true })
          .in("group_id", groupIds)
          .not("starts_at", "is", null)
          .lte("starts_at", nowIso);

        if (meetupsError) {
          console.error("[profile-stats] meetups load failed", meetupsError);
          nextError = nextError || meetupsError.message;
        } else {
          meetupsCount = Number(count || 0);
        }
      } else {
        meetupsCount = 0;
      }
    }

    if (!trustError) {
      trustScore = Number(trustRes.data?.rating_avg ?? 0);
      ratingCount = Number(trustRes.data?.rating_count ?? 0);
    }

    if (requestId !== requestIdRef.current) return;

    setStats({
      circlesCount,
      meetupsCount,
      trustScore,
      ratingCount,
    });
    setError(nextError);
    setLoading(false);
    hasLoadedRef.current = true;
  }, [userId]);

  useEffect(() => {
    hasLoadedRef.current = false;
    setStats(EMPTY_STATS);
    setError(null);
    setLoading(Boolean(userId));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        void loadStats();
      }, 220);
    };

    void loadStats();

    const channel = supabase
      .channel(`profile-stats:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_members", filter: `user_id=eq.${userId}` },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles", filter: `user_id=eq.${userId}` },
        scheduleRefresh,
      )
      // We can't filter by multiple group_ids in one Realtime rule, so we debounce refreshes.
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_events" },
        scheduleRefresh,
      )
      .subscribe();

    const onFocus = () => scheduleRefresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    const interval = window.setInterval(scheduleRefresh, 45000);

    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, [loadStats, userId]);

  return {
    stats,
    loading,
    error,
    refresh: loadStats,
  };
}

export default useProfileStats;
