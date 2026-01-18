import { Link, Outlet, useLocation } from "react-router-dom";
import { Compass, MessageSquare, Users, Bell, User, CheckCircle2, X, MapPin, MessageCircle, UserPlus } from "lucide-react";
import { useAuth } from "@/App";
import { useEffect, useMemo, useState } from "react";

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
      <div className={`relative z-10 ${isChat ? "pb-0" : "pb-[calc(80px+env(safe-area-inset-bottom))]"}`}>
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
