import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/App";
import { geocodePlace, reverseGeocodeCity } from "@/lib/geocode";

type Coords = { lat: number; lng: number };

export default function ProfileCreation() {
  const { user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [city, setCity] = useState("");
  const [gender, setGender] = useState<"man" | "woman" | "nonbinary" | "prefer_not_say">("prefer_not_say");
  const [interests, setInterests] = useState("");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationMsg, setLocationMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    // RequireAuth will redirect if not logged in
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
        setLocationMsg("Location captured. Add city name if needed.");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to use current location.");
    } finally {
      setLocationBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const trimmedCity = city.trim();
    const autoTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    let finalCity: string | null = trimmedCity || null;
    let lat: number | null = coords?.lat ?? null;
    let lng: number | null = coords?.lng ?? null;
    let locationSource: "gps" | "manual" | null = coords ? "gps" : null;

    if (!coords && trimmedCity) {
      const geo = await geocodePlace(trimmedCity);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
        locationSource = "manual";
        if (geo.city) finalCity = geo.city;
      }
    }

    const { error: dbError } = await supabase
  .from("profiles")
  .update({
    name: fullName,   // <- use 'name', matches DB schema
    username,
    city: finalCity,
    gender,
    timezone: autoTimezone,
    interests: interests || null,
    lat,
    lng,
    location_source: locationSource,
    location_updated_at: lat != null && lng != null ? new Date().toISOString() : null,
    onboarded: true,
  } as any)
  .eq("user_id", user!.id);
  
    setSaving(false);

    if (dbError) {
      setError(dbError.message);
      return;
    }

    // After saving, go to normal profile page
    window.location.href = "/profile";
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4 py-8 bg-neutral-50">
      <div className="w-full max-w-md rounded-xl border border-black/10 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold mb-2">Create your profile</h1>
        <p className="text-sm text-neutral-600 mb-6">
          Just a few details so Circles can find the best groups for you.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Full name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black focus:ring-1 focus:ring-black"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black focus:ring-1 focus:ring-black"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">City / Location</label>
            <div className="mb-2 flex items-center justify-end">
              <button
                type="button"
                onClick={handleUseLocation}
                disabled={locationBusy || saving}
                className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
              >
                {locationBusy ? "Getting location..." : "Use my location"}
              </button>
            </div>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black focus:ring-1 focus:ring-black"
              placeholder="e.g., Toronto, Berlin"
            />
            {locationMsg && <p className="mt-1 text-xs text-neutral-500">{locationMsg}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Gender</label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                { key: "man", label: "Man" },
                { key: "woman", label: "Woman" },
                { key: "nonbinary", label: "Non-binary" },
                { key: "prefer_not_say", label: "Prefer not to say" },
              ].map((opt) => (
                <label key={opt.key} className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 hover:border-black/20 cursor-pointer">
                  <input
                    type="radio"
                    name="gender"
                    value={opt.key}
                    checked={gender === opt.key}
                    onChange={() => setGender(opt.key as any)}
                    className="text-black focus:ring-black"
                    required
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Interests</label>
            <textarea
              value={interests}
              onChange={(e) => setInterests(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black focus:ring-1 focus:ring-black resize-none"
              placeholder="Games, study topics, outdoor hobbies…"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="mt-2 w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save and continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
