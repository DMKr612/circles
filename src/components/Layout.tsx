import { Link, Outlet, useLocation } from "react-router-dom";
import { Compass, MessageSquare, Users, Bell, User } from "lucide-react";

export default function Layout() {
  const location = useLocation();
  const active = location.pathname;
  const hideNav = active.startsWith("/settings");

  const isActive = (path: string) =>
    active === path || active.startsWith(`${path}/`);

  const links = [
    { to: "/chats", label: "Chats", icon: MessageSquare },
    { to: "/groups", label: "Groups", icon: Users },
    { to: "/browse", label: "Browse", icon: Compass },
    { to: "/notifications", label: "Activity", icon: Bell },
    { to: "/profile", label: "Profile", icon: User },
  ];

  return (
    <div className="relative min-h-dvh bg-white text-slate-900">
      {/* Ambient color washes (kept to the top to avoid a tinted footer) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-20 h-64 w-64 rounded-full bg-[radial-gradient(circle_at_center,#a5b4fc,transparent_55%)] opacity-60 blur-3xl" />
        <div className="absolute top-[30%] right-[-6rem] h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,#c7d2fe,transparent_55%)] opacity-50 blur-3xl" />
      </div>

      {/* Main content wrapper with padding just enough for the nav */}
      <div className="relative z-10 pb-[calc(80px+env(safe-area-inset-bottom))]">
        <div key={active} className="page-transition">
          <Outlet />
        </div>
      </div>

      {/* Bottom Navigation Bar */}
      {!hideNav && (
        <nav className="fixed bottom-4 left-0 right-0 z-[100] px-4 pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto max-w-xl rounded-[28px] border border-white/70 bg-white/80 backdrop-blur-2xl shadow-[0_10px_50px_rgba(15,23,42,0.12)]">
            <div className="flex h-[74px] items-center justify-around px-2">
              {links.map(({ to, label, icon: Icon }) => {
                const activeTab = isActive(to);
                return (
                  <Link
                    key={to}
                    to={to}
                    className="group flex flex-col items-center gap-1 text-[11px] font-medium text-slate-500 transition-all duration-150"
                  >
                    <span
                      className={`grid h-11 w-11 place-items-center rounded-2xl border transition-all duration-200 ${
                        activeTab
                          ? "border-transparent bg-gradient-to-br from-indigo-500 via-purple-500 to-teal-400 text-white shadow-lg shadow-indigo-500/30 animate-pulse"
                          : "border-white/70 bg-white/70 text-slate-600 hover:text-slate-900 hover:shadow-md hover:-translate-y-0.5"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className={activeTab ? "text-slate-900" : "text-slate-500 group-hover:text-slate-800"}>
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
