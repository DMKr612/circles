import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMyGroups } from "@/hooks/useMyGroups";
import type { MyGroupRow } from "@/types";

function fmtDate(d?: string | null) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return "";
  }
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

  const totalUnread = useMemo(
    () => Object.values(unreadCounts || {}).reduce((sum, n) => sum + (n ?? 0), 0),
    [unreadCounts]
  );
  const totalOpenPolls = useMemo(
    () => Object.values(openPolls || {}).filter(Boolean).length,
    [openPolls]
  );

  const pageTitle = "My Groups";

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-cyan-500 text-white shadow-lg ring-1 ring-emerald-200/60">
        <div className="absolute right-6 top-6 h-24 w-24 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -left-10 -bottom-12 h-32 w-32 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-6 md:px-8 md:py-8">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-white/80">{search ? "Filtered View" : "Dashboard"}</p>
            <h1 className="text-3xl font-black md:text-4xl">{pageTitle}</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/90">
              Stay on top of your circles. Track unread chats, open polls, and jump back in quickly.
            </p>
            {search && (
              <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white/90 ring-1 ring-white/20">
                Filtered by “{search}”
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl bg-white/15 px-4 py-3 text-left shadow-sm ring-1 ring-white/20">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/80">Unread</div>
              <div className="text-2xl font-bold">{totalUnread}</div>
            </div>
            <div className="rounded-2xl bg-white/15 px-4 py-3 text-left shadow-sm ring-1 ring-white/20">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/80">Open Polls</div>
              <div className="text-2xl font-bold">{totalOpenPolls}</div>
            </div>
            <Link
              to="/create"
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              + New Group
            </Link>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="rounded-3xl border border-black/5 bg-white/90 p-5 shadow-xl backdrop-blur">
        {loading && groups.length === 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="h-10 w-10 rounded-full bg-neutral-200 animate-pulse" />
                  <div className="h-6 w-16 rounded-full bg-neutral-200 animate-pulse" />
                </div>
                <div className="mt-4 h-5 w-40 rounded bg-neutral-200 animate-pulse" />
                <div className="mt-2 h-3 w-5/6 rounded bg-neutral-200 animate-pulse" />
                <div className="mt-6 flex gap-2">
                  <div className="h-7 w-20 rounded-full bg-neutral-200 animate-pulse" />
                  <div className="h-7 w-16 rounded-full bg-neutral-200 animate-pulse" />
                  <div className="h-7 w-12 rounded-full bg-neutral-200 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            {err}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center text-neutral-600">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="opacity-70"
            >
              <path d="M8 21h8" />
              <path d="M12 17v4" />
              <path d="M7 3h10l4 7H3l4-7Z" />
            </svg>
            <div className="text-lg font-medium">No groups found</div>
            <div className="text-sm">Try a different filter or create a new one.</div>
            <div className="mt-2 flex justify-center gap-2">
              <Link
                to="/browse"
                className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]"
              >
                Back
              </Link>
              <Link
                to="/create"
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white hover:brightness-110"
              >
                New Group
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {groups.map((g) => {
                const unread = unreadCounts[g.id] ?? 0;
                const hasPoll = !!openPolls[g.id];
                const initial = (g.title || g.game || "G").slice(0, 1).toUpperCase();
                return (
                  <Link
                    key={g.id}
                    to={`/group/${g.id}`}
                    onClick={() => markGroupRead(g.id)}
                    className="group relative flex flex-col rounded-2xl border border-black/5 bg-white/80 p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-emerald-50 to-cyan-50 text-base font-bold text-emerald-700 ring-1 ring-emerald-100">
                        {initial}
                      </div>
                      <div className="flex items-center gap-2">
                        {hasPoll && (
                          <span className="rounded-full bg-blue-600/90 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm">
                            Open poll
                          </span>
                        )}
                        {unread > 0 && (
                          <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm">
                            {unread > 99 ? "99+" : unread} new
                          </span>
                        )}
                        {g.host_id && g.host_id === me && (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                            Host
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      <div className="line-clamp-1 text-lg font-semibold text-neutral-900">
                        {g.title ?? "Untitled group"}
                      </div>
                      <p className="line-clamp-2 text-sm text-neutral-600">
                        {g.description ?? "No description added yet."}
                      </p>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-medium text-neutral-700">
                      {g.category && (
                        <span className="rounded-full border border-black/10 bg-neutral-50 px-2.5 py-1">#{g.category}</span>
                      )}
                      {g.game && (
                        <span className="rounded-full border border-black/10 bg-neutral-50 px-2.5 py-1">{g.game}</span>
                      )}
                      {g.city && (
                        <span className="rounded-full border border-black/10 bg-neutral-50 px-2.5 py-1">{g.city}</span>
                      )}
                    </div>

                    <div className="mt-4 flex items-center justify-between text-xs text-neutral-500">
                      <div className="flex items-center gap-3">
                        {g.capacity ? (
                          <span className="rounded-lg bg-neutral-100 px-2 py-1 font-semibold text-neutral-700">
                            {g.capacity} slots
                          </span>
                        ) : (
                          <span className="rounded-lg bg-neutral-100 px-2 py-1 font-semibold text-neutral-700">
                            Open capacity
                          </span>
                        )}
                        {g.created_at && <span>Created {fmtDate(g.created_at)}</span>}
                      </div>
                      <span className="text-emerald-700 font-semibold group-hover:underline">View</span>
                    </div>
                  </Link>
                );
              })}
            </div>

            {hasMore && (
              <div className="mt-5 border-t border-black/5 p-4 text-center">
                <button
                  onClick={loadMore}
                  className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-neutral-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={paging}
                >
                  {paging ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                        />
                      </svg>
                      Loading…
                    </>
                  ) : (
                    <>Load more</>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
