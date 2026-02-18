import { Link, Outlet, useLocation } from "react-router-dom";
import { Compass, MessageSquare, Bell, User, CheckCircle2, X, MapPin, MessageCircle, UserPlus, Search } from "lucide-react";
import { useAuth } from "@/App";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";


export default function Layout() {
  const { user } = useAuth();
  const location = useLocation();
  const active = location.pathname;
  const hideNav = active.startsWith("/settings");
  const isChat = active.startsWith("/chats");
  const [showChecklist, setShowChecklist] = useState(false);
  const [checklistCollapsed, setChecklistCollapsed] = useState(false);
  const [checklistState, setChecklistState] = useState<boolean[]>([false, false, false, false]);
  const [activeStep, setActiveStep] = useState(0);
  const [chatBadge, setChatBadge] = useState(0);
  const [activityBadge, setActivityBadge] = useState(0);
  const [profileBadge, setProfileBadge] = useState(0);
  const [animatedNav, setAnimatedNav] = useState<{ to: string; startedAt: number } | null>(null);
  const completedCount = checklistState.filter(Boolean).length;

  const checklistKey = useMemo(() => (user?.id ? `circles_first_steps_${user.id}` : null), [user?.id]);
  const collapseKey = useMemo(() => (user?.id ? `circles_first_steps_collapsed_${user.id}` : null), [user?.id]);
  const stateKey = useMemo(() => (user?.id ? `circles_first_steps_state_${user.id}` : null), [user?.id]);

  useEffect(() => {
    if (!checklistKey) {
      setShowChecklist(false);
      return;
    }
    const seen = localStorage.getItem(checklistKey);
    setShowChecklist(!seen);
  }, [checklistKey]);

  useEffect(() => {
    if (!collapseKey) return;
    const c = localStorage.getItem(collapseKey);
    setChecklistCollapsed(c === "1");
  }, [collapseKey]);

  useEffect(() => {
    if (!stateKey) return;
    try {
      const raw = localStorage.getItem(stateKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 4) {
          setChecklistState(parsed.map(Boolean));
          return;
        }
      }
    } catch {}
    setChecklistState([false, false, false, false]);
  }, [stateKey]);

  const dismissChecklist = () => {
    if (checklistKey) localStorage.setItem(checklistKey, "1");
    setShowChecklist(false);
  };

  const collapseChecklist = () => {
    setChecklistCollapsed(true);
    if (collapseKey) localStorage.setItem(collapseKey, "1");
  };

  const expandChecklist = () => {
    setChecklistCollapsed(false);
    if (collapseKey) localStorage.removeItem(collapseKey);
  };

  const toggleStep = (idx: number) => {
    setChecklistState((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      if (stateKey) localStorage.setItem(stateKey, JSON.stringify(next));
      const firstIncomplete = next.findIndex((v) => !v);
      setActiveStep(firstIncomplete === -1 ? next.length - 1 : firstIncomplete);
      return next;
    });
  };

  const stepData = [
    {
      label: "Find or create a Circle",
      sub: "Join something nearby or start your own",
      accent: "emerald",
      primary: "Find a circle near you",
      secondary: "Start a new circle",
      icon: Compass,
    },
    {
      label: "Set your city & availability",
      sub: "So we can show relevant circles",
      accent: "sky",
      primary: "Set location",
      icon: MapPin,
    },
    {
      label: "Say hello",
      sub: "Open a chat or react to a message",
      accent: "indigo",
      primary: "Open first chat",
      icon: MessageCircle,
    },
    {
      label: "Invite one person (optional)",
      sub: "Circles work best with familiar faces",
      accent: "indigo",
      primary: "Invite someone",
      icon: UserPlus,
      optional: true,
    },
  ];

  useEffect(() => {
    const firstIncomplete = checklistState.findIndex((v) => !v);
    setActiveStep(firstIncomplete === -1 ? checklistState.length - 1 : firstIncomplete);
  }, [checklistState]);

  useEffect(() => {
    const handleShow = () => setShowChecklist(true);
    window.addEventListener("circles:show-checklist", handleShow as any);
    return () => window.removeEventListener("circles:show-checklist", handleShow as any);
  }, []);

  useEffect(() => {
    if (!animatedNav) return;
    const t = window.setTimeout(() => {
      setAnimatedNav((current) => (current?.startedAt === animatedNav.startedAt ? null : current));
    }, 5000);
    return () => window.clearTimeout(t);
  }, [animatedNav]);

  useEffect(() => {
    let cancelled = false;
    const uid = user?.id;
    if (!uid) {
      setChatBadge(0);
      setActivityBadge(0);
      setProfileBadge(0);
      return;
    }

    const loadBadges = async () => {
      try {
        const [{ data: memberships }, { count: unreadNotifCount }, { data: profile }] = await Promise.all([
          supabase
            .from("group_members")
            .select("group_id")
            .eq("user_id", uid)
            .in("status", ["active", "accepted"]),
          supabase
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("user_id", uid)
            .eq("is_read", false),
          supabase
            .from("profiles")
            .select("name, city, avatar_url")
            .eq("user_id", uid)
            .maybeSingle(),
        ]);

        if (cancelled) return;
        const groupIds = Array.from(
          new Set((memberships || []).map((m: any) => m.group_id).filter(Boolean))
        );

        let unreadChats = 0;
        if (groupIds.length) {
          const [{ data: reads }, { data: messages }] = await Promise.all([
            supabase
              .from("group_reads")
              .select("group_id, last_read_at")
              .eq("user_id", uid)
              .in("group_id", groupIds),
            supabase
              .from("group_messages")
              .select("group_id, created_at")
              .in("group_id", groupIds)
              .order("created_at", { ascending: false })
              .limit(500),
          ]);

          if (!cancelled) {
            const readMap = new Map<string, string>();
            (reads || []).forEach((r: any) => {
              if (r.group_id && r.last_read_at) readMap.set(r.group_id, r.last_read_at);
            });
            const latestByGroup = new Map<string, string>();
            (messages || []).forEach((m: any) => {
              if (!m.group_id || !m.created_at || latestByGroup.has(m.group_id)) return;
              latestByGroup.set(m.group_id, m.created_at);
            });
            latestByGroup.forEach((lastMsgAt, gid) => {
              const lastReadAt = readMap.get(gid);
              if (!lastReadAt || lastMsgAt > lastReadAt) unreadChats += 1;
            });
          }
        }

        if (cancelled) return;
        setChatBadge(Math.min(99, unreadChats));
        setActivityBadge(Math.min(99, unreadNotifCount || 0));

        const missingProfileBits =
          !String((profile as any)?.name || "").trim() ||
          !String((profile as any)?.city || "").trim();
        setProfileBadge(missingProfileBits ? 1 : 0);
      } catch (e) {
        if (!cancelled) {
          console.warn("[layout] nav badge load failed", e);
          setChatBadge(0);
          setActivityBadge(0);
          setProfileBadge(0);
        }
      }
    };

    loadBadges();
    const t = window.setInterval(loadBadges, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [user?.id, active]);

  const isActive = (path: string) => {
    if (path === "/groups") {
      return active === "/groups" || active.startsWith("/groups/") || active.startsWith("/group/") || active.startsWith("/create");
    }
    if (path === "/notifications") {
      return active === "/notifications" || active.startsWith("/notifications") || active.startsWith("/announcements");
    }
    return active === path || active.startsWith(`${path}/`);
  };

  const links: Array<{
    to: string;
    label: string;
    icon: any;
    kind: "browse" | "circles" | "chat" | "activity" | "profile";
  }> = [
    { to: "/chats", label: "Chat", icon: MessageSquare, kind: "chat" },
    { to: "/browse", label: "Browse", icon: Search, kind: "browse" },
    { to: "/groups", label: "Circles", icon: null, kind: "circles" },
    { to: "/notifications", label: "Activity", icon: Bell, kind: "activity" },
    { to: "/profile", label: "Profile", icon: User, kind: "profile" },
  ];

  const triggerNavIconAnimation = (to: string) => {
    setAnimatedNav({ to, startedAt: Date.now() });
  };

  return (
    <div className="relative min-h-dvh bg-white text-slate-900">
      {/* Ambient color washes (kept to the top to avoid a tinted footer) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-20 h-64 w-64 rounded-full bg-[radial-gradient(circle_at_center,#a5b4fc,transparent_55%)] opacity-60 blur-3xl" />
        <div className="absolute top-[30%] right-[-6rem] h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,#c7d2fe,transparent_55%)] opacity-50 blur-3xl" />
      </div>

      {showChecklist && (
        <div className="fixed right-4 top-20 z-[120] max-w-md w-[min(420px,90vw)]">
          {checklistCollapsed ? (
            <div className="flex items-center justify-between rounded-full border border-emerald-100 bg-white px-4 py-2 shadow-lg shadow-emerald-500/10">
              <div className="flex items-center gap-2 text-sm font-semibold text-neutral-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                First steps ready
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={expandChecklist}
                  className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
                >
                  Open
                </button>
                <button
                  onClick={dismissChecklist}
                  className="rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                  aria-label="Dismiss first steps"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-100 bg-white shadow-xl shadow-emerald-500/10 ring-1 ring-emerald-50 max-h-[90vh] overflow-y-auto">
              <div className="flex items-start gap-3 p-4 sm:p-5">
                <div className="mt-0.5">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                </div>
                <div className="flex-1 space-y-4 pb-2">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">Welcome</p>
                    <p className="text-lg font-bold text-neutral-900">Let’s set up your first Circle</p>
                    <p className="text-sm text-neutral-600">Most people finish this in under 2 minutes.</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-neutral-600">
                      <span>
                        {completedCount === stepData.length ? "All steps done" : `Step ${Math.min(activeStep + 1, stepData.length)} of ${stepData.length}`}
                      </span>
                      <span>{Math.round((completedCount / stepData.length) * 100)}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-sky-500 to-indigo-500 transition-all"
                        style={{ width: `${(completedCount / stepData.length) * 100}%` }}
                      />
                    </div>
                    {completedCount === stepData.length && (
                      <p className="text-[12px] font-semibold text-emerald-700">Nice! You’re all set. 🎉</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    {stepData.map((step, idx) => {
                      const completed = checklistState[idx];
                      const isCurrent = idx === activeStep;
                      const accentBase =
                        step.accent === "emerald"
                          ? "bg-emerald-50 border-emerald-100 text-emerald-800"
                          : step.accent === "sky"
                            ? "bg-gradient-to-r from-emerald-50 to-sky-50 border-emerald-100 text-emerald-900"
                            : "bg-gradient-to-r from-[#2EA6FF1a] to-[#4F46E51a] border-[#4F46E520] text-[#2b2b3a]";
                      const activeAccent =
                        step.accent === "emerald"
                          ? "ring-2 ring-emerald-200"
                          : step.accent === "sky"
                            ? "ring-2 ring-emerald-200"
                            : "ring-2 ring-[#4F46E540]";
                      return (
                        <div
                          key={step.label}
                          className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left shadow-sm transition ${accentBase} ${completed || isCurrent ? activeAccent : ""}`}
                        >
                          {step.icon ? <step.icon className="mt-0.5 h-5 w-5 opacity-70" /> : null}
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-bold text-neutral-900">{step.label}</div>
                              {completed && <span className="text-[11px] font-bold text-emerald-700">✓</span>}
                              {!completed && step.optional && <span className="text-[11px] font-semibold text-neutral-500">Optional</span>}
                            </div>
                            <p className="text-[12px] font-normal text-neutral-600">{step.sub}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => toggleStep(idx)}
                                className={`rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm transition ${
                                  step.accent === "emerald"
                                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                    : step.accent === "sky"
                                      ? "bg-gradient-to-r from-emerald-500 to-sky-500 text-white hover:brightness-105"
                                      : "bg-gradient-to-r from-[#2EA6FF] to-[#4F46E5] text-white hover:brightness-105"
                                }`}
                              >
                                {step.primary}
                              </button>
                              {step.secondary && (
                                <button
                                  type="button"
                                  onClick={() => toggleStep(idx)}
                                  className="text-xs font-semibold text-neutral-700 underline-offset-2 hover:underline"
                                >
                                  {step.secondary}
                                </button>
                              )}
                            </div>
                            {isCurrent && !completed && (
                              <p className="text-[11px] font-semibold text-emerald-700">You’re on this step.</p>
                            )}
                            {step.optional && (
                              <p className="text-[11px] font-medium text-neutral-500">You can skip this for now.</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-end">
                    {completedCount === stepData.length ? (
                      <button
                        type="button"
                        onClick={dismissChecklist}
                        className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:-translate-y-0.5 hover:shadow-xl"
                      >
                        Done
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleStep(activeStep)}
                        className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:-translate-y-0.5 hover:shadow-xl"
                      >
                        Continue →
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <button
                    onClick={collapseChecklist}
                    className="rounded-full px-2 py-1 text-[11px] font-semibold text-neutral-500 hover:bg-neutral-100"
                  >
                    Minimize
                  </button>
                  <button
                    onClick={dismissChecklist}
                    className="rounded-full p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                    aria-label="Dismiss first steps"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main content wrapper with padding just enough for the nav */}
      <div className={`relative z-10 ${isChat ? "pb-0" : "pb-[calc(100px+env(safe-area-inset-bottom))]"}`}>
        <div key={active} className="page-transition">
          <Outlet />
        </div>
      </div>

      {/* Bottom Navigation Bar */}
      {!hideNav && (
        <nav className="fixed bottom-4 left-0 right-0 z-[100] px-4 pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto max-w-5xl rounded-[34px] border border-neutral-200 bg-white/95 px-1.5 py-1 shadow-[0_24px_52px_rgba(15,23,42,0.2)] backdrop-blur-xl">
            <div className="grid grid-cols-5 gap-0.5">
              {links.map(({ to, label, icon: Icon, kind }) => {
                const activeTab = isActive(to);
                const iconAnimating = animatedNav?.to === to;
                const showChatBadge = kind === "chat" && chatBadge > 0;
                const showActivityDot = kind === "activity" && activityBadge > 0;
                const showProfileBadge = kind === "profile" && profileBadge > 0;
                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => triggerNavIconAnimation(to)}
                    className="group flex flex-col items-center justify-center gap-0.5 py-1.5 text-center transition-all duration-150"
                  >
                    <span className={`relative grid h-10 w-10 place-items-center ${iconAnimating ? "nav-icon-click-anim" : ""}`}>
                      {kind === "circles" ? (
                        <>
                          <span className={`relative block h-9 w-9 ${activeTab ? "text-emerald-600" : "text-slate-400"}`}>
                            <svg
                              viewBox="0 0 64 64"
                              className="h-9 w-9 scale-[1.14]"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                              aria-hidden="true"
                            >
                              <g stroke="currentColor" strokeWidth="3.9" strokeLinecap="round" strokeLinejoin="round" fill="none">
                                {/* Left C-ring (gap on the right) */}
                                <path d="M32.03 43.47 A14 14 0 1 0 32.03 20.53" />
                                {/* Right C-ring (gap on the left) */}
                                <path d="M31.97 43.47 A14 14 0 1 1 31.97 20.53" />
                              </g>
                            </svg>
                            {activeTab && (
                              <span className="absolute right-[-1px] top-[-1px] h-2.5 w-2.5 rounded-full bg-emerald-500" />
                            )}
                          </span>
                        </>
                      ) : (
                        <Icon className={`h-9 w-9 ${activeTab ? "text-emerald-600" : "text-slate-400"} stroke-[1.8]`} />
                      )}

                      {showChatBadge && (
                        <span className="absolute right-[-2px] top-0 min-w-[20px] rounded-full bg-rose-500 px-1 py-[2px] text-center text-[10px] font-bold leading-none text-white">
                          {chatBadge > 99 ? "99+" : chatBadge}
                        </span>
                      )}

                      {showActivityDot && (
                        <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-500" />
                      )}

                      {showProfileBadge && (
                        <span className="absolute right-0 top-0 min-w-[20px] rounded-full bg-rose-500 px-1 py-[2px] text-center text-[10px] font-bold leading-none text-white">
                          {profileBadge > 99 ? "99+" : profileBadge}
                        </span>
                      )}
                    </span>
                    <span className={`text-[10px] leading-none ${activeTab ? "font-extrabold text-emerald-600" : "font-semibold text-slate-500 group-hover:text-slate-700"}`}>
                      {label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
      )}
    </div>
  );
}
