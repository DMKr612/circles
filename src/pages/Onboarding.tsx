import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import type { User } from "@supabase/supabase-js";
import { Clock3, Download, ShieldCheck, Sparkles, Users2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/App";

type Slide = {
  title: string;
  text: string;
  image: string;
};

// Minimal type for beforeinstallprompt (not in TS lib)
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const SLIDES: Slide[] = [
  {
    title: "Create a private circle",
    text: "Spin up a small group (max 7 people) and invite with a code.",
    image: `${import.meta.env.BASE_URL}image2.png`,
  },
  {
    title: "Plan real meetups",
    text: "Schedule gatherings, vote on plans, and lock times everyone agrees on.",
    image: `${import.meta.env.BASE_URL}image3.png`,
  },
  {
    title: "Signal, not noise",
    text: "No endless feed. Just chats, polls, and reminders that keep your group moving.",
    image: `${import.meta.env.BASE_URL}image5.png`,
  },
];

export default function Onboarding() {
  const { user } = useAuth();
  const isLoggedIn = !!user;
  const [index, setIndex] = useState(0);
  const [imgOk, setImgOk] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [registeredCount] = useState<number | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const navigate = useNavigate();
  const location = useLocation() as any;
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const redirectTimerRef = useRef<number | null>(null);
  const hasQueuedRedirectRef = useRef(false);

  useEffect(() => {
    setImgOk(null);
  }, [index]);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) window.clearTimeout(redirectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const checkStandalone = () => {
      const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches || (window.navigator as any)?.standalone;
      if (standalone) {
        setIsInstalled(true);
        setInstallPrompt(null);
      }
    };

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    checkStandalone();
    window.addEventListener("beforeinstallprompt", handleBeforeInstall as any);
    window.addEventListener("appinstalled", handleInstalled);
    window.addEventListener("visibilitychange", checkStandalone);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall as any);
      window.removeEventListener("appinstalled", handleInstalled);
      window.removeEventListener("visibilitychange", checkStandalone);
    };
  }, []);

  const computeDestination = useCallback(() => {
    const previous = location?.state?.from;
    const stored = localStorage.getItem("postLoginRedirect");
    const dest = stored || previous || "/profile";

    if (stored) localStorage.removeItem("postLoginRedirect");
    return location.pathname.includes("onboarding") ? "/profile" : dest;
  }, [location.pathname, location.state]);

  const queueProfileRedirect = useCallback((dest: string) => {
    if (hasQueuedRedirectRef.current) return;
    hasQueuedRedirectRef.current = true;

    if (redirectTimerRef.current) window.clearTimeout(redirectTimerRef.current);
    redirectTimerRef.current = window.setTimeout(() => {
      navigate(dest, { replace: true });
    }, 2000);
  }, [navigate]);

  const handleSignedIn = useCallback((sessionUser: User) => {
    if (hasQueuedRedirectRef.current) return;

    localStorage.setItem("onboardingSeen", "1");
    (async () => {
      try {
        await supabase
          .from("profiles")
          .update({ onboarded: true })
          .eq("user_id", sessionUser.id);
      } catch (err) {
        console.error("Failed to update onboarding:", err);
      }
    })();

    queueProfileRedirect(computeDestination());
  }, [computeDestination, queueProfileRedirect]);

  // Only redirect after an explicit SIGNED_IN event (skip initial cached session to stay on onboarding)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" || !session?.user) return;

      handleSignedIn(session.user);
    });

    return () => subscription.unsubscribe();
  }, [handleSignedIn]);

  useEffect(() => {
    if (!user) return;
    handleSignedIn(user);
  }, [handleSignedIn, user]);

  const isLast = index === SLIDES.length - 1;

  const duration = prefersReducedMotion ? 0 : 0.45;
  const transition = useMemo(() => ({ duration, ease: [0.22, 1, 0.36, 1] as any }), [duration]);

  function goto(i: number) {
    if (i < 0 || i >= SLIDES.length) return;
    setIndex(i);
  }

  function next() {
    setIndex((i) => Math.min(i + 1, SLIDES.length - 1));
  }

  function back() {
    setIndex((i) => Math.max(i - 1, 0));
  }

  // keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const key = e.key?.toLowerCase?.();
      if (!key) return;
      if (key === "arrowright") next();
      if (key === "arrowleft") back();
      if (key === "escape") skip();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function skip() {
    localStorage.setItem("onboardingSeen", "1");
    setIndex(SLIDES.length - 1);
    setShowEmailForm(true);
  }

  // swipe/drag navigation
  const dragThreshold = 90;
  function handleDragEnd(_: any, info: { offset: { x: number } }) {
    const x = info?.offset?.x ?? 0;
    if (x <= -dragThreshold) next();
    else if (x >= dragThreshold) back();
  }

  // segmented progress (0..100)
  const progressPct = ((index + 1) / SLIDES.length) * 100;

  async function submitCreds(e: React.FormEvent) {
    e.preventDefault();
    setAuthErr(null);
    if (!email.trim() || !password.trim()) {
      setAuthErr("Enter email and password");
      return;
    }
    try {
      setAuthBusy(true);
      localStorage.setItem("onboardingSeen", "1");
      if (authMode === "signup") {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password: password.trim() });
        if (error) throw error;
        // Do not navigate here; onAuthStateChange will redirect appropriately
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: password.trim() });
        if (error) throw error;
        // Do not navigate here; onAuthStateChange will redirect appropriately
      }
    } catch (err: any) {
      setAuthErr(err?.message ?? "Authentication failed");
    } finally {
      setAuthBusy(false);
    }
  }

  const installApp = useCallback(async () => {
    if (!installPrompt) return;
    try {
      setInstalling(true);
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === "accepted") {
        setIsInstalled(true);
      }
    } catch (err) {
      console.error("Install prompt failed", err);
    } finally {
      setInstalling(false);
      setInstallPrompt(null);
    }
  }, [installPrompt]);

  return (
    <div
      ref={containerRef}
      className="relative min-h-dvh w-full overflow-hidden bg-gradient-to-br from-slate-900 via-slate-850 to-slate-950 text-white"
      aria-label="Onboarding"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-gradient-to-br from-sky-500/35 via-cyan-400/25 to-transparent blur-3xl" />
        <div className="absolute bottom-[-25%] right-[-18%] h-[28rem] w-[28rem] rounded-full bg-gradient-to-tr from-indigo-600/25 via-blue-500/20 to-transparent blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(255,255,255,0.07),transparent_35%),radial-gradient(circle_at_80%_12%,rgba(255,255,255,0.04),transparent_36%),radial-gradient(circle_at_50%_80%,rgba(255,255,255,0.03),transparent_32%)]" />
      </div>

      <div className="relative mx-auto flex min-h-dvh max-w-6xl flex-col px-6 py-6 lg:py-10">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/20">
              <img
                src={`${import.meta.env.BASE_URL}image5.png`}
                alt="Circles"
                className="h-full w-full object-cover"
              />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-white/60">Circles</p>
              <p className="text-base font-semibold text-white">Micro-communities, IRL ready</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden md:inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-white/80 ring-1 ring-white/10">
              <ShieldCheck className="h-4 w-4 text-emerald-200" />
              Only people you invite can see your data
            </span>
            <button
              onClick={skip}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-lg shadow-emerald-500/20 transition hover:-translate-y-0.5 hover:shadow-xl"
            >
              Skip tour
            </button>
          </div>
        </header>

        <div className="mt-8 grid flex-1 items-center gap-8 lg:grid-cols-[1.05fr,1fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-white/80 ring-1 ring-white/10">
              <Clock3 className="h-4 w-4 text-emerald-200" />
              {index + 1} / {SLIDES.length} — guided setup
            </div>
            <h1 className="text-4xl font-black leading-tight sm:text-5xl text-white">
              Get into a circle fast.
            </h1>
            <p className="max-w-2xl text-lg text-white/90">
              Create a group, pick a time, and meet the same week. No noise, just the updates your circle needs.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: Users2, title: "Right-sized groups", desc: "Small cohorts keep discussion high signal and coordination simple." },
                { icon: ShieldCheck, title: "Verified + private", desc: "Transparent permissions, opt-in sharing, and RLS-secured data." },
                { icon: Sparkles, title: "Actionable threads", desc: "Polls, check-ins, and agendas instead of endless scrolling." },
                { icon: Clock3, title: "Designed for calm", desc: "Smart pacing, quiet hours, and dependable reminders." },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-3 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-md">
                  <item.icon className="mt-1 h-5 w-5 text-emerald-200" />
                  <div>
                    <p className="font-semibold text-white">{item.title}</p>
                    <p className="text-sm text-white/85">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -top-7 right-2 hidden rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white/85 ring-1 ring-white/15 lg:inline-flex">
              {registeredCount !== null ? `${registeredCount.toLocaleString()} people joined` : "Checking activity…"}
            </div>

            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl ring-1 ring-white/10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_18%,rgba(255,255,255,0.1),transparent_42%),radial-gradient(circle_at_82%_35%,rgba(255,255,255,0.08),transparent_38%)]" />
              <div className="relative flex flex-col gap-6 px-6 py-7 sm:px-8">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.15em] text-white/60">
                  <span className="font-semibold text-white/80">Preview</span>
                </div>

                <div className="flex min-h-[28rem] flex-col items-center justify-center">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, x: 60 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -60 }}
                      transition={transition}
                      className="w-full"
                    >
                      <motion.div
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        onDragEnd={handleDragEnd}
                        className="select-none text-center space-y-3"
                      >
                        {imgOk === false ? (
                          <div className="mx-auto mb-6 flex h-64 w-64 items-center justify-center rounded-2xl border border-white/40 bg-white/10 p-3 text-xs text-white/90">
                            Missing image:
                            <span className="ml-1 break-all">{SLIDES[index].image}</span>
                          </div>
                        ) : (
                          <div className="relative mx-auto mb-6 w-full max-w-[32rem] overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_15px_40px_rgba(0,0,0,0.3)]">
                            <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
                            <img
                              src={SLIDES[index].image}
                              alt={SLIDES[index].title}
                              className="h-auto w-full object-contain"
                              draggable={false}
                              onLoad={() => setImgOk(true)}
                              onError={() => { console.error('Onboarding image failed to load:', SLIDES[index].image); setImgOk(false); }}
                            />
                          </div>
                        )}
                        <h1 className="text-3xl font-extrabold">{SLIDES[index].title}</h1>
                        <p className="text-base/7 text-white/80">{SLIDES[index].text}</p>

                        <div className="mx-auto mt-6 w-full max-w-sm text-left">
                          {!isInstalled && isLoggedIn && (
                            <div className="mb-4 flex items-center justify-between rounded-xl border border-white/20 bg-white/10 px-4 py-3 shadow-lg shadow-indigo-500/20">
                              <div className="flex items-start gap-2">
                                <Download className="mt-0.5 h-5 w-5 text-emerald-200" />
                                <div>
                                  <p className="font-semibold text-white">Install Circles</p>
                                  <p className="text-xs text-white/75">
                                    {installPrompt ? "Add it as a standalone app for quick access." : "In Chrome: tap the address bar + or ⋮ → Install app."}
                                  </p>
                                </div>
                              </div>
                              {installPrompt ? (
                                <button
                                  onClick={installApp}
                                  disabled={installing}
                                  className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-slate-900 shadow transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-70"
                                >
                                  {installing ? "Installing…" : "Install"}
                                </button>
                              ) : (
                                <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white/85 ring-1 ring-white/20">
                                  Open in Chrome to install
                                </span>
                              )}
                            </div>
                          )}
                          {!showEmailForm ? (
                            <>
                              <div className="grid grid-cols-1 gap-3">
                                <button
                                  onClick={() => { setShowEmailForm(true); setAuthErr(null); }}
                                  className="w-full rounded-xl bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-cyan-400 px-4 py-3 font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:-translate-y-0.5 hover:shadow-xl"
                                >
                                  Continue with Email
                                </button>
                              </div>

                              <p className="mt-4 text-center text-[10px] text-white/60">
                                By continuing, you agree to our{" "}
                                <Link to="/legal" className="underline hover:text-white">
                                  Terms & Privacy Policy
                                </Link>
                                .
                              </p>
                            </>
                          ) : (
                            <form onSubmit={submitCreds} className="grid grid-cols-1 gap-3">
                              <input
                                type="email"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full rounded-xl border border-white/20 bg-white/15 px-3 py-3 text-white placeholder-white/80 outline-none transition focus:border-white/40 focus:bg-white/25"
                              />
                              <input
                                type="password"
                                placeholder="Password (min 6)"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full rounded-xl border border-white/20 bg-white/15 px-3 py-3 text-white placeholder-white/80 outline-none transition focus:border-white/40 focus:bg-white/25"
                              />
                              <button
                                type="submit"
                                disabled={authBusy}
                                className={`w-full rounded-xl px-4 py-3 font-semibold shadow-lg shadow-indigo-500/20 transition ${authBusy ? "cursor-not-allowed bg-white/40 text-slate-900" : "bg-white text-slate-900 hover:-translate-y-0.5 hover:shadow-xl"}`}
                              >
                                {authBusy ? "Please wait…" : authMode === "signup" ? "Sign up" : "Sign in"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setAuthMode(authMode === "signup" ? "signin" : "signup")}
                                className="text-sm font-semibold text-white underline-offset-2 hover:underline"
                              >
                                {authMode === "signup" ? "Have an account? Sign in" : "No account? Sign up"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowEmailForm(false)}
                                className="text-xs text-white/80 underline-offset-2 hover:text-white hover:underline"
                              >
                                ← Back to options
                              </button>
                            </form>
                          )}
                          {authErr && <div className="mt-3 rounded-lg border border-red-200/70 bg-red-50/90 px-3 py-2 text-sm text-red-800">{authErr}</div>}
                        </div>
                      </motion.div>
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className={`${isLast && showEmailForm ? "hidden" : ""} space-y-3`}>
                  <div className="h-1.5 w-full rounded-full bg-white/20 ring-1 ring-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-100 via-fuchsia-100 to-cyan-100 transition-all"
                      style={{ width: `${progressPct}%` }}
                      aria-hidden
                    />
                  </div>
                  <div className="sr-only" role="status" aria-live="polite">
                    {Math.round(progressPct)} percent complete
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <button
                      onClick={back}
                      disabled={index === 0}
                      className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Previous"
                    >
                      Back
                    </button>

                    <div className="flex gap-2">
                      {SLIDES.map((_, i) => (
                        <button
                          key={i}
                          aria-label={`Go to slide ${i + 1}`}
                          onClick={() => goto(i)}
                          className={`h-3 w-3 rounded-full transition ${i === index ? "bg-white shadow-[0_0_0_6px_rgba(255,255,255,0.12)]" : "bg-white/50 hover:bg-white/70"}`}
                        />
                      ))}
                    </div>

                    <button
                      onClick={next}
                      className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-lg shadow-indigo-500/25 transition hover:-translate-y-0.5 hover:shadow-xl"
                      aria-label={isLast ? "Login" : "Next"}
                    >
                      {isLast ? "Login" : "Next"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
