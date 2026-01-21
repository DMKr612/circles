import React, { useEffect, useMemo, useState } from "react";
import { X, Upload, Sparkles, Moon, Sun, MonitorSmartphone, Bell, Trash2 } from "lucide-react";
import { CATEGORIES, GAME_LIST } from "@/lib/constants";
// @ts-ignore: package ships without TS types in this setup
import { City } from 'country-state-city';
// FIX: Use a relative path from `components/` to `src/lib/`
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/App";

// Demo stubs for toast calls
const success = (m?: string) => console.log("[ok]", m || "");
const error = (m?: string) => console.error("[err]", m || "");

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { name: string, avatarUrl: string | null }) => void;
  variant?: "modal" | "page";
}

export default function SettingsModal({ isOpen, onClose, onSave, variant = "modal" }: SettingsModalProps) {
  const { user } = useAuth();
  const uid = user?.id || null;
  
  // Settings modal state
  const [sName, setSName] = useState<string>("");
  const [sCity, setSCity] = useState<string>("");
  const [sTimezone, setSTimezone] = useState<string>("UTC");
  const [sInterests, setSInterests] = useState<string>("");
  const [sTheme, setSTheme] = useState<'system'|'light'|'dark'>('system');
  const [emailNotifs, setEmailNotifs] = useState<boolean>(false);
  const [pushNotifs, setPushNotifs] = useState<boolean>(false);
  const [allowRatings, setAllowRatings] = useState<boolean>(true);
  const [sGender, setSGender] = useState<"man" | "woman" | "nonbinary" | "prefer_not_say">("prefer_not_say");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [initials, setInitials] = useState<string>("?");

  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  // All German cities from country-state-city, deduped + sorted
  const [deCities, setDeCities] = useState<string[]>([]);
  const [citiesLoaded, setCitiesLoaded] = useState(false);
  const isPage = variant === "page";
  const interestSuggestions = useMemo(() => {
    const items = [
      ...CATEGORIES.filter(c => c !== "All"),
      ...GAME_LIST.map(g => g.name)
    ].map(s => s.trim()).filter(Boolean);
    return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
  }, []);

  // Helper to get device/browser timezone
  function deviceTZ(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }
  
  // Load German cities dynamically (only once)
  const loadCities = async () => {
    if (citiesLoaded || deCities.length > 0) return;
    setCitiesLoaded(true); // Mark as attempted
    try {
      // FIX: Dynamically import
      const { City } = await import('country-state-city');
      const all = (City.getCitiesOfCountry('DE') || []) as Array<{ name: string }>;
      const names = all.map(c => (c?.name || '').trim()).filter(Boolean);
      setDeCities(Array.from(new Set(names)).sort((a,b)=>a.localeCompare(b)));
    } catch (e) {
      console.error("Failed to load cities", e);
    }
  };

  // On modal open, load current user and profile data
  useEffect(() => {
    if (!isOpen) return;
    
    // Load cities when modal is opened
    loadCities();
    
    // Load theme/notif settings from localStorage
    const LS_THEME = localStorage.getItem('theme') as 'system'|'light'|'dark' | null;
    if (LS_THEME) setSTheme(LS_THEME);
    const LS_EMAIL = localStorage.getItem('emailNotifs');
    if (LS_EMAIL) setEmailNotifs(LS_EMAIL === '1');
    const LS_PUSH = localStorage.getItem('pushNotifs');
    if (LS_PUSH) setPushNotifs(LS_PUSH === '1');

    (async () => {
      if (!uid) {
        onClose(); // Should not happen if modal is opened from profile
        return;
      }
      
      const { data: p, error } = await supabase
        .from("profiles")
        .select("name, city, timezone, interests, avatar_url, allow_ratings, gender")
        .eq("user_id", uid)
        .maybeSingle();
        
      if (error) { setSettingsMsg(error.message); return; }
      
      const name = (p as any)?.name ?? "";
      setSName(name);
      setSCity((p as any)?.city ?? "");
      setSTimezone((p as any)?.timezone ?? deviceTZ());
      const ints = Array.isArray((p as any)?.interests) ? ((p as any).interests as string[]) : [];
      setSInterests(ints.join(", "));
      setAvatarUrl((p as any)?.avatar_url ?? null);
      setAllowRatings((p as any)?.allow_ratings ?? true);
      setSGender((p as any)?.gender ?? "prefer_not_say");
      setInitials((name || user?.email || "?").slice(0, 2).toUpperCase());
    })();
    
  }, [isOpen, onClose, uid, user?.email]);

  useEffect(() => {
    if (isOpen || isPage) applyTheme(sTheme);
  }, [sTheme, isOpen, isPage]);

  function applyTheme(theme: 'system'|'light'|'dark') {
    const root = document.documentElement;
    root.classList.remove('light','dark');
    if (theme === 'light') root.classList.add('light');
    else if (theme === 'dark') root.classList.add('dark');
  }

  async function saveSettings(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!uid) return;
    setSettingsMsg(null);
    setSettingsSaving(true);
    try {
      // sanitize
      const name = sName.trim();
      const city = sCity.trim();
      if (!city) { setSettingsMsg("Please choose a city."); setSettingsSaving(false); return; }
      const timezone = sTimezone.trim() || "UTC";
      const interests = sInterests.split(",").map(s => s.trim()).filter(Boolean);

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ name, city, timezone, interests, allow_ratings: allowRatings, gender: sGender })
        .eq("user_id", uid);

      if (updateError) throw updateError;
      
      // Save theme/notifs to localStorage
      localStorage.setItem('theme', sTheme);
      localStorage.setItem('emailNotifs', emailNotifs ? '1' : '0');
      localStorage.setItem('pushNotifs', pushNotifs ? '1' : '0');
      applyTheme(sTheme);

      setSettingsMsg("Saved.");
      success('Profile saved');
      onSave({ name, avatarUrl }); // Pass new data back to Profile page
      
      // Auto-close after 1 sec
      setTimeout(() => {
        onClose();
        setSettingsMsg(null);
      }, 1000);
      
    } catch (err: any) {
      const msg = err?.message || "Failed to save";
      setSettingsMsg(msg);
      error(msg);
    } finally {
      setSettingsSaving(false);
    }
  }

  async function saveAllowRatings(next: boolean) {
    setAllowRatings(next);
    if (!uid) return;
    try {
      await supabase.from('profiles').update({ allow_ratings: next }).eq('user_id', uid);
    } catch {}
  }

  async function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!uid || !file) return;
    try {
      setAvatarUploading(true);
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${uid}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = pub?.publicUrl || null;
      if (url) {
        await supabase.from('profiles').update({ avatar_url: url }).eq('user_id', uid);
        setAvatarUrl(url);
        onSave({ name: sName, avatarUrl: url }); // Update parent immediately
      }
    } catch (e) {
      console.error(e);
      setSettingsMsg('Avatar upload failed');
    } finally {
      setAvatarUploading(false);
    }
  }

  async function deleteAccount() {
    if (!uid) return;
    setDeleteMsg(null);
    const ok = window.confirm(
      "This will permanently delete your account, your chats, and any groups you created. This cannot be undone."
    );
    if (!ok) return;
    const typed = window.prompt('Type DELETE to confirm account deletion.');
    if (typed !== "DELETE") {
      setDeleteMsg("Deletion cancelled.");
      return;
    }
    setDeleteBusy(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("delete-account", {
        body: { confirm: true }
      });
      if (fnErr) {
        let msg = fnErr.message || "Failed to delete account.";
        try {
          const payload = await fnErr.context.json();
          if (payload?.error) msg = payload.error;
        } catch {}
        throw new Error(msg);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      try {
        await supabase.auth.signOut();
      } catch {}
      try {
        localStorage.removeItem('onboardingSeen');
        sessionStorage.clear();
      } catch {}
      const base = `${window.location.origin}${import.meta.env.BASE_URL}`;
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
      } catch {}
      window.location.replace(base);
    } catch (err: any) {
      const msg = err?.message || "Failed to delete account.";
      setDeleteMsg(msg);
      error(msg);
    } finally {
      setDeleteBusy(false);
    }
  }
  
  if (!isOpen && !isPage) return null;

  return (
    <div
      className={isPage ? "min-h-screen bg-gradient-to-b from-neutral-50 via-white to-neutral-100 px-4 py-6" : "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 backdrop-blur-sm px-4 py-6 md:items-center"}
      onClick={isPage ? undefined : onClose}
    >
      <form
        onSubmit={saveSettings}
        className={`${isPage ? "mx-auto" : ""} w-[620px] max-w-[94vw] rounded-3xl border border-white/40 bg-white/90 shadow-[0_20px_80px_rgba(0,0,0,0.18)] backdrop-blur-xl p-6 space-y-5 ${isPage ? "" : "max-h-[calc(100dvh-3rem)] overflow-y-auto"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xl font-bold text-neutral-900 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-500" /> Edit Profile
            </div>
            <p className="text-sm text-neutral-500">Freshen up your details, theme, and notifications.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`grid h-9 w-9 place-items-center rounded-full border ${isPage ? "border-neutral-200 bg-white text-neutral-500 hover:text-neutral-800" : "border-neutral-200 bg-white text-neutral-500 hover:text-neutral-800 hover:border-neutral-300"}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Profile + Avatar */}
        <div className="grid gap-4 rounded-2xl border border-neutral-100 bg-white/80 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-emerald-100 to-blue-100 border border-white shadow-inner overflow-hidden grid place-items-center text-sm font-bold text-emerald-700">
              {avatarUrl ? <img src={avatarUrl} className="h-full w-full object-cover" /> : initials}
            </div>
            <div className="flex flex-1 items-center gap-2">
              <input
                value={sName}
                onChange={(e) => setSName(e.target.value)}
                className="flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium shadow-inner focus:border-neutral-300 focus:outline-none"
                placeholder="Your name"
                required
              />
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:border-neutral-300">
                <Upload className="h-4 w-4" />
                Change
                <input type="file" accept="image/*" onChange={onAvatarChange} className="hidden" />
              </label>
              {avatarUploading && <span className="text-xs text-neutral-500">Uploading…</span>}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-neutral-500">City</label>
              <input
                value={sCity}
                onChange={(e) => setSCity(e.target.value)}
                onFocus={loadCities}
                onBlur={() => { if (!sTimezone || sTimezone === "UTC") setSTimezone(deviceTZ()); }}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-neutral-300 focus:outline-none"
                placeholder="Start typing… e.g., Berlin"
                list="cities-de"
                required
              />
              <datalist id="cities-de">
                {deCities.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-neutral-500">Timezone</label>
              <input
                value={sTimezone}
                onChange={(e) => setSTimezone(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-neutral-300 focus:outline-none"
                placeholder="e.g., Europe/Berlin"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-neutral-500">Gender</label>
              <select
                value={sGender}
                onChange={(e) => setSGender(e.target.value as any)}
                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-neutral-300 focus:outline-none"
              >
                <option value="man">Man</option>
                <option value="woman">Woman</option>
                <option value="nonbinary">Non-binary</option>
                <option value="prefer_not_say">Prefer not to say</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-neutral-500">Interests</label>
            <input
              value={sInterests}
              onChange={(e) => setSInterests(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-neutral-300 focus:outline-none"
              placeholder="comma, separated, tags"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {interestSuggestions.slice(0, 14).map((tag) => (
                <button
                  type="button"
                  key={tag}
                  onClick={() => {
                    const existing = sInterests.split(",").map(s => s.trim()).filter(Boolean);
                    if (existing.includes(tag)) return;
                    const next = [...existing, tag].join(", ");
                    setSInterests(next);
                  }}
                  className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-700 hover:border-neutral-300 hover:bg-white"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Theme & privacy */}
        <div className="grid gap-4 rounded-2xl border border-neutral-100 bg-white/80 p-4 shadow-sm sm:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-neutral-500">
              <Sparkles className="h-4 w-4 text-amber-500" /> Theme
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: "system", label: "System", icon: <MonitorSmartphone className="h-4 w-4" /> },
                { key: "light", label: "Light", icon: <Sun className="h-4 w-4" /> },
                { key: "dark", label: "Dark", icon: <Moon className="h-4 w-4" /> },
              ].map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setSTheme(opt.key as any)}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-2 text-sm font-semibold transition-all ${
                    sTheme === opt.key ? "border-black bg-neutral-900 text-white shadow-md" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                  }`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-3 py-3">
            <div>
              <div className="text-sm font-semibold text-neutral-900">Allow profile ratings</div>
              <div className="text-[11px] text-neutral-500">Others can rate you when enabled.</div>
            </div>
            <button
              type="button"
              onClick={() => saveAllowRatings(!allowRatings)}
              className={`relative h-8 w-14 rounded-full transition ${allowRatings ? 'bg-emerald-500' : 'bg-neutral-300'}`}
              aria-pressed={allowRatings}
            >
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${allowRatings ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
        </div>

        {/* Notifications */}
        <div className="rounded-2xl border border-neutral-100 bg-white/80 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-neutral-500">
            <Bell className="h-4 w-4 text-emerald-500" /> Notifications
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 shadow-inner">
              <input
                id="emailNotifs"
                type="checkbox"
                checked={emailNotifs}
                onChange={(e) => setEmailNotifs(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-400"
              />
              Email notifications
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 shadow-inner">
              <input
                id="pushNotifs"
                type="checkbox"
                checked={pushNotifs}
                onChange={(e) => setPushNotifs(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-400"
              />
              Push notifications
            </label>
          </div>
        </div>

        {/* Danger zone */}
        <div className="rounded-2xl border border-red-100 bg-red-50/70 p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-red-600">
            <Trash2 className="h-4 w-4" /> Danger zone
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-red-900">Delete account</div>
              <div className="text-[11px] text-red-700/80">
                Permanently deletes your account, chats, and groups you created.
              </div>
            </div>
            <button
              type="button"
              onClick={deleteAccount}
              disabled={deleteBusy}
              className="rounded-xl border border-red-200 bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-md transition hover:bg-red-700 disabled:opacity-60"
            >
              {deleteBusy ? "Deleting…" : "Delete account"}
            </button>
          </div>
          {deleteMsg && (
            <div className="mt-3 rounded-xl border border-red-200 bg-white/70 px-3 py-2 text-xs text-red-700">
              {deleteMsg}
            </div>
          )}
        </div>

        {settingsMsg && (
          <div className={`mt-1 rounded-xl border px-3 py-2 text-sm ${settingsMsg === 'Saved.' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {settingsMsg}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:border-neutral-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={settingsSaving}
            className={`rounded-xl px-5 py-2 text-sm font-bold text-white shadow-md transition ${settingsSaving ? "bg-neutral-400" : "bg-emerald-600 hover:bg-emerald-700"}`}
          >
            {settingsSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
