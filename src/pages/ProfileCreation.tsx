import React, { useState } from "react";
import { supabase } from "@/lib/supabase"; // adjust path if your client is elsewhere
import useAuth from "@/hooks/useAuth";

export default function ProfileCreation() {
  const { user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [city, setCity] = useState("");
  const [gender, setGender] = useState<"man" | "woman" | "nonbinary" | "prefer_not_say">("prefer_not_say");
  const [timezone, setTimezone] = useState("");
  const [interests, setInterests] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    // RequireAuth will redirect if not logged in
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const { error: dbError } = await supabase
  .from("profiles")
  .update({
    name: fullName,   // <- use 'name', matches DB schema
    username,
    city: city || null,
    gender,
    timezone: timezone || null,
    interests: interests || null,
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
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black focus:ring-1 focus:ring-black"
              placeholder="e.g., Toronto, Berlin"
            />
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
            <label className="block text-sm font-medium mb-1">Timezone</label>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-black focus:ring-1 focus:ring-black"
              placeholder="e.g., UTC-5, CET, PST"
            />
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
