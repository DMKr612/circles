// src/hooks/useMyGroups.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/App";
import { supabase } from "@/lib/supabase";
import type { MyGroupRow } from "@/types";

type Args = {
  category: string;
  search: string;
};

const PAGE_SIZE = 12;
const HIGH_LEVEL = new Set(["games", "study", "outdoors"]);

export function useMyGroups({ category, search }: Args) {
  const { user } = useAuth();
  const me = user?.id || null;

  const [groups, setGroups] = useState<MyGroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [paging, setPaging] = useState(false);

  const [openPolls, setOpenPolls] = useState<Record<string, boolean>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [allowedByCat, setAllowedByCat] = useState<Record<string, string[]>>({});
  const groupIdsRef = useRef<string[]>([]);

  const modeJoined = true;
  const modeCreated = true;

  // --- Load whitelist once ---
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase
        .from("allowed_games")
        .select("id, category")
        .eq("is_active", true);

      if (!mounted) return;
      if (error) {
        setAllowedByCat({});
        return;
      }

      const map: Record<string, string[]> = {};
      (data ?? []).forEach((r: any) => {
        const cat = String(r.category || "").toLowerCase();
        const id = String(r.id || "").toLowerCase();
        if (!cat || !id) return;
        if (!map[cat]) map[cat] = [];
        map[cat].push(id);
      });
      setAllowedByCat(map);
    })();

    return () => {
      mounted = false;
    };
  }, []);


  // --- Unread helpers ---

  const refreshUnreadCounts = useCallback(
    async (ids: string[]) => {
      try {
        if (!me || !ids.length) return;

        // 1) last read per group for me
        const { data: reads, error: rErr } = await supabase
          .from("group_reads")
          .select("group_id,last_read_at")
          .eq("user_id", me)
          .in("group_id", ids);

        if (rErr) throw rErr;

        const lastByGroup: Record<string, string | null> = {};
        (reads ?? []).forEach((r: any) => {
          lastByGroup[r.group_id] = r.last_read_at ?? null;
        });

        // 2) count unread per group
        const pairs = ids.map(async (gid) => {
          const last = lastByGroup[gid] ?? "1970-01-01T00:00:00Z";
          const { count, error } = await supabase
            .from("group_messages")
            .select("id", { count: "exact", head: true })
            .eq("group_id", gid)
            .gt("created_at", last);
          if (error) return [gid, 0] as const;
          return [gid, count ?? 0] as const;
        });

        const results = await Promise.all(pairs);
        const map: Record<string, number> = {};
        results.forEach(([gid, c]) => {
          map[gid] = c;
        });
        setUnreadCounts((prev) => ({ ...prev, ...map }));
      } catch {
        // ignore; badge just won't show
      }
    },
    [me]
  );

  const markGroupRead = useCallback(
    async (groupId: string) => {
      if (!me) return;
      try {
        await supabase.rpc("mark_group_read", { p_group_id: groupId });
        setUnreadCounts((prev) => ({ ...prev, [groupId]: 0 }));
        await supabase
          .from("notifications")
          .update({ is_read: true })
          .eq("user_id", me)
          .eq("payload->>group_id", groupId)
          .eq("is_read", false);
      } catch (e) {
        console.warn("[markGroupRead]", e);
      }
    },
    [me]
  );

  // --- Live updates for reads ---
  useEffect(() => {
    if (!me) return;

    const ch = supabase
      .channel(`reads:${me}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_reads", filter: `user_id=eq.${me}` },
        async (payload) => {
          const gid =
            (payload.new as any)?.group_id || (payload.old as any)?.group_id;
          if (!gid) return;
          await refreshUnreadCounts([gid]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [me, refreshUnreadCounts]);

  // Keep latest group ids without recreating listeners on every list change.
  useEffect(() => {
    groupIdsRef.current = groups.map((g) => g.id);
  }, [groups]);

  // --- Fallback refresh for unread counts ---
  useEffect(() => {
    if (!me) return;

    const refreshAll = () => {
      const ids = groupIdsRef.current;
      if (ids.length) void refreshUnreadCounts(ids);
    };

    window.addEventListener("focus", refreshAll);
    const onVis = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    document.addEventListener("visibilitychange", onVis);

    const timer = window.setInterval(refreshAll, 20000);

    return () => {
      window.removeEventListener("focus", refreshAll);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(timer);
    };
  }, [me, refreshUnreadCounts]);

  // --- Core load function (page-based) ---
  const loadPage = useCallback(
    async (pageIndex: number, reset: boolean) => {
      try {
        if (reset) {
          setLoading(true);
          setGroups([]);
          setPage(0);
          setHasMore(false);
        } else {
          setPaging(true);
        }
        setErr(null);

        if ((modeJoined || modeCreated) && !me) {
          setGroups([]);
          setErr("Please sign in to view your groups.");
          setLoading(false);
          setPaging(false);
          return;
        }

        if (!me) {
          setGroups([]);
          setErr("Please sign in to view your groups.");
          setLoading(false);
          setPaging(false);
          return;
        }

        let rows: MyGroupRow[] = [];
        const from = pageIndex * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        // Fetch my joined group ids and created group ids in parallel
        const [joinedRes, createdRes] = await Promise.all([
          supabase.from("group_members").select("group_id").eq("user_id", me),
          supabase.from("groups").select("id").eq("host_id", me),
        ]);
        if (joinedRes.error) throw joinedRes.error;
        if (createdRes.error) throw createdRes.error;

        const joinedIds: string[] = (joinedRes.data ?? []).map(
          (m: any) => m.group_id
        );
        const createdIds: string[] = (createdRes.data ?? []).map(
          (g: any) => g.id
        );
        const idSet = new Set<string>([...joinedIds, ...createdIds]);
        const allIds = Array.from(idSet);

        const applyCommonFilters = (q: any) => {
          let qb = q;
          const catLower = category ? category.toLowerCase() : "";

          if (catLower) {
            if (HIGH_LEVEL.has(catLower)) {
              const ids = allowedByCat[catLower] ?? [];
              if (ids.length > 0) {
                const inList = ids.join(",");
                qb = qb.or(`game.in.(${inList}),category.eq.${catLower}`);
              } else {
                qb = qb.eq("category", catLower);
              }
            } else {
              const leaf = catLower.replace(/[^a-z0-9]+/g, "");
              qb = qb.or(
                `game.eq.${leaf},game.ilike.*${catLower}*,title.ilike.*${catLower}*`
              );
            }
          }

          if (search.trim()) {
            const q = search.trim();
            qb = qb.or(`title.ilike.*${q}*,game.ilike.*${q}*`);
          }

          return qb;
        };

        if (allIds.length > 0) {
          let q = supabase
            .from("groups")
            .select(
              "id, title, description, city, capacity, category, game, created_at, host_id"
            )
            .in("id", allIds)
            .order("created_at", { ascending: false })
            .range(from, to);

          const { data, error } = await applyCommonFilters(q);
          if (error) throw error;
          rows = (data ?? []) as MyGroupRow[];
        } else {
          rows = [];
        }

        if (reset) {
          setGroups(rows);
        } else {
          setGroups((prev) => [...prev, ...rows]);
        }

        setPage(pageIndex);
        setHasMore(rows.length === PAGE_SIZE);

        if ((rows ?? []).length > 0) {
          const ids = rows.map((g: MyGroupRow) => g.id);

          if (me && ids.length > 0) {
            await refreshUnreadCounts(ids);
          }

          const { data: polls } = await supabase
            .from("group_polls")
            .select("group_id, status")
            .in("group_id", ids);

          setOpenPolls((prev) => {
            const next: Record<string, boolean> = { ...prev };
            // Clear existing flags for the ids we just refreshed
            ids.forEach((id) => { delete next[id]; });
            (polls ?? []).forEach((p: any) => {
              if (p.status === "open") next[p.group_id] = true;
            });
            return next;
          });
        }
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load groups");
      } finally {
        setLoading(false);
        setPaging(false);
      }
    },
    [me, category, search, allowedByCat, refreshUnreadCounts]
  );

  // --- initial + filters change ---
  useEffect(() => {
    if (!me) return;
    loadPage(0, true);
  }, [me, category, search, allowedByCat, loadPage]);

  const loadMore = useCallback(async () => {
    if (!me || paging) return;
    const next = page + 1;
    await loadPage(next, false);
  }, [me, page, paging, loadPage]);

  return {
    me,
    groups,
    loading,
    err,
    hasMore,
    paging,
    unreadCounts,
    openPolls,
    loadMore,
    markGroupRead,
  };
}
