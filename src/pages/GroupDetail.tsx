import { useEffect, useState, useMemo, lazy, Suspense, useRef } from "react";
import { useParams, useNavigate, Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { checkGroupJoinBlock, joinBlockMessage } from "../lib/ratings";
import { getAvatarUrl } from "@/lib/avatar";
import { isAnnouncementVisibleForViewer } from "@/lib/announcements";
import type { Group, Poll, PollOption, GroupMember, GroupEvent, GroupMoment } from "../types";
import { 
  MapPin, Users, Calendar, Clock, Share2, MessageCircle, 
  LogOut, Trash2, Edit2, Check, X, Plus, ChevronLeft, AlertCircle, Map, Megaphone 
} from "lucide-react";
import ViewOtherProfileModal from "../components/ViewOtherProfileModal";
import { useGroupPresence } from "../hooks/useGroupPresence";

const ChatPanel = lazy(() => import("../components/ChatPanel"));

interface MemberDisplay extends GroupMember {
  name: string | null;
  avatar_url: string | null;
}

type DraftPollOption = {
  label: string;
  starts_at: string;
  place?: string;
};

type GroupAnnouncement = {
  id: string;
  title: string;
  description: string;
  datetime: string;
  created_at?: string | null;
  created_by?: string | null;
  duration_minutes?: number | null;
  location: string;
  activities?: string[];
  link?: string | null;
  group_id?: string | null;
};

type PollWithLate = Poll & { late_voter_ids?: string[] | null };

export default function GroupDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const nav = useNavigate();
  const location = useLocation();

  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<GroupAnnouncement[]>([]);

  // Host check
  const isHost = !!(me && group && (me === group.host_id || (group?.creator_id ?? null) === me));

  // UI State
  const [chatOpen, setChatOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false); 
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  
  // Edit Description State
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [editDescValue, setEditDescValue] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [copied, setCopied] = useState(false);

  // Voting State
  const [poll, setPoll] = useState<PollWithLate | null>(null);
  const [options, setOptions] = useState<PollOption[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [memberCount, setMemberCount] = useState<number>(0);
  const [votedCount, setVotedCount] = useState<number>(0);
  const [votingBusy, setVotingBusy] = useState<string | null>(null);
  const [pollFocus, setPollFocus] = useState(false);
  const [pollReloadKey, setPollReloadKey] = useState(0);
  
  const [members, setMembers] = useState<MemberDisplay[]>([]);
  const [isMember, setIsMember] = useState(false);
  const MAX_GROUPS = 7;
  const [joinedCount, setJoinedCount] = useState<number>(0);
  const [myVerificationLevel, setMyVerificationLevel] = useState<number>(1);
  const [myMembership, setMyMembership] = useState<GroupMember | null>(null);
  const [event, setEvent] = useState<GroupEvent | null>(null);
  const [moments, setMoments] = useState<GroupMoment[]>([]);
  const [momentsTick, setMomentsTick] = useState(0);
  const [momentBusy, setMomentBusy] = useState(false);
  const [momentMsg, setMomentMsg] = useState<string | null>(null);
  const [ownershipBusy, setOwnershipBusy] = useState<string | null>(null);
  const [lateGrantBusy, setLateGrantBusy] = useState<string | null>(null);
  const { isTogether } = useGroupPresence(id, isMember ? me ?? undefined : undefined);
  const togetherNow = useMemo(() => members.some((m) => isTogether(m.user_id)), [members, isTogether]);
  const momentInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL || "support@circles.app";

  // Focus poll when arriving from chat link (#poll)
  useEffect(() => {
    if (location.hash === "#poll") {
      setPollFocus(true);
      const el = document.getElementById("poll-section");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      const t = setTimeout(() => setPollFocus(false), 2000);
      return () => clearTimeout(t);
    } else {
      setPollFocus(false);
    }
  }, [location.hash]);

  // New Poll Form
  const [newTitle, setNewTitle] = useState("Schedule");
  const [newOptions, setNewOptions] = useState<DraftPollOption[]>([
    { label: "", starts_at: "" }
  ]); 
  const [pollDuration, setPollDuration] = useState("24h");
  const [customEndDate, setCustomEndDate] = useState("");

  // --- Helpers ---
  const isPollExpired = useMemo(() => {
    if (!poll?.closes_at) return false;
    return new Date(poll.closes_at) < new Date();
  }, [poll]);
  const lateVoterIds = useMemo(() => {
    if (!poll) return [];
    const arr = (poll as any).late_voter_ids;
    return Array.isArray(arr) ? (arr as string[]) : [];
  }, [poll]);
  const lateVoteAllowed = useMemo(() => {
    if (!me) return false;
    return lateVoterIds.includes(me);
  }, [lateVoterIds, me]);

  function getPollStatusLabel(status: string, closesAt: string | null) {
    if (status === 'closed') return "Voting Closed";
    if (!closesAt) return "Open";
    const diff = new Date(closesAt).getTime() - Date.now();
    if (diff <= 0) return "Time Expired";
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h ${minutes}m left`;
    return `${minutes}m left`;
  }

  function formatDateTime(iso: string | null) {
    if (!iso) return "TBD";
    try {
      const d = new Date(iso);
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch { return "TBD"; }
  }

  function toICSDate(d: Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  }

  function mapLinks(location: string) {
    const q = encodeURIComponent(location);
    return {
      google: `https://www.google.com/maps/search/?api=1&query=${q}`,
      apple: `http://maps.apple.com/?q=${q}`,
    };
  }

  function exitPollFocus() {
    setPollFocus(false);
    if (location.hash === "#poll") {
      nav(`/group/${id}`, { replace: true });
    }
  }

  function downloadCalendar(ev: GroupEvent) {
    const start = ev.starts_at ? new Date(ev.starts_at) : new Date();
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//circles//event//EN",
      "BEGIN:VEVENT",
      `UID:${ev.id}`,
      `DTSTAMP:${toICSDate(new Date())}`,
      `DTSTART:${toICSDate(start)}`,
      `DTEND:${toICSDate(end)}`,
      `SUMMARY:${ev.title || "Circle Event"}`,
      ev.place ? `LOCATION:${ev.place}` : "",
      `DESCRIPTION:Created from poll ${ev.poll_id || ""}`,
      "END:VEVENT",
      "END:VCALENDAR"
    ].filter(Boolean).join("\r\n");

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ev.title || "event"}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatAnnouncementRange(a: GroupAnnouncement) {
    const start = new Date(a.datetime);
    const end = new Date(start.getTime() + (a.duration_minutes ?? 60) * 60 * 1000);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
    return `${start.toLocaleString(undefined, opts)} – ${end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }

  function addAnnouncementToCalendar(a: GroupAnnouncement) {
    const start = new Date(a.datetime);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + (a.duration_minutes ?? 60) * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//circles//announcement//EN",
      "BEGIN:VEVENT",
      `UID:${a.id}`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${a.title}`,
      `DESCRIPTION:${a.description} Activities: ${(a.activities || []).join(" | ")}`,
      `LOCATION:${a.location}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${a.id}.ics`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const emptyDraftOption: DraftPollOption = { label: "", starts_at: "" };

  function updateDraftOption(idx: number, field: keyof DraftPollOption, value: string) {
    setNewOptions(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: value };
      return copy;
    });
  }

  function addDraftOption() {
    setNewOptions(prev => [...prev, { ...emptyDraftOption }]);
  }

  function duplicateLastOption() {
    setNewOptions(prev => {
      if (!prev.length) return [{ ...emptyDraftOption }];
      const last = prev[prev.length - 1];
      return [...prev, { ...last }];
    });
  }

  function removeDraftOption(idx: number) {
    setNewOptions(prev => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  // --- Effects ---

  useEffect(() => {
    if (location.hash === '#chat') setChatOpen(true);
  }, [location.hash]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      if (!ignore) setMe(auth.user?.id ?? null);

      const q = await supabase.from('groups').select('*').eq('id', id).maybeSingle();
      if (!ignore) setGroup((q.data as Group) ?? null);
      
            if (q.data) setEditDescValue((q.data as any).description || "");

      if (q.data?.id) {
        const { count } = await supabase
  .from('group_members')
  .select('*', { count: 'exact', head: true })
  .eq('group_id', q.data.id)
  .eq('status', 'active');
        if (!ignore) setMemberCount(count ?? 0);
      }
      setLoading(false);
    })();
    return () => { ignore = true; };
  }, [id]);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!group?.id) return;
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid || off) return;

      const { data: prof } = await supabase.from('profiles').select('verification_level').eq('user_id', uid).maybeSingle();
      if (!off) setMyVerificationLevel(prof?.verification_level ?? 1);

      const { data: gm, count } = await supabase
        .from('group_members')
        .select('group_id, user_id, role, status, last_joined_at, created_at', { count: 'exact' })
        .eq('user_id', uid)
        .eq('status', 'active');
      if (off) return;
      setJoinedCount(count ?? (gm?.length ?? 0));
      const current = (gm ?? []).find((r: any) => r.group_id === group.id);
      if (current) {
        setMyMembership(current as GroupMember);
        setIsMember(true);
      } else {
        setIsMember(false);
        setMyMembership(null);
      }
    })();
    return () => { off = true; };
  }, [group?.id, group?.host_id]);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!group?.id) { setMembers([]); return; }
            const { data } = await supabase
        .from('group_members')
        .select('user_id, role, created_at, status, group_id, profiles(name, avatar_url)')
        .eq('group_id', group.id)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      const arr: MemberDisplay[] = (data ?? []).map((r: any) => ({
  user_id: r.user_id,
  // Force host label in UI if this user is the group's host
  role: r.user_id === group.host_id ? 'host' : r.role,
  created_at: r.created_at,
  group_id: group.id,
  status: r.status ?? 'active',
  name: r.profiles?.name ?? "User",
  avatar_url: r.profiles?.avatar_url ?? null,
}));

      if (off) return;
      setMembers(arr);
      
      const meId = (await supabase.auth.getUser()).data.user?.id || null;
      if (meId) setIsMember(arr.some((a) => a.user_id === meId));
    })();
    return () => { off = true; };
  }, [group?.id]);

  // Load Polls
  useEffect(() => {
    let gone = false;
    (async () => {
      if (!group?.id || (!isMember && !isHost)) {
        if (!gone) {
          setPoll(null);
          setOptions([]);
          setCounts({});
          setVotedCount(0);
        }
        return;
      }
      
      const { data: polls } = await supabase
        .from("group_polls").select("*")
        .eq("group_id", group.id)
        .order("created_at", { ascending: false })
        .limit(1);
        
      if (gone) return;
      const cur = (polls && polls[0]) as PollWithLate | undefined;
      setPoll(cur || null);
      if (!cur) { setOptions([]); setCounts({}); setVotedCount(0); return; }

      const { data: opts } = await supabase.from("group_poll_options").select("*").eq("poll_id", cur.id).order("created_at");
      if (gone) return;
      setOptions((opts as PollOption[]) || []);

      const { data: votesRows } = await supabase.from("group_votes").select("option_id,user_id").eq("poll_id", cur.id);
      if (gone) return;
      const map: Record<string, number> = {};
      const voterSet = new Set<string>();
      (votesRows as any[])?.forEach((r) => {
        map[r.option_id] = (map[r.option_id] || 0) + 1;
        voterSet.add(r.user_id);
      });
      setCounts(map);
      setVotedCount(voterSet.size);
    })();
    return () => { gone = true; };
  }, [group?.id, isMember, isHost, pollReloadKey]);

  // Realtime updates for poll changes (e.g., late vote grants)
  useEffect(() => {
    if (!poll?.id) return;
    const channel = supabase
      .channel(`poll:${poll.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_polls', filter: `id=eq.${poll.id}` }, (payload) => {
        const next = payload.new as PollWithLate;
        setPoll(prev => prev && prev.id === next.id ? { ...prev, ...next } : next);
        setPollReloadKey((k) => k + 1);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [poll?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!group?.id) return;
      const { data } = await supabase
        .from('group_events')
        .select('*')
        .eq('group_id', group.id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (cancelled) return;
      setEvent(((data ?? [])[0] as GroupEvent) || null);
    })();
    return () => { cancelled = true; };
  }, [group?.id, poll?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!group?.id) return;
      const { data: auth } = await supabase.auth.getUser();
      const viewerId = auth?.user?.id ?? null;
      const viewerEmail = auth?.user?.email ?? null;
      let viewerCity: string | null = null;
      let viewerCoords: { lat: number; lng: number } | null = null;
      if (viewerId) {
        const profileRes = await supabase
          .from("profiles")
          .select("city, lat, lng")
          .eq("user_id", viewerId)
          .maybeSingle();
        if (!profileRes.error) {
          viewerCity = profileRes.data?.city || null;
          if (typeof profileRes.data?.lat === "number" && typeof profileRes.data?.lng === "number") {
            viewerCoords = { lat: profileRes.data.lat, lng: profileRes.data.lng };
          }
        } else if (profileRes.error?.code === "42703") {
          const fallbackProfile = await supabase
            .from("profiles")
            .select("city")
            .eq("user_id", viewerId)
            .maybeSingle();
          if (!fallbackProfile.error) viewerCity = fallbackProfile.data?.city || null;
        }
      }
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, description, datetime, created_at, created_by, duration_minutes, location, activities, link, group_id, scope_type, country, city, lat, lng, radius_km')
        .eq('group_id', group.id)
        .order('datetime', { ascending: true })
        .limit(20);
      if (cancelled || error) return;
      const visible = (data || [])
        .filter((a: any) =>
          isAnnouncementVisibleForViewer(a, {
            viewerId,
            viewerEmail,
            viewerCity,
            viewerCoords,
          })
        )
        .slice(0, 5);
      setAnnouncements(visible as GroupAnnouncement[]);
    })();
    return () => { cancelled = true; };
  }, [group?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!group?.id) return;
      const { data } = await supabase
        .from('group_moments')
        .select('id, group_id, created_by, photo_url, caption, verified, min_view_level, created_at, verified_at')
        .eq('group_id', group.id)
        .order('created_at', { ascending: false })
        .limit(12);
      if (cancelled) return;
      setMoments((data as GroupMoment[]) ?? []);
    })();
    return () => { cancelled = true; };
  }, [group?.id, momentsTick]);

  // --- Actions ---

  async function joinGroup() {
    setMsg(null);
    if (!group) return;
    if (joinedCount >= MAX_GROUPS) {
      setMsg("You can only be in 7 circles at once. Leave another to join.");
      return;
    }
    const requiredLevel = Number(group.requires_verification_level ?? 1);
    if (myVerificationLevel < requiredLevel) {
      setMsg("This circle is for verified members only.");
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setMsg("Please sign in."); return; }
    const blockReason = await checkGroupJoinBlock(auth.user.id, group.id);
    if (blockReason) {
      const message = joinBlockMessage(blockReason);
      window.alert(message);
      setMsg(message);
      return;
    }
    const payload = { group_id: id, user_id: auth.user.id, role: "member", status: "active", last_joined_at: new Date().toISOString() };
    const { error } = await supabase
      .from("group_members")
      .upsert(payload, { onConflict: "group_id,user_id" });
    if (error) { 
      const text = (error.message || "").toLowerCase();
      if (text.includes("group_join_limit")) setMsg("You can only be in 7 circles at once. Leave another to join.");
      else if (text.includes("verification")) setMsg("This circle requires a higher verification level.");
      else setMsg(error.message || "Could not join."); 
      return; 
    }
    setIsMember(true);
    setMyMembership({ ...(payload as any), created_at: new Date().toISOString() });
    setMemberCount(prev => prev + (isMember ? 0 : 1));
    setJoinedCount((c) => Math.min(MAX_GROUPS, c + (isMember ? 0 : 1)));
    setPollReloadKey((k) => k + 1);
  }

  async function leaveGroup() {
    setMsg(null);
    if (!group || !me) return;
    if (me === group.host_id) { setMsg("Host cannot leave their own group."); return; }
    const joinedAt = myMembership?.last_joined_at;
    if (joinedAt) {
      const diff = Date.now() - new Date(joinedAt).getTime();
      if (diff < 12 * 60 * 60 * 1000) {
        setMsg("You must stay in a Circle for at least 12 hours before leaving.");
        return;
      }
    }
    const { error } = await supabase.from("group_members").delete().match({ group_id: group.id, user_id: me });
    if (error) { 
      const text = (error.message || "").toLowerCase();
      if (text.includes("leave_cooldown")) setMsg("You must stay in a Circle for at least 12 hours before leaving.");
      else setMsg(error.message || "Could not leave."); 
      return; 
    }
    setIsMember(false);
    setMemberCount(prev => Math.max(0, prev - 1));
    setJoinedCount((c) => Math.max(0, c - 1));
    setMyMembership(null);
  }

  async function transferHost(nextHostId: string) {
    if (!group || !isHost) return;
    setMsg(null);
    setOwnershipBusy(nextHostId);
    const { error } = await supabase.from("groups").update({ host_id: nextHostId }).eq("id", group.id);
    if (error) { setMsg(error.message || "Could not transfer host."); setOwnershipBusy(null); return; }
    setGroup(prev => prev ? { ...prev, host_id: nextHostId } as Group : prev);
    setMembers(prev => prev.map((m) => ({
      ...m,
      role: m.user_id === nextHostId ? 'host' : (m.role === 'host' ? 'member' : m.role)
    })));
    setOwnershipBusy(null);
  }

  async function grantLateVoteChance(userId: string) {
    if (!group || !poll || poll.status !== 'closed' || !isHost) return;
    if (!window.confirm("Allow this member to cast a late vote on the closed poll?")) return;
    setMsg(null);
    setLateGrantBusy(userId);
    try {
      const existing = Array.isArray(poll.late_voter_ids) ? (poll.late_voter_ids as string[]) : [];
      if (existing.includes(userId)) { setLateGrantBusy(null); return; }
      const updated = [...existing, userId];
      const { data, error } = await supabase
        .from("group_polls")
        .update({ late_voter_ids: updated })
        .eq("id", poll.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setPoll(data as PollWithLate);
      } else {
        setPoll(prev => prev ? { ...prev, late_voter_ids: updated } : prev);
      }
      setMsg("Late vote granted. Let them know they can now cast a vote.");
      setPollReloadKey((k) => k + 1);
    } catch (e: any) {
      const raw = e?.message || "";
      if (raw.toLowerCase().includes("late_voter_ids")) {
        setMsg("Database missing late_voter_ids on group_polls. Apply the latest schema and try again.");
      } else {
        setMsg(raw || "Could not grant a late vote.");
      }
    } finally {
      setLateGrantBusy(null);
    }
  }

  async function copyGroupCode() {
    if (!group?.code) return;
    navigator.clipboard.writeText(group.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function createInvite() {
    setMsg(null);
    if (!group?.id) return;
    setShareBusy(true);
    try {
      const { data: code, error } = await supabase.rpc('make_group_invite', {
        p_group_id: group.id,
        p_hours: 168,
        p_max_uses: null
      });
      if (error) throw error;
      const url = `${window.location.origin}/invite/${code}`;
      await navigator.clipboard.writeText(url); 
      setShareCopied(true); 
      setTimeout(()=>setShareCopied(false), 1500);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setShareBusy(false);
    }
  }

  async function handleMomentFile(list: FileList | null) {
    if (!list || !list[0]) return;
    if (!group) return;
    const file = list[0];
    if (file.size > 4_000_000) { setMomentMsg("Image must be under 4MB."); return; }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setMomentMsg("Sign in to share a moment."); return; }
    setMomentBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const { error } = await supabase.from('group_moments').insert({
        group_id: group.id,
        created_by: auth.user.id,
        photo_url: dataUrl,
        verified: togetherNow,
        min_view_level: togetherNow ? Math.max(2, myVerificationLevel) : 1,
        caption: togetherNow ? "Verified meetup" : null,
        verified_at: togetherNow ? new Date().toISOString() : null
      });
      if (error) throw error;
      setMomentMsg("Moment captured.");
      setMomentsTick((t) => t + 1);
    } catch (e: any) {
      setMomentMsg(e.message || "Could not save moment.");
    } finally {
      setMomentBusy(false);
      setTimeout(() => setMomentMsg(null), 2000);
    }
  }

  const triggerMomentPicker = () => momentInputRef.current?.click();
  const triggerMomentCamera = () => cameraInputRef.current?.click();

  function reportMoment(m: GroupMoment) {
    const subject = encodeURIComponent(`Moment review request ${m.id}`);
    const reporter = me ? `Reporter: ${me}` : "Reporter: anonymous";
    const body = encodeURIComponent(
      [
        `Moment ID: ${m.id}`,
        `Group ID: ${m.group_id}`,
        `Group title: ${group?.title || ""}`,
        `Created by: ${m.created_by}`,
        reporter,
        "",
        "Reason: "
      ].join("\n")
    );
    window.location.href = `mailto:${supportEmail}?subject=${subject}&body=${body}`;
  }

  async function handleDelete() {
    if (!group || !me) return;
    if (!window.confirm("Delete this group?")) return;
    await supabase.from("groups").delete().match({ id: group.id, host_id: me });
    nav("/browse");
  }

    async function saveDescription() {
    setMsg(null);
    if (!group || !isHost) return;
    setEditBusy(true);
    try {
      const { error } = await supabase
        .from("groups")
        .update({ description: editDescValue })
        .eq("id", group.id);
      if (error) throw error;
      setGroup(prev => (prev ? { ...(prev as any), description: editDescValue } : null));
      setIsEditingDesc(false);
    } catch (e: any) {
      setMsg(e.message || "Failed to save description");
    } finally {
      setEditBusy(false);
    }
  }

  // --- Voting Logic ---

  async function confirmCreateVoting() {
    setMsg(null);
    if (!group || !isHost) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;

    let closesAt: string | null = null;
    if (pollDuration === 'custom') {
        if (customEndDate) closesAt = new Date(customEndDate).toISOString();
    } else {
        const now = new Date();
        const hours = parseInt(pollDuration);
        now.setTime(now.getTime() + hours * 60 * 60 * 1000);
        closesAt = now.toISOString();
    }

    const normalizedOptions = newOptions
      .map((opt) => ({
        label: (opt.label || "").trim(),
        starts_at: opt.starts_at ? new Date(opt.starts_at).toISOString() : "",
        place: (opt.place || "").trim() || null
      }))
      .filter((opt) => opt.label && opt.starts_at)
      .slice(0, 20);

    if (!normalizedOptions.length) {
      setMsg("Please add at least one option with date and time.");
      return;
    }

    const { data: created, error: pErr } = await supabase
      .from("group_polls")
      .insert({
          group_id: group.id,
          title: (newTitle || "Schedule").trim(),
          created_by: auth.user.id,
          closes_at: closesAt,
          status: "open"
      })
      .select("id")
      .single();
      
    if (pErr || !created?.id) { 
        console.error("Poll create error:", pErr);
        setMsg(pErr?.message || "Failed to create poll. Check permissions."); 
        return; 
    }

    let hadError = false;
    let createdOptions: PollOption[] = [];
    if (normalizedOptions.length) {
      const rows = [
        ...normalizedOptions.map((opt) => ({
          poll_id: created.id,
          label: opt.label,
          starts_at: opt.starts_at,
          place: opt.place
        })),
        { poll_id: created.id, label: "Not Coming", starts_at: null, place: null }
      ];
      const { data: optRows, error: optError } = await supabase
        .from("group_poll_options")
        .insert(rows)
        .select("*")
        .order("created_at");
      if (optError) {
         console.error("Option create error:", optError);
         setMsg("Poll created but failed to add options.");
         hadError = true;
      } else {
         createdOptions = (optRows as PollOption[]) ?? [];
      }
    }

    setCreateOpen(false);
    if (!hadError) setMsg(null); // Clear error on success
    setPoll({ 
        id: created.id, group_id: group.id, 
        title: newTitle, status: "open", 
        closes_at: closesAt, created_by: auth.user.id,
        late_voter_ids: []
    });
    setOptions(createdOptions);
    setCounts({});
    setVotedCount(0);
    setNewOptions([{ ...emptyDraftOption }]);

    try {
      const recipients = members.map((m) => m.user_id).filter((uid) => uid !== auth.user.id);
      if (recipients.length) {
        await supabase.functions.invoke('push-dispatch', {
          body: {
            userIds: recipients,
            type: 'poll_created',
            payload: { group_id: group.id, poll_id: created.id, title: newTitle }
          }
        });
      }
    } catch { /* non-blocking */ }
  }

  async function finalizePoll() {
    setMsg(null);
    if (!poll || !isHost) return;
    if (!window.confirm("End voting? Everyone who hasn't voted will be marked as 'Not Coming'.")) return;
    setVotingBusy("closing");
    try {
      const { data, error } = await supabase.rpc('resolve_poll', { p_poll_id: poll.id });
      if (error) throw error;
      setPoll(prev => prev ? { ...prev, status: 'closed' } : prev);
      setEvent((data as GroupEvent) || null);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setVotingBusy(null);
    }
  }

  async function deleteVoting() {
    setMsg(null);
    if (!poll) return;
    if (!window.confirm("Delete this voting?")) return;
    const { error } = await supabase.from("group_polls").delete().eq("id", poll.id);
    if (error) {
        setMsg("Could not delete. Check database permissions.");
        console.error(error);
    } else {
        setPoll(null);
    }
  }

  function normalizeVoteError(e: any): string {
    const raw = e?.message || "";
    if (raw.toLowerCase().includes("row-level security")) return "Join the group to vote.";
    if (raw.toLowerCase().includes("option does not belong to poll")) return "This option is no longer valid for the poll.";
    if (raw.toLowerCase().includes("not_authenticated")) return "Please sign in to vote.";
    return raw || "Could not save vote.";
  }

  async function castVote(optionId: string) {
    if (!poll) return;
    const hasLatePass = lateVoteAllowed && poll.status === "closed";
    if (!isMember) { setMsg("Join the circle to vote."); return; }
    if (!hasLatePass && (isPollExpired || poll.status === "closed")) return;
    setVotingBusy(optionId);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) { setMsg("Please sign in to vote."); nav("/login"); return; }

    const { error } = await supabase.from("group_votes").upsert(
        { poll_id: poll.id, option_id: optionId, user_id: auth.user.id },
        { onConflict: "poll_id,user_id" }
    );
    
    if (error) {
        console.error(error);
        setMsg(normalizeVoteError(error));
        setVotingBusy(null);
        return;
    }

    const { data: votesRows } = await supabase.from("group_votes").select("option_id,user_id").eq("poll_id", poll.id);
    const map: Record<string, number> = {};
    const voterSet = new Set<string>();
    (votesRows as any[])?.forEach((r) => {
        map[r.option_id] = (map[r.option_id] || 0) + 1;
        voterSet.add(r.user_id);
    });
    setCounts(map);
    setVotedCount(voterSet.size);
    setVotingBusy(null);
  }

  if (loading) return <div className="p-20 flex justify-center"><div className="animate-spin h-8 w-8 border-2 border-neutral-300 border-t-black rounded-full"/></div>;
  if (!group) return <div className="p-10 text-center">Group not found.</div>;

  const canVote = isMember && (
    (poll?.status === "open" && !isPollExpired) ||
    (poll?.status === "closed" && lateVoteAllowed)
  );

  return (
    <>
      <div className={"relative z-0 transition-all duration-300 min-h-screen bg-[#FDFBF7] pb-24 " + (chatOpen ? "lg:mr-[min(92vw,520px)]" : "")}>
        
        {/* HERO HEADER */}
        <div className="bg-white border-b border-neutral-200 pt-8 pb-6 px-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-emerald-50 to-blue-50 rounded-full blur-3xl -z-10 opacity-60" />
            
            <div className="mx-auto max-w-5xl">
                <div className="flex items-center gap-2 mb-4 text-sm text-neutral-500">
                    <Link to="/browse" className="flex items-center gap-1 hover:text-black transition-colors">
                        <ChevronLeft className="h-4 w-4" /> Browse
                    </Link> 
                    <span>/</span>
                    <span className="font-medium text-neutral-800">Group Detail</span>
                </div>

                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                    <div className="flex-1 min-w-0">
                        <h1 className="text-3xl md:text-4xl font-extrabold text-neutral-900 tracking-tight leading-tight mb-3">
                            {group.title}
                        </h1>
                        
                        <div className="flex flex-wrap gap-2 items-center">
    <div className="inline-flex items-center gap-1.5 bg-neutral-100 text-neutral-700 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide">
        {group.category || "General"}
    </div>
    {group.game && (
        <div className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-bold">
            {group.game}
        </div>
    )}
    {group.city && (
        <div className="inline-flex items-center gap-1.5 border border-neutral-200 text-neutral-600 px-3 py-1 rounded-full text-xs font-medium">
            <MapPin className="h-3 w-3" /> {group.city}
        </div>
    )}
    {group.code && (
        <button
          type="button"
          onClick={copyGroupCode}
          className="inline-flex items-center gap-1.5 bg-neutral-900 text-white px-3 py-1 rounded-full text-xs font-mono cursor-pointer hover:bg-neutral-800 active:scale-95 transition-transform"
          title={copied ? "Copied" : "Click to copy invite code"}
        >
          {String(group.code).toUpperCase()}
        </button>
    )}
    {(group.requires_verification_level ?? 1) > 1 && (
        <div className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold">
            Verified L{group.requires_verification_level}+ only
        </div>
    )}
    <div className="inline-flex items-center gap-1.5 border border-neutral-200 text-neutral-600 px-3 py-1 rounded-full text-xs font-medium">
        <Users className="h-3 w-3" /> {memberCount} / {group.capacity}
    </div>
</div>
                    </div>

                    {/* Main Actions */}
                    <div className="flex flex-wrap items-center gap-3">
                        {!isMember ? (
                            <button onClick={joinGroup} disabled={joinedCount >= MAX_GROUPS} className="h-10 px-6 rounded-full bg-emerald-600 text-white text-sm font-bold shadow-md hover:bg-emerald-700 hover:shadow-lg active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed">
                                {joinedCount >= MAX_GROUPS ? "Limit Reached" : "Join Group"}
                            </button>
                        ) : (
                            <>
                                <button onClick={() => nav(`/chats?groupId=${group.id}`)} className="h-10 px-5 rounded-full bg-white border border-neutral-200 text-neutral-800 text-sm font-bold shadow-sm hover:bg-neutral-50 hover:border-neutral-300 flex items-center gap-2 transition-all">
                                    <MessageCircle className="h-4 w-4" /> Chat
                                </button>
                                {isHost && (
                                    <button onClick={createInvite} className="h-10 px-5 rounded-full bg-white border border-neutral-200 text-neutral-800 text-sm font-bold shadow-sm hover:bg-neutral-50 hover:border-neutral-300 flex items-center gap-2 transition-all">
                                        <Share2 className="h-4 w-4" /> {shareBusy ? "..." : shareCopied ? "Copied" : "Invite"}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
        
        {/* GLOBAL ERROR MESSAGE */}
        {msg && !createOpen && (
            <div className="mx-auto max-w-5xl px-4 mt-4">
               <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm animate-in fade-in slide-in-from-top-2">
                  <AlertCircle className="h-4 w-4" />
                  {msg}
                  <button onClick={() => setMsg(null)} className="ml-auto hover:bg-red-100 p-1 rounded-full"><X className="h-3 w-3" /></button>
               </div>
            </div>
        )}

        {announcements.length > 0 && (
          <div className="mx-auto max-w-5xl px-4 mt-4">
            <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold text-neutral-900">
                  <Megaphone className="h-4 w-4 text-amber-500" />
                  Announcement for this circle
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600">Official</span>
              </div>
              {announcements.map((a) => (
                <div key={a.id} className="space-y-1 border-t border-neutral-100 pt-2 first:border-0 first:pt-0">
                  <div className="text-sm font-bold text-neutral-900">{a.title}</div>
                  <div className="text-xs text-neutral-600">{formatAnnouncementRange(a)}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-neutral-800">
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {a.location}</span>
                    <a href={mapLinks(a.location).google} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 hover:border-neutral-300"><Map className="h-3 w-3" /> Google</a>
                    <a href={mapLinks(a.location).apple} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-0.5 hover:border-neutral-300"><Map className="h-3 w-3" /> Apple</a>
                  </div>
                  <div className="text-sm text-neutral-700 leading-relaxed">{a.description}</div>
                  {a.activities?.length ? (
                    <ul className="space-y-0.5 text-xs text-neutral-600">
                      {a.activities.map((act) => (
                        <li key={act} className="flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-neutral-900" />
                          <span>{act}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => nav(`/chats?groupId=${group?.id}`)}
                      className="inline-flex items-center gap-2 rounded-full bg-black px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-neutral-800"
                    >
                      <MessageCircle className="h-4 w-4" /> Open chat
                    </button>
                    <button
                      onClick={() => addAnnouncementToCalendar(a)}
                      className="inline-flex items-center gap-2 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-bold text-neutral-800 hover:border-neutral-300"
                    >
                      <Calendar className="h-4 w-4" /> Add to calendar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MAIN CONTENT GRID */}
        <div className="mx-auto max-w-5xl px-4 py-8 grid gap-8 lg:grid-cols-[2fr_1fr]">
            
            {/* Left Column: About & Info */}
            <div className="space-y-8">
                
                {/* About Section */}
                <section className="bg-white rounded-2xl p-6 shadow-sm border border-neutral-200/60 relative">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
                            About this Circle
                        </h2>
                        {isHost && !isEditingDesc && (
                            <button onClick={() => setIsEditingDesc(true)} className="p-1.5 rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 transition-colors">
                                <Edit2 className="h-4 w-4" />
                            </button>
                        )}
                    </div>

                    {isEditingDesc ? (
                        <div className="animate-in fade-in duration-200">
                            <textarea
                                value={editDescValue}
                                onChange={(e) => setEditDescValue(e.target.value)}
                                className="w-full min-h-[120px] p-3 rounded-xl border border-neutral-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none resize-y mb-3"
                                placeholder="What's the plan?"
                            />
                            <div className="flex gap-2 justify-end">
                                <button onClick={() => setIsEditingDesc(false)} className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs font-bold hover:bg-neutral-50 text-neutral-600">Cancel</button>
                                <button onClick={saveDescription} disabled={editBusy} className="px-3 py-1.5 rounded-lg bg-black text-white text-xs font-bold hover:bg-neutral-800 disabled:opacity-50">
                                    {editBusy ? "Saving..." : "Save Changes"}
                                </button>
                            </div>
                        </div>
                                        ) : (
                        <p className="text-sm text-neutral-600 leading-relaxed whitespace-pre-wrap">
                            {(group as any).description || (
                              <span className="italic text-neutral-400">No description provided.</span>
                            )}
                        </p>
                    )}

                </section>

                <section className="bg-white rounded-2xl p-6 shadow-sm border border-neutral-200/60 relative">
                    <div className="flex items-center justify-between mb-3 gap-2">
                        <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
                            Moments
                        </h2>
                        <div className="flex gap-2">
                          <button
                            onClick={triggerMomentPicker}
                            disabled={!isMember || momentBusy}
                            className={`text-xs font-bold px-3 py-1.5 rounded-full ${isMember ? 'bg-black text-white' : 'bg-neutral-200 text-neutral-500 cursor-not-allowed'} ${momentBusy ? 'opacity-70' : ''}`}
                          >
                            {momentBusy ? "Saving..." : "Add"}
                          </button>
                          <button
                            onClick={triggerMomentCamera}
                            disabled={!isMember || momentBusy}
                            className={`text-xs font-bold px-3 py-1.5 rounded-full border ${isMember ? 'bg-white text-neutral-800 border-neutral-300' : 'bg-neutral-100 text-neutral-400 border-neutral-200 cursor-not-allowed'} ${momentBusy ? 'opacity-70' : ''}`}
                          >
                            {momentBusy ? "..." : "Take Photo"}
                          </button>
                          <input
                            ref={momentInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={!isMember || momentBusy}
                            onChange={(e) => { handleMomentFile(e.target.files); if (e.target) e.target.value = ""; }}
                          />
                          <input
                            ref={cameraInputRef}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            disabled={!isMember || momentBusy}
                            onChange={(e) => { handleMomentFile(e.target.files); if (e.target) e.target.value = ""; }}
                          />
                        </div>
                    </div>
                    {momentMsg && (
                        <div className="mb-3 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                            {momentMsg}
                        </div>
                    )}
                    {togetherNow && (
                        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                            You're all here! Take a group selfie to verify this meetup.
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        {moments.map((m) => {
                            const needsReview = !m.verified || myVerificationLevel < (m.min_view_level ?? 1);
                            return (
                                <div key={m.id} className="relative overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
                                    <img src={m.photo_url} className="h-32 w-full object-cover" />
                                    <div className="absolute top-2 left-2 rounded-full bg-black/70 text-white text-[10px] font-bold px-2 py-0.5">
                                        {m.verified ? "Verified" : "Unverified"} • {m.id.slice(0, 8)}
                                    </div>
                                    {needsReview && (
                                        <div className="absolute inset-0 flex items-end justify-start p-2">
                                            <button
                                              type="button"
                                              onClick={() => reportMoment(m)}
                                              className="rounded-lg bg-white/90 text-[10px] font-bold text-neutral-800 px-3 py-1.5 shadow-sm border border-neutral-200 hover:bg-white"
                                            >
                                                Not yet reviewed — report if inappropriate
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {moments.length === 0 && (
                        <div className="text-sm text-neutral-500">No moments yet. Share your first meetup photo.</div>
                    )}
                </section>

                {/* Details Card */}
                <section className="grid sm:grid-cols-2 gap-4">
                   <div className="bg-white p-4 rounded-2xl border border-neutral-200/60 shadow-sm">
                      <div className="flex items-center gap-2 text-neutral-400 text-xs font-bold uppercase mb-1">
                         <Calendar className="h-3 w-3" /> Created
                      </div>
                      <div className="text-sm font-semibold text-neutral-900">{new Date(group.created_at).toLocaleDateString()}</div>
                   </div>
                   <div className="bg-white p-4 rounded-2xl border border-neutral-200/60 shadow-sm">
                      <div className="flex items-center gap-2 text-neutral-400 text-xs font-bold uppercase mb-1">
                         <Clock className="h-3 w-3" /> Format
                      </div>
                      <div className="text-sm font-semibold text-neutral-900">
                         {group.is_online ? (group.online_link ? "Online (Link set)" : "Online") : "In Person"}
                      </div>
                   </div>
                </section>

                {isMember && isHost && (
                     <button onClick={handleDelete} className="flex items-center gap-2 text-red-600 text-sm font-medium hover:text-red-700 transition-colors px-2">
                         <Trash2 className="h-4 w-4" /> Delete this group
                     </button>
                )}
                {isMember && !isHost && (
                     <button onClick={leaveGroup} className="flex items-center gap-2 text-neutral-500 text-sm font-medium hover:text-neutral-800 transition-colors px-2">
                         <LogOut className="h-4 w-4" /> Leave group
                     </button>
                )}

            </div>

            {/* Right Column: Voting & Members */}
            <div className="space-y-6">
                
                {/* --- VOTING SECTION --- */}
                <div
                  id="poll-section"
                  className={`bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm transition-all ${pollFocus ? "relative z-40 ring-2 ring-emerald-200 shadow-2xl scale-[1.01]" : ""}`}
                  onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                           Polls & Events
                        </h2>
                        {isHost && (
                            <button onClick={() => { setMsg(null); setCreateOpen(true); }} className="p-1.5 bg-neutral-50 rounded-full text-neutral-600 shadow-sm hover:scale-105 active:scale-95 transition-all border border-neutral-200 hover:bg-white hover:border-neutral-300">
                                <Plus className="h-4 w-4" />
                            </button>
                        )}
                        {!isMember && (
                          <div className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-3 py-1">
                            Join the circle to vote
                          </div>
                        )}
                    </div>

                    {!poll ? (
                        <div className="text-center py-8 px-4 bg-neutral-50 rounded-xl border border-dashed border-neutral-200">
                            <p className="text-sm text-neutral-400 mb-2 font-medium">No active polls</p>
                            {isHost && <button onClick={() => { setMsg(null); setCreateOpen(true); }} className="text-xs text-black font-bold hover:underline">Create one</button>}
                        </div>
                    ) : (
                        <div className="animate-in slide-in-from-bottom-2 duration-500">
                            <div className="flex justify-between items-start mb-3">
                                <h3 className="font-bold text-neutral-900">{poll.title}</h3>
                                <div className="flex flex-col items-end gap-1">
                                  <div className={`text-[10px] font-bold px-2 py-1 rounded-full border ${poll.status === 'closed' ? 'bg-neutral-200 text-neutral-600 border-neutral-300' : isPollExpired ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
                                      {getPollStatusLabel(poll.status, poll.closes_at)}
                                  </div>
                                  {lateVoteAllowed && poll.status === 'closed' && (
                                    <span className="text-[11px] font-semibold text-emerald-700">Host gave you a late vote</span>
                                  )}
                                </div>
                            </div>

                            <div className="space-y-2 mb-4">
                                {options.map(o => {
                                    const count = counts[o.id] ?? 0;
                                    const isNC = o.label === 'Not Coming';
                                    const total = isNC ? count + (memberCount - votedCount) : count;
                                    const pct = memberCount > 0 ? Math.round((total / memberCount) * 100) : 0;
                                    
                                    return (
                                        <div key={o.id} className="relative">
                                            <div 
                                              className="absolute inset-0 bg-neutral-100 rounded-lg transition-all duration-500" 
                                              style={{ width: `${pct}%` }} 
                                            />
                                            <div className="relative flex items-center justify-between p-2.5 rounded-lg border border-neutral-100 hover:border-neutral-200 transition-colors">
                                                <div className="z-10 flex flex-col gap-0.5">
                                                  <span className="text-sm font-medium text-neutral-800">{o.label}</span>
                                                  {o.starts_at && (
                                                    <span className="text-[11px] text-neutral-500 flex items-center gap-1">
                                                      <Clock className="h-3 w-3" />
                                                      {formatDateTime(o.starts_at)}
                                                    </span>
                                                  )}
                                                  {o.place && (
                                                    <span className="text-[11px] text-neutral-500">{o.place}</span>
                                                  )}
                                                </div>
                                                <div className="flex items-center gap-3 z-10">
                                                    <span className="text-xs font-bold text-neutral-600">{total}</span>
                                                    {canVote && (
                                                        <button 
                                                            onClick={() => castVote(o.id)}
                                                            disabled={!canVote}
                                                            className={`h-6 w-6 rounded-full flex items-center justify-center border transition-all ${votingBusy === o.id ? 'bg-black border-black text-white' : 'bg-white border-neutral-200 text-neutral-600 hover:scale-110 active:scale-95'}`}
                                                        >
                                                            {votingBusy === o.id ? <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" /> : <Check className="h-3 w-3" />}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>

                            {event && (
                                <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                                    <div className="text-xs font-bold text-emerald-800">Confirmed Event</div>
                                    <div className="text-sm font-semibold text-neutral-900">{event.title}</div>
                                    <div className="text-xs text-neutral-600">{formatDateTime(event.starts_at)} {event.place ? `• ${event.place}` : ""}</div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      <button onClick={() => downloadCalendar(event)} className="text-xs font-bold rounded-lg bg-black text-white px-3 py-1.5 hover:bg-neutral-800">
                                        Add to Calendar
                                      </button>
                                    </div>
                                </div>
                            )}

                            {isHost && (
                                <div className="flex flex-col gap-2 pt-3 border-t border-neutral-100">
                                    {poll.status === 'open' && (
                                        <button 
                                            onClick={finalizePoll} 
                                            className="w-full bg-black text-white text-xs font-bold py-3 rounded-xl hover:bg-neutral-800 shadow-sm flex items-center justify-center gap-2"
                                        >
                                            <Check className="h-4 w-4" /> End & Count Games
                                        </button>
                                    )}
                                    {poll.status === 'closed' && (
                                        <button 
                                            onClick={() => { setMsg(null); setCreateOpen(true); }} 
                                            className="w-full bg-neutral-100 text-neutral-700 text-xs font-bold py-3 rounded-xl hover:bg-neutral-200 flex items-center justify-center gap-2"
                                        >
                                            <Plus className="h-4 w-4" /> Create New Vote
                                        </button>
                                    )}
                                    <button 
                                        onClick={deleteVoting} 
                                        className="w-full text-red-600 text-xs font-bold py-2 hover:bg-red-50 rounded-xl"
                                    >
                                        Delete Poll
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* --- MEMBERS PREVIEW --- */}
                <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-bold text-neutral-900">Members ({memberCount})</h2>
                        <button onClick={() => setMembersOpen(true)} className="text-xs font-medium text-emerald-600 hover:underline">
                            View All
                        </button>
                    </div>
                    <div className="flex -space-x-2 overflow-hidden cursor-pointer" onClick={() => setMembersOpen(true)}>
                         {members.slice(0, 5).map(m => (
                            <div key={m.user_id} className="h-8 w-8 rounded-full ring-2 ring-white bg-neutral-100 flex items-center justify-center text-[10px] font-bold text-neutral-500" title={m.name || "User"}>
                                <img src={getAvatarUrl(m.avatar_url, m.user_id)} alt={m.name || "User"} className="h-full w-full object-cover rounded-full" />
                            </div>
                         ))}
                         {memberCount > 5 && <div className="h-8 w-8 rounded-full ring-2 ring-white bg-neutral-50 flex items-center justify-center text-[10px] font-bold text-neutral-400">+{memberCount - 5}</div>}
                    </div>
                </div>
            </div>
        </div>
      </div>

      {/* Create Vote Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-[150] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm px-4 py-6 md:items-center animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 shadow-2xl ring-1 ring-black/5 max-h-[calc(100dvh-3rem)] flex flex-col">
            <div className="flex justify-between items-center mb-5">
                <h3 className="text-xl font-bold text-neutral-900">New Vote</h3>
                <button onClick={() => setCreateOpen(false)} className="p-1 rounded-full hover:bg-neutral-100 text-neutral-500"><X className="h-5 w-5" /></button>
            </div>
            
            {/* ERROR IN MODAL */}
            {msg && (
              <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold border border-red-100 flex items-center gap-2 animate-in slide-in-from-top-1">
                 <AlertCircle className="h-4 w-4 shrink-0" />
                 <span>{msg}</span>
              </div>
            )}
            
            <div className="space-y-4 flex-1 overflow-y-auto pr-1 pb-6">
                <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-1.5">Topic</label>
                    <input value={newTitle} onChange={e => setNewTitle(e.target.value)} className="w-full border border-neutral-200 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-black outline-none transition-all" placeholder="e.g. When to play?" />
                </div>
                
                <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-1.5">Duration</label>
                    <div className="flex gap-3">
                        <select value={pollDuration} onChange={e => setPollDuration(e.target.value)} className="border border-neutral-200 bg-neutral-50 rounded-xl px-4 py-3 text-sm font-medium flex-1 outline-none focus:ring-2 focus:ring-black">
                            <option value="1">1 Hour</option>
                            <option value="24">24 Hours</option>
                            <option value="48">2 Days</option>
                            <option value="custom">Custom...</option>
                        </select>
                        {pollDuration === 'custom' && (
                            <input type="datetime-local" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="border border-neutral-200 bg-neutral-50 rounded-xl px-3 py-3 text-sm font-medium flex-[1.5] outline-none focus:ring-2 focus:ring-black" />
                        )}
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-1.5">Options (with date & time)</label>
                    <div className="space-y-3">
                      {newOptions.map((opt, idx) => (
                        <div key={idx} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-neutral-500 uppercase">Option {idx + 1}</span>
                            {newOptions.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeDraftOption(idx)}
                                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-red-500 hover:bg-red-50"
                              >
                                <Trash2 className="h-3 w-3" /> Remove
                              </button>
                            )}
                          </div>
                          <input
                            value={opt.label}
                            onChange={(e) => updateDraftOption(idx, "label", e.target.value)}
                            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-black"
                            placeholder="Activity name"
                          />
                          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <input
                              type="datetime-local"
                              value={opt.starts_at}
                              onChange={(e) => updateDraftOption(idx, "starts_at", e.target.value)}
                              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-black"
                              placeholder="Date & time"
                            />
                            <input
                              value={opt.place || ""}
                              onChange={(e) => updateDraftOption(idx, "place", e.target.value)}
                              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-black"
                              placeholder="Location (optional)"
                            />
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addDraftOption}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 px-4 py-2 text-sm font-bold text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50"
                      >
                        <Plus className="h-4 w-4" /> Add blank option
                      </button>
                      <button
                        type="button"
                        onClick={duplicateLastOption}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-bold text-neutral-700 hover:border-neutral-300"
                      >
                        <Plus className="h-4 w-4" /> Copy previous option
                      </button>
                    </div>
                    <p className="text-[10px] text-neutral-400 mt-1 italic text-right">Date & time required. "Not Coming" is added automatically.</p>
                </div>
                
                <div className="flex justify-end gap-3 pt-2">
                    <button onClick={() => setCreateOpen(false)} className="px-5 py-2.5 text-sm font-bold text-neutral-500 hover:bg-neutral-50 rounded-xl transition-colors">Cancel</button>
                    <button onClick={confirmCreateVoting} className="px-6 py-2.5 text-sm font-bold bg-black text-white rounded-xl shadow-lg hover:bg-neutral-800 active:scale-95 transition-all">Create Vote</button>
                </div>
            </div>
          </div>
        </div>
      )}

      {/* Members Modal */}
      {membersOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm px-4 py-6 md:items-center animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-3rem)]">
            <div className="flex justify-between items-center mb-4 shrink-0">
               <h3 className="text-xl font-bold text-neutral-900">Members ({members.length})</h3>
               <button onClick={() => setMembersOpen(false)} className="p-1 rounded-full hover:bg-neutral-100 text-neutral-500"><X className="h-5 w-5" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-2">
               {members.map((m) => {
                 const lateGranted = Array.isArray(poll?.late_voter_ids) ? (poll?.late_voter_ids as string[]).includes(m.user_id) : false;
                 const isMe = m.user_id === me;
                 return (
                 <div
                   key={m.user_id}
                   onClick={() => {
                     if (isMe) return;
                     setSelectedUserId(m.user_id);
                     setShowProfileModal(true);
                   }}
                   className={`flex items-center justify-between p-2 rounded-xl transition-colors ${isMe ? "cursor-default bg-neutral-50/60" : "hover:bg-neutral-50 cursor-pointer"}`}
                 >
                    <div className="flex items-center gap-3">
                       <div className="h-10 w-10 rounded-full bg-neutral-200 flex items-center justify-center overflow-hidden">
                          <img src={getAvatarUrl(m.avatar_url, m.user_id)} alt={m.name || "User"} className="w-full h-full object-cover" />
                       </div>
                       <div>
                         <div className="text-sm font-bold text-neutral-900">{m.name || "User"}</div>
                         {isMe && (
                           <div className="text-[11px] font-semibold text-emerald-600">You</div>
                         )}

                         {isTogether(m.user_id) ? (
                           <div className="flex items-center gap-1 mt-0.5 animate-in fade-in slide-in-from-left-1">
                             <span className="relative flex h-2 w-2">
                               <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                               <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                             </span>
                             <span className="text-[10px] font-bold text-emerald-600">Here with you</span>
                           </div>
                         ) : (
                           <>
                             {m.role === 'host' && (
                               <div className="text-[10px] text-amber-600 font-bold uppercase tracking-wide">Host</div>
                             )}
                             {m.role === 'owner' && (
                               <div className="text-[10px] text-amber-600 font-bold uppercase tracking-wide">Owner</div>
                             )}
                            {m.role !== 'host' && m.role !== 'owner' && (
                               <div className="text-xs text-neutral-500 capitalize">{m.role}</div>
                             )}
                           </>
                         )}
                       </div>
                    </div>
                    {isHost && m.user_id !== group.host_id && !isMe && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); transferHost(m.user_id); }}
                          className="text-[10px] font-bold text-amber-700 border border-amber-200 px-2 py-1 rounded-lg hover:bg-amber-50 disabled:opacity-50"
                          disabled={ownershipBusy === m.user_id}
                        >
                          {ownershipBusy === m.user_id ? "..." : "Pass Torch"}
                        </button>
                        {poll && poll.status === 'closed' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); grantLateVoteChance(m.user_id); }}
                            className="text-[10px] font-bold text-emerald-700 border border-emerald-200 px-2 py-1 rounded-lg hover:bg-emerald-50 disabled:opacity-50"
                            disabled={lateGrantBusy === m.user_id || lateGranted}
                          >
                            { lateGranted ? "Vote Granted" : lateGrantBusy === m.user_id ? "..." : "Vote Chance" }
                          </button>
                        )}
                      </div>
                    )}
                 </div>
               );
               })}
            </div>
          </div>
        </div>
      )}

      <ViewOtherProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
         viewUserId={selectedUserId}
      />
      {/* Chat Panel - WRAPPED IN MODAL */}
      {chatOpen && group && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto px-4 py-6 md:items-center animate-in zoom-in-95 duration-200">
           {/* Backdrop */}
           <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setChatOpen(false)} />
           
           {/* Modal Content */}
           <div className="relative w-full max-w-2xl h-[85vh] bg-white rounded-3xl shadow-2xl overflow-hidden ring-1 ring-black/10">
               <Suspense fallback={<div className="flex h-full items-center justify-center">Loading...</div>}>
                 <ChatPanel 
                   groupId={group.id} 
                   onClose={() => { setChatOpen(false); }} 
                 />
               </Suspense>
           </div>
        </div>
      )}
    </>
  );
}
