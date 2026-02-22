import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/App";

type AuthMode = "signin" | "signup";

function normalizeDestination(path: string | null | undefined): string {
  if (!path || !path.startsWith("/")) return "/browse";
  if (path.startsWith("/auth")) return "/browse";
  return path;
}

function readStoredRedirect(): string | null {
  try {
    return localStorage.getItem("postLoginRedirect");
  } catch {
    return null;
  }
}

function clearStoredRedirect() {
  try {
    localStorage.removeItem("postLoginRedirect");
  } catch {
    // no-op
  }
}

export default function AuthEntry() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const { user } = useAuth();

  const [mode, setMode] = useState<AuthMode | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fromState = useMemo(
    () => (typeof location.state?.from === "string" ? location.state.from : null),
    [location.state]
  );

  useEffect(() => {
    if (!user || mode) return;
    navigate("/browse", { replace: true });
  }, [mode, navigate, user]);

  function goToLanding() {
    navigate("/", { replace: true });
  }

  function openMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setNotice(null);
  }

  function openChoice() {
    setMode(null);
    setError(null);
    setNotice(null);
    setPassword("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!mode) return;

    setError(null);
    setNotice(null);

    const cleanEmail = email.trim();
    const cleanPassword = password.trim();
    if (!cleanEmail || !cleanPassword) {
      setError("Enter both email and password.");
      return;
    }

    try {
      setBusy(true);

      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPassword,
        });
        if (signInError) throw signInError;

        const stored = readStoredRedirect();
        if (stored) clearStoredRedirect();
        const destination = normalizeDestination(stored ?? fromState ?? "/browse");
        navigate(destination, { replace: true });
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password: cleanPassword,
      });
      if (signUpError) throw signUpError;

      if (!data.session) {
        // Some projects may return no session from signUp; attempt a direct sign-in.
        const { error: signInAfterSignupError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPassword,
        });
        if (signInAfterSignupError) {
          setNotice("Check your email to confirm your account, then sign in.");
          setMode("signin");
          setPassword("");
          return;
        }
      }

      clearStoredRedirect();
      navigate("/profile-creation", { replace: true });
    } catch (err: any) {
      setError(err?.message ?? "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[radial-gradient(circle_at_20%_14%,rgba(59,130,246,0.2),transparent_42%),radial-gradient(circle_at_84%_20%,rgba(16,185,129,0.16),transparent_40%),#edf1f9] px-6 py-8 text-slate-900">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-xl flex-col">
        <header className="flex items-center justify-between">
          <button
            type="button"
            onClick={goToLanding}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white/85 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to landing
          </button>

          <div className="inline-flex items-center rounded-2xl border border-white/70 bg-white/85 p-2 shadow-sm">
            <img
              src="/image5.png"
              alt="Circles logo"
              className="h-12 w-12 rounded-xl object-cover"
            />
          </div>
        </header>

        <main className="mt-8 flex flex-1 items-center">
          <section className="w-full rounded-3xl border border-black/10 bg-white/85 p-7 shadow-[0_28px_80px_rgba(15,23,42,0.12)] backdrop-blur">
            {!mode ? (
              <div className="space-y-5">
                <h1 className="text-balance text-3xl font-black leading-tight text-slate-900">
                  Do you already have an account?
                </h1>
                <p className="text-base text-slate-700">
                  Choose how you want to continue.
                </p>

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => openMode("signin")}
                    className="w-full rounded-xl bg-slate-900 px-5 py-3 text-base font-semibold text-white transition hover:bg-black"
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => openMode("signup")}
                    className="w-full rounded-xl border border-slate-300 bg-white px-5 py-3 text-base font-semibold text-slate-900 transition hover:border-slate-400"
                  >
                    Sign Up
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <h1 className="text-3xl font-black text-slate-900">
                    {mode === "signin" ? "Sign in" : "Create account"}
                  </h1>
                  <button
                    type="button"
                    onClick={openChoice}
                    className="text-sm font-semibold text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
                  >
                    Back to options
                  </button>
                </div>
                <p className="text-base text-slate-700">
                  {mode === "signin"
                    ? "Welcome back. Sign in to continue."
                    : "Sign up to start your onboarding and profile setup."}
                </p>

                <form onSubmit={submit} className="space-y-3">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-black/10"
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password (min 6)"
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-black/10"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-base font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? "Please wait..." : mode === "signin" ? "Sign In" : "Sign Up"}
                    {!busy ? <ArrowRight className="h-4 w-4" /> : null}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => openMode(mode === "signin" ? "signup" : "signin")}
                  className="text-sm font-semibold text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
                >
                  {mode === "signin" ? "No account? Sign Up" : "Have an account? Sign In"}
                </button>
              </div>
            )}

            {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
            {notice ? <p className="mt-4 text-sm text-emerald-700">{notice}</p> : null}

            <p className="mt-5 text-xs text-slate-500">
              By continuing, you agree to our{" "}
              <Link to="/legal" className="underline">
                Terms & Privacy Policy
              </Link>
              .
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
