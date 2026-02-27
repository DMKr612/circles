import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  AlertCircle,
  CalendarDays,
  ChevronRight,
  Clock3,
  Globe2,
  MapPin,
  Plus,
  Users,
} from "lucide-react";
import { useMyGroups } from "@/hooks/useMyGroups";
import { GroupRatingBadge } from "@/components/GroupRatingBadge";
import { supabase } from "@/lib/supabase";
import "./Groups.css";

type GroupAttentionMeta = {
  needsConfirm: boolean;
  needsRating: boolean;
  upcomingCount: number;
  latestPastTs: number;
};

type CircleRowView = {
  id: string;
  title: string;
  role: "host" | "member";
  roleLabel: string;
  city: string;
  initial: string;
  unread: number;
  hasOpenPoll: boolean;
  needsConfirm: boolean;
  needsRating: boolean;
  upcomingCount: number;
  statusPill: string;
  statusTone: "vote" | "rate" | "ok" | "tbd";
  accentClass: "has-vote" | "has-rate" | "up-to-date";
  statusLine: string;
  meetupLine: string | null;
  memberCount: number;
  groupRatingAvg: number | null | undefined;
  groupRatingCount: number | null | undefined;
  groupMembersCount: number | null | undefined;
};

const MEMBER_BUBBLE_COLORS = ["#60A5FA", "#34D399", "#93C5FD", "#A7F3D0", "#3B82F6", "#10B981"];

function initialsFromTitle(title: string): string {
  const text = String(title || "").trim();
  if (!text) return "C";
  const parts = text.split(/\s+/).slice(0, 2);
  const value = parts.map((p) => p.charAt(0).toUpperCase()).join("");
  return value || "C";
}

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function bubbleColor(seed: string, index: number): string {
  const h = hashSeed(`${seed}:${index}`);
  return MEMBER_BUBBLE_COLORS[h % MEMBER_BUBBLE_COLORS.length];
}

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
  const [filterBy, setFilterBy] = useState<"all" | "host" | "member" | "active">("all");

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

  const circleRows = useMemo<CircleRowView[]>(
    () =>
      groups.map((g: any) => {
        const unread = unreadCounts[g.id] ?? 0;
        const hasOpenPoll = !!openPolls[g.id];
        const meta = attentionByGroup[g.id];
        const needsConfirm = !!meta?.needsConfirm;
        const needsRating = !!meta?.needsRating;
        const upcomingCount = meta?.upcomingCount ?? 0;
        const role = g.host_id && g.host_id === me ? "host" : "member";
        const roleLabel = role === "host" ? "Host" : "Member";
        const city = g.city || "No city";
        const title = (g.title || "Untitled circle").trim();

        let statusPill: CircleRowView["statusPill"] = "TBD";
        let statusTone: CircleRowView["statusTone"] = "tbd";
        let accentClass: CircleRowView["accentClass"] = "up-to-date";
        if (hasOpenPoll) {
          statusPill = "Vote open";
          statusTone = "vote";
          accentClass = "has-vote";
        } else if (needsRating) {
          statusPill = "Rate now";
          statusTone = "rate";
          accentClass = "has-rate";
        } else if (unread > 0 || needsConfirm || upcomingCount > 0) {
          statusPill = "Active";
          statusTone = "ok";
          accentClass = "up-to-date";
        }

        const statusBits: string[] = [`${roleLabel}`, city];
        if (unread > 0) statusBits.push(`${unread} unread`);
        if (needsConfirm) statusBits.push("Confirm attendance");
        if (needsRating) statusBits.push("Rating pending");
        if (hasOpenPoll) statusBits.push("Poll running");

        const meetupLine =
          upcomingCount > 0
            ? `${upcomingCount} upcoming meetup${upcomingCount === 1 ? "" : "s"}`
            : needsConfirm
              ? "Attendance confirmation needed"
              : needsRating
                ? "Recent meetup waiting for your rating"
                : null;

        return {
          id: g.id,
          title,
          role,
          roleLabel,
          city,
          initial: initialsFromTitle(title || g.game || "C"),
          unread,
          hasOpenPoll,
          needsConfirm,
          needsRating,
          upcomingCount,
          statusPill,
          statusTone,
          accentClass,
          statusLine: statusBits.join(" • "),
          meetupLine,
          memberCount: Math.max(0, Number(g.group_members_count || 0)),
          groupRatingAvg: g.group_rating_avg,
          groupRatingCount: g.group_rating_count,
          groupMembersCount: g.group_members_count,
        };
      }),
    [attentionByGroup, groups, me, openPolls, unreadCounts]
  );

  const visibleRows = useMemo(
    () =>
      circleRows.filter((row) => {
        if (filterBy === "all") return true;
        if (filterBy === "host") return row.role === "host";
        if (filterBy === "member") return row.role === "member";
        return row.unread > 0 || row.hasOpenPoll || row.needsConfirm || row.needsRating;
      }),
    [circleRows, filterBy]
  );

  return (
    <main className="circles-dashboard mx-auto w-full max-w-5xl px-4 pb-28 pt-4">
      <section className="circles-dashboard__panel">
        <div className="circles-dashboard__orbs" aria-hidden>
          <span className="circles-orb o1" />
          <span className="circles-orb o2" />
          <span className="circles-orb o3" />
          <span className="circles-orb o4" />
        </div>

        <div className="circles-dashboard__content">
          <header className="circles-hero fade-up">
            <div>
              <h1 className="circles-hero__title">
                My <span>Circles.</span>
              </h1>
              <p className="circles-hero__subtitle">Where you need to go right now.</p>
              <div className="circles-hero__actions">
                <Link to="/create" className="circles-btn-primary">
                  <Plus className="h-4 w-4" />
                  Create Circle
                </Link>
                <Link to="/browse" className="circles-btn-secondary">
                  <Globe2 className="h-4 w-4" />
                  Browse Circles
                </Link>
              </div>
            </div>

            <div className="circles-hero__stats">
              <article className="circles-stat-card">
                <div className="label">Circles</div>
                <div className="value">{groups.length}</div>
              </article>
              <article className="circles-stat-card urgent">
                <div className="label">Open Vote</div>
                <div className="value">{totalOpenVotes}</div>
              </article>
              <article className="circles-stat-card">
                <div className="label">Upcoming</div>
                <div className="value">{upcomingMeetups}</div>
              </article>
            </div>
          </header>

          <section className="circles-filter-row fade-up delay-2">
            <div className="circles-filter-tabs">
              {[
                { key: "all", label: "All" },
                { key: "host", label: "Hosting" },
                { key: "member", label: "Member" },
                { key: "active", label: "Active" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilterBy(tab.key as "all" | "host" | "member" | "active")}
                  className={`circles-filter-tab ${filterBy === tab.key ? "is-active" : ""}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button type="button" className="circles-sort-btn">
              <Clock3 className="h-3.5 w-3.5" />
              Recent
            </button>
          </section>

          <section className="circles-list fade-up delay-3">
            <div className="sec-label-row">
              <span>Your Circles</span>
              <span>{visibleRows.length} shown</span>
            </div>

            {loading && groups.length === 0 ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.06]" />
                ))}
              </div>
            ) : err ? (
              <div className="rounded-2xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {err}
              </div>
            ) : visibleRows.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-slate-300">
                No circles found for this filter.
              </div>
            ) : (
              <div className="space-y-3">
                {visibleRows.map((row) => (
                  <Link
                    key={row.id}
                    to={`/group/${row.id}`}
                    onClick={() => markGroupRead(row.id)}
                    className={`circles-card ${row.accentClass}`}
                    data-role={row.role}
                  >
                    <div className="circles-card__avatar">{row.initial}</div>

                    <div className="circles-card__body">
                      <div className="circles-card__title-row">
                        <h3>{row.title}</h3>
                        <span className={`role-tag ${row.role}`}>{row.roleLabel}</span>
                      </div>
                      <p className="circles-card__meta">
                        <MapPin className="h-3.5 w-3.5" />
                        {row.statusLine}
                      </p>
                      <div className="circles-card__members">
                        <Users className="h-3.5 w-3.5 text-slate-500" />
                        <div className="member-bubbles">
                          {Array.from({ length: Math.min(3, Math.max(1, row.memberCount || 0)) }).map((_, i) => (
                            <span
                              key={`${row.id}-bubble-${i}`}
                              style={{ background: bubbleColor(row.id, i) }}
                            />
                          ))}
                        </div>
                        <span>{row.memberCount} members</span>
                      </div>
                    </div>

                    <div className="circles-card__state">
                      <GroupRatingBadge
                        groupMembersCount={row.groupMembersCount}
                        groupRatingAvg={row.groupRatingAvg}
                        groupRatingCount={row.groupRatingCount}
                      />
                      <span className={`status-pill sp-${row.statusTone}`}>{row.statusPill}</span>
                    </div>

                    <div className="circles-card__chev">
                      {row.unread > 0 ? (
                        <span className="unread-chip">{row.unread > 99 ? "99+" : row.unread}</span>
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      )}
                    </div>

                    {row.meetupLine && (
                      <div className="circles-card__meetup">
                        <span>
                          <CalendarDays className="h-3.5 w-3.5" />
                          {row.meetupLine}
                        </span>
                        <span className="mini-action">Open</span>
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            )}

            {hasMore && (
              <div className="mt-4 text-center">
                <button
                  onClick={loadMore}
                  disabled={paging}
                  className="circles-load-more"
                >
                  {paging ? "Loading..." : "Load more"}
                </button>
              </div>
            )}
          </section>

          <section className="circles-discover-card fade-up delay-4">
            <div className="emoji">🌍</div>
            <div>
              <h3>Discover more circles</h3>
              <p>Find groups near you, join in seconds, and keep your week active.</p>
              <Link to="/browse" className="circles-btn-primary">
                Browse circles
              </Link>
            </div>
          </section>

          {totalUnread > 0 && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              <AlertCircle className="h-3.5 w-3.5" />
              {totalUnread} unread update{totalUnread === 1 ? "" : "s"} across your circles.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
