import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Sparkles, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/App";
import { geocodePlace, reverseGeocodeCity } from "@/lib/geocode";

type Coords = { lat: number; lng: number };
type Step = 1 | 2 | 3;
type Gender = "man" | "woman" | "nonbinary" | "prefer_not_say";
type AvatarPreset = {
  id: string;
  label: string;
  from: string;
  to: string;
};

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

const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "soft-sky", label: "Sky", from: "#bfdbfe", to: "#86efac" },
  { id: "rose-dawn", label: "Rose", from: "#fbcfe8", to: "#fed7aa" },
  { id: "mint-lake", label: "Mint", from: "#a7f3d0", to: "#93c5fd" },
  { id: "sand-stone", label: "Sand", from: "#fde68a", to: "#fdba74" },
  { id: "steel-night", label: "Night", from: "#cbd5e1", to: "#a5b4fc" },
  { id: "pearl-wave", label: "Pearl", from: "#ddd6fe", to: "#bae6fd" },
];

const MAX_AVATAR_MB = 5;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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

function buildPresetAvatarUrl(preset: AvatarPreset): string {
  const initial = preset.label.slice(0, 1).toUpperCase();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${preset.from}" />
          <stop offset="100%" stop-color="${preset.to}" />
        </linearGradient>
      </defs>
      <rect width="160" height="160" rx="80" fill="url(#g)" />
      <text x="80" y="97" text-anchor="middle" font-size="52" font-family="ui-sans-serif, system-ui" fill="#0f172a" opacity="0.82">
        ${initial}
      </text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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
  const [age, setAge] = useState("");
  const [username, setUsername] = useState("");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [gender, setGender] = useState<Gender>("prefer_not_say");

  const [city, setCity] = useState("");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationMsg, setLocationMsg] = useState<string | null>(null);

  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);

  const [selectedPresetId, setSelectedPresetId] = useState<string>(AVATAR_PRESETS[0].id);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => buildPresetAvatarUrl(AVATAR_PRESETS[0]));
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [completedFx, setCompletedFx] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSuffix = useMemo(() => Math.floor(1000 + Math.random() * 9000), []);

  const parsedAge = useMemo(() => parseAgeInput(age), [age]);
  const normalizedUsername = useMemo(() => normalizeHandle(username), [username]);
  const displayName = useMemo(() => fullName.trim() || normalizedUsername, [fullName, normalizedUsername]);
  const previewInterests = useMemo(
    () => (selectedInterests.length ? selectedInterests.join(" / ") : "—"),
    [selectedInterests]
  );

  const identityReady = normalizedUsername.length >= 2 && parsedAge !== null;
  const locationReady = city.trim().length > 0;
  const interestsReady = selectedInterests.length >= 3 && selectedInterests.length <= 5;
  const canContinue = step === 1 ? identityReady : step === 2 ? locationReady : interestsReady;

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
      if (normalizedUsername.length < 2) return "Please choose a valid username.";
      if (parsedAge === null) return "Please enter a valid age (13-120).";
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

  async function onAvatarFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
      setError("Please upload JPG, PNG, or WEBP.");
      return;
    }
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      setError(`Max image size is ${MAX_AVATAR_MB}MB.`);
      return;
    }

    setAvatarUploading(true);
    setError(null);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const path = `${user.id}/${fileName}`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, {
        upsert: true,
      });
      if (uploadError) throw uploadError;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      if (!pub?.publicUrl) throw new Error("Could not resolve avatar URL.");
      setAvatarUrl(pub.publicUrl);
      setSelectedPresetId("");
    } catch (err: any) {
      setError(err?.message || "Avatar upload failed.");
    } finally {
      setAvatarUploading(false);
    }
  }

  function choosePreset(preset: AvatarPreset) {
    setSelectedPresetId(preset.id);
    setAvatarUrl(buildPresetAvatarUrl(preset));
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
      const trimmedCity = city.trim();
      const autoTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      let finalCity: string | null = trimmedCity || null;
      let lat: number | null = coords?.lat ?? null;
      let lng: number | null = coords?.lng ?? null;
      let locationSource: "gps" | "manual" | null = coords ? "gps" : trimmedCity ? "manual" : null;

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
        name: displayName,
        username: normalizedUsername,
        age: parsedAge,
        city: finalCity,
        gender,
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
                        Full name (optional)
                      </label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                        placeholder="Your full name"
                        autoComplete="name"
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
                          Gender (optional)
                        </label>
                        <select
                          value={gender}
                          onChange={(e) => setGender(e.target.value as Gender)}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                        >
                          <option value="prefer_not_say">Prefer not to say</option>
                          <option value="woman">Woman</option>
                          <option value="man">Man</option>
                          <option value="nonbinary">Non-binary</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <label className="text-sm font-semibold text-slate-800">Pick an avatar</label>
                        {avatarUploading ? <span className="text-xs text-slate-500">Uploading...</span> : null}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {AVATAR_PRESETS.map((preset) => {
                          const selected = selectedPresetId === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => choosePreset(preset)}
                              className={`rounded-xl border px-2 py-3 text-xs font-semibold transition ${
                                selected
                                  ? "border-slate-700 shadow-[0_8px_20px_rgba(15,23,42,0.15)]"
                                  : "border-slate-200 hover:border-slate-300"
                              }`}
                              style={{ background: `linear-gradient(135deg, ${preset.from}, ${preset.to})` }}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                      <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">
                        <Upload className="h-3.5 w-3.5" />
                        Upload
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={onAvatarFileChange}
                        />
                      </label>
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
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      placeholder="e.g., Freiburg, Toronto, Berlin"
                      required
                    />
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
              disabled={saving || avatarUploading}
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
