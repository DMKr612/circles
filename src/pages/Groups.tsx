import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useMyGroups } from "@/hooks/useMyGroups";
import { supabase } from "@/lib/supabase";

type GroupAttentionMeta = {
  needsConfirm: boolean;
  needsRating: boolean;
  upcomingCount: number;
  latestPastTs: number;
};

function useQuery() {
  const loc = useLocation();
  return useMemo(() => new URLSearchParams(loc.search), [loc.search]);
}

export default function GroupsPage() {
  const query = useQuery();
  const category = query.get("category") || "";
  const search = query.get("q") || "";

  const {
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
  } = useMyGroups({ category, search });

  const [attentionByGroup, setAttentionByGroup] = useState<Record<string, GroupAttentionMeta>>({});
  const [upcomingMeetups, setUpcomingMeetups] = useState(0);

  useEffect(() => {
    let active = true;
    const ids = groups.map((g) => g.id).filter(Boolean);
    if (!me || ids.length === 0) {
      setAttentionByGroup({});
      setUpcomingMeetups(0);
      return;
    }

    (async () => {
      try {
        const now = Date.now();
        const in72h = now + 72 * 60 * 60 * 1000;
        const recentPastWindow = 14 * 24 * 60 * 60 * 1000;

        const [eventsRes, ratingsRes] = await Promise.all([
          supabase
            .from("group_events")
            .select("id, group_id, starts_at")
            .in("group_id", ids)
            .not("starts_at", "is", null),
          supabase
            .rpc("get_my_group_event_ratings", { p_group_ids: ids }),
        ]);

        const events = eventsRes.data || [];
        const ratings = ratingsRes.error ? [] : (ratingsRes.data || []);
        const ratedEventIds = new Set(
          ratings
            .map((r: any) => String(r?.event_id || ""))
            .filter(Boolean)
        );

        const meta: Record<string, GroupAttentionMeta> = {};
        const latestPastEventByGroup: Record<string, string | null> = {};
        ids.forEach((gid) => {
          meta[gid] = {
            needsConfirm: false,
            needsRating: false,
            upcomingCount: 0,
            latestPastTs: 0,
          };
          latestPastEventByGroup[gid] = null;
        });

        let upcomingCount = 0;

        events.forEach((ev: any) => {
          const gid = String(ev?.group_id || "");
          const ts = new Date(ev?.starts_at || "").getTime();
          if (!gid || !Number.isFinite(ts) || !meta[gid]) return;

          if (ts > now) {
            upcomingCount += 1;
            meta[gid].upcomingCount += 1;
            if (ts <= in72h) meta[gid].needsConfirm = true;
            return;
          }

          if (now - ts <= recentPastWindow && ts > meta[gid].latestPastTs) {
            meta[gid].latestPastTs = ts;
            latestPastEventByGroup[gid] = String(ev?.id || "") || null;
          }
        });

        Object.keys(meta).forEach((gid) => {
          const latestPastEventId = latestPastEventByGroup[gid];
          if (latestPastEventId && !ratedEventIds.has(latestPastEventId)) {
            meta[gid].needsRating = true;
          }
        });

        if (!active) return;
        setAttentionByGroup(meta);
        setUpcomingMeetups(upcomingCount);
      } catch {
        if (!active) return;
        setAttentionByGroup({});
        setUpcomingMeetups(0);
      }
    })();

    return () => {
      active = false;
    };
  }, [me, groups]);

  const totalUnread = useMemo(
    () => Object.values(unreadCounts || {}).reduce((sum, n) => sum + (n ?? 0), 0),
    [unreadCounts]
  );

  const totalOpenVotes = useMemo(
    () => Object.values(openPolls || {}).filter(Boolean).length,
    [openPolls]
  );

  const attentionGroups = useMemo(
    () =>
      groups.filter((g) => {
        const unread = unreadCounts[g.id] ?? 0;
        const hasOpenPoll = !!openPolls[g.id];
        const meta = attentionByGroup[g.id];
        return unread > 0 || hasOpenPoll || !!meta?.needsConfirm || !!meta?.needsRating;
      }),
    [groups, unreadCounts, openPolls, attentionByGroup]
  );

  const renderCircleRow = (g: any, inAttentionSection = false) => {
    const unread = unreadCounts[g.id] ?? 0;
    const hasOpenPoll = !!openPolls[g.id];
    const meta = attentionByGroup[g.id];
    const role = g.host_id && g.host_id === me ? "Host" : "Member";
    const city = g.city || "No city";
    const initial = (g.title || g.game || "C").slice(0, 1).toUpperCase();

    const statusParts: string[] = [];
    if (unread > 0) statusParts.push(`${unread} unread`);
    if (hasOpenPoll) statusParts.push("Vote open");
    if (meta?.needsConfirm) statusParts.push("Confirm attendance");
    if (meta?.needsRating) statusParts.push("Rate meetup");

    const statusLine = inAttentionSection
      ? statusParts.join(" • ")
      : `${role} • ${city}${statusParts.length ? ` • ${statusParts.join(" • ")}` : " • Up to date"}`;

    return (
      <Link
        key={g.id}
        to={`/group/${g.id}`}
        onClick={() => markGroupRead(g.id)}
        className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 transition hover:border-neutral-300 hover:bg-neutral-50"
      >
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-700 ring-1 ring-emerald-100">
          {initial}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-neutral-900">{g.title || "Untitled circle"}</div>
          <div className="truncate text-xs text-neutral-600">{statusLine}</div>
        </div>

        <div className="shrink-0">
          {unread > 0 ? (
            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : (
            <ChevronRight className="h-4 w-4 text-neutral-400" />
          )}
        </div>
      </Link>
    );
  };

  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 pb-28 pt-6">
      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-neutral-900">Circles</h1>
            <p className="text-xs text-neutral-500">Where you need to go right now.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-semibold text-neutral-700">
              Unread: <span className="font-bold text-neutral-900">{totalUnread}</span>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-semibold text-neutral-700">
              Open Votes: <span className="font-bold text-neutral-900">{totalOpenVotes}</span>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-semibold text-neutral-700">
              Upcoming Meetups: <span className="font-bold text-neutral-900">{upcomingMeetups}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            to="/create"
            className="rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
          >
            + Create Circle
          </Link>
          <Link
            to="/browse"
            className="rounded-full border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
          >
            Browse Circles
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-bold text-neutral-900">Needs Attention</div>
        <div className="space-y-2">
          {loading && groups.length === 0 ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-neutral-100" />
            ))
          ) : err ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>
          ) : attentionGroups.length === 0 ? (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-600">
              You are all caught up.
            </div>
          ) : (
            attentionGroups.map((g) => renderCircleRow(g, true))
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-bold text-neutral-900">All Circles</div>
        <div className="space-y-2">
          {!loading && !err && groups.length === 0 ? (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-600">
              No circles found.
            </div>
          ) : (
            groups.map((g) => renderCircleRow(g))
          )}
        </div>

        {hasMore && (
          <div className="mt-3 border-t border-neutral-200 pt-3 text-center">
            <button
              onClick={loadMore}
              disabled={paging}
              className="rounded-full border border-neutral-300 bg-white px-4 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            >
              {paging ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
