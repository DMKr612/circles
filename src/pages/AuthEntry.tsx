import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/App";
import "./AuthEntry.css";

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

function parseRequestedMode(search: string): AuthMode {
  const params = new URLSearchParams(search);
  return params.get("mode") === "signup" ? "signup" : "signin";
}

export default function AuthEntry() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const { user } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [waitlistName, setWaitlistName] = useState("");
  const [waitlistCity, setWaitlistCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formStageKey, setFormStageKey] = useState(0);

  const fromState = useMemo(
    () => (typeof location.state?.from === "string" ? location.state.from : null),
    [location.state],
  );

  const requestedMode = useMemo(() => parseRequestedMode(location.search), [location.search]);

  const waitlistContext = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const status = params.get("waitlist");
    const emailFromLink = params.get("email")?.trim().toLowerCase() ?? "";
    const code = params.get("code")?.trim() ?? "";
    return {
      approved: status === "approved" && Boolean(emailFromLink) && Boolean(code),
      emailFromLink,
    };
  }, [location.search]);

  const [mode, setMode] = useState<AuthMode>(waitlistContext.approved ? "signup" : requestedMode);

  useEffect(() => {
    if (!user) return;
    navigate("/browse", { replace: true });
  }, [navigate, user]);

  useEffect(() => {
    if (!waitlistContext.approved) {
      setMode((current) => (current === requestedMode ? current : requestedMode));
      return;
    }

    setMode("signup");
    setEmail((current) => current || waitlistContext.emailFromLink);
    setError(null);
    setNotice("You are approved. Set your password to activate access.");
  }, [requestedMode, waitlistContext.approved, waitlistContext.emailFromLink]);

  function goToLanding() {
    navigate("/", { replace: true });
  }

  function switchTab(nextMode: AuthMode) {
    if (waitlistContext.approved && nextMode === "signin") return;
    if (mode === nextMode) return;

    setMode(nextMode);
    setError(null);
    setNotice(null);
    setPassword("");
    setConfirmPassword("");
    setFormStageKey((key) => key + 1);
  }

  async function sendResetPassword() {
    setError(null);
    setNotice(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Enter your email first.");
      return;
    }

    try {
      setResetBusy(true);
      const redirectTo = `${window.location.origin}/auth?mode=signin`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo });
      if (resetError) throw resetError;
      setNotice("Password reset email sent. Check your inbox.");
    } catch (err: any) {
      setError(err?.message ?? "Failed to send reset email.");
    } finally {
      setResetBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();

    setError(null);
    setNotice(null);

    const approvedSignup = mode === "signup" && waitlistContext.approved;
    const cleanEmail = (approvedSignup ? waitlistContext.emailFromLink : email.trim()).toLowerCase();
    const cleanPassword = password.trim();
    const cleanConfirmPassword = confirmPassword.trim();
    const cleanName = waitlistName.trim();
    const cleanCity = waitlistCity.trim();

    if (!cleanEmail) {
      setError("Enter your email.");
      return;
    }

    const requiresPassword = mode === "signin" || approvedSignup;
    if (requiresPassword && !cleanPassword) {
      setError("Enter your password.");
      return;
    }

    if (approvedSignup) {
      if (cleanPassword.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
      if (!cleanConfirmPassword) {
        setError("Confirm your password.");
        return;
      }
      if (cleanPassword !== cleanConfirmPassword) {
        setError("Passwords do not match.");
        return;
      }
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

      if (!waitlistContext.approved) {
        const { data: waitlistData, error: waitlistError } = await supabase.functions.invoke("waitlist-request", {
          body: {
            email: cleanEmail,
            name: cleanName || undefined,
            source: cleanCity ? `city:${cleanCity}` : "auth_page",
          },
        });
        if (waitlistError) throw waitlistError;

        const status = String((waitlistData as any)?.status || "");
        const message = String((waitlistData as any)?.message || "");

        if (status === "already_waitlisted") {
          setError(message || "You are in waitlist.");
          return;
        }

        if (status === "already_has_account") {
          setError(message || "You have been approved. Join and click Login with your password.");
          setMode("signin");
          setPassword("");
          setConfirmPassword("");
          setFormStageKey((key) => key + 1);
          return;
        }

        setPassword("");
        setConfirmPassword("");
        setNotice("You are on the waitlist. We will email you when you are approved.");
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password: cleanPassword,
      });
      if (signUpError) throw signUpError;

      if (!data.session) {
        const { error: signInAfterSignupError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPassword,
        });
        if (signInAfterSignupError) {
          setNotice("Check your email to confirm your account, then sign in.");
          setMode("signin");
          setPassword("");
          setConfirmPassword("");
          setFormStageKey((key) => key + 1);
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

  const showApprovedActivation = mode === "signup" && waitlistContext.approved;

  return (
    <div className="circles-auth">
      <div className="auth-noise" aria-hidden="true" />
      <div className="auth-orb orb-blue" aria-hidden="true" />
      <div className="auth-orb orb-sky" aria-hidden="true" />
      <div className="auth-orb orb-green" aria-hidden="true" />
      <div className="auth-vignette" aria-hidden="true" />

      <button type="button" className="auth-back" onClick={goToLanding}>
        <ArrowLeft size={16} />
        Back to landing
      </button>

      <Link to="/" className="auth-brand" aria-label="Circles home">
        <span className="brand-rings" aria-hidden="true">
          <span className="brand-ring r1" />
          <span className="brand-ring r2" />
          <span className="brand-ring r3" />
        </span>
        Circles
      </Link>

      <main className="auth-stage">
        <section className="auth-shell" aria-live="polite">
          <aside className="auth-left">
            <h1 className="left-title">
              Find your
              <br />
              <i>people.</i>
            </h1>
            <p className="left-sub">Build small circles, plan quickly, and meet in real life this week.</p>

            <ul className="left-list">
              <li>Small groups with clearer conversations.</li>
              <li>Vote on place and time in one flow.</li>
              <li>Meet real people with trust signals.</li>
              <li>No endless feed, just real plans.</li>
            </ul>

            <div className="left-community">
              <div className="avatar-row" aria-hidden="true">
                <span className="avatar-bubble b1">LM</span>
                <span className="avatar-bubble b2">AS</span>
                <span className="avatar-bubble b3">DN</span>
                <span className="avatar-bubble b4">RM</span>
              </div>
              <p className="community-text">
                <strong>28,400+</strong> people already found their circle
              </p>
            </div>
          </aside>

          <section className="auth-right">
            <h2 className="right-title">Welcome back 👋</h2>
            <p className="right-sub">Sign in or join the waitlist to get started.</p>

            <div className="tab-row" role="tablist" aria-label="Auth mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={`tab-btn ${mode === "signup" ? "active" : ""}`}
                onClick={() => switchTab("signup")}
              >
                {waitlistContext.approved ? "Activate Account" : "Join Waitlist"}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signin"}
                className={`tab-btn ${mode === "signin" ? "active" : ""}`}
                onClick={() => switchTab("signin")}
                disabled={showApprovedActivation}
              >
                Sign In
              </button>
            </div>

            <div key={`${mode}-${formStageKey}`} className="form-stage">
              {mode === "signin" ? (
                <form className="auth-form" onSubmit={submit}>
                  <label className="field-label" htmlFor="auth-signin-email">
                    Email
                  </label>
                  <input
                    id="auth-signin-email"
                    type="email"
                    autoComplete="email"
                    className="auth-input"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />

                  <div className="field-top">
                    <label className="field-label" htmlFor="auth-signin-password">
                      Password
                    </label>
                    <button type="button" className="forgot-link" onClick={sendResetPassword} disabled={resetBusy}>
                      {resetBusy ? "Sending..." : "Forgot password?"}
                    </button>
                  </div>
                  <input
                    id="auth-signin-password"
                    type="password"
                    autoComplete="current-password"
                    className="auth-input"
                    placeholder="Your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />

                  <button type="submit" className="primary-btn" disabled={busy}>
                    {busy ? "Please wait..." : "Sign In"}
                    {!busy ? <ArrowRight size={16} /> : null}
                  </button>

                  <div className="divider">or continue with</div>

                  <div className="social-row">
                    <button type="button" className="social-btn locked" disabled aria-disabled="true" title="Locked">
                      Google Locked
                    </button>
                    <button type="button" className="social-btn locked" disabled aria-disabled="true" title="Locked">
                      Apple Locked
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {!waitlistContext.approved ? (
                    <>
                      <div className="pill">
                        <span className="pill-dot" aria-hidden="true" />
                        Spots opening weekly
                      </div>
                      <div className="preview-card">
                        <p className="preview-title">Get early access</p>
                        <p className="preview-text">We approve in waves and email you as soon as your access is ready.</p>
                      </div>
                    </>
                  ) : null}

                  <form className="auth-form" onSubmit={submit}>
                    {waitlistContext.approved ? null : (
                      <>
                        <label className="field-label" htmlFor="auth-waitlist-name">
                          Full Name
                        </label>
                        <input
                          id="auth-waitlist-name"
                          type="text"
                          autoComplete="name"
                          className="auth-input"
                          placeholder="Your full name"
                          value={waitlistName}
                          onChange={(event) => setWaitlistName(event.target.value)}
                        />
                      </>
                    )}

                    <label className="field-label" htmlFor="auth-waitlist-email">
                      Email
                    </label>
                    <input
                      id="auth-waitlist-email"
                      type="email"
                      autoComplete="email"
                      className={`auth-input ${waitlistContext.approved ? "locked" : ""}`}
                      placeholder="you@example.com"
                      value={showApprovedActivation ? waitlistContext.emailFromLink : email}
                      onChange={(event) => {
                        if (showApprovedActivation) return;
                        setEmail(event.target.value);
                      }}
                      readOnly={showApprovedActivation}
                      required
                    />

                    {showApprovedActivation ? (
                      <>
                        <label className="field-label" htmlFor="auth-activate-password">
                          Password
                        </label>
                        <input
                          id="auth-activate-password"
                          type="password"
                          autoComplete="new-password"
                          className="auth-input"
                          placeholder="Set your password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          required
                        />

                        <label className="field-label" htmlFor="auth-activate-confirm-password">
                          Confirm Password
                        </label>
                        <input
                          id="auth-activate-confirm-password"
                          type="password"
                          autoComplete="new-password"
                          className="auth-input"
                          placeholder="Repeat your password"
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          required
                        />
                      </>
                    ) : (
                      <>
                        <label className="field-label" htmlFor="auth-waitlist-city">
                          Your City
                        </label>
                        <input
                          id="auth-waitlist-city"
                          type="text"
                          autoComplete="address-level2"
                          className="auth-input"
                          placeholder="City"
                          value={waitlistCity}
                          onChange={(event) => setWaitlistCity(event.target.value)}
                        />
                      </>
                    )}

                    <button type="submit" className="primary-btn" disabled={busy}>
                      {busy
                        ? "Please wait..."
                        : showApprovedActivation
                          ? "Activate Account"
                          : "Join Waitlist"}
                      {!busy ? <ArrowRight size={16} /> : null}
                    </button>
                  </form>
                </>
              )}
            </div>

            {error ? <p className="error-text">{error}</p> : null}
            {notice ? <p className="notice-text">{notice}</p> : null}

            <p className="auth-legal">
              By continuing, you agree to our <Link to="/legal">Terms & Privacy Policy</Link>.
            </p>
          </section>
        </section>
      </main>
    </div>
  );
}
