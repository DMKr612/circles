import { Link, Outlet, useLocation } from "react-router-dom";
import { MessageSquare, Bell, User, Search } from "lucide-react";
import { useAuth } from "@/App";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppLanguage } from "@/state/language";


export default function Layout() {
  const { user } = useAuth();
  const { lang } = useAppLanguage();
  const location = useLocation();
  const active = location.pathname;
  const hideNav = active.startsWith("/settings") || active.startsWith("/quiz");
  const isChat = active.startsWith("/chats");
  const [chatBadge, setChatBadge] = useState(0);
  const [activityBadge, setActivityBadge] = useState(0);
  const [profileBadge, setProfileBadge] = useState(0);
  const [animatedNav, setAnimatedNav] = useState<{ to: string; startedAt: number } | null>(null);

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
    {
      to: "/chats",
      label: lang === "de" ? "Chat" : lang === "fa" ? "چت" : "Chat",
      icon: MessageSquare,
      kind: "chat",
    },
    {
      to: "/browse",
      label: lang === "de" ? "Entdecken" : lang === "fa" ? "مرور" : "Browse",
      icon: Search,
      kind: "browse",
    },
    {
      to: "/groups",
      label: lang === "de" ? "Kreise" : lang === "fa" ? "حلقه‌ها" : "Circles",
      icon: null,
      kind: "circles",
    },
    {
      to: "/notifications",
      label: lang === "de" ? "Aktivität" : lang === "fa" ? "فعالیت" : "Activity",
      icon: Bell,
      kind: "activity",
    },
    {
      to: "/profile",
      label: lang === "de" ? "Profil" : lang === "fa" ? "پروفایل" : "Profile",
      icon: User,
      kind: "profile",
    },
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
