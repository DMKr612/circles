import React, { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { useProfile } from "../hooks/useProfile";
import { useAuth } from "@/App";
import ViewOtherProfileModal from "@/components/ViewOtherProfileModal";
import { X, List } from "lucide-react";

// Demo stubs for toast calls (prevents red lines if Toaster is removed)
const success = (m?: string) => console.log("[ok]", m || "");
const error   = (m?: string) => console.error("[err]", m || "");

// Small sessionStorage helpers
function ssGet<T = any>(k: string, fallback: T): T {
  try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}
function ssSet(k: string, v: any) {
  try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {}
}

// Types
type PreviewGroup = { id: string; title: string; game: string | null; category: string | null; code?: string | null };
type Thread = {
  other_id: string;
  name: string;
  avatar_url: string | null;
  last_body: string;
  last_at: string;
  last_from_me: boolean;
  unread: boolean;
};
type GameStat = { game: string; count: number };
type GroupInvite = {
  group_id: string;
  group_title: string | null;
  role: string | null;
  status: string;
  invited_at: string;
};
type GroupMsgNotif = {
  group_id: string;
  group_title: string | null;
  preview: string;
  created_at: string;
};

function timeAgo(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 5) return "now";
  return diff < 60 ? `${diff}s` :
    diff < 3600 ? `${Math.floor(diff / 60)}m` :
    diff < 86400 ? `${Math.floor(diff / 3600)}h` :
    `${Math.floor(diff / 86400)}d`;
}

function renderGroupCode(id: string, serverCode?: string | null): string {
  const sc = (serverCode ?? '').toString().trim();
  if (sc) return sc.toUpperCase();
  // Fallback: legacy local code (kept only to avoid blank UI if DB code is missing)
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  const u = (h >>> 0).toString(16).toUpperCase();
  return u.padStart(8, '0').slice(-8);
}

// All German cities from country-state-city, deduped + sorted
const DE_CITIES: string[] = (() => {
  // @ts-ignore: package ships without TS types in this setup
  const { State, City } = (window as any).countryStateCity || { State: null, City: null };
  if (!State || !City) return [];
  try {
    const states = (State.getStatesOfCountry('DE') || []) as Array<{ isoCode: string; name: string }>;
    const names: string[] = [];
    for (const s of states) {
      const cities = (City.getCitiesOfState('DE', s.isoCode) || []) as Array<{ name: string }>;
      for (const c of cities) {
        if (c && typeof c.name === 'string' && c.name.trim()) {
          names.push(c.name.trim());
        }
      }
    }
    return Array.from(new Set(names)).sort((a,b)=>a.localeCompare(b,'de'));
  } catch (e) {
    console.warn("Could not load cities list", e);
    return [];
  }
})();

// Helper to get device/browser timezone
function deviceTZ(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

type FriendShipRow = {
  id: string;
  user_id_a: string;
  user_id_b: string;
  status: 'pending' | 'accepted' | 'blocked';
  requested_by: string;
};
type DMMessage = {
  id: string;
  sender: string;
  receiver: string;
  content: string;
  created_at: string;
};

type ProfileStub = {
  name: string;
  avatar_url: string | null;
}

// --- Main component ---

export default function Profile() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId: routeUserId } = useParams<{ userId?: string }>();

  // --- Auth & Profile Data ---
  const { user } = useAuth();
  const uid = user?.id;

  const { data: profile, isLoading, error: profileError } = useProfile(uid ?? null);
  

  //
  // Sync groups created/joined from profile hook
  useEffect(() => {
    if (profile) {
      setGroupsCreated(profile.groups_created || 0);
      setGroupsJoined(profile.groups_joined || 0);
    }
  }, [profile]);

  // Recalculate groupsCreated based on groups where I am creator or host
  useEffect(() => {
    if (!uid) return;
    (async () => {
      const { count, error } = await supabase
        .from('groups')
        .select('id', { count: 'exact', head: true })
        .or(`creator_id.eq.${uid},host_id.eq.${uid}`);
      if (error) {
        console.warn('Failed to load created groups count', error);
        return;
      }
      setGroupsCreated(count ?? 0);
    })();
  }, [uid]);

  // Recalculate groupsJoined based on group_members rows for me
  useEffect(() => {
    if (!uid) return;
    (async () => {
      const { count, error } = await supabase
        .from('group_members')
        .select('group_id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .in('status', ['active', 'accepted']);
      if (error) {
        console.warn('Failed to load joined groups count', error);
        return;
      }
      setGroupsJoined(count ?? 0);
    })();
  }, [uid]);

  // Game stats (events in circles I'm a member of)
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const { data: memberships, error: mErr } = await supabase
        .from("group_members")
        .select("group_id, groups(game)")
        .eq("user_id", uid)
        .in("status", ["active", "accepted"]);
      if (cancelled || mErr) return;

      const groupIds = (memberships || []).map((m: any) => m.group_id);
      const gameByGroup: Record<string, string> = {};
      (memberships || []).forEach((m: any) => {
        if (m.group_id) gameByGroup[m.group_id] = m.groups?.game || "Unknown";
      });

      if (!groupIds.length) {
        if (!cancelled) { setGamesTotal(0); setGameStats([]); }
        return;
      }

      const { data: events, error: eErr } = await supabase
        .from("group_events")
        .select("id, group_id")
        .in("group_id", groupIds);
      if (cancelled || eErr) return;

      const counts: Record<string, number> = {};
      (events || []).forEach((ev: any) => {
        const g = gameByGroup[ev.group_id] || "Unknown";
        counts[g] = (counts[g] || 0) + 1;
      });

      const stats: GameStat[] = Object.entries(counts)
        .map(([game, count]) => ({ game, count }))
        .sort((a, b) => b.count - a.count || a.game.localeCompare(b.game));

      if (!cancelled) {
        setGamesTotal(events?.length || 0);
        setGameStats(stats);
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  // --- UI State ---
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gamesModalOpen, setGamesModalOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
 
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const notifRef = useRef<HTMLDivElement | null>(null);

  const viewingOther = !!routeUserId && routeUserId !== uid;

  // --- Settings modal state ---
  const [sName, setSName] = useState<string>("");
  const [sCity, setSCity] = useState<string>("");
  const [sTimezone, setSTimezone] = useState<string>("UTC");
  const [sInterests, setSInterests] = useState<string>("");
  const [sTheme, setSTheme] = useState<'system'|'light'|'dark'>('system');
  const [emailNotifs, setEmailNotifs] = useState<boolean>(false);
  const [pushNotifs, setPushNotifs] = useState<boolean>(false);
  const [allowRatings, setAllowRatings] = useState<boolean>(true);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // --- DM / Chat state --- (removed)
  const [threads, setThreads] = useState<Thread[]>([]);
  const [dmTargetId, setDmTargetId] = useState<string | null>(null);
  const [dmMsgs, setDmMsgs] = useState<DMMessage[]>([]);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmError, setDmError] = useState<string | null>(null);
  const [dmInput, setDmInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);


  // --- Stats ---
  const [groupsCreated, setGroupsCreated] = useState<number>(0);
  const [groupsJoined, setGroupsJoined] = useState<number>(0);
  const [gamesTotal, setGamesTotal] = useState<number>(0);
  const [gameStats, setGameStats] = useState<GameStat[]>([]);
 
  // --- Group & Friend Previews ---
  const [createdPreview, setCreatedPreview] = useState<PreviewGroup[]>([]);
  const [joinedPreview, setJoinedPreview] = useState<PreviewGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState<'created' | 'joined' | 'all'>('created');
  const [friends, setFriends] = useState<FriendShipRow[]>([]);
  const [friendProfiles, setFriendProfiles] =
    useState<Map<string, { name: string; avatar_url: string | null }>>(new Map());
  const [friendsModalOpen, setFriendsModalOpen] = useState(false);

  const friendAvatars = useMemo(() => {
    return friends.slice(0, 10).map((fr) => {
      const fid = fr.user_id_a === uid ? fr.user_id_b : fr.user_id_a;
      const prof = friendProfiles.get(fid);
      return { id: fid, name: prof?.name || fid.slice(0, 6), avatar: prof?.avatar_url ?? null };
    });
  }, [friends, friendProfiles, uid]);

  // --- Notifications ---
  const [incomingRequests, setIncomingRequests] = useState<any[]>([]); // Using 'any' to match original
  const [groupInvites, setGroupInvites] = useState<GroupInvite[]>([]);
  const [groupNotifs, setGroupNotifs] = useState<GroupMsgNotif[]>([]);

  // --- Other User's Data ---
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [viewName, setViewName] = useState<string>("");
  const [viewAvatar, setViewAvatar] = useState<string | null>(null);
  const [viewAllowRatings, setViewAllowRatings] = useState<boolean>(true);
  const [viewRatingAvg, setViewRatingAvg] = useState<number>(0);
  const [viewRatingCount, setViewRatingCount] = useState<number>(0);
  const [myRating, setMyRating] = useState<number>(0);
  const [rateBusy, setRateBusy] = useState(false);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [pairNextAllowedAt, setPairNextAllowedAt] = useState<string | null>(null);
  const [pairEditUsed, setPairEditUsed] = useState<boolean>(false);
  const [viewFriendStatus, setViewFriendStatus] = useState<'none' | 'pending_in' | 'pending_out' | 'accepted' | 'blocked'>('none');
 
  const [otherUserGamesTotal, setOtherUserGamesTotal] = useState<number>(0);
  const [theirFriendCount, setTheirFriendCount] = useState<number>(0);

  // --- UI ---
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [viewBusy, setViewBusy] = useState(false);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // --- Derived State ---
  const headerName = viewingOther ? (viewName || (routeUserId ? routeUserId.slice(0,6) : '')) : (profile?.name || user?.email || '');
  const headerAvatar = viewingOther ? viewAvatar : profile?.avatar_url;
  const headerRatingAvg = viewingOther ? viewRatingAvg : profile?.rating_avg;
  const headerRatingCount = viewingOther ? viewRatingCount : profile?.rating_count;
  const headerInitials = (headerName || '?').slice(0, 2).toUpperCase() ?? '?';

  const notifCount = useMemo(
    () => incomingRequests.length + groupInvites.length + groupNotifs.length,
    [incomingRequests, groupInvites, groupNotifs]
  );
 
  // Merge DM threads with accepted friends for sidebar
  const sidebarItems = useMemo<Thread[]>(() => {
    const tMap = new Map<string, Thread>();
    threads.forEach(t => tMap.set(t.other_id, t));

    const out: Thread[] = [...threads];
    const friendIds = friends.map(f => (f.user_id_a === uid ? f.user_id_b : f.user_id_a));

    friendIds.forEach(fid => {
      if (tMap.has(fid)) return; // already in thread list
      if (!uid) return; // guard
      const prof = friendProfiles.get(fid);
      out.push({
        other_id: fid,
        name: (prof?.name && prof.name.trim()) ? prof.name : fid.slice(0, 6),
        avatar_url: prof?.avatar_url ?? null,
        last_body: '',
        last_at: new Date(0).toISOString(),
        last_from_me: false,
        unread: false,
      });
    });

    out.sort((a, b) => (b.last_at > a.last_at ? 1 : (b.last_at < a.last_at ? -1 : 0)));
    return out;
  }, [threads, friends, friendProfiles, uid]);
 
  const visibleGroups = useMemo(() => {
    if (groupFilter === 'created') return createdPreview;
    if (groupFilter === 'joined') return joinedPreview;
    const map = new Map<string, PreviewGroup>();
    for (const g of createdPreview) if (g?.id) map.set(g.id, g);
    for (const g of joinedPreview) if (g?.id && !map.has(g.id)) map.set(g.id, g);
    return Array.from(map.values());
  }, [groupFilter, createdPreview, joinedPreview]);

  const visibleCount = useMemo(() => {
    if (groupFilter === 'created') return groupsCreated;
    if (groupFilter === 'joined') return groupsJoined;
    const ids = new Set<string>();
    createdPreview.forEach(g => g?.id && ids.add(g.id));
    joinedPreview.forEach(g => g?.id && ids.add(g.id));
    return ids.size;
  }, [groupFilter, groupsCreated, groupsJoined, createdPreview, joinedPreview]);

  const followingCount = useMemo(() => friends.filter(f => f.requested_by === uid).length, [friends, uid]);
  const followersCount = useMemo(() => friends.filter(f => f.requested_by !== uid).length, [friends, uid]);
  const voteWeight = useMemo(() => Math.max(0, followingCount + followersCount * 0.25), [followingCount, followersCount]);

  // Build friend options (accepted friends) for autocomplete (removed)
  // Resolve display for current DM target (removed)
  // const unreadThreads = useMemo(() => threads.filter(t => t.unread), [threads]); (removed)

  // --- Rating logic ---
  const cooldownSecs = useMemo(() => {
    if (!pairNextAllowedAt) return 0;
    const t = new Date(pairNextAllowedAt).getTime();
    return Math.max(0, Math.floor((t - Date.now()) / 1000));
  }, [pairNextAllowedAt]);
 
  const canEditOnce = useMemo(() => {
    if (!pairNextAllowedAt) return false;
    const t = new Date(pairNextAllowedAt).getTime();
    return t > Date.now() && !pairEditUsed;
  }, [pairNextAllowedAt, pairEditUsed]);
 
  async function loadPairStatus(otherId: string) {
    if (!uid || !otherId) return;
    const { data, error } = await supabase
      .from('rating_pairs')
      .select('stars,updated_at,next_allowed_at,edit_used')
      .eq('rater_id', uid)
      .eq('ratee_id', otherId)
      .maybeSingle();
    if (error) return;
    setMyRating(Number(data?.stars ?? 0));
    setPairNextAllowedAt((data as any)?.next_allowed_at ?? null);
    setPairEditUsed(Boolean((data as any)?.edit_used ?? false));
  }
 
  // --- Data Loading Effects ---

  // Load accepted friends
  useEffect(() => {
    if (!uid) return;

    (async () => {
      const { data: frs, error: frErr } = await supabase
        .from("friendships")
        .select("id,user_id_a,user_id_b,status,requested_by")
        .or(`and(user_id_a.eq.${uid},status.eq.accepted),and(user_id_b.eq.${uid},status.eq.accepted)`);

      if (frErr) console.error("Friend load error:", frErr);

      setFriends((frs as FriendShipRow[]) || []);

      // Load their profile info
      if (frs) {
        const ids = frs.map(f => f.user_id_a === uid ? f.user_id_b : f.user_id_a);

        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id,name,avatar_url")
          .in("user_id", ids);

        const map = new Map();
        profs?.forEach(p =>
          map.set(p.user_id, { name: p.name, avatar_url: p.avatar_url })
        );
        setFriendProfiles(map);
      }
    })();
  }, [uid]);

  // (Removed manual data-loading useEffect in favor of useProfile)

  // Realtime listener for DMs (removed)

  // --- Other Effects ---

  // Open/close sidebar based on hash
  useLayoutEffect(() => {
    if (location.hash === "#chat") {
      setSidebarOpen(true);
    }
  }, [location.key, location.hash]);

  // Open/close sidebar based on global event
  useEffect(() => {
    const handler = () => setSidebarOpen(true);
    window.addEventListener('open-chat' as any, handler);
    return () => window.removeEventListener('open-chat' as any, handler);
  }, []);

  // Close popovers on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (notifOpen && notifRef.current && !notifRef.current.contains(t)) {
        setNotifOpen(false);
      }
      if (sidebarOpen && sidebarRef.current && !sidebarRef.current.contains(t)) {
        setSidebarOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [notifOpen, sidebarOpen]);
 
  // --- DM functions ---
 
  const openThread = useCallback(async (otherId: string) => {
    setShowSuggestions(false);
    setDmError(null);
    setDmLoading(true);
    setDmMsgs([]);
    setDmTargetId(otherId);
    // mark thread as read locally
    setThreads(prev => prev.map(t => t.other_id === otherId ? { ...t, unread: false, last_from_me: true } : t));
    const { data: msgs } = await supabase
      .from("direct_messages")
      .select("id,sender,receiver,content,created_at")
      .or(`and(sender.eq.${uid},receiver.eq.${otherId}),and(sender.eq.${otherId},receiver.eq.${uid})`)
      .order("created_at", { ascending: true })
      .limit(200);
    setDmMsgs(msgs ?? []);
    setDmLoading(false);
  }, [uid]);

  async function sendDm() {
    if (!uid || !dmTargetId || !dmInput.trim()) return;
    const body = dmInput.trim();
    setDmInput("");
    const { data, error } = await supabase
      .from("direct_messages")
      .insert({ sender: uid, receiver: dmTargetId, content: body })
      .select("id,sender,receiver,content,created_at")
      .single();
    if (error) { setDmError(error.message); return; }
    if (data) {
      setDmMsgs((prev) => [...prev, data!]);
    }
    // Also update the thread list
    setThreads(prev => {
        const other = prev.find(t => t.other_id === dmTargetId);
        const rest = prev.filter(t => t.other_id !== dmTargetId);
        const updated = {
            ...(other || { other_id: dmTargetId, name: dmTargetId.slice(0,6), avatar_url: null, unread: false }),
            last_body: body,
            last_at: data ? data.created_at : new Date().toISOString(),
            last_from_me: true,
        };
        return [updated, ...rest];
    });
  }
 
  // --- View Other Profile Modal Functions ---
  function openProfileView(otherId: string) {
    if (viewOpen && viewUserId === otherId) return; 
    setViewUserId(otherId);
    setViewOpen(true);
  }
 
  // --- Notification Handlers ---
 
  const acceptFriend = async (fromId: string) => {
    try {
      const { error: rpcErr } = await supabase.rpc("accept_friend", { from_id: fromId });
      if (rpcErr) throw rpcErr;
      if (uid) setIncomingRequests(prev => prev.filter(r => r.user_id_a !== fromId));
      success('Friend request accepted');
    } catch (e: any) {
      error(e?.message || 'Could not accept friend request');
    }
  };

  const removeFriend = async (otherId: string) => {
    try {
      const { error: rpcErr } = await supabase.rpc("remove_friend", { other_id: otherId });
      if (rpcErr) throw rpcErr;
      if (uid) setIncomingRequests(prev => prev.filter(r => r.user_id_a !== otherId));
      success('Removed');
    } catch (e: any) {
      error(e?.message || 'Could not remove friend');
    }
  };
 
  const sendFriendRequest = async (targetId: string) => {
    try {
      const { error: rpcErr } = await supabase.rpc("request_friend", { target_id: targetId });
      if (rpcErr) throw rpcErr;
      setViewFriendStatus('pending_out');
      success('Friend request sent');
    } catch (e: any) {
      error(e?.message || 'Could not send friend request');
    }
  };

  const acceptGroupInvite = async (gid: string) => {
    if (!uid) return;
    const { error } = await supabase
      .from("group_members")
      .update({ status: "active" })
      .eq("group_id", gid)
      .eq("user_id", uid);
    if (error) {
      // try recovery
      try {
        await supabase.from("group_members").delete().eq("group_id", gid).eq("user_id", uid);
        await supabase.from("group_members").insert({ group_id: gid, user_id: uid, status: "active", role: "member" });
      } catch {}
    }
    setGroupInvites(prev => prev.filter(inv => inv.group_id !== gid));
  };

  const declineGroupInvite = async (gid: string) => {
    if (!uid) return;
    await supabase.from("group_members").delete().eq("group_id", gid).eq("user_id", uid);
    setGroupInvites(prev => prev.filter(inv => inv.group_id !== gid));
  };

  const openGroup = (gid: string) => {
    setGroupNotifs(prev => prev.filter(n => n.group_id !== gid));
    setNotifOpen(false);
    navigate(`/group/${gid}`);
  };
 
  // --- Settings Modal Functions ---
 
  // Load settings modal data only when opened
  useEffect(() => {
    if (!settingsOpen || !uid) return;
    // Load LS settings
    const LS_THEME = localStorage.getItem('theme') as 'system'|'light'|'dark' | null;
    if (LS_THEME) setSTheme(LS_THEME);
    const LS_EMAIL = localStorage.getItem('emailNotifs');
    if (LS_EMAIL) setEmailNotifs(LS_EMAIL === '1');
    const LS_PUSH = localStorage.getItem('pushNotifs');
    if (LS_PUSH) setPushNotifs(LS_PUSH === '1');
    // Load profile data
    (async () => {
      const { data: p, error } = await supabase
        .from("profiles")
        .select("name, city, timezone, interests, avatar_url, allow_ratings")
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
    })();
  }, [settingsOpen, uid]);

  async function saveSettings() {
    if (!uid) return;
    setSettingsMsg(null);
    setSettingsSaving(true);
    try {
      // sanitize
      const name = sName.trim();
      if (!name) { setSettingsMsg("Name cannot be empty."); setSettingsSaving(false); return; }
      const city = sCity.trim();
      if (!city) { setSettingsMsg("Please choose a city."); setSettingsSaving(false); return; }
      const timezone = sTimezone.trim() || "UTC";
      const interests = sInterests.split(",").map(s => s.trim()).filter(Boolean);

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ name, city, timezone, interests, allow_ratings: allowRatings, onboarded: true })
        .eq("user_id", uid);

      if (updateError) throw updateError;
      
      // Save theme/notifs to localStorage
      localStorage.setItem('theme', sTheme);
      localStorage.setItem('emailNotifs', emailNotifs ? '1' : '0');
      localStorage.setItem('pushNotifs', pushNotifs ? '1' : '0');
      applyTheme(sTheme);


      setSettingsMsg("Saved.");
      success('Profile saved');
      setSettingsDirty(false);
      
      // Auto-close after 1 sec
      setTimeout(() => {
        setSettingsOpen(false);
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
        setAvatarUrl(url); // update page and modal
      }
    } catch (e) {
      console.error(e);
      setSettingsMsg('Avatar upload failed');
    } finally {
      setAvatarUploading(false);
    }
  }
 
  function applyTheme(theme: 'system'|'light'|'dark') {
    const root = document.documentElement;
    root.classList.remove('light','dark');
    if (theme === 'light') root.classList.add('light');
    else if (theme === 'dark') root.classList.add('dark');
  }
 
  async function rateUser(n: number) {
    if (!uid || !viewUserId || rateBusy) return;
    if (!(cooldownSecs === 0 || canEditOnce)) return;

    const v = Math.max(1, Math.min(6, Math.round(n)));
    setRateBusy(true);
    const prev = myRating;
    setMyRating(v);
    
    try {
      const { error: rpcErr } = await supabase.rpc('submit_rating', { p_ratee: viewUserId, p_stars: v });
      if (rpcErr) throw rpcErr;

      // Reload pair status and aggregates
      await loadPairStatus(viewUserId);
      const { data: agg } = await supabase
        .from('profiles')
        .select('rating_avg,rating_count')
        .eq('user_id', viewUserId)
        .maybeSingle();
      if (agg) {
        setViewRatingAvg(Number((agg as any).rating_avg ?? 0));
        setViewRatingCount(Number((agg as any).rating_count ?? 0));
      }
    } catch (e: any) {
      setMyRating(prev);
      const msg = String(e?.message || '');
      if (/rate_cooldown_active/i.test(msg)) {
        setErr('You already used your one edit for this 14‑day window.');
      } else if (/invalid_stars/i.test(msg)) {
        setErr('Rating must be between 1 and 6.');
      } else if (/not_authenticated/i.test(msg)) {
        setErr('Please sign in to rate.');
      } else {
        setErr('Rating failed.');
      }
    } finally {
      setRateBusy(false);
    }
  }

  async function logout() {
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
  }
 
  // --- Render ---

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-neutral-500">Loading...</div>;
  }

  if (profileError || !profile) {
    return <div className="p-4 text-red-500">Failed to load profile.</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pt-16 md:pt-20 pb-0">
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* --- Main Content --- */}
        <div className="space-y-6">
          {/* Header */}
          <div className="mb-6 flex items-center gap-4">
            <div className="grid h-16 w-16 place-content-center rounded-full bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300/60 overflow-hidden">
              {headerAvatar ? (
                <img src={headerAvatar} alt="" className="h-16 w-16 object-cover" />
              ) : (
                <span className="text-2xl font-semibold tracking-wide">{headerInitials}</span>
              )}
            </div>
            <div className="flex-1">
              <div className="text-lg font-semibold text-neutral-900">{headerName}</div>
              <div
                className="mt-1 flex items-center gap-2 text-sm text-neutral-800"
                title={`${(headerRatingAvg ?? 0).toFixed(1)} / 6 from ${headerRatingCount ?? 0} ratings`}
              >
                <span className="inline-flex items-center gap-1 text-lg leading-none">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span key={i}>
                      {i < Math.round(headerRatingAvg || 0) ? '★' : '☆'}
                    </span>
                  ))}
                </span>
                <span className="text-xs font-semibold text-neutral-700">
                  {(headerRatingAvg || 0).toFixed(1)}/6
                </span>
                <span className="text-[11px] text-neutral-500">
                  • {headerRatingCount || 0} rating{(headerRatingCount || 0) === 1 ? "" : "s"}
                </span>
                {viewingOther && (
                  <button onClick={() => openProfileView(routeUserId!)} className="text-xs text-emerald-700 hover:underline">Rate</button>
                )}
              </div>
              {!viewingOther && (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => navigate("/settings")}
                    className="ml-2 rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm hover:bg-black/[0.04]"
                  >
                    Settings
                  </button>
                  <button
                    onClick={logout}
                    className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
          {/* --- Stats Section --- */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold text-neutral-500 uppercase mb-2">Circles</div>
              <div className="flex items-end gap-4">
                <button onClick={() => navigate('/groups?filter=created')} className="group flex-1 text-left">
                  <div className="text-3xl font-extrabold text-neutral-900">{groupsCreated}</div>
                  <div className="text-sm text-neutral-500 group-hover:text-neutral-800">Created</div>
                </button>
                <button onClick={() => navigate('/groups?filter=joined')} className="group flex-1 text-left">
                  <div className="text-3xl font-extrabold text-neutral-900">{groupsJoined}</div>
                  <div className="text-sm text-neutral-500 group-hover:text-neutral-800">Joined</div>
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-xs font-semibold text-neutral-500 uppercase">Friends</div>
                  <div className="text-[11px] text-neutral-500">
                    Following {followingCount} • Followers {followersCount}
                  </div>
                </div>
                <button
                  onClick={() => setFriendsModalOpen(true)}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-full border border-neutral-200 bg-white hover:bg-neutral-100 text-neutral-600"
                  title="Open friends"
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
              <div className="flex -space-x-2 py-1">
                {friendAvatars.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => openProfileView(f.id)}
                    className="h-11 w-11 rounded-full ring-2 ring-white bg-gradient-to-br from-pink-500 to-amber-400 p-[2px]"
                  >
                    <div className="h-full w-full rounded-full bg-white overflow-hidden">
                      {f.avatar ? (
                        <img src={f.avatar} alt={f.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full grid place-items-center text-xs font-bold text-neutral-700 bg-neutral-100">
                          {f.name.slice(0,2).toUpperCase()}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
                {friendAvatars.length === 0 && (
                  <div className="text-sm text-neutral-500">No friends yet</div>
                )}
              </div>
              <div className="text-[11px] text-neutral-500 mt-1">Tap a bubble to view profile.</div>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-xs font-semibold text-neutral-500 uppercase">Games Played</div>
                  <div className="text-3xl font-extrabold text-neutral-900">{gamesTotal}</div>
                </div>
                {gameStats[0] && (
                  <span className="rounded-full bg-neutral-900 text-white text-[11px] px-2 py-1 font-semibold">
                    Top: {gameStats[0].game}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-neutral-500">Counts confirmed events in your circles.</div>
            </div>
          </div>

          {/* --- Game Stats --- */}
          <Card title="Game Activity" count={gameStats.length} empty="No game history yet (events in your circles).">
            {gameStats.map(gs => (
              <li key={gs.game} className="flex justify-between py-2">
                <span className="font-medium text-neutral-900">{gs.game}</span>
                <span className="text-neutral-600 text-sm">{gs.count}</span>
              </li>
            ))}
          </Card>

        </div>
        {/* --- DM Sidebar --- */}
        {/* DM Floating Button */}
      </div>
      {/* ...rest of modals and content remain unchanged... */}


      {/* --- Settings Modal --- */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
          <form
            onSubmit={(e) => { e.preventDefault(); saveSettings(); }}
            className="w-[560px] max-w-[92vw] rounded-2xl border border-black/10 bg-white shadow-xl max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

              <div className="relative mb-2">
                <div className="text-base font-semibold text-neutral-900">Edit Profile</div>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="absolute top-3 right-3 text-neutral-500 hover:text-neutral-800 text-xl leading-none"
                >
                  ×
                </button>
              </div>

              <div className="rounded-xl border border-black/5 bg-neutral-50/80 p-4 shadow-inner space-y-4">
                <div className="text-sm font-semibold text-neutral-700">Profile</div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-800">Name</label>
                  <input
                    value={sName}
                    onChange={(e) => { setSName(e.target.value); setSettingsDirty(true); }}
                    className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:border-emerald-600"
                    placeholder="Your name"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-800">Avatar</label>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-neutral-200 grid place-items-center overflow-hidden">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" className="h-10 w-10 object-cover" />
                      ) : (
                        <span className="text-xs">{headerInitials}</span>
                      )}
                    </div>
                    <input type="file" accept="image/*" onChange={onAvatarChange} className="text-sm" />
                    {avatarUploading && <span className="text-xs text-neutral-600">Uploading…</span>}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-neutral-800">City</label>
                    <input
                      value={sCity}
                      onChange={(e) => { setSCity(e.target.value); setSettingsDirty(true); }}
                      onBlur={() => { if (!sTimezone || sTimezone === "UTC") setSTimezone(deviceTZ()); }}
                      className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:border-emerald-600"
                      placeholder="Start typing… e.g., Berlin"
                      list="cities-de"
                      required
                    />
                    <datalist id="cities-de">
                      {DE_CITIES.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-neutral-800">Timezone</label>
                    <input
                      value={sTimezone}
                      onChange={(e) => { setSTimezone(e.target.value); setSettingsDirty(true); }}
                      className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:border-emerald-600"
                      placeholder="e.g., Europe/Berlin"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-800">Interests</label>
                  <input
                    value={sInterests}
                    onChange={(e) => { setSInterests(e.target.value); setSettingsDirty(true); }}
                    className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:border-emerald-600"
                    placeholder="comma, separated, tags"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-black/5 bg-neutral-50/80 p-4 shadow-inner space-y-3">
                <div className="text-sm font-semibold text-neutral-700">Appearance & Privacy</div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-800">Theme</label>
                  <select
                    value={sTheme}
                    onChange={(e) => setSTheme(e.target.value as 'system'|'light'|'dark')}
                    className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:border-emerald-600"
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-lg border border-black/5 bg-white px-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-neutral-800">Allow profile ratings</div>
                    <div className="text-[11px] text-neutral-500">Others can rate you when enabled.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => saveAllowRatings(!allowRatings)}
                    className={`h-7 w-12 rounded-full ${allowRatings ? 'bg-emerald-600' : 'bg-neutral-300'} relative`}
                  >
                    <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition ${allowRatings ? 'right-0.5' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-black/5 bg-neutral-50/80 p-4 shadow-inner space-y-3">
                <div className="text-sm font-semibold text-neutral-700">Notifications</div>

                <div className="flex items-center gap-2">
                  <input
                    id="emailNotifs"
                    type="checkbox"
                    checked={emailNotifs}
                    onChange={(e) => setEmailNotifs(e.target.checked)}
                    className="h-4 w-4 rounded border-black/20"
                  />
                  <label htmlFor="emailNotifs" className="text-sm text-neutral-800">Email notifications</label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="pushNotifs"
                    type="checkbox"
                    checked={pushNotifs}
                    onChange={(e) => setPushNotifs(e.target.checked)}
                    className="h-4 w-4 rounded border-black/20"
                  />
                  <label htmlFor="pushNotifs" className="text-sm text-neutral-800">Push notifications</label>
                </div>
              </div>

              {settingsMsg && (
                <div className={`rounded-md border px-3 py-2 text-sm ${settingsMsg === 'Saved.' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                  {settingsMsg}
                </div>
              )}

            </div>

            <div className="shrink-0 px-5 py-3 border-t border-black/10">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <div className="text-sm text-neutral-500">Need a break?</div>
                  <button
                    type="button"
                    onClick={logout}
                    className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100"
                  >
                    Log out
                  </button>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(false)}
                    className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={settingsSaving}
                    className={`rounded-md px-3 py-1.5 text-sm text-white ${settingsSaving ? "bg-neutral-400" : "bg-emerald-600 hover:bg-emerald-700"}`}
                  >
                    {settingsSaving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </div>

          </form>
        </div>
      )}

      {/* --- View Other Profile Modal --- */}
      <ViewOtherProfileModal 
        isOpen={viewOpen}
        onClose={() => setViewOpen(false)}
        viewUserId={viewUserId}
      />
    </div>
  );
}

// --- SharedGroups component for View Other Profile Modal ---
function SharedGroups({ me, other }: { me: string; other: string }) {
  const [groups, setGroups] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      const { data: myGroups } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', me)
        .eq('status', 'active');

      const { data: theirGroups } = await supabase
        .from('group_members')
        .select('group_id, groups(title)')
        .eq('user_id', other)
        .eq('status', 'active');

      const mineSet = new Set(myGroups?.map(g => g.group_id));
      const shared = (theirGroups ?? []).filter(g => mineSet.has(g.group_id));

      setGroups(shared);
      setLoading(false);
    })();
  }, [me, other]);

  if (loading) return <div className="text-neutral-600 text-sm">Loading…</div>;
  if (groups.length === 0) return <div className="text-neutral-600 text-sm">No shared groups.</div>;

  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {groups.map(g => (
        <div
          key={g.group_id}
          className="px-2 py-1 bg-neutral-100 text-neutral-800 text-xs rounded-md flex items-center gap-2"
        >
          {g.groups?.title || g.group_id.slice(0,6)}
          <Link to={`/group/${g.group_id}`} className="text-emerald-700 hover:underline text-[11px]">Open</Link>
        </div>
      ))}
    </div>
  );
}

function FriendsModal({
  open,
  onClose,
  items,
  onView
}: {
  open: boolean;
  onClose: () => void;
  items: Array<{ id: string; name: string; avatar?: string | null }>;
  onView: (id: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-neutral-200 max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
          <div className="text-sm font-semibold text-neutral-900">Friends</div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="divide-y divide-neutral-100 max-h-[70vh] overflow-y-auto">
          {items.map((f) => (
            <button
              key={f.id}
              onClick={() => { onView(f.id); onClose(); }}
              className="flex w-full items-center gap-3 px-4 py-3 hover:bg-neutral-50 text-left"
            >
              <div className="h-11 w-11 rounded-full bg-neutral-100 overflow-hidden">
                {f.avatar ? (
                  <img src={f.avatar} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full grid place-items-center text-sm font-bold text-neutral-700">
                    {f.name.slice(0,2).toUpperCase()}
                  </div>
                )}
              </div>
              <div>
                <div className="text-sm font-semibold text-neutral-900">{f.name}</div>
                <div className="text-xs text-neutral-500">View profile</div>
              </div>
            </button>
          ))}
          {items.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-neutral-500">No friends yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Re-usable Sub-Components ---

const StatCard = React.memo(function StatCard({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  const content = (
    <>
      <div className="text-sm text-neutral-600">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900">{value}</div>
    </>
  );
 
  if (onClick) {
    return (
      <button onClick={onClick} className="w-full rounded-xl border border-black/10 bg-white p-4 text-left shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-sm" disabled={!onClick}>
        {content}
      </button>
    );
  }
 
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      {content}
    </div>
  );
});

const Card = React.memo(function Card({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-medium text-neutral-900">{title}</h3>
        <span className="text-xs text-neutral-600">{count}</span>
      </div>
      {React.Children.count(children) === 0 ? (
        <p className="text-sm text-neutral-600">{empty}</p>
      ) : (
        <ul className="divide-y">
          {children}
        </ul>
      )}
    </div>
  );
});

const Row = React.memo(function Row({ id, title, meta, code }: { id: string; title: string; meta: string; code?: string | null }) {
  const shortHash = renderGroupCode(String(id), code);
  return (
    <li className="flex items-center justify-between py-2">
      <div>
        <Link to={`/group/${id}`} className="font-medium text-neutral-900 hover:underline">{title}</Link>
        <div className="text-xs text-neutral-600">{meta}</div>
        <div className="text-[11px] text-neutral-500 tracking-wider">Code: {shortHash}</div>
      </div>
      <Link to={`/group/${id}`} className="text-sm text-emerald-700 hover:underline">Open</Link>
    </li>
  );
});

const FriendRow = React.memo(function FriendRow({ _otherId, name, avatarUrl, lastBody, lastAt, unread, onView }: {
  _otherId: string;
  name: string;
  avatarUrl: string | null;
  lastBody: string;
  lastAt: string;
  unread: boolean;
  onView: () => void;
}) {
  return (
    <li className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-neutral-200 grid place-items-center text-xs font-medium overflow-hidden">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : (
            name.slice(0,2).toUpperCase()
          )}
        </div>
        <div>
          {/* --- This link allows clicking a friend's name to see their profile --- */}
          <button
            onClick={onView}
            className="font-medium text-neutral-900 hover:underline text-left"
          >
            {name}
          </button>
          <div className="text-xs text-neutral-600 truncate max-w-[220px]">{lastBody}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-neutral-500">{timeAgo(lastAt)}</span>
        {unread && <span className="h-2 w-2 rounded-full bg-emerald-600" />}
      </div>
    </li>
  );
});
