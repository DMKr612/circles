import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Check,
  ChevronRight,
  Copy,
  Lock,
  LogOut,
  Mail,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  User,
  Users,
} from "lucide-react";
import { useAuth } from "@/App";
import { supabase } from "@/lib/supabase";
import { getAvatarUrl } from "@/lib/avatar";
import { isValidPublicId, normalizePublicId } from "@/lib/mentions";
import { useAppLanguage } from "@/state/language";

type ToastKind = "success" | "error" | "info";
type ToastMessage = { kind: ToastKind; text: string } | null;

type AvailabilityValue = "weekday_evenings" | "weekends" | "flexible";
type LanguageValue = "en" | "de" | "fa";
type ProfileVisibilityValue = "my_circles" | "chat_contacts" | "city";
type MessageAccessValue = "my_circles" | "shared_circles" | "anyone";

type NotificationSettings = {
  pushEnabled: boolean;
  emailEnabled: boolean;
  meetupScheduled: boolean;
  pollCreated: boolean;
  attendanceConfirmations: boolean;
  mentions: boolean;
  announcements: boolean;
  ratingReminders: boolean;
  directMessages: boolean;
};

type PrivacySettings = {
  profileVisibility: ProfileVisibilityValue;
  whoCanMessage: MessageAccessValue;
  showOnlineStatus: boolean;
};

type PersistedSettings = {
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  language: LanguageValue;
};

type ProfileSnapshot = {
  name: string;
  publicId: string;
  bio: string;
  city: string;
  availability: AvailabilityValue;
  avatarUrl: string | null;
  age: number | null;
};

type BlockedUser = {
  userId: string;
  name: string;
  avatarUrl: string | null;
};

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  pushEnabled: true,
  emailEnabled: false,
  meetupScheduled: true,
  pollCreated: true,
  attendanceConfirmations: true,
  mentions: true,
  announcements: true,
  ratingReminders: true,
  directMessages: true,
};

const DEFAULT_PRIVACY: PrivacySettings = {
  profileVisibility: "my_circles",
  whoCanMessage: "shared_circles",
  showOnlineStatus: true,
};

const DEFAULT_LANGUAGE: LanguageValue = "en";
const DEFAULT_AVAILABILITY: AvailabilityValue = "flexible";
const MAX_BIO_LENGTH = 180;
const MAX_AVATAR_MB = 5;
const PUBLIC_ID_MIN_LENGTH = 6;
const PUBLIC_ID_MAX_LENGTH = 28;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SETTINGS_PROFILE_FIELDS = [
  "name",
  "public_id",
  "bio",
  "city",
  "age",
  "availability",
  "avatar_url",
  "personality_traits",
].join(",");

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getAvailability(value: unknown): AvailabilityValue {
  if (value === "weekday_evenings" || value === "weekends" || value === "flexible") return value;
  return DEFAULT_AVAILABILITY;
}

function parseAgeInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return null;
  if (n < 13 || n > 120) return null;
  return n;
}

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function socialStyleLabel(input: any): string {
  if (!input) return "Not set yet";
  if (typeof input === "string") return input;
  if (Array.isArray(input) && input.length) return input.map((v) => String(v)).join(", ");
  if (typeof input === "object") {
    if (typeof input.style === "string" && input.style.trim()) return input.style;
    if (typeof input.label === "string" && input.label.trim()) return input.label;
    const truthy = Object.entries(input)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k.replaceAll("_", " "));
    if (truthy.length) return truthy.join(", ");
  }
  return "Not set yet";
}

function Toggle({
  checked,
  disabled,
  onClick,
  ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={checked}
      disabled={disabled}
      className={`relative h-7 w-12 rounded-full transition ${
        disabled ? "cursor-not-allowed bg-neutral-200" : checked ? "bg-emerald-500" : "bg-neutral-300"
      }`}
    >
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition ${
          checked ? "right-0.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { lang: appLang, setLang: setAppLang } = useAppLanguage();
  const uid = user?.id ?? null;

  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage>(null);

  const [name, setName] = useState("");
  const [publicId, setPublicId] = useState("");
  const [bio, setBio] = useState("");
  const [city, setCity] = useState("");
  const [age, setAge] = useState("");
  const [availability, setAvailability] = useState<AvailabilityValue>(DEFAULT_AVAILABILITY);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [socialStyle, setSocialStyle] = useState("Not set yet");
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [profileInitial, setProfileInitial] = useState<ProfileSnapshot | null>(null);
  const [publicIdChecking, setPublicIdChecking] = useState(false);
  const [publicIdAvailable, setPublicIdAvailable] = useState<boolean | null>(null);
  const [copiedPublicId, setCopiedPublicId] = useState(false);

  const [deCities, setDeCities] = useState<string[]>([]);
  const [citiesLoaded, setCitiesLoaded] = useState(false);

  const [notifications, setNotifications] = useState<NotificationSettings>(DEFAULT_NOTIFICATIONS);
  const [privacy, setPrivacy] = useState<PrivacySettings>(DEFAULT_PRIVACY);
  const [language, setLanguage] = useState<LanguageValue>(appLang as LanguageValue);

  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [unblockBusyId, setUnblockBusyId] = useState<string | null>(null);

  const profileExtrasKey = useMemo(
    () => (uid ? `circles_profile_extras_${uid}` : null),
    [uid]
  );
  const settingsKey = useMemo(
    () => (uid ? `circles_user_settings_${uid}` : null),
    [uid]
  );

  const profileSnapshot = useMemo<ProfileSnapshot>(
    () => ({
      name: name.trim(),
      publicId: normalizePublicId(publicId),
      bio: bio.trim(),
      city: city.trim(),
      age: parseAgeInput(age),
      availability,
      avatarUrl: avatarUrl?.trim() || null,
    }),
    [name, publicId, bio, city, age, availability, avatarUrl]
  );

  const profileErrors = useMemo(() => {
    const errors: string[] = [];
    if (!user?.email) errors.push("Email is required.");
    if (profileSnapshot.name.length < 2) errors.push("Name must be at least 2 characters.");
    if (profileSnapshot.name.length > 60) errors.push("Name must be 60 characters or fewer.");
    if (!profileSnapshot.publicId) errors.push("Public ID is required.");
    if (profileSnapshot.publicId.length < PUBLIC_ID_MIN_LENGTH || profileSnapshot.publicId.length > PUBLIC_ID_MAX_LENGTH) {
      errors.push(`Public ID must be ${PUBLIC_ID_MIN_LENGTH}-${PUBLIC_ID_MAX_LENGTH} characters.`);
    }
    if (!isValidPublicId(profileSnapshot.publicId)) {
      errors.push("Public ID format must be name + 4 numbers (example: dara4821).");
    }
    if (!profileSnapshot.bio) errors.push("Bio is required.");
    if (countWords(profileSnapshot.bio) < 10) errors.push("Bio must be at least 10 words.");
    if (profileSnapshot.bio.length > MAX_BIO_LENGTH) errors.push(`Bio must be ${MAX_BIO_LENGTH} characters or fewer.`);
    if (profileSnapshot.age === null) errors.push("Age is required (13-120).");
    if (!profileSnapshot.city) errors.push("City is required.");
    return errors;
  }, [profileSnapshot, user?.email]);

  const profileDirty = useMemo(() => {
    if (!profileInitial) return false;
    return JSON.stringify(profileInitial) !== JSON.stringify(profileSnapshot);
  }, [profileInitial, profileSnapshot]);

  const tx = useCallback(
    (en: string, de: string, fa: string) => {
      if (language === "de") return de;
      if (language === "fa") return fa;
      return en;
    },
    [language]
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setLanguage(appLang as LanguageValue);
  }, [appLang]);

  useEffect(() => {
    if (!copiedPublicId) return;
    const timer = window.setTimeout(() => setCopiedPublicId(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copiedPublicId]);

  useEffect(() => {
    if (!uid) {
      setPublicIdChecking(false);
      setPublicIdAvailable(null);
      return;
    }

    const normalized = profileSnapshot.publicId;
    const initialNormalized = normalizePublicId(profileInitial?.publicId || "");
    const changed = !!normalized && normalized !== initialNormalized;
    if (!changed) {
      setPublicIdChecking(false);
      setPublicIdAvailable(normalized ? true : null);
      return;
    }
    if (!isValidPublicId(normalized)) {
      setPublicIdChecking(false);
      setPublicIdAvailable(null);
      return;
    }

    let cancelled = false;
    setPublicIdChecking(true);
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase.rpc("is_public_id_available", { p_public_id: normalized });
      if (cancelled) return;
      if (error) {
        setPublicIdAvailable(null);
      } else {
        setPublicIdAvailable(Boolean(data));
      }
      setPublicIdChecking(false);
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [uid, profileSnapshot.publicId, profileInitial?.publicId]);

  const loadCities = useCallback(async () => {
    if (citiesLoaded) return;
    setCitiesLoaded(true);
    try {
      const mod = await import("country-state-city");
      const all = (mod.City.getCitiesOfCountry("DE") || []) as Array<{ name?: string }>;
      const names = all.map((c) => String(c?.name || "").trim()).filter(Boolean);
      setDeCities(Array.from(new Set(names)).sort((a, b) => a.localeCompare(b)));
    } catch (err) {
      console.warn("[settings] failed to load cities", err);
    }
  }, [citiesLoaded]);

  const persistSettings = useCallback(
    async (next: PersistedSettings) => {
      if (settingsKey) {
        localStorage.setItem(settingsKey, JSON.stringify(next));
      }
    },
    [settingsKey]
  );

  const loadBlockedUsers = useCallback(async () => {
    if (!uid) return;
    setBlockedLoading(true);
    try {
      const { data: relations, error } = await supabase
        .from("friendships")
        .select("user_id_a, user_id_b, status")
        .eq("status", "blocked")
        .or(`user_id_a.eq.${uid},user_id_b.eq.${uid}`);

      if (error) throw error;

      const otherIds = Array.from(
        new Set(
          (relations || []).map((row: any) => (row.user_id_a === uid ? row.user_id_b : row.user_id_a)).filter(Boolean)
        )
      );

      if (!otherIds.length) {
        setBlockedUsers([]);
        return;
      }

      const { data: profiles, error: profileErr } = await supabase
        .from("profiles")
        .select("user_id, name, avatar_url")
        .in("user_id", otherIds);

      if (profileErr) throw profileErr;

      const profileMap = new Map<string, any>();
      (profiles || []).forEach((p: any) => profileMap.set(p.user_id, p));

      setBlockedUsers(
        otherIds.map((id) => {
          const p = profileMap.get(id);
          return {
            userId: id,
            name: String(p?.name || "Circle Member"),
            avatarUrl: p?.avatar_url || null,
          };
        })
      );
    } catch (err) {
      console.warn("[settings] failed to load blocked users", err);
      setBlockedUsers([]);
    } finally {
      setBlockedLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setIsLoading(true);
      await loadCities();

      const localSettings = parseJson<Partial<PersistedSettings>>(settingsKey ? localStorage.getItem(settingsKey) : null);
      const localExtras = parseJson<{ bio?: string; availability?: AvailabilityValue; age?: number | string }>(
        profileExtrasKey ? localStorage.getItem(profileExtrasKey) : null
      );

      const mergedNotifications: NotificationSettings = {
        ...DEFAULT_NOTIFICATIONS,
        ...((localSettings?.notifications as Partial<NotificationSettings>) || {}),
      };

      const mergedPrivacy: PrivacySettings = {
        ...DEFAULT_PRIVACY,
        ...((localSettings?.privacy as Partial<PrivacySettings>) || {}),
      };

      const mergedLanguage = (localSettings?.language || DEFAULT_LANGUAGE) as LanguageValue;

      const { data: profileRow, error: profileErr } = await supabase
        .from("profiles")
        .select(SETTINGS_PROFILE_FIELDS)
        .eq("user_id", uid)
        .maybeSingle();

      if (cancelled) return;

      if (profileErr) {
        setToast({ kind: "error", text: profileErr.message || "Could not load your profile." });
      }

      const p = (profileRow || {}) as any;
      const loadedBio = typeof p.bio === "string" ? p.bio : String(localExtras?.bio || "");
      const loadedAvailability = getAvailability(typeof p.availability === "string" ? p.availability : localExtras?.availability);
      const loadedAgeValue = p.age ?? localExtras?.age ?? "";
      const loadedAge = typeof loadedAgeValue === "number" ? String(Math.round(loadedAgeValue)) : String(loadedAgeValue || "");
      const loadedPublicId = normalizePublicId(String(p.public_id || ""));

      setName(String(p.name || ""));
      setPublicId(loadedPublicId);
      setBio(loadedBio);
      setCity(String(p.city || ""));
      setAge(loadedAge);
      setAvatarUrl(p.avatar_url || null);
      setAvailability(loadedAvailability);
      setSocialStyle(socialStyleLabel(p.personality_traits));
      setNotifications(mergedNotifications);
      setPrivacy(mergedPrivacy);
      setLanguage(mergedLanguage);
      setAppLang(mergedLanguage);

      setProfileInitial({
        name: String(p.name || "").trim(),
        publicId: loadedPublicId,
        bio: loadedBio.trim(),
        city: String(p.city || "").trim(),
        age: parseAgeInput(loadedAge),
        availability: loadedAvailability,
        avatarUrl: p.avatar_url || null,
      });

      await loadBlockedUsers();
      if (!cancelled) setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, settingsKey, profileExtrasKey, loadCities, loadBlockedUsers, setAppLang]);

  async function copyPublicIdToClipboard() {
    const normalized = profileSnapshot.publicId;
    if (!normalized) return;
    const value = `@${normalized}`;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedPublicId(true);
      setToast({ kind: "success", text: "Public ID copied." });
    } catch {
      setToast({ kind: "error", text: "Could not copy public ID." });
    }
  }

  async function saveProfile() {
    if (!uid) return;
    if (profileErrors.length) {
      setToast({ kind: "error", text: profileErrors[0] });
      return;
    }
    if (!isValidPublicId(profileSnapshot.publicId)) {
      setToast({ kind: "error", text: "Public ID format is invalid." });
      return;
    }

    setProfileSaving(true);
    try {
      const initialPublicId = normalizePublicId(profileInitial?.publicId || "");
      if (profileSnapshot.publicId !== initialPublicId) {
        const { data: available, error: availableError } = await supabase.rpc("is_public_id_available", {
          p_public_id: profileSnapshot.publicId,
        });
        if (availableError) throw availableError;
        if (!available) throw new Error("This public ID is already taken.");
      }

      const basePayload = {
        user_id: uid,
        name: profileSnapshot.name,
        public_id: profileSnapshot.publicId,
        city: profileSnapshot.city || null,
        avatar_url: profileSnapshot.avatarUrl,
      };
      const { error: baseError } = await supabase
        .from("profiles")
        .upsert(basePayload, { onConflict: "user_id" });
      if (baseError) throw baseError;

      const extrasPayload: Record<string, unknown> = {
        bio: profileSnapshot.bio || null,
        availability: profileSnapshot.availability,
        age: profileSnapshot.age,
      };

      if (profileExtrasKey) localStorage.setItem(profileExtrasKey, JSON.stringify(extrasPayload));

      // Some deployments may lag on optional columns (e.g. age).
      // Retry once without unknown column(s) if PostgREST reports schema mismatch.
      let retryPayload: Record<string, unknown> = { ...extrasPayload };
      for (let i = 0; i < 3; i += 1) {
        const { error: extraError } = await supabase
          .from("profiles")
          .update(retryPayload)
          .eq("user_id", uid);
        if (!extraError) break;

        const msg = String(extraError.message || "").toLowerCase();
        const missingCol =
          msg.includes("column") && msg.includes("age")
            ? "age"
            : msg.includes("column") && msg.includes("availability")
            ? "availability"
            : msg.includes("column") && msg.includes("bio")
            ? "bio"
            : null;
        if (!missingCol || !(missingCol in retryPayload)) {
          throw extraError;
        }
        delete retryPayload[missingCol];
        if (Object.keys(retryPayload).length === 0) break;
      }

      // Keep auth metadata aligned so quiz email can always include key identity fields.
      await supabase.auth.updateUser({
        data: {
          name: profileSnapshot.name,
          full_name: profileSnapshot.name,
          public_id: profileSnapshot.publicId,
          city: profileSnapshot.city,
          bio: profileSnapshot.bio,
          age: profileSnapshot.age,
        },
      });

      await queryClient.invalidateQueries({ queryKey: ["profile", uid] });
      setProfileInitial(profileSnapshot);
      setToast({ kind: "success", text: "Saved." });
    } catch (err: any) {
      setToast({ kind: "error", text: err?.message || "Could not save profile." });
    } finally {
      setProfileSaving(false);
    }
  }

  async function onAvatarFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!uid || !file) return;

    if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
      setToast({ kind: "error", text: "Please upload JPG, PNG, or WEBP." });
      return;
    }
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      setToast({ kind: "error", text: `Max image size is ${MAX_AVATAR_MB}MB.` });
      return;
    }

    setAvatarUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const path = `${uid}/${fileName}`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      if (!pub?.publicUrl) throw new Error("Could not resolve avatar URL.");
      setAvatarUrl(pub.publicUrl);
      setToast({ kind: "success", text: "Avatar uploaded. Save to apply." });
    } catch (err: any) {
      setToast({ kind: "error", text: err?.message || "Avatar upload failed." });
    } finally {
      setAvatarUploading(false);
    }
  }

  async function updateNotifications(next: NotificationSettings) {
    setNotifications(next);
    await persistSettings({ notifications: next, privacy, language });
    setToast({
      kind: "success",
      text: tx("Notifications updated.", "Benachrichtigungen aktualisiert.", "اعلان‌ها به‌روزرسانی شد."),
    });
  }

  async function updatePrivacy(next: PrivacySettings) {
    setPrivacy(next);
    await persistSettings({ notifications, privacy: next, language });
    setToast({
      kind: "success",
      text: tx("Privacy settings updated.", "Datenschutz aktualisiert.", "تنظیمات حریم خصوصی به‌روزرسانی شد."),
    });
  }

  async function updateLanguage(next: LanguageValue) {
    setLanguage(next);
    setAppLang(next);
    await persistSettings({ notifications, privacy, language: next });
    setToast({
      kind: "success",
      text: next === "de" ? "Sprache aktualisiert." : next === "fa" ? "زبان به‌روزرسانی شد." : "Language updated.",
    });
  }

  async function sendPasswordReset() {
    if (!user?.email) return;
    setPasswordBusy(true);
    try {
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo });
      if (error) throw error;
      setToast({
        kind: "success",
        text: tx(
          "Password reset email sent.",
          "E-Mail zum Zurucksetzen wurde gesendet.",
          "ایمیل بازنشانی رمز عبور ارسال شد."
        ),
      });
    } catch (err: any) {
      setToast({ kind: "error", text: err?.message || "Could not send reset email." });
    } finally {
      setPasswordBusy(false);
    }
  }

  async function logout() {
    const ok = window.confirm(tx("Log out now?", "Jetzt abmelden?", "الان خارج شوید؟"));
    if (!ok) return;
    setLogoutBusy(true);
    try {
      await supabase.auth.signOut();
      navigate("/onboarding", { replace: true });
    } catch (err: any) {
      setToast({ kind: "error", text: err?.message || "Could not log out." });
      setLogoutBusy(false);
    }
  }

  async function deleteAccount() {
    if (!uid) return;
    const ok = window.confirm(
      tx(
        "This permanently deletes your account, chats, and groups you created. This cannot be undone.",
        "Dadurch werden dein Konto, Chats und erstellte Gruppen dauerhaft geloscht. Das kann nicht ruckgangig gemacht werden.",
        "این کار حساب، چت‌ها و گروه‌های ساخته‌شده توسط شما را برای همیشه حذف می‌کند و قابل بازگشت نیست."
      )
    );
    if (!ok) return;
    const typed = window.prompt(
      tx("Type DELETE to confirm account deletion.", "Zur Bestatigung DELETE eingeben.", "برای تایید حذف حساب، DELETE را تایپ کنید.")
    );
    if (typed !== "DELETE") {
      setToast({ kind: "info", text: tx("Deletion cancelled.", "Loschen abgebrochen.", "حذف لغو شد.") });
      return;
    }

    setDeleteBusy(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("delete-account", {
        body: { confirm: true },
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
        sessionStorage.clear();
      } catch {}

      const base = `${window.location.origin}${import.meta.env.BASE_URL}`;
      window.location.replace(base);
    } catch (err: any) {
      setToast({ kind: "error", text: err?.message || "Failed to delete account." });
      setDeleteBusy(false);
    }
  }

  async function unblockUser(otherId: string) {
    setUnblockBusyId(otherId);
    try {
      const { error } = await supabase.rpc("remove_friend", { other_id: otherId });
      if (error) throw error;
      await loadBlockedUsers();
      setToast({ kind: "success", text: "User unblocked." });
    } catch (err: any) {
      setToast({ kind: "error", text: err?.message || "Could not unblock user." });
    } finally {
      setUnblockBusyId(null);
    }
  }

  function showFirstStepsAgain() {
    if (!uid) return;
    const seenKey = `circles_first_steps_${uid}`;
    const stateKey = `circles_first_steps_state_${uid}`;
    const collapseKey = `circles_first_steps_collapsed_${uid}`;
    try {
      localStorage.removeItem(seenKey);
      localStorage.removeItem(collapseKey);
      localStorage.setItem(stateKey, JSON.stringify([false, false, false, false]));
      window.dispatchEvent(new Event("circles:show-checklist"));
      setToast({ kind: "success", text: "First steps are visible again." });
    } catch {
      setToast({ kind: "error", text: "Could not update first steps visibility." });
    }
  }

  function goBack() {
    if (window.history.length > 1) navigate(-1);
    else navigate("/profile");
  }

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 pt-24 text-sm text-neutral-500">
        {tx("Loading settings...", "Einstellungen werden geladen...", "در حال بارگذاری تنظیمات...")}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-12 md:px-6 md:pt-14">
      <header className="mb-5 rounded-3xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex w-fit items-center gap-1 rounded-xl px-2 py-1 text-sm font-semibold text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
          >
            <ArrowLeft className="h-4 w-4" />
            {tx("Back", "Zuruck", "بازگشت")}
          </button>
          <h1 className="text-center text-2xl font-bold tracking-tight text-neutral-900">
            {tx("Settings", "Einstellungen", "تنظیمات")}
          </h1>
          <div />
        </div>
      </header>

      {toast && (
        <div
          className={`mb-4 rounded-2xl border px-4 py-2.5 text-sm ${
            toast.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : toast.kind === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-neutral-200 bg-neutral-100 text-neutral-700"
          }`}
        >
          {toast.text}
        </div>
      )}

      <section className="mb-4 rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm md:p-5">
        <div className="mb-4 inline-flex items-center gap-2">
          <User className="h-4 w-4 text-emerald-600" />
          <h2 className="text-xl font-bold text-neutral-900">{tx("Profile", "Profil", "پروفایل")}</h2>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="h-16 w-16 overflow-hidden rounded-full border border-white bg-neutral-300 shadow-sm">
              <img
                src={getAvatarUrl(avatarUrl, uid || user?.email || "circles-user")}
                alt="Profile avatar"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xl font-bold text-neutral-900">{name || "Circle Member"}</div>
              <div className="truncate text-sm text-neutral-600">{city || "Set your city"}</div>
              <div className="mt-1 inline-flex items-center gap-2">
                <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-xs font-semibold text-neutral-700">
                  @{profileSnapshot.publicId || "set-public-id"}
                </span>
                <button
                  type="button"
                  onClick={() => void copyPublicIdToClipboard()}
                  className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-neutral-700 hover:border-neutral-300"
                >
                  {copiedPublicId ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedPublicId ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:border-neutral-300">
                <Upload className="h-4 w-4" />
                {tx("Upload", "Hochladen", "آپلود")}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={onAvatarFileChange}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={() => setAvatarUrl(null)}
                className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:border-neutral-300"
              >
                {tx("Remove", "Entfernen", "حذف")}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            {tx(
              `JPG, PNG, or WEBP. Max ${MAX_AVATAR_MB}MB.`,
              `JPG, PNG oder WEBP. Maximal ${MAX_AVATAR_MB}MB.`,
              `فرمت JPG، PNG یا WEBP. حداکثر ${MAX_AVATAR_MB} مگابایت.`
            )}
            {avatarUploading ? " Uploading..." : ""}
          </p>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1.5 text-sm font-semibold text-neutral-800">
            {tx("Name", "Name", "نام")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-medium text-neutral-900 outline-none transition focus:border-emerald-400"
              placeholder="Your name"
            />
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-neutral-800">
            Public ID
            <input
              value={publicId}
              onChange={(e) => setPublicId(normalizePublicId(e.target.value))}
              maxLength={PUBLIC_ID_MAX_LENGTH}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-medium text-neutral-900 outline-none transition focus:border-emerald-400"
              placeholder="dara4821"
            />
            <div className="flex items-center justify-between text-xs">
              <span
                className={
                  publicIdChecking
                    ? "text-neutral-500"
                    : publicIdAvailable === false
                    ? "text-red-600"
                    : publicIdAvailable === true
                    ? "text-emerald-700"
                    : "text-neutral-500"
                }
              >
                {publicIdChecking
                  ? "Checking availability..."
                  : publicIdAvailable === false
                  ? "Public ID is already taken."
                  : publicIdAvailable === true
                  ? "Public ID is available."
                  : "Format: name + 4 numbers (example: dara4821)."}
              </span>
              <button
                type="button"
                onClick={() => void copyPublicIdToClipboard()}
                className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-neutral-700 hover:border-neutral-300"
              >
                {copiedPublicId ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiedPublicId ? "Copied" : "Copy"}
              </button>
            </div>
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-neutral-800">
            {tx("Bio", "Bio", "بیو")}
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={MAX_BIO_LENGTH}
              rows={3}
              className="w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-emerald-400"
              placeholder="Tell others a bit about you."
            />
            <span className="text-right text-xs text-neutral-500">
              {bio.length}/{MAX_BIO_LENGTH}
            </span>
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-neutral-800">
            {tx("Age", "Alter", "سن")}
            <input
              value={age}
              onChange={(e) => setAge(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              maxLength={3}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-emerald-400"
              placeholder={tx("Age (optional)", "Alter (optional)", "سن (اختیاری)")}
            />
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-neutral-800">
            {tx("City", "Stadt", "شهر")}
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onFocus={loadCities}
              list="settings-cities-de"
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-emerald-400"
              placeholder="City"
            />
            <datalist id="settings-cities-de">
              {deCities.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </label>

          <div className="grid gap-1.5 text-sm font-semibold text-neutral-800">
            {tx("Availability", "Verfugbarkeit", "زمان‌های در دسترس")}
            <div className="flex flex-wrap gap-2">
              {[
                {
                  value: "weekday_evenings" as AvailabilityValue,
                  label: tx("Weekday evenings", "Wochentage abends", "عصرهای روزهای هفته"),
                },
                { value: "weekends" as AvailabilityValue, label: tx("Weekends", "Wochenenden", "آخر هفته‌ها") },
                { value: "flexible" as AvailabilityValue, label: tx("Flexible", "Flexibel", "منعطف") },
              ].map((opt) => {
                const active = availability === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAvailability(opt.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2.5">
            <div>
              <div className="text-sm font-semibold text-neutral-900">{tx("Social style", "Sozialstil", "سبک اجتماعی")}</div>
              <div className="text-xs text-neutral-600">{socialStyle}</div>
            </div>
            <button
              type="button"
              onClick={() => navigate("/quiz")}
              className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 hover:border-neutral-300"
            >
              {tx("Take / retake quiz", "Quiz starten / erneut machen", "انجام / تکرار آزمون")}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
          <div>
            <div className="text-sm font-semibold text-emerald-900">First steps reminder</div>
            <div className="text-xs text-emerald-800/80">
              {tx(
                "Bring back the setup banner on your profile page.",
                "Setup-Hinweis im Profil wieder anzeigen.",
                "بنر راه‌اندازی را دوباره در صفحه پروفایل نشان بده."
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={showFirstStepsAgain}
            className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
          >
            {tx("Show first steps again", "Erste Schritte erneut zeigen", "نمایش دوباره مراحل اول")}
          </button>
        </div>

        {profileErrors.length > 0 && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {profileErrors[0]}
          </div>
        )}

        {profileDirty && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={saveProfile}
              disabled={profileSaving || profileErrors.length > 0 || publicIdChecking || publicIdAvailable === false}
              className={`rounded-full px-6 py-2.5 text-sm font-bold text-white transition ${
                profileSaving || profileErrors.length > 0 || publicIdChecking || publicIdAvailable === false
                  ? "cursor-not-allowed bg-neutral-400"
                  : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {profileSaving
                ? tx("Saving...", "Wird gespeichert...", "در حال ذخیره...")
                : tx("Save", "Speichern", "ذخیره")}
            </button>
          </div>
        )}
      </section>

      <section className="mb-4 rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm md:p-5">
          <div className="mb-1 inline-flex items-center gap-2">
            <Bell className="h-4 w-4 text-emerald-600" />
            <h2 className="text-xl font-bold text-neutral-900">{tx("Notifications", "Benachrichtigungen", "اعلان‌ها")}</h2>
          </div>
          <p className="mb-3 text-xs text-neutral-500">
            {tx("Only notify me when it matters.", "Nur benachrichtigen, wenn es wichtig ist.", "فقط وقتی مهم است به من اطلاع بده.")}
          </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-xl border border-neutral-200 px-3 py-2.5">
            <span className="text-sm font-semibold text-neutral-800">{tx("Push notifications", "Push-Benachrichtigungen", "اعلان‌های پوش")}</span>
            <Toggle
              checked={notifications.pushEnabled}
              onClick={() =>
                updateNotifications({
                  ...notifications,
                  pushEnabled: !notifications.pushEnabled,
                })
              }
              ariaLabel="Toggle push notifications"
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-neutral-200 px-3 py-2.5">
            <span className="text-sm font-semibold text-neutral-800">{tx("Email notifications", "E-Mail-Benachrichtigungen", "اعلان‌های ایمیلی")}</span>
            <Toggle
              checked={notifications.emailEnabled}
              onClick={() =>
                updateNotifications({
                  ...notifications,
                  emailEnabled: !notifications.emailEnabled,
                })
              }
              ariaLabel="Toggle email notifications"
            />
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {[
            { key: "meetupScheduled", label: tx("Meetup scheduled", "Treffen geplant", "ملاقات برنامه‌ریزی شد") },
            { key: "pollCreated", label: tx("Poll created / vote needed", "Umfrage erstellt / Abstimmung erforderlich", "نظرسنجی ایجاد شد / رای لازم است") },
            { key: "attendanceConfirmations", label: tx("Attendance confirmations", "Teilnahme-Bestatigungen", "تایید حضور") },
            { key: "mentions", label: tx("Mentions", "Erwahnungen", "منشن‌ها") },
            { key: "announcements", label: tx("Circle announcements", "Circle-Ankundigungen", "اعلامیه‌های حلقه") },
            { key: "ratingReminders", label: tx("Rating reminders", "Bewertungs-Erinnerungen", "یادآور امتیازدهی") },
            { key: "directMessages", label: tx("Direct messages", "Direktnachrichten", "پیام‌های مستقیم") },
          ].map((item) => {
            const key = item.key as keyof NotificationSettings;
            const disabled = !notifications.pushEnabled;
            const checked = Boolean(notifications[key]);
            return (
              <div
                key={item.key}
                className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${
                  disabled ? "border-neutral-200 bg-neutral-50 text-neutral-400" : "border-neutral-200 bg-white"
                }`}
              >
                <span className="text-sm font-medium">{item.label}</span>
                <Toggle
                  checked={checked}
                  disabled={disabled}
                  onClick={() =>
                    updateNotifications({
                      ...notifications,
                      [key]: !checked,
                    })
                  }
                  ariaLabel={`Toggle ${item.label}`}
                />
              </div>
            );
          })}
        </div>
      </section>

      <section className="mb-4 rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm md:p-5">
        <div className="mb-3 inline-flex items-center gap-2">
          <Shield className="h-4 w-4 text-emerald-600" />
          <h2 className="text-xl font-bold text-neutral-900">{tx("Privacy & Safety", "Datenschutz & Sicherheit", "حریم خصوصی و امنیت")}</h2>
        </div>

        <div className="space-y-3">
          <label className="grid gap-1.5 text-sm font-semibold text-neutral-800">
            {tx("Visible to", "Sichtbar fur", "نمایش برای")}
            <select
              value={privacy.profileVisibility}
              onChange={(e) =>
                updatePrivacy({
                  ...privacy,
                  profileVisibility: e.target.value as ProfileVisibilityValue,
                })
              }
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800 outline-none focus:border-emerald-400"
            >
              <option value="my_circles">{tx("Only my circles", "Nur meine Circles", "فقط حلقه‌های من")}</option>
              <option value="chat_contacts">{tx("People I chat with", "Personen, mit denen ich chatte", "کسانی که با آن‌ها چت می‌کنم")}</option>
              <option value="city">{tx("Everyone in my city", "Alle in meiner Stadt", "همه در شهر من")}</option>
            </select>
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-neutral-800">
            {tx("Who can message me", "Wer kann mir schreiben", "چه کسانی می‌توانند پیام بدهند")}
            <select
              value={privacy.whoCanMessage}
              onChange={(e) =>
                updatePrivacy({
                  ...privacy,
                  whoCanMessage: e.target.value as MessageAccessValue,
                })
              }
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800 outline-none focus:border-emerald-400"
            >
              <option value="my_circles">{tx("Only my circles", "Nur meine Circles", "فقط حلقه‌های من")}</option>
              <option value="shared_circles">{tx("Anyone in shared circles", "Jeder in gemeinsamen Circles", "افراد در حلقه‌های مشترک")}</option>
              <option value="anyone">{tx("Anyone", "Jeder", "همه")}</option>
            </select>
          </label>

          <div className="flex items-center justify-between rounded-xl border border-neutral-200 px-3 py-2.5">
            <div>
                <div className="text-sm font-semibold text-neutral-900">{tx("Show online status", "Online-Status anzeigen", "نمایش وضعیت آنلاین")}</div>
                <div className="text-xs text-neutral-500">
                  {tx("Let others see when you are active.", "Andere konnen sehen, wann du aktiv bist.", "به دیگران نشان بده چه زمانی فعال هستی.")}
                </div>
              </div>
            <Toggle
              checked={privacy.showOnlineStatus}
              onClick={() =>
                updatePrivacy({
                  ...privacy,
                  showOnlineStatus: !privacy.showOnlineStatus,
                })
              }
              ariaLabel="Toggle online status"
            />
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-neutral-200 p-3">
            <div className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
              <Users className="h-4 w-4 text-neutral-500" />
              {tx("Blocked users", "Blockierte Nutzer", "کاربران مسدود شده")}
            </div>
          {blockedLoading ? (
              <div className="text-xs text-neutral-500">{tx("Loading blocked users...", "Blockierte Nutzer werden geladen...", "در حال بارگذاری کاربران مسدود شده...")}</div>
            ) : blockedUsers.length === 0 ? (
              <div className="text-sm text-neutral-500">{tx("No blocked users.", "Keine blockierten Nutzer.", "کاربر مسدود شده‌ای وجود ندارد.")}</div>
          ) : (
            <div className="space-y-2">
              {blockedUsers.map((item) => (
                <div key={item.userId} className="flex items-center justify-between rounded-xl border border-neutral-200 px-2.5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="h-9 w-9 overflow-hidden rounded-full bg-neutral-200">
                      <img
                        src={getAvatarUrl(item.avatarUrl, item.userId)}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <span className="truncate text-sm font-semibold text-neutral-800">{item.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => unblockUser(item.userId)}
                    disabled={unblockBusyId === item.userId}
                    className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 hover:border-neutral-300 disabled:opacity-60"
                  >
                    {unblockBusyId === item.userId
                      ? tx("Unblocking...", "Wird entsperrt...", "در حال رفع مسدودیت...")
                      : tx("Unblock", "Entsperren", "رفع مسدودیت")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <a
            href="mailto:support@meincircles.com?subject=Report%20a%20problem"
            className="flex items-center justify-between rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            {tx("Report a problem", "Problem melden", "گزارش مشکل")}
            <ChevronRight className="h-4 w-4 text-neutral-400" />
          </a>
          <button
            type="button"
            onClick={() => navigate("/legal")}
            className="flex items-center justify-between rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            {tx("Community guidelines", "Community-Richtlinien", "قوانین جامعه")}
            <ChevronRight className="h-4 w-4 text-neutral-400" />
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm md:p-5">
        <div className="mb-3 inline-flex items-center gap-2">
          <Lock className="h-4 w-4 text-emerald-600" />
          <h2 className="text-xl font-bold text-neutral-900">{tx("Account", "Konto", "حساب")}</h2>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-xl border border-neutral-200 px-3 py-2.5">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-800">
              <Mail className="h-4 w-4 text-neutral-500" />
              {tx("Email", "E-Mail", "ایمیل")}
            </div>
            <span className="max-w-[65%] truncate text-sm text-neutral-600">{user?.email || "No email"}</span>
          </div>

          <button
            type="button"
            onClick={sendPasswordReset}
            disabled={passwordBusy}
            className="flex w-full items-center justify-between rounded-xl border border-neutral-200 px-3 py-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
          >
            {tx("Change password", "Passwort andern", "تغییر رمز عبور")}
            <span className="text-xs text-neutral-500">
              {passwordBusy ? tx("Sending...", "Wird gesendet...", "در حال ارسال...") : tx("Send reset link", "Reset-Link senden", "ارسال لینک بازنشانی")}
            </span>
          </button>

          <label className="grid gap-1.5 rounded-xl border border-neutral-200 px-3 py-2.5 text-sm font-semibold text-neutral-800">
            {tx("Language", "Sprache", "زبان")}
            <select
              value={language}
              onChange={(e) => updateLanguage(e.target.value as LanguageValue)}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 outline-none focus:border-emerald-400"
            >
              <option value="en">{tx("English", "Englisch", "انگلیسی")}</option>
              <option value="de">{tx("German", "Deutsch", "آلمانی")}</option>
              <option value="fa">{tx("Persian", "Persisch", "فارسی")}</option>
            </select>
          </label>
        </div>

        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50/80 p-3">
          <div className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-red-700">
            <AlertTriangle className="h-4 w-4" />
            {tx("Danger zone", "Gefahrenbereich", "بخش خطرناک")}
          </div>
          <div className="space-y-2">
            <button
              type="button"
              onClick={logout}
              disabled={logoutBusy}
              className="flex w-full items-center justify-between rounded-xl border border-red-200 bg-white px-3 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2">
                <LogOut className="h-4 w-4" />
                {tx("Log out", "Abmelden", "خروج از حساب")}
              </span>
              <ChevronRight className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={deleteAccount}
              disabled={deleteBusy}
              className="flex w-full items-center justify-between rounded-xl border border-red-300 bg-red-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                {deleteBusy ? tx("Deleting...", "Wird geloscht...", "در حال حذف...") : tx("Delete account", "Konto loschen", "حذف حساب")}
              </span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}
