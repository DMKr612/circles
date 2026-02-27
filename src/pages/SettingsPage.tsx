import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Check,
  Copy,
  HelpCircle,
  Lock,
  Link2,
  LogOut,
  Mail,
  Search,
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
import { useProfileStats } from "@/hooks/useProfileStats";
import "./SettingsPage.css";

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
};

type PersistedSettings = {
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  language: LanguageValue;
  visualMode?: VisualModeValue;
};

type VisualModeValue = "light" | "system" | "contrast";

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
};

const DEFAULT_LANGUAGE: LanguageValue = "en";
const DEFAULT_VISUAL_MODE: VisualModeValue = "light";
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

type PanelId =
  | "profile"
  | "identity"
  | "trust"
  | "notifications"
  | "appearance"
  | "privacy"
  | "connected"
  | "account"
  | "danger";

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

function toTitleCase(input: string): string {
  return String(input || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function groupSizeBucket(value: number | null): "1-3" | "4-6" | "7-10" | "10+" | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value <= 24) return "1-3";
  if (value <= 49) return "4-6";
  if (value <= 74) return "7-10";
  return "10+";
}

function parsePersistedSettings(raw: unknown): PersistedSettings {
  const source = raw && typeof raw === "object" ? (raw as Partial<PersistedSettings>) : {};
  const sourceNotifications =
    source.notifications && typeof source.notifications === "object"
      ? (source.notifications as Partial<NotificationSettings>)
      : {};
  const sourcePrivacy =
    source.privacy && typeof source.privacy === "object"
      ? (source.privacy as Partial<PrivacySettings>)
      : {};

  const language: LanguageValue =
    source.language === "de" || source.language === "fa" || source.language === "en"
      ? source.language
      : DEFAULT_LANGUAGE;

  const visualMode: VisualModeValue =
    source.visualMode === "light" || source.visualMode === "system" || source.visualMode === "contrast"
      ? source.visualMode
      : DEFAULT_VISUAL_MODE;

  const profileVisibility: ProfileVisibilityValue =
    sourcePrivacy.profileVisibility === "my_circles" ||
    sourcePrivacy.profileVisibility === "chat_contacts" ||
    sourcePrivacy.profileVisibility === "city"
      ? sourcePrivacy.profileVisibility
      : DEFAULT_PRIVACY.profileVisibility;

  const whoCanMessage: MessageAccessValue =
    sourcePrivacy.whoCanMessage === "my_circles" ||
    sourcePrivacy.whoCanMessage === "shared_circles" ||
    sourcePrivacy.whoCanMessage === "anyone"
      ? sourcePrivacy.whoCanMessage
      : DEFAULT_PRIVACY.whoCanMessage;

  return {
    notifications: {
      ...DEFAULT_NOTIFICATIONS,
      ...sourceNotifications,
    },
    privacy: {
      profileVisibility,
      whoCanMessage,
    },
    language,
    visualMode,
  };
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
      className={`settings-toggle${checked ? " on" : ""}${disabled ? " is-disabled" : ""}`}
    >
      <span className="settings-toggle-knob" />
    </button>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { lang: appLang, setLang: setAppLang } = useAppLanguage();
  const uid = user?.id ?? null;
  const { stats, loading: statsLoading } = useProfileStats(uid);

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
  const [personalityTraits, setPersonalityTraits] = useState<any | null>(null);
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
  const [leaveAllBusy, setLeaveAllBusy] = useState(false);
  const [unblockBusyId, setUnblockBusyId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<PanelId>("profile");
  const [settingsSearch, setSettingsSearch] = useState("");
  const [saveFxActive, setSaveFxActive] = useState(false);
  const [visualMode, setVisualMode] = useState<VisualModeValue>(DEFAULT_VISUAL_MODE);
  const [prefersDark, setPrefersDark] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const saveFxTimerRef = useRef<number | null>(null);

  const profileExtrasKey = useMemo(
    () => (uid ? `circles_profile_extras_${uid}` : null),
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

  const navItems = useMemo(
    () =>
      [
        { id: "profile" as PanelId, section: "account", label: tx("Profile", "Profil", "پروفایل"), icon: "🪪" },
        { id: "identity" as PanelId, section: "account", label: tx("Identity", "هویت", "هویت"), icon: "✨" },
        { id: "trust" as PanelId, section: "account", label: tx("Trust Score", "Trust-Score", "امتیاز اعتماد"), icon: "⭐", tag: "BETA" },
        {
          id: "notifications" as PanelId,
          section: "prefs",
          label: tx("Notifications", "Benachrichtigungen", "اعلان‌ها"),
          icon: "🔔",
        },
        { id: "appearance" as PanelId, section: "prefs", label: tx("Appearance", "Darstellung", "ظاهر"), icon: "🎨" },
        { id: "privacy" as PanelId, section: "safety", label: tx("Privacy", "Datenschutz", "حریم خصوصی"), icon: "🛡️" },
        { id: "connected" as PanelId, section: "safety", label: tx("Connected Apps", "Verbundene Apps", "برنامه‌های متصل"), icon: "🔗" },
        { id: "account" as PanelId, section: "safety", label: tx("Account", "Konto", "حساب"), icon: "🔑" },
        { id: "danger" as PanelId, section: "safety", label: tx("Danger Zone", "Gefahrenbereich", "بخش خطر"), icon: "⚠️", danger: true },
      ] as const,
    [tx]
  );

  const filteredNavItems = useMemo(() => {
    const q = settingsSearch.trim().toLowerCase();
    if (!q) return navItems;
    return navItems.filter((item) => item.label.toLowerCase().includes(q));
  }, [navItems, settingsSearch]);

  useEffect(() => {
    if (!filteredNavItems.some((item) => item.id === activePanel)) {
      const fallback = filteredNavItems[0]?.id || "profile";
      setActivePanel(fallback);
    }
  }, [activePanel, filteredNavItems]);

  const profileCompletionPct = useMemo(() => {
    const checks = [
      Boolean(profileSnapshot.name),
      Boolean(profileSnapshot.publicId),
      Boolean(profileSnapshot.bio),
      Boolean(profileSnapshot.city),
      profileSnapshot.age !== null,
    ];
    const done = checks.filter(Boolean).length;
    return Math.round((done / checks.length) * 100);
  }, [profileSnapshot]);

  const circlesCount = stats.circlesCount;
  const meetupsCount = stats.meetupsCount;
  const trustScore = stats.trustScore;
  const ratingCount = stats.ratingCount;

  const trustFramework = useMemo(() => {
    if (trustScore == null || ratingCount == null || circlesCount == null || meetupsCount == null) {
      return null;
    }

    const safeScore = Number.isFinite(trustScore) ? Math.max(0, Math.min(10, trustScore)) : 0;
    const ratingSignal = Math.min(100, ratingCount * 20);
    const meetupSignal = circlesCount > 0 ? Math.min(100, Math.round((meetupsCount / (circlesCount * 2)) * 100)) : 0;
    const consistencySignal = Math.min(100, Math.round((safeScore / 10) * 100));

    return {
      safeScore,
      ratingSignal,
      meetupSignal,
      consistencySignal,
    };
  }, [circlesCount, meetupsCount, ratingCount, trustScore]);

  const identityModel = useMemo(() => {
    const traits = personalityTraits && typeof personalityTraits === "object" ? personalityTraits : {};
    const summary = traits.summary && typeof traits.summary === "object" ? traits.summary : {};
    const labels = traits.labels && typeof traits.labels === "object" ? traits.labels : {};
    const dimensions = traits.dimensions && typeof traits.dimensions === "object" ? traits.dimensions : {};

    const tagCandidates = [
      typeof traits.style === "string" ? traits.style : "",
      typeof summary.energy === "string" ? summary.energy : "",
      typeof summary.group_size === "string" ? summary.group_size : "",
      typeof summary.planning === "string" ? summary.planning : "",
      typeof summary.conversation === "string" ? summary.conversation : "",
      typeof summary.meetup_length === "string" ? summary.meetup_length : "",
      typeof labels.stim === "string" ? labels.stim : "",
      typeof labels.connection === "string" ? labels.connection : "",
    ]
      .map((v) => toTitleCase(String(v || "")))
      .filter(Boolean);

    const uniqueTags = Array.from(new Set(tagCandidates)).slice(0, 10);
    const stim = Number(dimensions.stim);
    const energyValue = Number.isFinite(stim) ? Math.max(0, Math.min(100, Math.round(stim))) : null;
    const groupSize = Number(dimensions.group_size);
    const groupSizeValue = Number.isFinite(groupSize) ? Math.max(0, Math.min(100, Math.round(groupSize))) : null;

    return {
      tags: uniqueTags,
      energyValue,
      energyLabel: toTitleCase(String(summary.energy || labels.stim || "")),
      groupSizeBucket: groupSizeBucket(groupSizeValue),
      groupSizeLabel: toTitleCase(String(summary.group_size || labels.group_size || "")),
    };
  }, [personalityTraits]);

  const resolvedVisualMode = visualMode === "system" ? (prefersDark ? "contrast" : "light") : visualMode;

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
    if (!window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (next: boolean) => setPrefersDark(next);
    apply(media.matches);
    const handler = (event: MediaQueryListEvent) => apply(event.matches);
    if (media.addEventListener) {
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
    media.addListener(handler);
    return () => media.removeListener(handler);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = String(event.key || "").toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      if (saveFxTimerRef.current) {
        window.clearTimeout(saveFxTimerRef.current);
        saveFxTimerRef.current = null;
      }
    };
  }, []);

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
      const normalized = parsePersistedSettings(next);
      const { error } = await supabase.auth.updateUser({
        data: {
          settings: normalized,
        },
      });
      if (error) throw error;
    },
    []
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

      const authSettings = parsePersistedSettings((user?.user_metadata as any)?.settings);
      const localExtras = parseJson<{ bio?: string; availability?: AvailabilityValue; age?: number | string }>(
        profileExtrasKey ? localStorage.getItem(profileExtrasKey) : null
      );

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
      setPersonalityTraits(p.personality_traits ?? null);
      setNotifications(authSettings.notifications);
      setPrivacy(authSettings.privacy);
      setLanguage(authSettings.language);
      setVisualMode(authSettings.visualMode || DEFAULT_VISUAL_MODE);
      setAppLang(authSettings.language);

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
  }, [uid, profileExtrasKey, loadCities, loadBlockedUsers, setAppLang]);

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

  async function saveProfile(): Promise<boolean> {
    if (!uid) return false;
    if (profileErrors.length) {
      setToast({ kind: "error", text: profileErrors[0] });
      return false;
    }
    if (!isValidPublicId(profileSnapshot.publicId)) {
      setToast({ kind: "error", text: "Public ID format is invalid." });
      return false;
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
      return true;
    } catch (err: any) {
      setToast({ kind: "error", text: err?.message || "Could not save profile." });
      return false;
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
    const prev = notifications;
    setNotifications(next);
    try {
      await persistSettings({ notifications: next, privacy, language, visualMode });
      setToast({
        kind: "success",
        text: tx("Notifications updated.", "Benachrichtigungen aktualisiert.", "اعلان‌ها به‌روزرسانی شد."),
      });
    } catch (err: any) {
      setNotifications(prev);
      setToast({ kind: "error", text: err?.message || "Could not update notifications." });
    }
  }

  async function updatePrivacy(next: PrivacySettings) {
    const prev = privacy;
    setPrivacy(next);
    try {
      await persistSettings({ notifications, privacy: next, language, visualMode });
      setToast({
        kind: "success",
        text: tx("Privacy settings updated.", "Datenschutz aktualisiert.", "تنظیمات حریم خصوصی به‌روزرسانی شد."),
      });
    } catch (err: any) {
      setPrivacy(prev);
      setToast({ kind: "error", text: err?.message || "Could not update privacy settings." });
    }
  }

  async function updateLanguage(next: LanguageValue) {
    const prev = language;
    setLanguage(next);
    setAppLang(next);
    try {
      await persistSettings({ notifications, privacy, language: next, visualMode });
      setToast({
        kind: "success",
        text: next === "de" ? "Sprache aktualisiert." : next === "fa" ? "زبان به‌روزرسانی شد." : "Language updated.",
      });
    } catch (err: any) {
      setLanguage(prev);
      setAppLang(prev);
      setToast({ kind: "error", text: err?.message || "Could not update language." });
    }
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
      navigate("/auth", { replace: true });
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

  async function triggerSave() {
    if (saveFxActive) return;
    const ok = await saveProfile();
    if (!ok) return;
    setSaveFxActive(true);
    if (saveFxTimerRef.current) window.clearTimeout(saveFxTimerRef.current);
    saveFxTimerRef.current = window.setTimeout(() => {
      setSaveFxActive(false);
      saveFxTimerRef.current = null;
    }, 2200);
  }

  async function updateVisualMode(next: VisualModeValue) {
    const prev = visualMode;
    setVisualMode(next);
    try {
      await persistSettings({ notifications, privacy, language, visualMode: next });
      setToast({
        kind: "success",
        text: tx("Visual mode updated.", "Ansicht aktualisiert.", "حالت نمایش به‌روزرسانی شد."),
      });
    } catch (err: any) {
      setVisualMode(prev);
      setToast({ kind: "error", text: err?.message || "Could not update visual mode." });
    }
  }

  async function leaveAllCircles() {
    if (!uid) return;
    const ok = window.confirm(
      tx(
        "Leave all circles you joined? Circles you host will be kept.",
        "Alle beigetretenen Circles verlassen? Circles, die du hostest, bleiben erhalten.",
        "از همه حلقه‌هایی که عضو هستید خارج شوید؟ حلقه‌هایی که میزبانشان هستید حفظ می‌شوند."
      )
    );
    if (!ok) return;

    setLeaveAllBusy(true);
    try {
      const { data: memberships, error: memberErr } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", uid)
        .in("status", ["active", "accepted"]);
      if (memberErr) throw memberErr;

      const groupIds = Array.from(new Set((memberships || []).map((row: any) => String(row.group_id || "")).filter(Boolean)));
      if (!groupIds.length) {
        setToast({ kind: "info", text: tx("No joined circles found.", "Keine beigetretenen Circles gefunden.", "حلقه عضو شده‌ای پیدا نشد.") });
        return;
      }

      const { data: hostedGroups, error: hostedErr } = await supabase
        .from("groups")
        .select("id")
        .eq("host_user_id", uid)
        .in("id", groupIds);
      if (hostedErr) throw hostedErr;

      const hostedSet = new Set((hostedGroups || []).map((row: any) => String(row.id || "")));
      const removableIds = groupIds.filter((id) => !hostedSet.has(id));
      if (!removableIds.length) {
        setToast({
          kind: "info",
          text: tx(
            "You only host circles right now, so there is nothing to leave.",
            "Du hostest aktuell nur Circles, daher gibt es nichts zu verlassen.",
            "در حال حاضر فقط میزبان حلقه‌ها هستید، بنابراین چیزی برای خروج وجود ندارد."
          ),
        });
        return;
      }
      let success = 0;
      let failed = 0;

      for (const gid of removableIds) {
        const { error } = await supabase.from("group_members").delete().match({ group_id: gid, user_id: uid });
        if (error) {
          failed += 1;
        } else {
          success += 1;
        }
      }

      if (success > 0) {
        await queryClient.invalidateQueries({ queryKey: ["profile", uid] });
      }

      if (failed > 0) {
        setToast({
          kind: "info",
          text: tx(
            `Left ${success} circle(s). ${failed} could not be left yet (cooldown or permissions).`,
            `${success} Circle(s) verlassen. ${failed} konnten noch nicht verlassen werden (Cooldown oder Rechte).`,
            `از ${success} حلقه خارج شدید. خروج از ${failed} حلقه هنوز ممکن نیست (محدودیت زمانی یا دسترسی).`
          ),
        });
      } else {
        const hostedCount = hostedSet.size;
        setToast({
          kind: "success",
          text:
            hostedCount > 0
              ? tx(
                  `Left ${success} circle(s). ${hostedCount} hosted circle(s) were kept.`,
                  `${success} Circle(s) verlassen. ${hostedCount} gehostete Circle(s) wurden behalten.`,
                  `از ${success} حلقه خارج شدید. ${hostedCount} حلقه‌ای که میزبانش بودید حفظ شد.`
                )
              : tx(
                  `Left ${success} circle(s).`,
                  `${success} Circle(s) verlassen.`,
                  `از ${success} حلقه خارج شدید.`
                ),
        });
      }
    } catch (err: any) {
      setToast({ kind: "error", text: err?.message || "Could not leave all circles." });
    } finally {
      setLeaveAllBusy(false);
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
    <div className={`settings-page mode-${resolvedVisualMode}`}>
      <div className="settings-app">
        <header className="settings-topbar">
          <div className="settings-topbar-left">
            <button type="button" onClick={goBack} className="back-pill">
              <ArrowLeft size={14} />
              {tx("Profile", "Profil", "پروفایل")}
            </button>
            <h1 className="settings-topbar-title">{tx("Settings", "Einstellungen", "تنظیمات")}</h1>
          </div>

          <div className="settings-topbar-right">
            <label className="settings-search-bar" htmlFor="settings-search-input">
              <Search size={14} />
              <input
                id="settings-search-input"
                ref={searchInputRef}
                type="text"
                value={settingsSearch}
                onChange={(e) => setSettingsSearch(e.target.value)}
                placeholder={tx("Search settings...", "Einstellungen suchen...", "جستجوی تنظیمات...")}
              />
            </label>
            <button
              type="button"
              onClick={() => void triggerSave()}
              disabled={profileSaving || saveFxActive || !profileDirty}
              className={`settings-save-btn${saveFxActive ? " saved" : ""}`}
            >
              {profileSaving ? tx("Saving...", "Wird gespeichert...", "در حال ذخیره...") : tx("Save changes", "Änderungen speichern", "ذخیره تغییرات")}
            </button>
          </div>
        </header>

        <aside className="settings-sidebar">
          {(["account", "prefs", "safety"] as const).map((section) => {
            const items = filteredNavItems.filter((item) => item.section === section);
            if (!items.length) return null;

            const sectionLabel =
              section === "account"
                ? tx("Profile", "Profil", "پروفایل")
                : section === "prefs"
                ? tx("Preferences", "Präferenzen", "ترجیحات")
                : tx("Safety", "Sicherheit", "ایمنی");

            return (
              <div key={section}>
                <div className="sidebar-section-label">{sectionLabel}</div>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActivePanel(item.id)}
                    className={`settings-nav-item${activePanel === item.id ? " is-active" : ""}${item.danger ? " is-danger" : ""}`}
                  >
                    <span className="settings-nav-icon">{item.icon}</span>
                    <span className="settings-nav-label">{item.label}</span>
                    {item.badge ? (
                      <span className={`settings-nav-badge${item.mutedBadge ? " muted" : ""}`}>{item.badge}</span>
                    ) : null}
                    {item.tag ? <span className="settings-tag new">{item.tag}</span> : null}
                  </button>
                ))}
              </div>
            );
          })}
        </aside>

        <main className="settings-main">
          {toast && (
            <div className={`settings-toast ${toast.kind}`}>
              {toast.text}
            </div>
          )}

          <section className={`settings-panel${activePanel === "profile" ? " is-active" : ""}`} id="panel-profile">
            <div className="panel-hero">
              <div>
                <h2 className="panel-heading">{tx("Your Profile", "Dein Profil", "پروفایل شما")}</h2>
                <p className="panel-sub">{tx("How others see you in circles", "Wie andere dich sehen", "دیگران شما را چگونه می‌بینند")}</p>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-block-title">
                <User size={14} />
                {tx("Identity Card", "Profilkarte", "کارت هویت")}
              </div>
              <div className="settings-avatar-editor">
                <label className="settings-ava-wrap">
                  <div className="settings-ava">
                    <img
                      src={getAvatarUrl(avatarUrl, uid || user?.email || "circles-user")}
                      alt="Profile avatar"
                      className="settings-ava-img"
                    />
                  </div>
                  <div className="settings-ava-overlay">📷</div>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={onAvatarFileChange}
                    className="hidden-input"
                  />
                </label>

                <div className="settings-ava-info">
                  <div className="settings-ava-name">{name || "Circle Member"}</div>
                  <div className="settings-ava-sub">
                    @{profileSnapshot.publicId || "set-public-id"} · {city || tx("Set your city", "Stadt setzen", "شهر را تنظیم کنید")}
                  </div>
                  <div className="settings-progress-wrap">
                    <div className="settings-progress-label">
                      {tx("Profile completion", "Profilstatus", "تکمیل پروفایل")} {profileCompletionPct}%
                    </div>
                    <div className="settings-progress-bar">
                      <span style={{ width: `${profileCompletionPct}%` }} />
                    </div>
                  </div>
                  <div className="settings-inline-actions">
                    <label className="settings-soft-btn">
                      <Upload size={13} />
                      {tx("Upload", "Hochladen", "آپلود")}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={onAvatarFileChange}
                        className="hidden-input"
                      />
                    </label>
                    <button type="button" className="settings-soft-btn" onClick={() => setAvatarUrl(null)}>
                      {tx("Remove", "Entfernen", "حذف")}
                    </button>
                    <button type="button" className="settings-soft-btn" onClick={() => void copyPublicIdToClipboard()}>
                      <Copy size={13} />
                      {copiedPublicId ? "Copied" : "Copy ID"}
                    </button>
                  </div>
                  <p className="settings-help-line">
                    {tx(
                      `JPG, PNG, or WEBP. Max ${MAX_AVATAR_MB}MB.`,
                      `JPG, PNG oder WEBP. Maximal ${MAX_AVATAR_MB}MB.`,
                      `فرمت JPG، PNG یا WEBP. حداکثر ${MAX_AVATAR_MB} مگابایت.`
                    )}
                    {avatarUploading ? ` ${tx("Uploading...", "Wird hochgeladen...", "در حال آپلود...")}` : ""}
                  </p>
                </div>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-block-title">
                <Sparkles size={14} />
                {tx("Profile Fields", "Profilfelder", "فیلدهای پروفایل")}
              </div>
              <div className="settings-fields-grid two">
                <label className="settings-field-wrap">
                  <span className="settings-field-label">{tx("Name", "Name", "نام")}</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    className="settings-input"
                    placeholder={tx("Your name", "Dein Name", "نام شما")}
                  />
                </label>

                <label className="settings-field-wrap">
                  <span className="settings-field-label">Public ID</span>
                  <input
                    value={publicId}
                    onChange={(e) => setPublicId(normalizePublicId(e.target.value))}
                    maxLength={PUBLIC_ID_MAX_LENGTH}
                    className="settings-input"
                    placeholder="dara4821"
                  />
                  <div className="settings-inline-help">
                    <span
                      className={`settings-hint ${
                        publicIdChecking
                          ? ""
                          : publicIdAvailable === false
                          ? "error"
                          : publicIdAvailable === true
                          ? "ok"
                          : ""
                      }`}
                    >
                      {publicIdChecking
                        ? "Checking availability..."
                        : publicIdAvailable === false
                        ? "Public ID is already taken."
                        : publicIdAvailable === true
                        ? "Public ID is available."
                        : "Format: name + 4 numbers (example: dara4821)."}
                    </span>
                    <button type="button" className="settings-copy-pill" onClick={() => void copyPublicIdToClipboard()}>
                      {copiedPublicId ? <Check size={13} /> : <Copy size={13} />}
                      {copiedPublicId ? "Copied" : "Copy"}
                    </button>
                  </div>
                </label>

                <label className="settings-field-wrap">
                  <span className="settings-field-label">{tx("City", "Stadt", "شهر")}</span>
                  <input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    onFocus={loadCities}
                    list="settings-cities-de"
                    className="settings-input"
                    placeholder="Freiburg"
                  />
                  <datalist id="settings-cities-de">
                    {deCities.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </label>

                <label className="settings-field-wrap">
                  <span className="settings-field-label">{tx("Age", "Alter", "سن")}</span>
                  <input
                    value={age}
                    onChange={(e) => setAge(e.target.value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    maxLength={3}
                    className="settings-input"
                    placeholder="18"
                  />
                </label>

                <label className="settings-field-wrap full">
                  <span className="settings-field-label">
                    {tx("Bio", "Bio", "بیو")}
                    <span className={`settings-counter ${bio.length > 160 ? "warn" : ""}`}>{bio.length}/{MAX_BIO_LENGTH}</span>
                  </span>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={MAX_BIO_LENGTH}
                    rows={4}
                    className="settings-textarea"
                    placeholder={tx("Tell your circles who you are...", "Erzähl etwas über dich...", "کمی درباره خودت بنویس...")}
                  />
                </label>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-block-title">
                <CalendarDays size={14} />
                {tx("Availability", "Verfügbarkeit", "زمان‌های در دسترس")}
              </div>
              <div className="settings-chip-row">
                {[
                  { value: "weekday_evenings" as AvailabilityValue, label: tx("Weekday evenings", "Wochentage abends", "عصرهای هفته") },
                  { value: "weekends" as AvailabilityValue, label: tx("Weekends", "آخر هفته", "آخر هفته‌ها") },
                  { value: "flexible" as AvailabilityValue, label: tx("Flexible", "Flexibel", "منعطف") },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAvailability(opt.value)}
                    className={`settings-chip${availability === opt.value ? " active" : ""}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="settings-row no-hover">
                <div className="row-left">
                  <div className="row-label">{tx("Social style", "Sozialstil", "سبک اجتماعی")}</div>
                  <div className="row-desc">{socialStyle}</div>
                </div>
                <div className="row-right">
                  <button type="button" className="settings-soft-btn" onClick={() => navigate("/quiz")}>
                    {tx("Take / retake quiz", "Quiz starten / erneut machen", "انجام / تکرار آزمون")}
                  </button>
                </div>
              </div>
            </div>

            {profileErrors.length > 0 ? <div className="settings-inline-error">{profileErrors[0]}</div> : null}
          </section>

          <section className={`settings-panel${activePanel === "identity" ? " is-active" : ""}`} id="panel-identity">
            <div className="panel-hero">
              <div>
                <h2 className="panel-heading">{tx("Identity", "Identität", "هویت")}</h2>
                <p className="panel-sub">
                  {tx(
                    "Only profile fields backed by your current account data.",
                    "Nur Felder mit echter Kontodaten-Anbindung.",
                    "فقط فیلدهایی که به داده واقعی حساب شما وصل هستند."
                  )}
                </p>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-block-title">
                <Sparkles size={14} />
                {tx("Quiz Identity", "Quiz-Identität", "هویت آزمون")}
              </div>
              <div className="settings-row no-hover">
                <div className="row-left">
                  <div className="row-label">{tx("Social style", "Sozialstil", "سبک اجتماعی")}</div>
                  <div className="row-desc">{socialStyle}</div>
                </div>
                <div className="row-right">
                  <button type="button" className="settings-soft-btn" onClick={() => navigate("/quiz")}>
                    {tx("Take / retake quiz", "Quiz starten / erneut machen", "انجام / تکرار آزمون")}
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-block identity-enhanced">
              <div className="settings-block-title">
                <Sparkles size={14} />
                {tx("Identity Signals", "Identitäts-Signale", "نشانه‌های هویتی")}
              </div>

              <div className="identity-section">
                <div className="identity-section-head">
                  {tx("Interests & vibe", "Interessen & Vibe", "علایق و حال‌و‌هوا")}
                </div>
                {identityModel.tags.length > 0 ? (
                  <div className="identity-chip-cloud">
                    {identityModel.tags.map((tag) => (
                      <span key={tag} className="identity-chip">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="identity-empty">
                    {tx(
                      "No quiz signals yet. Take the quiz to generate identity tags.",
                      "Noch keine Quiz-Signale. Starte das Quiz, um Identitäts-Tags zu erzeugen.",
                      "هنوز سیگنال آزمون ندارید. برای ساخت تگ‌های هویتی آزمون را انجام دهید."
                    )}
                  </div>
                )}
              </div>

              <div className="identity-section">
                <div className="identity-section-head">{tx("Energy level", "Energielevel", "سطح انرژی")}</div>
                <div className="identity-energy-row">
                  <span>{tx("Calm", "Ruhig", "آرام")}</span>
                  <span>{identityModel.energyValue != null ? `${identityModel.energyValue}%` : "—"}</span>
                  <span>{tx("High energy", "Hohe Energie", "انرژی بالا")}</span>
                </div>
                <div className="identity-energy-track">
                  <span
                    className="identity-energy-fill"
                    style={{ width: `${identityModel.energyValue ?? 0}%` }}
                  />
                  <span
                    className="identity-energy-knob"
                    style={{ left: `${identityModel.energyValue ?? 0}%` }}
                  />
                </div>
                {identityModel.energyLabel ? <div className="identity-caption">{identityModel.energyLabel}</div> : null}
              </div>

              <div className="identity-section">
                <div className="identity-section-head">
                  {tx("Group size preference", "Gruppengröße-Präferenz", "ترجیح اندازه گروه")}
                </div>
                <div className="identity-size-row">
                  {(["1-3", "4-6", "7-10", "10+"] as const).map((range) => (
                    <span
                      key={range}
                      className={`identity-size-chip${identityModel.groupSizeBucket === range ? " active" : ""}`}
                    >
                      {range}
                    </span>
                  ))}
                </div>
                {identityModel.groupSizeLabel ? <div className="identity-caption">{identityModel.groupSizeLabel}</div> : null}
              </div>
            </div>
          </section>

          <section className={`settings-panel${activePanel === "trust" ? " is-active" : ""}`} id="panel-trust">
            <div className="panel-hero">
              <div>
                <h2 className="panel-heading">{tx("Trust Score", "Trust-Score", "امتیاز اعتماد")}</h2>
                <p className="panel-sub">
                  {tx(
                    "Real metrics from your account data. Framework is still in beta.",
                    "Echte Metriken aus deinen Kontodaten. Das Framework ist noch in Beta.",
                    "معیارهای واقعی از داده حساب شما. این چارچوب هنوز در نسخه بتا است."
                  )}
                </p>
              </div>
              <span className="settings-tag beta">BETA</span>
            </div>

            <div className="settings-block trust-highlight">
              <div className="trust-score-main">
                <div className="trust-score-value">
                  {statsLoading ? "…" : trustFramework ? trustFramework.safeScore.toFixed(1) : "—"}
                </div>
                <div className="trust-score-meta">
                  {statsLoading
                    ? tx("Loading live trust stats...", "Lade Live-Trust-Statistiken...", "در حال بارگذاری آمار زنده اعتماد...")
                    : trustFramework
                    ? tx(
                        `${ratingCount} rating(s) · ${circlesCount} circle(s) · ${meetupsCount} meetup(s)`,
                        `${ratingCount} Bewertung(en) · ${circlesCount} Circle(s) · ${meetupsCount} Treffen`,
                        `${ratingCount} امتیاز · ${circlesCount} حلقه · ${meetupsCount} دورهمی`
                      )
                    : tx(
                        "Live trust stats are temporarily unavailable.",
                        "Live-Trust-Statistiken sind vorübergehend nicht verfügbar.",
                        "آمار زنده اعتماد موقتاً در دسترس نیست."
                      )}
                </div>
              </div>
              <div className="trust-stats-strip">
                <div className="trust-stat-item">
                  <span>{tx("Circles", "Circles", "حلقه‌ها")}</span>
                  <strong>{statsLoading ? "…" : circlesCount ?? "—"}</strong>
                </div>
                <div className="trust-stat-item">
                  <span>{tx("Meetups", "Meetups", "دورهمی‌ها")}</span>
                  <strong>{statsLoading ? "…" : meetupsCount ?? "—"}</strong>
                </div>
                <div className="trust-stat-item">
                  <span>{tx("Ratings", "Bewertungen", "امتیازها")}</span>
                  <strong>{statsLoading ? "…" : ratingCount ?? "—"}</strong>
                </div>
              </div>
              <div className="trust-meter-list">
                {[
                  {
                    label: tx("Meetup participation", "Meetup-Teilnahme", "مشارکت در دورهمی"),
                    value: trustFramework?.meetupSignal ?? 0,
                    tone: "teal",
                  },
                  {
                    label: tx("Feedback volume", "Feedback-Volumen", "حجم بازخورد"),
                    value: trustFramework?.ratingSignal ?? 0,
                    tone: "blue",
                  },
                  {
                    label: tx("Consistency score", "Konsistenz-Score", "امتیاز ثبات"),
                    value: trustFramework?.consistencySignal ?? 0,
                    tone: "amber",
                  },
                ].map((item) => (
                  <div key={item.label} className="trust-meter-row">
                    <div className="trust-meter-head">
                      <span>{item.label}</span>
                      <span>{item.value}%</span>
                    </div>
                    <div className="trust-meter">
                      <span className={`tone-${item.tone}`} style={{ width: `${item.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className={`settings-panel${activePanel === "notifications" ? " is-active" : ""}`} id="panel-notifications">
            <div className="panel-hero">
              <div>
                <h2 className="panel-heading">{tx("Notifications", "Benachrichtigungen", "اعلان‌ها")}</h2>
                <p className="panel-sub">{tx("Stay in the loop, your way", "Bleib informiert, auf deine Art", "به روش خودت در جریان بمان")}</p>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-block-title">{tx("Channels", "Kanäle", "کانال‌ها")}</div>
              <div className="settings-row">
                <div className="row-left">
                  <div className="row-label">{tx("Push notifications", "Push-Benachrichtigungen", "اعلان‌های پوش")}</div>
                  <div className="row-desc">
                    {tx("Saved to your account preferences", "In deinen Kontoeinstellungen gespeichert", "در تنظیمات حساب شما ذخیره می‌شود")}
                  </div>
                </div>
                <div className="row-right">
                  <Toggle
                    checked={notifications.pushEnabled}
                    onClick={() =>
                      void updateNotifications({
                        ...notifications,
                        pushEnabled: !notifications.pushEnabled,
                      })
                    }
                    ariaLabel="Toggle push notifications"
                  />
                </div>
              </div>

              <div className="settings-row">
                <div className="row-left">
                  <div className="row-label">{tx("Email notifications", "E-Mail-Benachrichtigungen", "اعلان‌های ایمیلی")}</div>
                  <div className="row-desc">{tx("Weekly digest & reminders", "Wöchentliche Zusammenfassung", "خلاصه هفتگی و یادآورها")}</div>
                </div>
                <div className="row-right">
                  <Toggle
                    checked={notifications.emailEnabled}
                    onClick={() =>
                      void updateNotifications({
                        ...notifications,
                        emailEnabled: !notifications.emailEnabled,
                      })
                    }
                    ariaLabel="Toggle email notifications"
                  />
                </div>
              </div>

              <div className="settings-row is-disabled">
                <div className="row-left">
                  <div className="row-label">
                    {tx("SMS reminders", "SMS-Erinnerungen", "یادآور پیامکی")} <span className="settings-tag beta">BETA</span>
                  </div>
                  <div className="row-desc">
                    {tx("Coming soon. This option is locked for now.", "Kommt bald. Diese Option ist vorerst gesperrt.", "به‌زودی. این گزینه فعلاً قفل است.")}
                  </div>
                </div>
                <div className="row-right">
                  <button type="button" className="settings-lock-pill" disabled>
                    <Lock size={13} />
                    {tx("Locked", "Gesperrt", "قفل")}
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-block-title">{tx("Events", "Ereignisse", "رویدادها")}</div>
              {[
                { key: "meetupScheduled", label: tx("Meetup scheduled", "Treffen geplant", "ملاقات برنامه‌ریزی شد") },
                { key: "pollCreated", label: tx("Poll created / vote needed", "Umfrage erstellt / Abstimmung nötig", "نظرسنجی ایجاد شد / رای لازم است") },
                { key: "attendanceConfirmations", label: tx("Attendance confirmations", "Teilnahme-Bestätigungen", "تایید حضور") },
                { key: "mentions", label: tx("Mentions", "Erwähnungen", "منشن‌ها") },
                { key: "announcements", label: tx("Circle announcements", "Circle-Ankündigungen", "اعلامیه‌های حلقه") },
                { key: "ratingReminders", label: tx("Rating reminders", "Bewertungs-Erinnerungen", "یادآور امتیازدهی") },
                { key: "directMessages", label: tx("Direct messages", "Direktnachrichten", "پیام‌های مستقیم") },
              ].map((item) => {
                const key = item.key as keyof NotificationSettings;
                const disabled = !notifications.pushEnabled;
                const checked = Boolean(notifications[key]);
                return (
                  <div key={item.key} className={`settings-row${disabled ? " is-disabled" : ""}`}>
                    <div className="row-left">
                      <div className="row-label">{item.label}</div>
                    </div>
                    <div className="row-right">
                      <Toggle
                        checked={checked}
                        disabled={disabled}
                        onClick={() =>
                          void updateNotifications({
                            ...notifications,
                            [key]: !checked,
                          })
                        }
                        ariaLabel={`Toggle ${item.label}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

          </section>

          <section className={`settings-panel${activePanel === "appearance" ? " is-active" : ""}`} id="panel-appearance">
            <div className="panel-hero">
              <div>
                <h2 className="panel-heading">{tx("Appearance", "Darstellung", "ظاهر")}</h2>
                <p className="panel-sub">
                  {tx(
                    "Visual mode is live and applied immediately.",
                    "Ansichtsmodus ist live und wird sofort angewendet.",
                    "حالت نمایش فعال است و بلافاصله اعمال می‌شود."
                  )}
                </p>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-block-title">{tx("Visual Mode", "Ansicht", "حالت نمایش")}</div>
              <div className="vis-grid">
                {([
                  { id: "light", title: tx("Light", "Hell", "روشن"), sub: tx("Clean default look", "Klarer Standard", "نمای پیش‌فرض روشن") },
                  { id: "system", title: tx("System", "System", "سیستمی"), sub: tx("Follow device", "Gerät folgen", "پیروی از دستگاه") },
                  { id: "contrast", title: tx("High contrast", "Hoher Kontrast", "کنتراست بالا"), sub: tx("Sharper readability", "Bessere Lesbarkeit", "خوانایی بهتر") },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`vis-opt${visualMode === opt.id ? " active" : ""}`}
                    onClick={() => void updateVisualMode(opt.id)}
                  >
                    <div className="vis-title">{opt.title}</div>
                    <div className="vis-sub">{opt.sub}</div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className={`settings-panel${activePanel === "privacy" ? " is-active" : ""}`} id="panel-privacy">
            <div className="panel-hero">
              <div>
                <h2 className="panel-heading">{tx("Privacy", "Datenschutz", "حریم خصوصی")}</h2>
                <p className="panel-sub">{tx("Control who sees what", "Steuere, wer was sieht", "کنترل کنید چه کسی چه چیزی ببیند")}</p>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-block-title">
                <Shield size={14} />
                {tx("Visibility", "Sichtbarkeit", "نمایش")}
              </div>
              <div className="vis-grid">
                {([
                  { value: "my_circles", title: tx("My circles", "Meine Circles", "حلقه‌های من"), sub: tx("Only your circle members", "Nur Mitglieder deiner Circles", "فقط اعضای حلقه‌های شما") },
                  { value: "chat_contacts", title: tx("Everyone", "Alle", "همه"), sub: tx("People you chat with", "Personen aus deinen Chats", "افرادی که با آن‌ها چت می‌کنید") },
                  { value: "city", title: tx("No one", "Niemand", "هیچکس"), sub: tx("Only city-level discovery", "Nur auf Stadtebene", "فقط کشف در سطح شهر") },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`vis-opt${privacy.profileVisibility === opt.value ? " active" : ""}`}
                    onClick={() =>
                      void updatePrivacy({
                        ...privacy,
                        profileVisibility: opt.value,
                      })
                    }
                  >
                    <div className="vis-title">{opt.title}</div>
                    <div className="vis-sub">{opt.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-block-title">{tx("Messaging", "Nachrichten", "پیام‌ها")}</div>
              <div className="settings-row">
                <div className="row-left">
                  <div className="row-label">{tx("Who can message me", "Wer kann mir schreiben", "چه کسی می‌تواند پیام بدهد")}</div>
                </div>
                <div className="row-right">
                  <select
                    className="settings-select"
                    value={privacy.whoCanMessage}
                    onChange={(e) =>
                      void updatePrivacy({
                        ...privacy,
                        whoCanMessage: e.target.value as MessageAccessValue,
                      })
                    }
                  >
                    <option value="my_circles">{tx("Only my circles", "Nur meine Circles", "فقط حلقه‌های من")}</option>
                    <option value="shared_circles">{tx("Shared circles", "Gemeinsame Circles", "حلقه‌های مشترک")}</option>
                    <option value="anyone">{tx("Anyone", "Jeder", "همه")}</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-block-title">
                <Users size={14} />
                {tx("Blocked users", "Blockierte Nutzer", "کاربران مسدود شده")}
              </div>
              {blockedLoading ? (
                <div className="settings-empty">{tx("Loading blocked users...", "Blockierte Nutzer werden geladen...", "در حال بارگذاری کاربران مسدود شده...")}</div>
              ) : blockedUsers.length === 0 ? (
                <div className="settings-empty">{tx("No blocked users.", "Keine blockierten Nutzer.", "کاربر مسدودشده‌ای وجود ندارد.")}</div>
              ) : (
                <div className="settings-list">
                  {blockedUsers.map((item) => (
                    <div key={item.userId} className="settings-list-item">
                      <div className="settings-list-user">
                        <img src={getAvatarUrl(item.avatarUrl, item.userId)} alt={item.name} className="settings-mini-avatar" />
                        <span>{item.name}</span>
                      </div>
                      <button
                        type="button"
                        className="settings-soft-btn"
                        onClick={() => void unblockUser(item.userId)}
                        disabled={unblockBusyId === item.userId}
                      >
                        {unblockBusyId === item.userId ? tx("Unblocking...", "Wird entsperrt...", "در حال رفع مسدودیت...") : tx("Unblock", "Entsperren", "رفع مسدودیت")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="settings-inline-actions">
              <a href="mailto:support@meincircles.com?subject=Help%20with%20Circles%20App" className="settings-soft-btn">
                <HelpCircle size={13} />
                {tx("Contact support", "Support kontaktieren", "تماس با پشتیبانی")}
              </a>
              <button type="button" className="settings-soft-btn" onClick={() => navigate("/legal")}>
                {tx("Community guidelines", "Community-Richtlinien", "قوانین جامعه")}
              </button>
            </div>
          </section>

          <section className={`settings-panel${activePanel === "connected" ? " is-active" : ""}`} id="panel-connected">
            <div className="panel-hero">
              <div>
                <h2 className="panel-heading">{tx("Connected Apps", "Verbundene Apps", "برنامه‌های متصل")}</h2>
                <p className="panel-sub">
                  {tx(
                    "All providers are locked until backend OAuth linking is released.",
                    "Alle Anbieter bleiben gesperrt, bis OAuth-Backend-Linking live ist.",
                    "همه ارائه‌دهنده‌ها تا زمان آماده شدن اتصال OAuth در بک‌اند قفل هستند."
                  )}
                </p>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-block-title">
                <Link2 size={14} />
                OAuth
              </div>
              {([
                { key: "google", label: "Google", desc: "Sign in" },
                { key: "linkedin", label: "LinkedIn", desc: "Professional profile" },
                { key: "discord", label: "Discord", desc: "Community identity" },
                { key: "apple", label: "Apple", desc: "Private relay sign in" },
              ] as const).map((app) => {
                return (
                  <div key={app.key} className="settings-row">
                    <div className="row-left">
                      <div className="row-label">{app.label}</div>
                      <div className="row-desc">{app.desc}</div>
                    </div>
                    <div className="row-right">
                      <button type="button" className="settings-soft-btn locked" disabled>
                        <Lock size={13} />
                        {tx("Locked", "Gesperrt", "قفل")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={`settings-panel${activePanel === "account" ? " is-active" : ""}`} id="panel-account">
            <div className="panel-hero">
              <div>
                <h2 className="panel-heading">{tx("Account", "Konto", "حساب")}</h2>
                <p className="panel-sub">{tx("Email, password, and security", "E-Mail, Passwort und Sicherheit", "ایمیل، رمز عبور و امنیت")}</p>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-block-title">
                <Lock size={14} />
                {tx("Status", "Status", "وضعیت")}
              </div>
              <div className="status-indicator">
                <span className="status-dot" />
                {tx("Account active and protected", "Konto aktiv und geschützt", "حساب فعال و محافظت‌شده")}
              </div>

              <div className="settings-row">
                <div className="row-left">
                  <div className="row-label">{tx("Email", "E-Mail", "ایمیل")}</div>
                  <div className="row-desc">{user?.email || "No email"}</div>
                </div>
                <div className="row-right">
                  <Mail size={16} />
                </div>
              </div>

              <div className="settings-row">
                <div className="row-left">
                  <div className="row-label">{tx("Password", "Passwort", "رمز عبور")}</div>
                  <div className="row-desc">{tx("Send a reset link by email", "Reset-Link per E-Mail senden", "ارسال لینک بازنشانی با ایمیل")}</div>
                </div>
                <div className="row-right">
                  <button type="button" className="settings-soft-btn" onClick={() => void sendPasswordReset()} disabled={passwordBusy}>
                    {passwordBusy ? tx("Sending...", "Senden...", "در حال ارسال...") : tx("Send reset link", "Reset-Link senden", "ارسال لینک بازنشانی")}
                  </button>
                </div>
              </div>

              <div className="settings-row">
                <div className="row-left">
                  <div className="row-label">{tx("Language", "Sprache", "زبان")}</div>
                </div>
                <div className="row-right">
                  <select className="settings-select" value={language} onChange={(e) => void updateLanguage(e.target.value as LanguageValue)}>
                    <option value="en">{tx("English", "Englisch", "انگلیسی")}</option>
                    <option value="de">{tx("German", "Deutsch", "آلمانی")}</option>
                    <option value="fa">{tx("Persian", "Persisch", "فارسی")}</option>
                  </select>
                </div>
              </div>

              <div className="settings-row">
                <div className="row-left">
                  <div className="row-label">{tx("Log out", "Abmelden", "خروج از حساب")}</div>
                </div>
                <div className="row-right">
                  <button type="button" className="settings-soft-btn" onClick={() => void logout()} disabled={logoutBusy}>
                    <LogOut size={14} />
                    {logoutBusy ? tx("Logging out...", "Abmelden...", "در حال خروج...") : tx("Log out", "Abmelden", "خروج")}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className={`settings-panel${activePanel === "danger" ? " is-active" : ""}`} id="panel-danger">
            <div className="panel-hero">
              <div>
                <h2 className="panel-heading">{tx("Danger Zone", "Gefahrenbereich", "بخش خطر")}</h2>
                <p className="panel-sub">{tx("Irreversible actions — proceed with care", "Unumkehrbare Aktionen", "اقدامات غیرقابل بازگشت")}</p>
              </div>
            </div>

            <div className="settings-block danger-block">
              <div className="settings-block-title">
                <AlertTriangle size={14} />
                {tx("Permanent actions", "Permanente Aktionen", "اقدامات دائمی")}
              </div>

              <div className="danger-row">
                <div className="row-left">
                  <div className="row-label">{tx("Leave all circles", "Alle Circles verlassen", "خروج از همه حلقه‌ها")}</div>
                  <div className="row-desc">
                    {tx(
                      "Leaves every joined circle. Circles you host are kept.",
                      "Verlässt alle beigetretenen Circles. Gehostete Circles bleiben bestehen.",
                      "از همه حلقه‌هایی که عضو هستید خارج می‌شود. حلقه‌هایی که میزبانشان هستید حفظ می‌شوند."
                    )}
                  </div>
                </div>
                <div className="row-right">
                  <button type="button" onClick={() => void leaveAllCircles()} disabled={leaveAllBusy} className="settings-danger-btn soft">
                    {leaveAllBusy ? tx("Leaving...", "Verlassen...", "در حال خروج...") : tx("Leave all", "Alle verlassen", "خروج از همه")}
                  </button>
                </div>
              </div>

              <div className="danger-row">
                <div className="row-left">
                  <div className="row-label">{tx("Log out", "Abmelden", "خروج از حساب")}</div>
                  <div className="row-desc">{tx("Sign out from this device.", "Von diesem Gerät abmelden.", "از این دستگاه خارج شوید.")}</div>
                </div>
                <div className="row-right">
                  <button type="button" onClick={() => void logout()} disabled={logoutBusy} className="settings-danger-btn soft">
                    <LogOut size={14} />
                    {logoutBusy ? tx("Logging out...", "Abmelden...", "در حال خروج...") : tx("Log out", "Abmelden", "خروج")}
                  </button>
                </div>
              </div>

              <div className="danger-row">
                <div className="row-left">
                  <div className="row-label">{tx("Delete account", "Konto löschen", "حذف حساب")}</div>
                  <div className="row-desc">
                    {tx(
                      "Permanently removes your account, chats, and groups you created.",
                      "Löscht dein Konto, Chats und erstellte Gruppen dauerhaft.",
                      "حساب، چت‌ها و گروه‌های ساخته‌شده توسط شما را برای همیشه حذف می‌کند."
                    )}
                  </div>
                </div>
                <div className="row-right">
                  <button type="button" onClick={() => void deleteAccount()} disabled={deleteBusy} className="settings-danger-btn">
                    <Trash2 size={14} />
                    {deleteBusy ? tx("Deleting...", "Wird gelöscht...", "در حال حذف...") : tx("Delete account", "Konto löschen", "حذف حساب")}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
