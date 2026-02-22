import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { reverseGeocodeCity } from "@/lib/geocode";
import { useAuth } from "@/App";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type FlowStep = 0 | 1 | 2 | 3 | 4 | 5;

const INTEREST_OPTIONS = ["Games", "Study", "Outdoors", "Sports", "Music", "Other"];

function readSessionValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function readSessionStep(): FlowStep {
  const raw = readSessionValue("onboarding_step");
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return 0;
  if (parsed === 3) return 4;
  if (parsed < 0 || parsed > 4) return 0;
  return parsed as FlowStep;
}

function readSessionInterests(): string[] {
  const raw = readSessionValue("onboarding_interests");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => typeof x === "string");
  } catch {
    return [];
  }
}

function readAccountHint(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("onboarding_has_account_hint") === "1";
  } catch {
    return false;
  }
}

function getPresenceGuestId(): string {
  const existing = readSessionValue("onboarding_presence_guest_id");
  if (existing) return existing;

  const generated = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    sessionStorage.setItem("onboarding_presence_guest_id", generated);
  } catch {
    // no-op
  }

  return generated;
}

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as any;
  const prefersReducedMotion = useReducedMotion();

  const [hasAccountHint, setHasAccountHint] = useState<boolean>(() => readAccountHint());
  const [onlineCount, setOnlineCount] = useState(0);
  const [onlineReady, setOnlineReady] = useState(false);

  const [step, setStep] = useState<FlowStep>(() => readSessionStep());
  const [stepErr, setStepErr] = useState<string | null>(null);

  const [cityInput, setCityInput] = useState(() => readSessionValue("onboarding_city") || "");
  const [detectedCity, setDetectedCity] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationErr, setLocationErr] = useState<string | null>(null);

  const [interests, setInterests] = useState<string[]>(() => readSessionInterests());

  const [authMode, setAuthMode] = useState<"signin" | "signup">(() => (readAccountHint() ? "signin" : "signup"));
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);

  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  const redirectTimerRef = useRef<number | null>(null);
  const hasQueuedRedirectRef = useRef(false);
  const shouldRouteToProfileCreationRef = useRef(false);

  const city = cityInput.trim() || detectedCity.trim();

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
    }, 700);
  }, [navigate]);

  const markOnboardingSeen = useCallback(() => {
    try {
      localStorage.setItem("onboardingSeen", "1");
    } catch {
      // no-op
    }
  }, []);

  const clearOnboardingDraft = useCallback(() => {
    try {
      sessionStorage.removeItem("onboarding_step");
      sessionStorage.removeItem("onboarding_city");
      sessionStorage.removeItem("onboarding_interests");
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) window.clearTimeout(redirectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem("onboarding_step", String(Math.min(step, 4)));
      sessionStorage.setItem("onboarding_city", cityInput);
      sessionStorage.setItem("onboarding_interests", JSON.stringify(interests));
    } catch {
      // no-op
    }
  }, [cityInput, interests, step]);

  useEffect(() => {
    try {
      localStorage.setItem("onboarding_has_account_hint", hasAccountHint ? "1" : "0");
    } catch {
      // no-op
    }
  }, [hasAccountHint]);

  useEffect(() => {
    if (!user?.id) return;
    setHasAccountHint(true);
  }, [user?.id]);

  useEffect(() => {
    let active = true;
    const presenceKey = user?.id ? `user:${user.id}` : `guest:${getPresenceGuestId()}`;
    const channel = supabase.channel("presence:onboarding:lobby", {
      config: { presence: { key: presenceKey } },
    });

    channel.on("presence", { event: "sync" }, () => {
      if (!active) return;
      const state = channel.presenceState() as Record<string, Array<{ user_id?: string | null }>>;
      setOnlineCount(Object.keys(state).length);
      setOnlineReady(true);
    });

    channel.subscribe(async (status) => {
      if (!active) return;
      if (status === "SUBSCRIBED") {
        try {
          await channel.track({
            user_id: user?.id ?? null,
            route: "onboarding",
            online_at: new Date().toISOString(),
          });
        } catch {
          // no-op
        }
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setOnlineReady(false);
      }
    });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

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

  useEffect(() => {
    if (!user) {
      shouldRouteToProfileCreationRef.current = false;
      return;
    }

    markOnboardingSeen();

    if (shouldRouteToProfileCreationRef.current) {
      shouldRouteToProfileCreationRef.current = false;
      clearOnboardingDraft();
      navigate("/profile-creation", { replace: true });
      return;
    }

    clearOnboardingDraft();
    queueProfileRedirect(computeDestination());
  }, [
    clearOnboardingDraft,
    computeDestination,
    markOnboardingSeen,
    navigate,
    queueProfileRedirect,
    user,
  ]);

  const detectLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocationErr("Location not available on this device.");
      return;
    }

    setLocationBusy(true);
    setLocationErr(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        try {
          const reverse = await reverseGeocodeCity({ lat, lng });
          const name = reverse?.city?.trim();
          setDetectedCity(name || `${lat.toFixed(2)}, ${lng.toFixed(2)}`);
        } catch {
          setDetectedCity(`${lat.toFixed(2)}, ${lng.toFixed(2)}`);
        } finally {
          setLocationBusy(false);
        }
      },
      () => {
        setLocationBusy(false);
        setLocationErr("Could not detect location. Enter your city manually.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  function toggleInterest(value: string) {
    setStepErr(null);
    setInterests((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  function continueFromLocation() {
    if (!city) {
      setStepErr("Enter your city to continue.");
      return;
    }
    setStepErr(null);
    setStep(2);
  }

  function continueFromInterests() {
    if (!interests.length) {
      setStepErr("Pick at least one interest.");
      return;
    }
    setStepErr(null);
    setStep(4);
  }

  async function submitCreds(e: React.FormEvent) {
    e.preventDefault();
    setAuthErr(null);

    if (!email.trim() || !password.trim()) {
      setAuthErr("Enter email and password");
      return;
    }

    try {
      setAuthBusy(true);

      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: password.trim() });
        if (error) throw error;
        setHasAccountHint(true);

        if (!data?.session) {
          // If signUp doesn't return a session, try direct sign-in before asking for email confirmation.
          const { error: signInAfterSignupError } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password: password.trim(),
          });
          if (signInAfterSignupError) {
            setAuthErr("Check your email to confirm your account, then sign in.");
            setAuthMode("signin");
            setShowEmailForm(true);
            return;
          }
        }

        shouldRouteToProfileCreationRef.current = true;
        clearOnboardingDraft();
        navigate("/profile-creation", { replace: true });
        return;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: password.trim() });
        if (error) throw error;
        setHasAccountHint(true);
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
      if (outcome === "accepted") setIsInstalled(true);
    } catch (err) {
      console.error("Install prompt failed", err);
    } finally {
      setInstalling(false);
      setInstallPrompt(null);
    }
  }, [installPrompt]);

  const heroCtaLabel = hasAccountHint ? "Sign In" : "Get Started";
  const onlineCountLabel = onlineReady ? onlineCount.toLocaleString() : "…";
  const onlineSuffixLabel = onlineReady
    ? `${onlineCount === 1 ? "person" : "people"} online now.`
    : "checking how many people are online...";

  function handleHeroPrimaryClick() {
    setStepErr(null);
    setAuthErr(null);

    if (hasAccountHint) {
      setAuthMode("signin");
      setShowEmailForm(false);
      setStep(4);
      return;
    }

    setStep(1);
  }

  function goBackToLanding() {
    navigate("/");
  }

  return (
    <div
      style={{
        "--paper": "#e7edf8",
        "--ink": "#1f2c47",
        "--muted": "#5f7090",
        "--accent": "#7166ff",
        "--cta-from": "#1b2b67",
        "--cta-to": "#2951a6",
      } as CSSProperties}
      className="relative min-h-dvh w-full overflow-hidden bg-[color:var(--paper)] text-[color:var(--ink)]"
      aria-label="Onboarding"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_10%,rgba(138,120,255,0.34)_0,transparent_42%),radial-gradient(circle_at_88%_18%,rgba(56,128,255,0.24)_0,transparent_40%),radial-gradient(circle_at_20%_78%,rgba(255,255,255,0.72)_0,transparent_44%),radial-gradient(circle_at_84%_86%,rgba(120,176,255,0.24)_0,transparent_38%)]" />
        <div className="absolute -left-20 -top-10 h-[26rem] w-[26rem] rounded-full bg-violet-300/26 blur-3xl" />
        <div className="absolute right-[-10%] top-14 h-[24rem] w-[24rem] rounded-full bg-blue-300/24 blur-3xl" />
        <div className="absolute -bottom-20 left-[-6%] h-[20rem] w-[20rem] rounded-full bg-white/45 blur-3xl" />
        <div className="absolute bottom-[-14%] right-[-2%] h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,rgba(120,164,255,0.4),transparent_64%)] blur-3xl" />
      </div>

      {step === 0 ? (
        <div className="relative mx-auto flex min-h-dvh w-full max-w-5xl flex-col items-center px-6 pb-10 pt-10 text-center md:px-10 md:pt-12">
          <div className="w-full">
            <button
              type="button"
              onClick={goBackToLanding}
              className="inline-flex items-center rounded-full border border-black/10 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-white"
            >
              Back to landing
            </button>
          </div>

          <motion.header
            initial={{ opacity: 0, y: prefersReducedMotion ? 0 : -14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.45, ease: "easeOut" }}
            className="relative mt-4 inline-flex items-center justify-center"
          >
            <div className="pointer-events-none absolute -inset-x-20 -inset-y-12 rounded-full bg-[radial-gradient(circle,rgba(110,98,255,0.48)_0%,rgba(56,124,255,0.34)_42%,transparent_72%)] blur-2xl" />
            <img
              src="/image5.png"
              alt="Circles logo"
              className="relative w-[min(86vw,33rem)] rounded-[1.8rem] object-cover ring-1 ring-white/45 shadow-[0_28px_70px_rgba(23,38,78,0.36)]"
            />
          </motion.header>

          <motion.main
            initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.5, delay: prefersReducedMotion ? 0 : 0.05, ease: "easeOut" }}
            className="mt-[13vh] flex w-full flex-1 flex-col items-center"
          >
            <h1 className="max-w-4xl text-balance text-[clamp(2.3rem,6.4vw,5rem)] font-bold leading-[1.06] tracking-[-0.02em] text-[color:var(--ink)]">
              Meet your people this week.
            </h1>
            <p className="mt-5 max-w-xl text-balance text-[clamp(1.15rem,2.2vw,1.9rem)] font-medium text-[color:var(--muted)]">
              Join small trusted circles near you.
            </p>

            <div className="mt-12 w-full max-w-xl rounded-[2rem] border border-white/72 bg-white/70 px-5 py-8 shadow-[0_24px_80px_rgba(17,30,56,0.18)] backdrop-blur-md">
              <button
                type="button"
                onClick={handleHeroPrimaryClick}
                className="mx-auto block w-full max-w-[20rem] rounded-[1rem] bg-[linear-gradient(120deg,var(--cta-from),var(--cta-to)_54%,#1f3f7d)] px-7 py-4 text-[clamp(1.55rem,6vw,1.95rem)] font-bold leading-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_14px_28px_rgba(13,28,58,0.4)] transition hover:-translate-y-0.5 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/70 focus-visible:ring-offset-2"
              >
                {heroCtaLabel}
              </button>
              <p className="mt-5 text-[1.15rem] font-medium text-[color:var(--muted)]">
                {hasAccountHint ? "Welcome back." : "Takes less than 30 seconds"}
              </p>
              <button
                type="button"
                onClick={() => {
                  const nextHasAccount = !hasAccountHint;
                  setHasAccountHint(nextHasAccount);
                  setAuthMode(nextHasAccount ? "signin" : "signup");
                }}
                className="mt-3 text-sm font-semibold text-[color:var(--ink)]/72 underline-offset-2 hover:underline"
              >
                {hasAccountHint ? "New here? Get Started" : "Already have an account? Sign In"}
              </button>
            </div>

            {stepErr ? <p className="mt-4 text-sm text-red-700">{stepErr}</p> : null}
          </motion.main>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.45, delay: prefersReducedMotion ? 0 : 0.12 }}
            className="mt-auto pb-4 text-[clamp(1.05rem,2vw,1.65rem)] text-[color:var(--muted)]"
          >
            <span className="font-semibold text-[color:var(--ink)]">{onlineCountLabel}</span> {onlineSuffixLabel}
          </motion.p>
        </div>
      ) : (
        <div className="relative mx-auto flex min-h-dvh w-full max-w-xl flex-col px-6 py-8">
          <header className="flex items-center justify-between">
            <div className="inline-flex items-center gap-3">
              <button
                type="button"
                onClick={goBackToLanding}
                className="rounded-full border border-black/10 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm transition hover:bg-white"
              >
                Back
              </button>
              <div className="inline-flex items-center rounded-2xl border border-white/60 bg-white/80 p-2 shadow-sm">
                <img
                  src="/image5.png"
                  alt="Circles logo"
                  className="h-12 w-12 rounded-lg object-cover"
                />
              </div>
            </div>

            {step > 0 && step < 5 ? (
              <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-black/10">
                Step {Math.min(step >= 4 ? 3 : step, 3)} of 3
              </span>
            ) : null}
          </header>

          <main className="flex flex-1 items-center">
            <motion.section
              key={step}
              initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.35, ease: "easeOut" }}
              className="mt-6 w-full rounded-3xl border border-black/10 bg-white/85 p-6 shadow-[0_28px_80px_rgba(15,23,42,0.12)] backdrop-blur"
            >

            {step === 1 ? (
              <div className="space-y-5">
                <h1 className="text-3xl font-black text-slate-900">Where are you located?</h1>
                <p className="text-base text-slate-700">We&apos;ll show circles near you.</p>

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={detectLocation}
                    disabled={locationBusy}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {locationBusy ? "Detecting location..." : "Auto-detect location"}
                  </button>

                  <input
                    type="text"
                    value={cityInput}
                    onChange={(e) => {
                      setCityInput(e.target.value);
                      setStepErr(null);
                    }}
                    placeholder="Or type your city"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-black/10"
                  />

                  {detectedCity ? <p className="text-sm font-medium text-emerald-700">Detected: {detectedCity}</p> : null}
                  {locationErr ? <p className="text-sm text-red-700">{locationErr}</p> : null}
                </div>

                <button
                  type="button"
                  onClick={continueFromLocation}
                  className="w-full rounded-xl bg-slate-900 px-5 py-3 text-base font-semibold text-white transition hover:bg-black"
                >
                  Continue
                </button>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-5">
                <h1 className="text-3xl font-black text-slate-900">What are you into?</h1>
                <p className="text-base text-slate-700">Pick what fits you.</p>

                <div className="flex flex-wrap gap-2">
                  {INTEREST_OPTIONS.map((option) => {
                    const active = interests.includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => toggleInterest(option)}
                        className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                          active
                            ? "bg-slate-900 text-white"
                            : "border border-slate-300 bg-white text-slate-800 hover:border-slate-400"
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={continueFromInterests}
                  className="w-full rounded-xl bg-slate-900 px-5 py-3 text-base font-semibold text-white transition hover:bg-black"
                >
                  Continue
                </button>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="space-y-5">
                <h1 className="text-3xl font-black text-slate-900">
                  {authMode === "signin" ? "Sign in to continue." : "Create your account to continue."}
                </h1>
                <p className="text-base text-slate-700">{authMode === "signin" ? "Welcome back." : "One quick step left."}</p>

                {!showEmailForm ? (
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEmailForm(true);
                        setAuthErr(null);
                      }}
                      className="w-full rounded-xl bg-slate-900 px-5 py-3 text-base font-semibold text-white transition hover:bg-black"
                    >
                      {authMode === "signin" ? "Sign in with email" : "Continue with email"}
                    </button>

                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      title="Google sign-in is currently locked"
                      className="w-full cursor-not-allowed rounded-xl border border-slate-300 bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-500 opacity-80"
                    >
                      Google (Locked)
                    </button>

                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      title="Apple sign-in is currently locked"
                      className="w-full cursor-not-allowed rounded-xl border border-slate-300 bg-slate-100 px-5 py-3 text-sm font-semibold text-slate-500 opacity-80"
                    >
                      Apple (Locked)
                    </button>
                  </div>
                ) : (
                  <form onSubmit={submitCreds} className="space-y-3">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-black/10"
                    />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password (min 6)"
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-black/10"
                    />
                    <button
                      type="submit"
                      disabled={authBusy}
                      className="w-full rounded-xl bg-slate-900 px-5 py-3 text-base font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {authBusy ? "Please wait..." : authMode === "signup" ? "Sign up" : "Sign in"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const nextMode = authMode === "signup" ? "signin" : "signup";
                        setAuthMode(nextMode);
                        setHasAccountHint(nextMode === "signin");
                      }}
                      className="w-full text-sm font-semibold text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
                    >
                      {authMode === "signup" ? "Have an account? Sign in" : "No account? Sign up"}
                    </button>
                  </form>
                )}

                {authErr ? <p className="text-sm text-red-700">{authErr}</p> : null}
                <p className="text-[11px] text-slate-500">
                  By continuing, you agree to our <Link to="/legal" className="underline">Terms & Privacy Policy</Link>.
                </p>
              </div>
            ) : null}

            {step === 5 ? (
              <div className="space-y-5">
                <h1 className="text-3xl font-black text-slate-900">Add Circles to your home screen.</h1>
                <p className="text-base text-slate-700">Get meetup reminders.</p>

                {!isInstalled ? (
                  <div className="space-y-3">
                    {installPrompt ? (
                      <button
                        type="button"
                        onClick={installApp}
                        disabled={installing}
                        className="w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {installing ? "Installing..." : "Add to Home Screen"}
                      </button>
                    ) : (
                      <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        In Chrome: tap the address bar + or menu and choose Install app.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                    Circles is installed.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => {
                    clearOnboardingDraft();
                    navigate(computeDestination(), { replace: true });
                  }}
                  className="w-full rounded-xl bg-slate-900 px-5 py-3 text-base font-semibold text-white transition hover:bg-black"
                >
                  Continue to Circles
                </button>
              </div>
            ) : null}

            {stepErr ? <p className="mt-4 text-sm text-red-700">{stepErr}</p> : null}
            </motion.section>
          </main>
        </div>
      )}
    </div>
  );
}
