import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
    title: "Find your people",
    text: "Start a circle that feels like friends, not followers.",
    image: `${import.meta.env.BASE_URL}image.png`,
  },
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
    title: "Stay in sync",
    text: "Lightweight check-ins keep the plan moving without extra noise.",
    image: `${import.meta.env.BASE_URL}image4.png`,
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
  const staggerVariants = useMemo(() => ({
    hidden: {},
    show: { transition: { staggerChildren: prefersReducedMotion ? 0 : 0.08 } },
  }), [prefersReducedMotion]);
  const revealVariants = useMemo(() => ({
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 14 },
    show: { opacity: 1, y: 0, transition: { duration: prefersReducedMotion ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] as any } },
  }), [prefersReducedMotion]);
  const pingClass = prefersReducedMotion ? "" : "animate-ping";

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
      style={{
        "--paper": "#f6f1e8",
        "--ink": "#161515",
        "--coral": "#ff7a59",
        "--coral-soft": "#ffd1bf",
        "--mint": "#77d7c3",
        "--sky": "#9bc9ff",
        "--sun": "#ffd887",
      } as CSSProperties}
      className="relative min-h-dvh w-full overflow-hidden bg-[color:var(--paper)] text-[color:var(--ink)]"
      aria-label="Onboarding"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(255,209,191,0.75),transparent_65%)] blur-3xl" />
        <div className="absolute right-[-18%] top-[12%] h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,rgba(119,215,195,0.65),transparent_60%)] blur-3xl" />
        <div className="absolute bottom-[-24%] left-[30%] h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,rgba(155,201,255,0.55),transparent_65%)] blur-3xl" />
        <div
          className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.12)_1px,transparent_0)] opacity-30"
          style={{ backgroundSize: "18px 18px" }}
        />
      </div>

      <div className="relative mx-auto flex min-h-dvh max-w-6xl flex-col px-6 py-6 lg:py-10">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-white/80 ring-1 ring-black/5 shadow-sm">
              <img
                src={`${import.meta.env.BASE_URL}image5.png`}
                alt="Circles"
                className="h-full w-full object-cover"
              />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-slate-500">Circles</p>
              <p className="text-base font-semibold text-slate-900">close-communities, IRL ready</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden md:inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-black/10 shadow-sm">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Invite-only privacy by design
            </span>
            <button
              onClick={skip}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:shadow-xl"
            >
              Skip tour
            </button>
          </div>
        </header>

        <div className="mt-8 grid flex-1 items-center gap-8 lg:grid-cols-[1.05fr,1fr]">
          <motion.div
            variants={staggerVariants}
            initial="hidden"
            animate="show"
            className="space-y-6"
          >
            <motion.div
              variants={revealVariants}
              className="inline-flex items-center gap-3 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-black/10 shadow-sm"
            >
              <span className="relative flex h-2 w-2">
                <span className={`absolute inline-flex h-full w-full ${pingClass} rounded-full bg-[color:var(--coral)] opacity-70`} />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--coral)]" />
              </span>
              Step {index + 1} of {SLIDES.length} - guided setup
            </motion.div>
            <motion.h1
              variants={revealVariants}
              className="text-4xl font-black leading-tight sm:text-6xl text-slate-900"
            >
              From On-line to On-Life,{" "}
              <span className="bg-gradient-to-r from-[color:var(--coral)] via-[color:var(--sun)] to-[color:var(--mint)] bg-clip-text text-transparent">
                Smarter
              </span>
              .
            </motion.h1>
            <motion.p variants={revealVariants} className="max-w-2xl text-lg text-slate-700">
              Create a circle or join one, connect with people like yourself, vote on plans or create one, and lock a time in days.
            </motion.p>

            <motion.div variants={staggerVariants} className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: Users2, title: "Right-sized groups", desc: "Small cohorts keep discussion high signal and coordination simple." },
                { icon: ShieldCheck, title: "Verified + private", desc: "Transparent permissions, opt-in sharing, and RLS-secured data." },
                { icon: Sparkles, title: "Actionable threads", desc: "Polls, check-ins, and agendas instead of endless scrolling." },
                { icon: Clock3, title: "Designed for calm", desc: "Smart pacing, quiet hours, and dependable reminders." },
              ].map((item) => (
                <motion.div
                  key={item.title}
                  variants={revealVariants}
                  className="flex items-start gap-3 rounded-2xl border border-black/10 bg-white/80 px-4 py-3 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur"
                >
                  <item.icon className="mt-1 h-5 w-5 text-[color:var(--coral)]" />
                  <div>
                    <p className="font-semibold text-slate-900">{item.title}</p>
                    <p className="text-sm text-slate-600">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] as any }}
            className="relative"
          >
            <div className="relative overflow-hidden rounded-3xl border border-black/10 bg-white/80 shadow-[0_40px_100px_rgba(15,23,42,0.15)] ring-1 ring-white/70 backdrop-blur">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_18%,rgba(255,255,255,0.85),transparent_55%),radial-gradient(circle_at_82%_35%,rgba(255,220,180,0.45),transparent_48%)]" />
              <div className="relative flex flex-col gap-6 px-6 py-7 sm:px-8">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.16em] text-slate-500">
                  <span className="font-semibold text-slate-700">Preview</span>
                  <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-white">Swipe</span>
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
                      <div className="text-center space-y-3">
                        <motion.div
                          drag="x"
                          dragConstraints={{ left: 0, right: 0 }}
                          onDragEnd={handleDragEnd}
                          className="select-none"
                        >
                          {imgOk === false ? (
                            <div className="mx-auto mb-6 flex h-64 w-64 items-center justify-center rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
                              Missing image:
                              <span className="ml-1 break-all">{SLIDES[index].image}</span>
                            </div>
                          ) : (
                            <div className="relative mx-auto mb-6 w-full max-w-[32rem] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
                              <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-white/40" />
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
                        </motion.div>
                        <h1 className="text-3xl font-black text-slate-900">{SLIDES[index].title}</h1>
                        <p className="text-base/7 text-slate-600">{SLIDES[index].text}</p>

                        <div className="mx-auto mt-6 w-full max-w-sm text-left">
                          {!isInstalled && isLoggedIn && (
                            <div className="mb-4 flex items-center justify-between rounded-xl border border-black/10 bg-white/80 px-4 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
                              <div className="flex items-start gap-2">
                                <Download className="mt-0.5 h-5 w-5 text-[color:var(--coral)]" />
                                <div>
                                  <p className="font-semibold text-slate-900">Install Circles</p>
                                  <p className="text-xs text-slate-500">
                                    {installPrompt ? "Add it as a standalone app for quick access." : "In Chrome: tap the address bar + or ⋮ → Install app."}
                                  </p>
                                </div>
                              </div>
                              {installPrompt ? (
                                <button
                                  onClick={installApp}
                                  disabled={installing}
                                  className="rounded-full bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-70"
                                >
                                  {installing ? "Installing…" : "Install"}
                                </button>
                              ) : (
                                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-black/5">
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
                                  className="w-full rounded-xl bg-gradient-to-r from-[color:var(--coral)] via-[color:var(--sun)] to-[color:var(--mint)] px-4 py-3 font-semibold text-slate-900 shadow-lg shadow-orange-500/20 transition hover:-translate-y-0.5 hover:shadow-xl"
                                >
                                  Continue with Email
                                </button>
                              </div>

                              <p className="mt-4 text-center text-[10px] text-slate-500">
                                By continuing, you agree to our{" "}
                                <Link to="/legal" className="underline text-slate-700 hover:text-slate-900">
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
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-slate-900 placeholder-slate-400 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-black/10"
                              />
                              <input
                                type="password"
                                placeholder="Password (min 6)"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-slate-900 placeholder-slate-400 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-black/10"
                              />
                              <button
                                type="submit"
                                disabled={authBusy}
                                className={`w-full rounded-xl px-4 py-3 font-semibold shadow-lg shadow-black/10 transition ${authBusy ? "cursor-not-allowed bg-slate-200 text-slate-500" : "bg-slate-900 text-white hover:-translate-y-0.5 hover:shadow-xl"}`}
                              >
                                {authBusy ? "Please wait…" : authMode === "signup" ? "Sign up" : "Sign in"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setAuthMode(authMode === "signup" ? "signin" : "signup")}
                                className="text-sm font-semibold text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
                              >
                                {authMode === "signup" ? "Have an account? Sign in" : "No account? Sign up"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowEmailForm(false)}
                                className="text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
                              >
                                ← Back to options
                              </button>
                            </form>
                          )}
                          {authErr && <div className="mt-3 rounded-lg border border-red-200/70 bg-red-50/90 px-3 py-2 text-sm text-red-800">{authErr}</div>}
                        </div>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className={`${isLast && showEmailForm ? "hidden" : ""} space-y-3`}>
                  <div className="h-1.5 w-full rounded-full bg-slate-200 ring-1 ring-black/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[color:var(--coral)] via-[color:var(--sun)] to-[color:var(--mint)] transition-all"
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
                      className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-black/20 hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
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
                          className={`h-3 w-3 rounded-full transition ${i === index ? "bg-slate-900 shadow-[0_0_0_6px_rgba(15,23,42,0.12)]" : "bg-slate-300 hover:bg-slate-400"}`}
                        />
                      ))}
                    </div>

                    <button
                      onClick={next}
                      className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:shadow-xl"
                      aria-label={isLast ? "Login" : "Next"}
                    >
                      {isLast ? "Login" : "Next"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

    </div>
  );
}
