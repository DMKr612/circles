import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/App";
import { geocodePlace, reverseGeocodeCity, searchGermanCitySuggestions, type CitySuggestion } from "@/lib/geocode";
import { getAvatarUrl } from "@/lib/avatar";

type Coords = { lat: number; lng: number };
type Step = 1 | 2 | 3;
type Gender = "man" | "woman" | "nonbinary" | "prefer_not_say";
type GenderInput = Gender | "";

const INTEREST_OPTIONS = [
  "Board Games",
  "Study Sessions",
  "Outdoor Walks",
  "Coffee Talks",
  "Sports",
  "Tech",
  "Language Exchange",
  "Music",
] as const;

const BIO_MAX_LEN = 220;
const CITY_SUGGESTION_LIMIT = 10;
const AVATAR_OPTION_COUNT = 8;

function normalizeHandle(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (cleaned || "circle").slice(0, 24);
}

function parseAgeInput(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const age = Math.round(n);
  if (age < 13 || age > 120) return null;
  return age;
}

function stepLabel(step: Step): string {
  if (step === 1) return "Your identity";
  if (step === 2) return "Your location";
  return "Your interests";
}

export default function ProfileCreation() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(1);

  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [age, setAge] = useState("");
  const [username, setUsername] = useState("");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [gender, setGender] = useState<GenderInput>("");

  const [city, setCity] = useState("");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [coordsSource, setCoordsSource] = useState<"gps" | "manual" | null>(null);
  const [cityFocused, setCityFocused] = useState(false);
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [citySuggestionBusy, setCitySuggestionBusy] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationMsg, setLocationMsg] = useState<string | null>(null);

  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [completedFx, setCompletedFx] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSuffix = useMemo(() => Math.floor(1000 + Math.random() * 9000), []);

  const parsedAge = useMemo(() => parseAgeInput(age), [age]);
  const normalizedUsername = useMemo(() => normalizeHandle(username), [username]);
  const previewInterests = useMemo(
    () => (selectedInterests.length ? selectedInterests.join(" / ") : "—"),
    [selectedInterests]
  );
  const avatarOptions = useMemo(() => {
    const base = String(user.id || user.email || "circles-user");
    return Array.from({ length: AVATAR_OPTION_COUNT }, (_, idx) =>
      getAvatarUrl(null, `${base}-preset-${idx + 1}`, 160)
    );
  }, [user.id, user.email]);

  const identityReady =
    fullName.trim().length >= 2 &&
    normalizedUsername.length >= 2 &&
    parsedAge !== null &&
    Boolean(gender) &&
    Boolean(avatarUrl);
  const locationReady = city.trim().length > 0;
  const interestsReady = selectedInterests.length >= 3 && selectedInterests.length <= 5;
  const canContinue = step === 1 ? identityReady : step === 2 ? locationReady : interestsReady;

  useEffect(() => {
    if (!cityFocused) return;
    const query = city.trim();
    if (!query) {
      setCitySuggestions([]);
      setCitySuggestionBusy(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setCitySuggestionBusy(true);
      const suggestions = await searchGermanCitySuggestions(query, CITY_SUGGESTION_LIMIT);
      if (!cancelled) {
        setCitySuggestions(suggestions);
        setCitySuggestionBusy(false);
      }
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [city, cityFocused]);

  useEffect(() => {
    if (!user || usernameEdited) return;
    const base =
      fullName.trim() ||
      String(user.user_metadata?.name || "").trim() ||
      String(user.email || "").split("@")[0] ||
      "circle";
    setUsername(`${normalizeHandle(base)}${handleSuffix}`);
  }, [fullName, handleSuffix, user, usernameEdited]);

  if (!user) {
    return null;
  }

  async function getBrowserCoords(): Promise<Coords> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Location is not supported on this device."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
        },
        () => reject(new Error("Could not access your location. Please allow location permission.")),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    });
  }

  function validateCurrentStep(currentStep: Step): string | null {
    if (currentStep === 1) {
      if (fullName.trim().length < 2) return "Please enter your full name.";
      if (normalizedUsername.length < 2) return "Please choose a valid username.";
      if (parsedAge === null) return "Please enter a valid age (13-120).";
      if (!gender) return "Please choose your gender.";
      if (!avatarUrl) return "Please choose an avatar.";
      return null;
    }
    if (currentStep === 2) {
      if (!city.trim()) return "Please enter your city or use your current location.";
      return null;
    }
    if (selectedInterests.length < 3) return "Choose at least 3 interests.";
    if (selectedInterests.length > 5) return "Choose up to 5 interests.";
    return null;
  }

  async function handleUseLocation() {
    setError(null);
    setLocationMsg(null);
    setLocationBusy(true);
    try {
      const nextCoords = await getBrowserCoords();
      setCoords(nextCoords);
      setCoordsSource("gps");
      const reverse = await reverseGeocodeCity(nextCoords);
      if (reverse?.city) {
        setCity(reverse.city);
        setLocationMsg(`Using your location: ${reverse.city}`);
      } else {
        const fallback = `${nextCoords.lat.toFixed(2)}, ${nextCoords.lng.toFixed(2)}`;
        setCity(fallback);
        setLocationMsg("Location captured. You can edit city if needed.");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to use current location.");
    } finally {
      setLocationBusy(false);
    }
  }

  function chooseCitySuggestion(item: CitySuggestion) {
    setCity(item.name);
    if (item.lat != null && item.lng != null) {
      setCoords({ lat: item.lat, lng: item.lng });
      setCoordsSource("manual");
    } else {
      setCoords(null);
      setCoordsSource(null);
    }
    setLocationMsg(`City selected: ${item.name}`);
    setCityFocused(false);
    setError(null);
  }

  function toggleInterest(tag: string) {
    setError(null);
    setSelectedInterests((prev) => {
      if (prev.includes(tag)) return prev.filter((item) => item !== tag);
      if (prev.length >= 5) {
        setError("Choose up to 5 interests.");
        return prev;
      }
      return [...prev, tag];
    });
  }

  function goBack() {
    setError(null);
    if (step === 1) {
      navigate("/", { replace: true });
      return;
    }
    setStep((prev) => (prev === 3 ? 2 : 1));
  }

  async function saveProfile() {
    const validationError = validateCurrentStep(3);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const trimmedName = fullName.trim();
      const trimmedBio = bio.trim();
      const trimmedCity = city.trim();
      const autoTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      let finalCity: string | null = trimmedCity || null;
      let lat: number | null = coords?.lat ?? null;
      let lng: number | null = coords?.lng ?? null;
      let locationSource: "gps" | "manual" | null = coordsSource ?? (trimmedCity ? "manual" : null);

      if (!coords && trimmedCity) {
        const geo = await geocodePlace(trimmedCity);
        if (geo) {
          lat = geo.lat;
          lng = geo.lng;
          locationSource = "manual";
          if (geo.city) finalCity = geo.city;
        }
      }

      const payload = {
        name: trimmedName,
        bio: trimmedBio || null,
        username: normalizedUsername,
        age: parsedAge,
        city: finalCity,
        gender: gender as Gender,
        timezone: autoTimezone,
        interests: selectedInterests.join(", "),
        avatar_url: avatarUrl,
        lat,
        lng,
        location_source: locationSource,
        location_updated_at: lat != null && lng != null ? new Date().toISOString() : null,
        onboarded: true,
      };

      const { error: dbError } = await supabase.from("profiles").update(payload as any).eq("user_id", user.id);
      if (dbError) throw dbError;

      // Keep guard state in sync so app does not bounce back to /profile-creation.
      queryClient.setQueryData(["profile", user.id], (prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          name: payload.name,
          bio: payload.bio,
          city: payload.city,
          avatar_url: payload.avatar_url,
          onboarded: true,
        };
      });
      await queryClient.invalidateQueries({ queryKey: ["profile", user.id] });

      setCompletedFx(true);
      await new Promise((resolve) => window.setTimeout(resolve, 520));
      navigate("/profile", { replace: true });
    } catch (err: any) {
      setError(err?.message || "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  async function handleContinue(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const validationError = validateCurrentStep(step);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (step < 3) {
      setStep((prev) => (prev === 1 ? 2 : 3));
      return;
    }

    await saveProfile();
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[radial-gradient(circle_at_12%_12%,rgba(59,130,246,0.24),transparent_45%),radial-gradient(circle_at_86%_20%,rgba(16,185,129,0.14),transparent_42%),#edf2fb] px-4 py-8 text-slate-900">
      <div className="mx-auto w-full max-w-3xl">
        <form
          onSubmit={handleContinue}
          className="relative overflow-hidden rounded-[28px] border border-white/70 bg-white/82 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.14)] backdrop-blur md:p-8"
        >
          {completedFx ? (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {[8, 18, 28, 42, 58, 74, 84].map((x, idx) => (
                <Sparkles
                  key={x}
                  className="absolute h-4 w-4 text-emerald-400/85"
                  style={{
                    left: `${x}%`,
                    top: `${14 + (idx % 3) * 24}%`,
                    animation: "pulse 850ms ease-out 1",
                  }}
                />
              ))}
            </div>
          ) : null}

          <header className="flex items-start justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {step === 1 ? "Exit" : "Back"}
            </button>
            <div className="text-right">
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                Step {step} of 3
              </div>
              <div className="mt-2 flex justify-end gap-1.5">
                {[1, 2, 3].map((item) => (
                  <span
                    key={item}
                    className={`h-2 w-2 rounded-full transition ${
                      item <= step ? "bg-slate-900" : "bg-slate-300"
                    }`}
                  />
                ))}
              </div>
            </div>
          </header>

          <div className="mt-6">
            <p className="text-sm font-semibold text-slate-500">{stepLabel(step)}</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">Welcome to Circles</h1>
            <p className="mt-2 text-base text-slate-600">
              Let&apos;s set up your space.
              <br />
              It only takes 1 minute.
            </p>
          </div>

          <div className="mt-6 min-h-[360px]">
            <AnimatePresence mode="wait">
              {step === 1 ? (
                <motion.section
                  key="step-1"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="grid gap-5 md:grid-cols-[1fr,1.25fr]"
                >
                  <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-blue-50/70 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Profile card preview</p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-14 w-14 overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm">
                        {avatarUrl ? (
                          <img src={avatarUrl} alt="Avatar preview" className="h-full w-full object-cover" />
                        ) : (
                          <div className="grid h-full w-full place-items-center bg-slate-100 text-sm font-bold text-slate-500">
                            {normalizedUsername.slice(0, 1).toUpperCase() || "C"}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-600">{fullName.trim() || "Your name"}</p>
                        <p className="text-lg font-black text-slate-900">@{normalizedUsername || "circle0000"}</p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-2 text-sm text-slate-700">
                      <div className="rounded-xl bg-white/80 px-3 py-2">
                        <span className="font-semibold text-slate-500">Location:</span>{" "}
                        <span>{city.trim() || "—"}</span>
                      </div>
                      <div className="rounded-xl bg-white/80 px-3 py-2">
                        <span className="font-semibold text-slate-500">Interests:</span>{" "}
                        <span>{previewInterests}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="mb-1 block text-sm font-semibold text-slate-800">Username</label>
                      <div className="flex items-center rounded-xl border border-slate-300 bg-white px-3 py-2 focus-within:border-slate-500 focus-within:ring-2 focus-within:ring-slate-200">
                        <span className="text-sm font-semibold text-slate-500">@</span>
                        <input
                          type="text"
                          value={normalizedUsername}
                          onChange={(e) => {
                            setUsername(normalizeHandle(e.target.value));
                            setUsernameEdited(true);
                          }}
                          className="w-full bg-transparent px-2 text-sm text-slate-900 outline-none"
                          placeholder="yourhandle"
                          autoComplete="username"
                          required
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">You can change this anytime.</p>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Full name
                      </label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                        placeholder="Your full name"
                        autoComplete="name"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-semibold text-slate-800">Age</label>
                        <input
                          type="number"
                          value={age}
                          onChange={(e) => setAge(e.target.value)}
                          min={13}
                          max={120}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                          placeholder="13 - 120"
                          required
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Gender
                        </label>
                        <select
                          value={gender}
                          onChange={(e) => setGender(e.target.value as GenderInput)}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                          required
                        >
                          <option value="" disabled>
                            Select gender
                          </option>
                          <option value="woman">Woman</option>
                          <option value="man">Man</option>
                          <option value="nonbinary">Non-binary</option>
                          <option value="prefer_not_say">Prefer not to say</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-semibold text-slate-800">Bio</label>
                      <textarea
                        value={bio}
                        onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX_LEN))}
                        className="min-h-[88px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                        placeholder="Write a short intro about yourself..."
                        maxLength={BIO_MAX_LEN}
                      />
                      <p className="mt-1 text-xs text-slate-500">{bio.length}/{BIO_MAX_LEN}</p>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-800">Choose avatar</label>
                      <div className="grid grid-cols-4 gap-2">
                        {avatarOptions.map((option, idx) => {
                          const active = avatarUrl === option;
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => {
                                setAvatarUrl(option);
                                setError(null);
                              }}
                              className={`relative h-14 w-14 overflow-hidden rounded-full border transition ${
                                active
                                  ? "border-slate-900 ring-2 ring-slate-300"
                                  : "border-slate-300 hover:border-slate-500"
                              }`}
                              aria-label={`Choose avatar ${idx + 1}`}
                            >
                              <img src={option} alt="" className="h-full w-full object-cover" />
                              {active ? (
                                <span className="absolute bottom-0 right-0 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white">
                                  <Check className="h-3 w-3" />
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-xs text-slate-500">Pick one avatar to continue.</p>
                    </div>
                  </div>
                </motion.section>
              ) : null}

              {step === 2 ? (
                <motion.section
                  key="step-2"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="space-y-5"
                >
                  <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-50 to-white p-5">
                    <h2 className="text-2xl font-black text-slate-900">Where are you based?</h2>
                    <p className="mt-2 text-sm text-slate-600">
                      We use your city to show nearby circles and make your recommendations better.
                    </p>
                    <button
                      type="button"
                      onClick={handleUseLocation}
                      disabled={locationBusy || saving}
                      className="mt-4 inline-flex items-center rounded-xl bg-gradient-to-r from-slate-900 to-blue-800 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(15,23,42,0.25)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {locationBusy ? "Detecting location..." : "Use my location"}
                    </button>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-800">City</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => {
                        setCity(e.target.value);
                        setCoords(null);
                        setCoordsSource(null);
                        setLocationMsg(null);
                      }}
                      onFocus={() => setCityFocused(true)}
                      onBlur={() => window.setTimeout(() => setCityFocused(false), 120)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      placeholder="Start typing (Germany cities suggestions appear)"
                      required
                    />
                    {cityFocused && citySuggestions.length ? (
                      <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                        {citySuggestions.map((item) => (
                          <button
                            key={`${item.label}-${item.lat ?? "na"}-${item.lng ?? "na"}`}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => chooseCitySuggestion(item)}
                            className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-700 last:border-b-0 hover:bg-slate-50"
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {cityFocused && citySuggestionBusy ? (
                      <p className="mt-2 text-xs text-slate-500">Searching German cities...</p>
                    ) : null}
                    {locationMsg ? <p className="mt-2 text-xs text-slate-500">{locationMsg}</p> : null}
                  </div>
                </motion.section>
              ) : null}

              {step === 3 ? (
                <motion.section
                  key="step-3"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="space-y-5"
                >
                  <div>
                    <h2 className="text-2xl font-black text-slate-900">Choose 3 to 5 interests</h2>
                    <p className="mt-2 text-sm text-slate-600">
                      This is the most important part for matching you with the right circles.
                    </p>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {selectedInterests.length}/5 selected
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {INTEREST_OPTIONS.map((tag) => {
                      const active = selectedInterests.includes(tag);
                      return (
                        <motion.button
                          key={tag}
                          type="button"
                          onClick={() => toggleInterest(tag)}
                          whileTap={{ scale: 0.97 }}
                          animate={{ scale: active ? 1.03 : 1 }}
                          transition={{ type: "spring", stiffness: 380, damping: 28 }}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                            active
                              ? "border-slate-800 bg-slate-900 text-white shadow-[0_10px_22px_rgba(15,23,42,0.22)]"
                              : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                          }`}
                        >
                          {active ? <Check className="h-3.5 w-3.5" /> : null}
                          {tag}
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.section>
              ) : null}
            </AnimatePresence>
          </div>

          {error ? <p className="mt-4 text-sm font-medium text-red-700">{error}</p> : null}

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
              {step === 1 ? "Cancel" : "Back"}
            </button>

            <button
              type="submit"
              disabled={saving}
              className={`inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-slate-900 via-blue-800 to-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(30,64,175,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${
                canContinue && !saving ? "animate-pulse" : ""
              }`}
            >
              {saving ? "Saving..." : step === 3 ? "-> Continue to Circles" : "Continue"}
              {!saving ? <ArrowRight className="h-4 w-4" /> : null}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
