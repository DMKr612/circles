import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useLocation, useNavigate } from "react-router-dom";
import { Calendar, Check, CheckCircle2, ChevronLeft, ChevronRight, MessageCircle, CheckSquare, Mail, Users, Megaphone, Star, UserPlus } from "lucide-react";
import { useAuth } from "@/App";
import { isAnnouncementVisibleForViewer } from "@/lib/announcements";
import { getAvatarUrl } from "@/lib/avatar";
import { routeToEventRating } from "@/constants/routes";

type CalendarEntry = {
  id: string;
  groupId: string;
  groupTitle: string;
  title: string;
  startsAt: string;
  phase: "planned" | "confirmed";
  pollId?: string;
  optionId?: string;
  participants: number;
  votes: number;
};

type ActivityType = "meetup_scheduled" | "poll_created" | "mention" | "rating_needed";

type ActivityEntry = {
  id: string;
  type: ActivityType;
  date: Date;
  title: string;
  description: string;
  startsAt?: string;
  actionLabel?: "View" | "Vote" | "Open chat" | "Rate" | "Confirm";
  actionTo: string;
};

type ActivityDraft = {
  id: string;
  type: ActivityType;
  createdAt: string;
  groupId: string;
  groupTitle: string;
  startsAt?: string | null;
  place?: string | null;
  text?: string | null;
  eventId?: string | null;
};

const UUID_REGEX =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const RAW_ENTITY_REGEX =
  /\b(?:group[_\s-]?polls?|group[_\s-]?events?|group[_\s-]?votes?|rating[_\s-]?pairs?|profiles?|announcements?|table|column)\b/gi;

function cleanActivityText(value: string | null | undefined, max = 120): string {
  const cleaned = String(value || "")
    .replace(UUID_REGEX, "")
    .replace(/\bPOLL:\s*/gi, "")
    .replace(RAW_ENTITY_REGEX, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function formatActivityDateTime(iso: string | null | undefined): string {
  if (!iso) return "Time TBD";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Time TBD";
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  const day = d.toLocaleDateString(undefined, { day: "2-digit" });
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${weekday} ${day} ${month} · ${time}`;
}

function titleCaseWords(value: string): string {
  return String(value || "")
    .replace(/\b[a-z]/g, (m) => m.toUpperCase())
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMentionRegex(
  name: string | null | undefined,
  email: string | null | undefined,
  publicId: string | null | undefined
): RegExp | null {
  const fromName = String(name || "").trim();
  const fromEmail = String(email || "").trim().split("@")[0] || "";
  const fromPublicId = String(publicId || "").trim().replace(/^@+/, "");
  const first = fromName.split(/\s+/).filter(Boolean)[0] || "";
  const candidates = Array.from(new Set([fromName, first, fromEmail, fromPublicId].filter((v) => v.length >= 2)));
  if (!candidates.length) return null;
  const pattern = candidates.map(escapeRegExp).join("|");
  return new RegExp(`@\\s*(?:${pattern})\\b`, "i");
}

function formatActivityEntry(draft: ActivityDraft): ActivityEntry {
  const groupTitle = titleCaseWords(cleanActivityText(draft.groupTitle, 42) || "Circle") || "Circle";
  const createdDate = new Date(draft.createdAt);
  const safeDate = Number.isNaN(createdDate.getTime()) ? new Date() : createdDate;
  const startsAt = draft.startsAt || draft.createdAt;

  if (draft.type === "meetup_scheduled") {
    const startsMs = new Date(draft.startsAt || draft.createdAt).getTime();
    const needsConfirm =
      Number.isFinite(startsMs) &&
      startsMs > Date.now() &&
      startsMs - Date.now() <= 72 * 60 * 60 * 1000;
    return {
      id: draft.id,
      type: draft.type,
      date: safeDate,
      title: `New meetup in ${groupTitle}`,
      description: formatActivityDateTime(startsAt),
      startsAt,
      actionLabel: needsConfirm ? "Confirm" : "View",
      actionTo: draft.groupId ? `/group/${draft.groupId}` : "/groups/mine",
    };
  }

  if (draft.type === "poll_created") {
    return {
      id: draft.id,
      type: draft.type,
      date: safeDate,
      title: `New vote in ${groupTitle}`,
      description: cleanActivityText(draft.text || "Vote for the next meetup time.", 120) || "Vote for the next meetup time.",
      actionLabel: "Vote",
      actionTo: draft.groupId ? `/group/${draft.groupId}#poll` : "/groups/mine",
    };
  }

  if (draft.type === "mention") {
    return {
      id: draft.id,
      type: draft.type,
      date: safeDate,
      title: `You were mentioned in ${groupTitle}`,
      description: cleanActivityText(draft.text || "Someone mentioned you.", 120) || "Someone mentioned you.",
      actionLabel: "Open chat",
      actionTo: draft.groupId ? `/chats?groupId=${draft.groupId}` : "/chats",
    };
  }

  return {
    id: draft.id,
    type: "rating_needed",
    date: safeDate,
    title: "Rate your last meetup",
    description: `${groupTitle} • ${formatActivityDateTime(draft.startsAt || draft.createdAt)}`,
    actionLabel: "Rate",
    actionTo: draft.eventId
      ? routeToEventRating(draft.eventId, draft.groupId || undefined)
      : draft.groupId
        ? `/group/${draft.groupId}`
        : "/groups/mine",
  };
}

async function fetchFriendRequests(userId: string) {
  const rpcRes = await supabase.rpc("get_my_friend_requests");
  if (!rpcRes.error && Array.isArray(rpcRes.data)) {
    return rpcRes.data.map((r: any) => ({
      id: r.id,
      user_id_a: r.sender_id,
      created_at: r.created_at,
      profiles: {
        name: r.sender_name,
        avatar_url: r.sender_avatar,
      },
    }));
  }

  if (rpcRes.error) {
    console.warn("[notifications] get_my_friend_requests fallback", rpcRes.error.message);
  }

  const { data: pendingRows, error: pendingErr } = await supabase
    .from("friendships")
    .select("id,user_id_a,user_id_b,requested_by,created_at")
    .eq("status", "pending")
    .or(`user_id_a.eq.${userId},user_id_b.eq.${userId}`)
    .neq("requested_by", userId)
    .order("created_at", { ascending: false });

  if (pendingErr || !pendingRows?.length) return [];

  const senderIds = Array.from(
    new Set(
      pendingRows
        .map((row: any) => row.requested_by || (row.user_id_a === userId ? row.user_id_b : row.user_id_a))
        .filter(Boolean)
    )
  ) as string[];

  let profileMap = new Map<string, { name: string | null; avatar_url: string | null }>();
  if (senderIds.length) {
    const { data: senderProfiles } = await supabase
      .from("profiles")
      .select("user_id,name,avatar_url")
      .in("user_id", senderIds);
    profileMap = new Map(
      (senderProfiles || []).map((p: any) => [
        p.user_id,
        {
          name: p.name ?? null,
          avatar_url: p.avatar_url ?? null,
        },
      ])
    );
  }

  return pendingRows.map((row: any) => {
    const senderId = row.requested_by || (row.user_id_a === userId ? row.user_id_b : row.user_id_a);
    const sender = profileMap.get(senderId);
    return {
      id: row.id,
      user_id_a: senderId,
      created_at: row.created_at,
      profiles: {
        name: sender?.name ?? "Someone",
        avatar_url: sender?.avatar_url ?? null,
      },
    };
  });
}

async function fetchSentFriendRequests(userId: string) {
  const { data: pendingRows, error } = await supabase
    .from("friendships")
    .select("id,user_id_a,user_id_b,requested_by,created_at")
    .eq("status", "pending")
    .eq("requested_by", userId)
    .order("created_at", { ascending: false });

  if (error || !pendingRows?.length) return [];

  const targetIds = Array.from(
    new Set(
      pendingRows
        .map((row: any) => (row.user_id_a === userId ? row.user_id_b : row.user_id_a))
        .filter(Boolean)
    )
  ) as string[];

  let profileMap = new Map<string, { name: string | null; avatar_url: string | null }>();
  if (targetIds.length) {
    const { data: targetProfiles } = await supabase
      .from("profiles")
      .select("user_id,name,avatar_url")
      .in("user_id", targetIds);
    profileMap = new Map(
      (targetProfiles || []).map((p: any) => [
        p.user_id,
        {
          name: p.name ?? null,
          avatar_url: p.avatar_url ?? null,
        },
      ])
    );
  }

  return pendingRows.map((row: any) => {
    const targetId = row.user_id_a === userId ? row.user_id_b : row.user_id_a;
    const target = profileMap.get(targetId);
    return {
      id: row.id,
      target_id: targetId,
      created_at: row.created_at,
      profiles: {
        name: target?.name ?? "Someone",
        avatar_url: target?.avatar_url ?? null,
      },
    };
  });
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  
  // Raw Data
  const [friendReqs, setFriendReqs] = useState<any[]>([]);
  const [sentFriendReqs, setSentFriendReqs] = useState<any[]>([]);
  const [reconnectReqs, setReconnectReqs] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [polls, setPolls] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [groupEvents, setGroupEvents] = useState<any[]>([]);
  const [myRatingLog, setMyRatingLog] = useState<any[]>([]);
  const [myPublicId, setMyPublicId] = useState<string | null>(null);
  const [votes, setVotes] = useState<any[]>([]);
  const [ratings, setRatings] = useState<any[]>([]);
  const [reconnectRatings, setReconnectRatings] = useState<Record<string, { stars: number; nextAllowedAt: string | null; editUsed: boolean; busy?: boolean; err?: string }>>({});
  const [reconnectHover, setReconnectHover] = useState<Record<string, number | null>>({});

  // UI State
  const [selectedTab, setSelectedTab] = useState<"activity" | "calendar">("activity");
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarEntries, setCalendarEntries] = useState<CalendarEntry[]>([]);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showUpcoming, setShowUpcoming] = useState(true);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [confirmingActionIds, setConfirmingActionIds] = useState<string[]>([]);
  const [dismissedActionIds, setDismissedActionIds] = useState<string[]>([]);
  const dismissedActionStorageKey = user ? `circles.dismissedActionRequired.${user.id}` : null;

  useEffect(() => {
    if (!dismissedActionStorageKey) {
      setDismissedActionIds([]);
      return;
    }
    try {
      const raw = localStorage.getItem(dismissedActionStorageKey);
      if (!raw) {
        setDismissedActionIds([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setDismissedActionIds(parsed.filter((v) => typeof v === "string"));
      } else {
        setDismissedActionIds([]);
      }
    } catch {
      setDismissedActionIds([]);
    }
  }, [dismissedActionStorageKey]);

  useEffect(() => {
    if (!dismissedActionStorageKey) return;
    try {
      localStorage.setItem(dismissedActionStorageKey, JSON.stringify(dismissedActionIds.slice(-300)));
    } catch {
      // best effort persistence; skip on storage errors
    }
  }, [dismissedActionIds, dismissedActionStorageKey]);

  const dismissAction = useCallback((id: string) => {
    setDismissedActionIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const parseLocation = (location: string) => {
    const match = location.match(/^(.*?)(\s*\(([^)]+)\))?\s*$/);
    const label = match?.[1]?.trim() || location;
    const coords = match?.[3]?.trim() || null;
    return { label, coords };
  };

  const mapLinks = (location: string) => {
    const { coords, label } = parseLocation(location);
    const q = encodeURIComponent(coords || label);
    return {
      google: `https://www.google.com/maps/search/?api=1&query=${q}`,
      apple: `http://maps.apple.com/?q=${q}`,
    };
  };

  useEffect(() => {
    if (!user) return;

    const userId = user.id;

    async function loadData() {
      setLoading(true);
      const bail = setTimeout(() => setLoading(false), 8000); // ensure UI frees if a query hangs

      try {
        const [friendRequests, sentFriendRequests, invRes, myGroupsRes, annRes, reconnectRes, ratingsRes] = await Promise.all([
          fetchFriendRequests(userId),
          fetchSentFriendRequests(userId),
          supabase
            .from("group_members" as any)
            .select("group_id, created_at, groups(title)")
            .eq("user_id", userId)
            .eq("status", "invited")
            .order("created_at", { ascending: false }),
          supabase
            .from("group_members" as any)
            .select("group_id")
            .eq("user_id", userId)
            .in("status", ["active", "accepted"]),
          supabase
            .from("announcements")
            .select("id, title, description, datetime, location, group_id, created_at, created_by, scope_type, country, city, lat, lng, radius_km")
            .order("datetime", { ascending: true })
            .limit(5),
          supabase
            .from("reconnect_requests")
            .select("id, requester_id, target_id, message, status, created_at")
            .eq("target_id", userId)
            .eq("status", "pending")
            .order("created_at", { ascending: false }),
          supabase
            .from("rating_pairs")
            .select("rater_id, stars, created_at, updated_at")
            .eq("ratee_id", userId)
            .order("updated_at", { ascending: false })
            .limit(20)
        ]);

        const inv = invRes.data;
        const myGroups = myGroupsRes.data;

        let viewerCity: string | null = null;
        let viewerCoords: { lat: number; lng: number } | null = null;
        const profileRes = await supabase
          .from("profiles")
          .select("city, lat, lng, public_id")
          .eq("user_id", userId)
          .maybeSingle();
        if (!profileRes.error) {
          viewerCity = profileRes.data?.city || null;
          setMyPublicId(profileRes.data?.public_id ? String(profileRes.data.public_id) : null);
          if (typeof profileRes.data?.lat === "number" && typeof profileRes.data?.lng === "number") {
            viewerCoords = { lat: profileRes.data.lat, lng: profileRes.data.lng };
          }
        } else if (profileRes.error?.code === "42703") {
          const fallbackProfile = await supabase
            .from("profiles")
            .select("city, public_id")
            .eq("user_id", userId)
            .maybeSingle();
          if (!fallbackProfile.error) {
            viewerCity = fallbackProfile.data?.city || null;
            setMyPublicId(fallbackProfile.data?.public_id ? String(fallbackProfile.data.public_id) : null);
          }
        }

        const anns = (annRes.data || []).filter((a: any) =>
          isAnnouncementVisibleForViewer(a, {
            viewerId: userId,
            viewerEmail: user?.email ?? null,
            viewerCity,
            viewerCoords,
          })
        );
        const reconnectRaw = reconnectRes.data || [];
        const ratingsRaw = ratingsRes.data || [];
        const reqIds = Array.from(new Set(reconnectRaw.map((r: any) => r.requester_id).filter(Boolean)));

        const gIds = myGroups?.map((g: any) => g.group_id) || [];
        if (reconnectRaw.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, name, avatar_url, allow_ratings")
            .in("user_id", reqIds);
          const map = new Map<string, { name: string; avatar_url: string | null; allow_ratings?: boolean | null }>();
          (profs ?? []).forEach((p: any) =>
            map.set(p.user_id, { name: p.name, avatar_url: p.avatar_url, allow_ratings: p.allow_ratings })
          );
          const merged = reconnectRaw.map((r: any) => ({
            ...r,
            profiles: map.get(r.requester_id) || null
          }));
          setReconnectReqs(merged);
        } else {
          setReconnectReqs([]);
        }

        if (reqIds.length) {
          const { data: pairs } = await supabase
            .from("rating_pairs")
            .select("ratee_id, stars, next_allowed_at, edit_used")
            .eq("rater_id", userId)
            .in("ratee_id", reqIds);
          const ratingMap: Record<string, { stars: number; nextAllowedAt: string | null; editUsed: boolean }> = {};
          (pairs ?? []).forEach((p: any) => {
            if (!p?.ratee_id) return;
            ratingMap[p.ratee_id] = {
              stars: Number(p.stars ?? 0),
              nextAllowedAt: p.next_allowed_at ?? null,
              editUsed: Boolean(p.edit_used ?? false),
            };
          });
          setReconnectRatings(ratingMap);
        } else {
          setReconnectRatings({});
        }

        if (ratingsRaw.length) {
          const raterIds = Array.from(new Set(ratingsRaw.map((r: any) => r.rater_id).filter(Boolean)));
          const { data: profs } = await supabase
            .from("profiles")
            .select("user_id, name, avatar_url")
            .in("user_id", raterIds);
          const map = new Map<string, { name: string; avatar_url: string | null }>();
          (profs ?? []).forEach((p: any) => map.set(p.user_id, { name: p.name, avatar_url: p.avatar_url }));
          const merged = ratingsRaw.map((r: any) => ({
            ...r,
            profiles: map.get(r.rater_id) || null
          }));
          setRatings(merged);
        } else {
          setRatings([]);
        }

        let fetchedPolls: any[] = [];
        let fetchedMsgs: any[] = [];
        let fetchedGroupEvents: any[] = [];
        let fetchedMyRatings: any[] = [];

        if (gIds.length > 0) {
          const [pRes, mRes, eRes, myRRes] = await Promise.all([
            supabase
              .from("group_polls" as any)
              .select("id, title, group_id, created_at, groups(title)")
              .in("group_id", gIds)
              .eq("status", "open")
              .order("created_at", { ascending: false }),
            supabase
              .from("group_messages" as any)
              .select("id, group_id, sender_id, content, created_at, groups(title)")
              .in("group_id", gIds)
              .neq("sender_id", userId)
              .order("created_at", { ascending: false })
              .limit(120),
            supabase
              .from("group_events" as any)
              .select("id, group_id, title, starts_at, place, created_at, groups(title)")
              .in("group_id", gIds)
              .order("created_at", { ascending: false })
              .limit(160),
            supabase.rpc("get_my_group_event_ratings", { p_group_ids: gIds }),
          ]);

          fetchedPolls = pRes.data || [];
          fetchedMsgs = mRes.data || [];
          fetchedGroupEvents = eRes.data || [];
          if (myRRes.error) {
            console.warn("[notifications] get_my_group_event_ratings failed", myRRes.error.message);
            fetchedMyRatings = [];
          } else {
            fetchedMyRatings = myRRes.data || [];
          }
        }

        setFriendReqs(friendRequests || []);
        setSentFriendReqs(sentFriendRequests || []);
        setInvites(inv || []);
        setPolls(fetchedPolls);
        setMessages(fetchedMsgs);
        setGroupEvents(fetchedGroupEvents);
        setMyRatingLog(fetchedMyRatings);
        setVotes([]);
        setAnnouncements(anns);
      } catch (e) {
        console.error("Error loading notifications", e);
      } finally {
        clearTimeout(bail);
        setLoading(false);
      }
    }

    loadData();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const uid = user.id;
    const channel = supabase
      .channel(`friend-requests:${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, async (payload) => {
        const row: any = (payload as any).new || (payload as any).old;
        if (!row) return;
        if (row.user_id_a !== uid && row.user_id_b !== uid) return;
        const [nextReceived, nextSent] = await Promise.all([
          fetchFriendRequests(uid),
          fetchSentFriendRequests(uid),
        ]);
        setFriendReqs(nextReceived || []);
        setSentFriendReqs(nextSent || []);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const loadCalendar = useCallback(async () => {
    if (!user) return;
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      const { data: memberships, error: memberErr } = await supabase
        .from("group_members" as any)
        .select("group_id, status, groups(title)")
        .eq("user_id", user.id)
        .in("status", ["active", "accepted"]);
      if (memberErr) throw memberErr;

      const groupIds = (memberships || []).map((m: any) => m.group_id);
      const groupNames: Record<string, string> = {};
      (memberships || []).forEach((m: any) => {
        if (m?.group_id) groupNames[m.group_id] = m.groups?.title || "Group";
      });

      if (!groupIds.length) {
        setCalendarEntries([]);
        return;
      }

      const { data: pollsData, error: pollsErr } = await supabase
        .from("group_polls" as any)
        .select("id, group_id, title, status, created_at, closes_at, groups(title), group_poll_options(id, label, starts_at, place, created_at)")
        .in("group_id", groupIds)
        .order("created_at", { ascending: false })
        .limit(120);
      if (pollsErr) throw pollsErr;

      const pollIds = (pollsData || []).map((p: any) => p.id).filter(Boolean);
      let votesData: any[] = [];
      if (pollIds.length) {
        const { data: voteRows, error: voteErr } = await supabase
          .from("group_votes" as any)
          .select("poll_id, option_id, user_id")
          .in("poll_id", pollIds);
        if (voteErr) throw voteErr;
        votesData = voteRows || [];
      }

      const { data: eventsData, error: eventErr } = await supabase
        .from("group_events" as any)
        .select("id, group_id, poll_id, option_id, title, starts_at, place, created_at, groups(title)")
        .in("group_id", groupIds)
        .order("starts_at", { ascending: true });
      if (eventErr) throw eventErr;

      const votesByOption: Record<string, number> = {};
      const participantsByPoll: Record<string, Set<string>> = {};
      votesData.forEach((v: any) => {
        if (!v?.poll_id || !v?.option_id || !v?.user_id) return;
        votesByOption[v.option_id] = (votesByOption[v.option_id] || 0) + 1;
        if (!participantsByPoll[v.poll_id]) participantsByPoll[v.poll_id] = new Set<string>();
        participantsByPoll[v.poll_id].add(v.user_id);
      });

      const eventByPoll = new Map<string, any>();
      (eventsData || []).forEach((ev: any) => {
        if (ev?.poll_id) eventByPoll.set(ev.poll_id, ev);
      });

      const items: CalendarEntry[] = [];

      (pollsData || []).forEach((poll: any) => {
        const participants = participantsByPoll[poll.id]?.size ?? 0;
        const pollEvent = eventByPoll.get(poll.id);
        const selectedOption = pollEvent?.option_id || null;

        (poll.group_poll_options || []).forEach((opt: any) => {
          if (!opt?.starts_at) return;
          if (pollEvent && selectedOption && opt.id !== selectedOption) return; // only keep winning slot once confirmed
          const votes = votesByOption[opt.id] ?? 0;
          items.push({
            id: `${poll.id}-${opt.id}`,
            groupId: poll.group_id,
            groupTitle: poll.groups?.title || groupNames[poll.group_id] || "Group",
            title: poll.title || opt.label,
            startsAt: opt.starts_at,
            phase: pollEvent && selectedOption === opt.id ? "confirmed" : "planned",
            pollId: poll.id,
            optionId: opt.id,
            participants,
            votes
          });
        });
      });

      (eventsData || []).forEach((ev: any) => {
        if (!ev?.starts_at) return;
        if (ev.poll_id && items.some((i) => i.pollId === ev.poll_id)) return;
        items.push({
          id: `event-${ev.id}`,
          groupId: ev.group_id,
          groupTitle: ev.groups?.title || groupNames[ev.group_id] || "Group",
          title: ev.title || "Group Event",
          startsAt: ev.starts_at,
          phase: "confirmed",
          pollId: ev.poll_id || undefined,
          optionId: ev.option_id || undefined,
          participants: ev.poll_id && participantsByPoll[ev.poll_id] ? participantsByPoll[ev.poll_id].size : 0,
          votes: ev.option_id ? votesByOption[ev.option_id] ?? 0 : 0
        });
      });

      items.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
      setCalendarEntries(items);
    } catch (e: any) {
      console.error("Failed to load calendar", e);
      setCalendarError(e.message || "Calendar could not be loaded");
    } finally {
      setCalendarLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (selectedTab !== "calendar") return;
    const today = new Date();
    setSelectedDate(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`);
    if (!calendarEntries.length) loadCalendar();
  }, [selectedTab, calendarEntries.length, loadCalendar]);

  const pad = (n: number) => String(n).padStart(2, "0");
  const keyFromDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const keyFromISO = (iso: string) => keyFromDate(new Date(iso));

  // --- Process Data (4 strict activity types + sectioning) ---

  const processedActivity = useMemo(() => {
    const drafts: ActivityDraft[] = [];
    const nowTs = Date.now();
    const maxAgeMs = 21 * 24 * 60 * 60 * 1000;

    const uniquePolls = new Map<string, any>();
    (polls || []).forEach((p: any) => {
      if (!p?.id || uniquePolls.has(p.id)) return;
      uniquePolls.set(p.id, p);
    });
    Array.from(uniquePolls.values()).forEach((p: any) => {
      const createdTs = new Date(p.created_at).getTime();
      if (!Number.isFinite(createdTs)) return;
      if (nowTs - createdTs > maxAgeMs) return;
      drafts.push({
        id: `poll-${p.id}`,
        type: "poll_created",
        createdAt: p.created_at,
        groupId: p.group_id || "",
        groupTitle: p.groups?.title || "Circle",
        text: p.title || null,
      });
    });

    (groupEvents || []).forEach((ev: any) => {
      const createdTs = new Date(ev.created_at || ev.starts_at).getTime();
      if (!Number.isFinite(createdTs)) return;
      if (nowTs - createdTs > maxAgeMs) return;
      drafts.push({
        id: `meetup-${ev.id}`,
        type: "meetup_scheduled",
        createdAt: ev.created_at || ev.starts_at,
        groupId: ev.group_id || "",
        groupTitle: ev.groups?.title || "Circle",
        startsAt: ev.starts_at || null,
        place: ev.place || null,
        text: ev.title || null,
      });
    });

    const mentionRegex = buildMentionRegex(user?.user_metadata?.name || null, user?.email || null, myPublicId);
    const allRegex = /(^|\s)@all(\b|$)/i;
    (messages || []).forEach((m: any) => {
      const content = String(m?.content || "");
      const mentionedDirectly = mentionRegex ? mentionRegex.test(content) : false;
      const mentionedByAll = allRegex.test(content);
      if (!mentionedDirectly && !mentionedByAll) return;
      const createdTs = new Date(m.created_at).getTime();
      if (!Number.isFinite(createdTs)) return;
      if (nowTs - createdTs > maxAgeMs) return;
      drafts.push({
        id: `mention-${m.id || `${m.group_id}-${m.created_at}`}`,
        type: "mention",
        createdAt: m.created_at,
        groupId: m.group_id || "",
        groupTitle: m.groups?.title || "Circle",
        text: content,
      });
    });

    const latestPastMeetup = (groupEvents || [])
      .filter((ev: any) => !!ev?.starts_at)
      .filter((ev: any) => {
        const ts = new Date(ev.starts_at).getTime();
        return Number.isFinite(ts) && ts < nowTs && nowTs - ts <= 14 * 24 * 60 * 60 * 1000;
      })
      .sort((a: any, b: any) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())[0];

    const ratedEventIds = new Set(
      (myRatingLog || [])
        .map((r: any) => String(r?.event_id || ""))
        .filter(Boolean)
    );

    if (latestPastMeetup) {
      if (!ratedEventIds.has(String(latestPastMeetup.id))) {
        drafts.push({
          id: `rating-needed-${latestPastMeetup.id}`,
          type: "rating_needed",
          createdAt: latestPastMeetup.created_at || latestPastMeetup.starts_at,
          groupId: latestPastMeetup.group_id || "",
          groupTitle: latestPastMeetup.groups?.title || "Circle",
          startsAt: latestPastMeetup.starts_at,
          place: latestPastMeetup.place || null,
          eventId: latestPastMeetup.id,
        });
      }
    }

    const items = drafts
      .map(formatActivityEntry)
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    const seen = new Set<string>();
    const deduped = items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    const actionRequired = deduped.filter((e) =>
      e.type === "poll_created" ||
      e.type === "rating_needed" ||
      (e.type === "meetup_scheduled" && e.actionLabel === "Confirm")
    );
    const updates = deduped.filter((e) => !actionRequired.some((a) => a.id === e.id));

    return { actionRequired, updates };
  }, [polls, groupEvents, messages, myRatingLog, myPublicId, user?.email, user?.user_metadata?.name]);
  const upcomingEntries = useMemo(() => {
    const now = Date.now();
    return calendarEntries
      .filter((c) => new Date(c.startsAt).getTime() >= now)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [calendarEntries]);

  const pastEntries = useMemo(() => {
    const now = Date.now();
    return calendarEntries
      .filter((c) => new Date(c.startsAt).getTime() < now)
      .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  }, [calendarEntries]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {};
    calendarEntries.forEach((c) => {
      const key = keyFromDate(new Date(c.startsAt));
      if (!map[key]) map[key] = [];
      map[key].push(c);
    });
    Object.values(map).forEach((list) => list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()));
    return map;
  }, [calendarEntries]);

  const monthDays = useMemo(() => {
    const first = new Date(calendarMonth);
    const startOffset = (first.getDay() + 6) % 7; // Monday as first day
    const start = new Date(first);
    start.setDate(1 - startOffset);
    const days: { date: Date; key: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push({ date: d, key: keyFromDate(d), inMonth: d.getMonth() === first.getMonth() });
    }
    return days;
  }, [calendarMonth]);

  const selectedDayEvents = useMemo(() => {
    if (!selectedDate) return [];
    return eventsByDay[selectedDate] || [];
  }, [eventsByDay, selectedDate]);
  const selectedDateLabel = useMemo(() => {
    if (!selectedDate) return null;
    const d = new Date(`${selectedDate}T12:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
    const day = d.toLocaleDateString(undefined, { day: "numeric" });
    const month = d.toLocaleDateString(undefined, { month: "short" });
    return `${weekday}, ${day} ${month}`;
  }, [selectedDate]);

  const todayKey = keyFromDate(new Date());
  const monthLabel = calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const weekdayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

  const changeMonth = (delta: number) => {
    setCalendarMonth((prev) => {
      const next = new Date(prev);
      next.setMonth(prev.getMonth() + delta);
      next.setDate(1);
      next.setHours(0, 0, 0, 0);
      return next;
    });
  };

  const resetToCurrentMonth = () => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    setCalendarMonth(first);
    setSelectedDate(keyFromDate(now));
  };

  const visibleUpcoming = useMemo(() => {
    if (!selectedDate) return upcomingEntries;
    return upcomingEntries.filter((e) => keyFromISO(e.startsAt) !== selectedDate);
  }, [upcomingEntries, selectedDate]);

  const friendRequestActions = useMemo(() => {
    return (friendReqs || [])
      .map((r: any) => ({
        id: `friend-${r.id || r.user_id_a}`,
        requestId: r.id as string,
        fromId: r.user_id_a as string,
        fromName: titleCaseWords(cleanActivityText(r.profiles?.name || "Someone", 40) || "Someone"),
        fromAvatar: r.profiles?.avatar_url || null,
        date: new Date(r.created_at || Date.now()),
      }))
      .filter((r) => !!r.fromId && Number.isFinite(r.date.getTime()))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [friendReqs]);

  const sentFriendRequestActions = useMemo(() => {
    return (sentFriendReqs || [])
      .map((r: any) => ({
        id: `friend-sent-${r.id || r.target_id}`,
        requestId: r.id as string,
        targetId: r.target_id as string,
        targetName: titleCaseWords(cleanActivityText(r.profiles?.name || "Someone", 40) || "Someone"),
        targetAvatar: r.profiles?.avatar_url || null,
        date: new Date(r.created_at || Date.now()),
      }))
      .filter((r) => !!r.targetId && Number.isFinite(r.date.getTime()))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [sentFriendReqs]);

  const inviteActions = useMemo(() => {
    return (invites || [])
      .map((i: any) => ({
        id: `invite-${i.group_id}`,
        date: new Date(i.created_at),
        groupId: i.group_id as string,
        groupTitle: titleCaseWords(cleanActivityText(i.groups?.title || "Circle", 42) || "Circle") || "Circle",
      }))
      .filter((i) => !!i.groupId && Number.isFinite(i.date.getTime()))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [invites]);

  const actionRequiredRows = useMemo(() => {
    const friendRows = friendRequestActions.map((friend) => ({
      kind: "friend" as const,
      id: friend.id,
      date: friend.date,
      friend,
    }));
    const inviteRows = inviteActions.map((inv) => ({
      kind: "invite" as const,
      id: inv.id,
      date: inv.date,
      invite: inv,
    }));
    const sentFriendRows = sentFriendRequestActions.map((friend) => ({
      kind: "friend_sent" as const,
      id: friend.id,
      date: friend.date,
      friend,
    }));
    const eventRows = processedActivity.actionRequired
      .filter((ev) => !dismissedActionIds.includes(ev.id) || confirmingActionIds.includes(ev.id))
      .map((ev) => ({
      kind: "event" as const,
      id: ev.id,
      date: ev.date,
      event: ev,
      }));
    return [...friendRows, ...sentFriendRows, ...inviteRows, ...eventRows].sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [friendRequestActions, sentFriendRequestActions, inviteActions, processedActivity.actionRequired, dismissedActionIds, confirmingActionIds]);

  const updateRows = useMemo(() => {
    const eventRows = processedActivity.updates.map((ev) => ({
      kind: "event" as const,
      id: ev.id,
      date: ev.date,
      event: ev,
    }));
    const announcementRows = (announcements || []).map((a: any) => ({
      kind: "announcement" as const,
      id: `announcement-${a.id}`,
      date: new Date(a.datetime),
      announcement: a,
    }));
    return [...eventRows, ...announcementRows]
      .filter((row) => Number.isFinite(row.date.getTime()))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [processedActivity.updates, announcements]);

  function timeUntil(startIso: string) {
    const now = Date.now();
    const t = new Date(startIso).getTime();
    const diff = t - now;
    if (diff <= 0) return "Starts now";
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours < 24) return `in ${hours}h ${remMins}m`;
    const days = Math.floor(hours / 24);
    const remH = hours % 24;
    return `in ${days}d ${remH}h`;
  }

  function formatUpcomingSlot(startIso: string): string {
    const d = new Date(startIso);
    if (Number.isNaN(d.getTime())) return "Time TBD";
    const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    return `${weekday} · ${time}`;
  }

  // --- Handlers ---

  async function handleAcceptFriend(id: string, fromId: string) {
    if (!user) return;
    const { error } = await supabase.rpc("accept_friend", { from_id: fromId });
    if (error) {
      console.error("Failed to accept friend request", error);
      return;
    }
    setFriendReqs(prev => prev.filter(r => r.id !== id && r.user_id_a !== fromId));
    try {
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("kind", "friend_request")
        .eq("payload->>from_id", fromId)
        .eq("is_read", false);
    } catch {
      // best effort; friendship state is already updated
    }
  }

  async function handleDeclineFriend(id: string, fromId: string) {
    const { error } = await supabase.rpc("remove_friend", { other_id: fromId });
    if (error) {
      console.error("Failed to decline friend request", error);
      return;
    }
    setFriendReqs(prev => prev.filter(r => r.id !== id && r.user_id_a !== fromId));
  }

  async function handleCancelSentFriend(id: string, targetId: string) {
    const { error } = await supabase.rpc("remove_friend", { other_id: targetId });
    if (error) {
      console.error("Failed to cancel sent friend request", error);
      return;
    }
    setSentFriendReqs((prev) => prev.filter((r) => r.id !== id && r.target_id !== targetId));
  }

  async function handleAcceptReconnect(req: any) {
    if (!user) return;
    await supabase
      .from("reconnect_requests")
      .update({ status: "accepted" })
      .eq("id", req.id);
    await supabase.rpc("remove_friend", { other_id: req.requester_id });
    setReconnectReqs(prev => prev.filter(r => r.id !== req.id));
  }

  async function handleDeclineReconnect(req: any) {
    await supabase
      .from("reconnect_requests")
      .update({ status: "declined" })
      .eq("id", req.id);
    setReconnectReqs(prev => prev.filter(r => r.id !== req.id));
  }

  async function handleJoinGroup(gid: string) {
    if (!user) return;

    const { error } = await supabase
      .from("group_members" as any)
      .update({ status: "accepted" })
      .eq("group_id", gid)
      .eq("user_id", user.id);

    if (error) {
      console.error("Failed to join group from notifications", error);
      return;
    }

    setInvites(prev => prev.filter(i => i.group_id !== gid));
    navigate(`/group/${gid}`);
  }

  function openProfileView(otherId?: string | null) {
    if (!otherId) return;
    navigate(`/users/${otherId}`, {
      state: { from: `${location.pathname}${location.search}${location.hash}` },
    });
  }

  function updateReconnectRating(
    targetId: string,
    patch: Partial<{ stars: number; nextAllowedAt: string | null; editUsed: boolean; busy?: boolean; err?: string }>
  ) {
    setReconnectRatings(prev => {
      const current = prev[targetId] || { stars: 0, nextAllowedAt: null, editUsed: false };
      return { ...prev, [targetId]: { ...current, ...patch } };
    });
  }

  async function rateReconnectUser(targetId: string, stars: number) {
    if (!user) return;
    updateReconnectRating(targetId, { busy: true, err: undefined });
    try {
      const { error } = await supabase.rpc("submit_rating", { p_ratee: targetId, p_stars: stars });
      if (error) throw error;
      const { data: pair } = await supabase
        .from("rating_pairs")
        .select("stars, next_allowed_at, edit_used")
        .eq("rater_id", user.id)
        .eq("ratee_id", targetId)
        .maybeSingle();
      updateReconnectRating(targetId, {
        stars: Number(pair?.stars ?? stars),
        nextAllowedAt: pair?.next_allowed_at ?? null,
        editUsed: Boolean(pair?.edit_used ?? false),
        busy: false,
        err: undefined,
      });
    } catch (e: any) {
      const msg = String(e?.message || "");
      let errMsg = "Rating failed.";
      if (/rate_cooldown_active/i.test(msg)) errMsg = "Cooldown active. Try again later.";
      else if (/ratings_disabled/i.test(msg)) errMsg = "Ratings are disabled for this user.";
      else if (/not_authenticated/i.test(msg)) errMsg = "Please sign in to rate.";
      else if (/invalid_stars/i.test(msg)) errMsg = "Rating must be between 1 and 6.";
      updateReconnectRating(targetId, { busy: false, err: errMsg });
    }
  }

  // --- Render Helpers ---

  const renderEvent = (e: ActivityEntry, options?: { showAction?: boolean; dismissOnAction?: boolean }) => {
    const showAction = options?.showAction ?? false;
    const dismissOnAction = options?.dismissOnAction ?? false;
    const isMeetupConfirmCard = showAction && e.type === "meetup_scheduled" && e.actionLabel === "Confirm";
    const isConfirming = confirmingActionIds.includes(e.id);
    const timeLabel = formatActivityDateTime(e.date.toISOString());
    const startsInLabel = e.startsAt ? `Starts ${timeUntil(e.startsAt)}` : null;

    const handleActionClick = () => {
      if (e.actionLabel === "Confirm") {
        if (isConfirming) return;
        setConfirmingActionIds((prev) => (prev.includes(e.id) ? prev : [...prev, e.id]));
        // Persist dismissal immediately so it won't reappear after route change/reload.
        dismissAction(e.id);
        setTimeout(() => {
          setConfirmingActionIds((prev) => prev.filter((id) => id !== e.id));
        }, 260);
        return;
      }
      if (dismissOnAction) dismissAction(e.id);
      navigate(e.actionTo);
    };

    return (
      <div
        key={e.id}
        className={`flex items-start gap-3 rounded-2xl border border-neutral-100 bg-white p-3 shadow-sm animate-in fade-in slide-in-from-bottom-2 transition-all duration-200 ${
          isConfirming
            ? "pointer-events-none -translate-y-2 opacity-0"
            : "hover:-translate-y-0.5 hover:shadow-md"
        }`}
      >
        <div className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center ${
          e.type === "meetup_scheduled" ? "bg-emerald-100 text-emerald-600" :
          e.type === "poll_created" ? "bg-indigo-100 text-indigo-600" :
          e.type === "mention" ? "bg-sky-100 text-sky-600" :
          "bg-amber-100 text-amber-600"
        }`}>
          {e.type === "meetup_scheduled" && <Calendar className="h-5 w-5" />}
          {e.type === "poll_created" && <CheckSquare className="h-5 w-5" />}
          {e.type === "mention" && <MessageCircle className="h-5 w-5" />}
          {e.type === "rating_needed" && <Star className="h-5 w-5" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-neutral-900">{e.title}</div>
          <div className="mt-0.5 text-xs text-neutral-600">{e.description}</div>
          {isMeetupConfirmCard ? (
            <div className="mt-1 text-[10px] text-neutral-400">{startsInLabel || "Starts soon"}</div>
          ) : (
            <div className="mt-1 text-[10px] text-neutral-400">{timeLabel}</div>
          )}
        </div>

        {showAction && e.actionLabel && (
          <button
            type="button"
            onClick={handleActionClick}
            disabled={isConfirming}
            className={`shrink-0 rounded-full px-3.5 py-2 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-70 ${
              e.type === "poll_created"
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : e.type === "rating_needed"
                  ? "bg-amber-500 text-white hover:bg-amber-600"
                  : e.type === "meetup_scheduled" && e.actionLabel === "Confirm"
                    ? "self-center inline-flex items-center gap-1 bg-emerald-600 text-white hover:bg-emerald-700"
                    : "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100"
            }`}
          >
            {e.actionLabel === "Confirm" ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Confirm
              </>
            ) : (
              e.actionLabel
            )}
          </button>
        )}
      </div>
    );
  };

  const renderCalendarEntry = (entry: CalendarEntry, nowMs: number) => {
    const date = new Date(entry.startsAt);
    const isPast = date.getTime() < nowMs;
    const colorBar = entry.phase === "confirmed" ? "bg-emerald-500" : "bg-sky-500";
    const badgeClass =
      entry.phase === "confirmed"
        ? "border-emerald-100 bg-emerald-50 text-emerald-700"
        : "border-sky-100 bg-sky-50 text-sky-700";

    return (
      <div
        key={entry.id}
        onClick={() => navigate(`/group/${entry.groupId}`)}
        className="relative overflow-hidden rounded-2xl border border-neutral-100 bg-white/95 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg cursor-pointer"
      >
        <div className={`absolute inset-y-0 left-0 w-1 ${colorBar}`} />
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{entry.groupTitle}</div>
            <div className="text-base font-bold text-neutral-900">{entry.title}</div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
              <Calendar className="h-4 w-4" />
              <span>{date.toLocaleDateString()} • {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              {isPast && (
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-500">
                  Past
                </span>
              )}
            </div>
            <div className="flex gap-4 text-[12px] text-neutral-600">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> {entry.participants} Teilnahme{entry.participants === 1 ? "" : "n"}
              </span>
              <span className="flex items-center gap-1">
                <CheckSquare className="h-3.5 w-3.5" /> {entry.votes} Stimme{entry.votes === 1 ? "" : "n"}
              </span>
            </div>
          </div>
          <span className={`flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-bold ${badgeClass}`}>
            {entry.phase === "confirmed" ? "Confirmed" : "Poll open"}
          </span>
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className="pt-24 text-center text-neutral-400 text-sm">Checking for updates...</div>;
  }

  const hasActivityItems =
    processedActivity.actionRequired.length > 0 ||
    friendRequestActions.length > 0 ||
    sentFriendRequestActions.length > 0 ||
    inviteActions.length > 0 ||
    processedActivity.updates.length > 0 ||
    announcements.length > 0;

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 pb-32">
      <div className="mb-3">
        <h1 className="text-2xl font-extrabold text-neutral-900">Activity</h1>
      </div>

      <div className="mb-8 inline-flex rounded-full border border-neutral-200 bg-neutral-100/90 p-1 shadow-inner">
        <button
          type="button"
          onClick={() => setSelectedTab("activity")}
          className={`rounded-full px-4 py-1.5 text-sm transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-1 ${
            selectedTab === "activity"
              ? "bg-white font-semibold text-neutral-900 shadow-sm"
              : "font-medium text-neutral-500 hover:text-neutral-700"
          }`}
        >
          Activity
        </button>
        <button
          type="button"
          onClick={() => setSelectedTab("calendar")}
          className={`rounded-full px-4 py-1.5 text-sm transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-1 ${
            selectedTab === "calendar"
              ? "bg-white font-semibold text-neutral-900 shadow-sm"
              : "font-medium text-neutral-500 hover:text-neutral-700"
          }`}
        >
          Calendar
        </button>
      </div>

      {selectedTab === "activity" && (
        <>
          {!hasActivityItems && (
            <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-6 text-center text-sm text-neutral-600">
              You’re all caught up.
            </div>
          )}

          {hasActivityItems && (
            <div className="space-y-10">
              <section>
                <h2 className="mb-4 text-sm font-semibold text-neutral-700">Action Required</h2>
                <div className="space-y-3">
                  {actionRequiredRows.map((row) =>
                    row.kind === "friend" ? (
                      <div key={row.id} className="flex items-start gap-3 rounded-2xl border border-neutral-100 bg-white p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                        <button
                          type="button"
                          onClick={() => openProfileView(row.friend.fromId)}
                          className="relative h-10 w-10 shrink-0 rounded-full ring-1 ring-neutral-200 overflow-hidden"
                        >
                          <img
                            src={getAvatarUrl(row.friend.fromAvatar, row.friend.fromId)}
                            alt={row.friend.fromName}
                            className="h-full w-full object-cover"
                          />
                          <span className="absolute -bottom-1 -right-1 rounded-full bg-emerald-600 p-1 text-white">
                            <UserPlus className="h-2.5 w-2.5" />
                          </span>
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-neutral-900">{row.friend.fromName} sent a friend request</div>
                          <div className="mt-0.5 text-xs text-neutral-600">Accept to start direct messaging and see them in chats.</div>
                          <div className="mt-1 text-[10px] text-neutral-400">{formatActivityDateTime(row.date.toISOString())}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDeclineFriend(row.friend.requestId, row.friend.fromId)}
                            className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-[11px] font-bold text-neutral-700 hover:bg-neutral-100"
                          >
                            Decline
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAcceptFriend(row.friend.requestId, row.friend.fromId)}
                            className="rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700"
                          >
                            Accept
                          </button>
                        </div>
                      </div>
                    ) : row.kind === "friend_sent" ? (
                      <div key={row.id} className="flex items-start gap-3 rounded-2xl border border-neutral-100 bg-white p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                        <button
                          type="button"
                          onClick={() => openProfileView(row.friend.targetId)}
                          className="relative h-10 w-10 shrink-0 rounded-full ring-1 ring-neutral-200 overflow-hidden"
                        >
                          <img
                            src={getAvatarUrl(row.friend.targetAvatar, row.friend.targetId)}
                            alt={row.friend.targetName}
                            className="h-full w-full object-cover"
                          />
                          <span className="absolute -bottom-1 -right-1 rounded-full bg-amber-500 p-1 text-white">
                            <UserPlus className="h-2.5 w-2.5" />
                          </span>
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-neutral-900">Friend request sent to {row.friend.targetName}</div>
                          <div className="mt-0.5 text-xs text-neutral-600">Waiting for response. You can cancel this request anytime.</div>
                          <div className="mt-1 text-[10px] text-neutral-400">{formatActivityDateTime(row.date.toISOString())}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCancelSentFriend(row.friend.requestId, row.friend.targetId)}
                          className="shrink-0 rounded-full border border-red-200 bg-white px-3 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : row.kind === "invite" ? (
                      <div key={row.id} className="flex items-start gap-3 rounded-2xl border border-neutral-100 bg-white p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                          <Mail className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-neutral-900">Respond to invite in {row.invite.groupTitle}</div>
                          <div className="mt-0.5 text-xs text-neutral-600">You were invited to join this circle.</div>
                          <div className="mt-1 text-[10px] text-neutral-400">{formatActivityDateTime(row.date.toISOString())}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleJoinGroup(row.invite.groupId)}
                          className="shrink-0 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-[11px] font-bold text-neutral-800 hover:bg-neutral-100"
                        >
                          Respond
                        </button>
                      </div>
                    ) : (
                      renderEvent(row.event, { showAction: true, dismissOnAction: true })
                    )
                  )}

                  {actionRequiredRows.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
                      Nothing pending.
                    </div>
                  )}
                </div>
              </section>

              <section>
                <h2 className="mb-4 text-sm font-semibold text-neutral-700">Updates</h2>
                <div className="space-y-3">
                  {updateRows.map((row) => {
                    if (row.kind === "event") return renderEvent(row.event, { showAction: row.event.type === "mention", dismissOnAction: false });
                    const a = row.announcement;
                    const detailPath = a.group_id ? `/group/${a.group_id}` : `/announcements#${a.id}`;
                    return (
                      <div key={row.id} className="flex items-start gap-3 rounded-2xl border border-neutral-100 bg-white p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                          <Megaphone className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-neutral-900">Announcement posted</div>
                          <div className="mt-0.5 line-clamp-2 text-xs text-neutral-600">{cleanActivityText(a.title || a.description || "Circles update", 120)}</div>
                          <div className="mt-1 text-[10px] text-neutral-400">{formatActivityDateTime(row.date.toISOString())}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => navigate(detailPath)}
                          className="shrink-0 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-[11px] font-bold text-neutral-800 hover:bg-neutral-100"
                        >
                          View
                        </button>
                      </div>
                    );
                  })}

                  {updateRows.length === 0 && (
                    <div className="flex min-h-[120px] flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-4 text-center">
                      <CheckCircle2 className="mb-2 h-5 w-5 text-emerald-600" />
                      <p className="text-sm font-medium text-neutral-700">You’re all caught up.</p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </>
      )}

      {selectedTab === "calendar" && (
        <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm md:p-6">
          <div className="mb-4">
            <div className="text-lg font-bold text-neutral-900">Calendar</div>
            <p className="text-sm text-neutral-500">Month view, upcoming plans, and past meetups.</p>
          </div>

          {calendarError && (
            <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {calendarError}
            </div>
          )}

          {calendarLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-neutral-500">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-700" />
              Loading calendar...
            </div>
          ) : !calendarEntries.length ? (
            <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-6 text-center text-sm text-neutral-600">
              No events scheduled yet.
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                <div className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => changeMonth(-1)}
                        className="rounded-full border border-neutral-200 bg-neutral-50 p-2 text-neutral-500 transition hover:bg-white hover:text-neutral-700"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <div className="text-xl font-extrabold tracking-tight text-neutral-900">{monthLabel}</div>
                      <button
                        onClick={() => changeMonth(1)}
                        className="rounded-full border border-neutral-200 bg-neutral-50 p-2 text-neutral-500 transition hover:bg-white hover:text-neutral-700"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                    <button
                      onClick={resetToCurrentMonth}
                      className="rounded-full border border-neutral-200 bg-transparent px-3 py-1 text-xs font-semibold text-neutral-600 transition hover:bg-white"
                    >
                      Today
                    </button>
                  </div>

                  <div className="mb-3 grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    {weekdayLabels.map((w) => (
                      <div key={w} className="py-1">{w}</div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-2">
                    {monthDays.map(({ date, key, inMonth }) => {
                      const dayEvents = eventsByDay[key] || [];
                      const isToday = key === todayKey;
                      const isSelected = selectedDate === key;
                      const hasPlanned = dayEvents.some((ev) => ev.phase === "planned");
                      const hasConfirmed = dayEvents.some((ev) => ev.phase === "confirmed");

                      return (
                        <button
                          key={key}
                          onClick={() => setSelectedDate(key)}
                          className={`min-h-[88px] rounded-xl border bg-white p-2 text-center transition-all duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${
                            inMonth ? "border-neutral-200" : "border-neutral-100 text-neutral-400"
                          } ${isSelected ? "scale-[1.02] border-emerald-500 bg-emerald-50/70 shadow-sm" : "hover:scale-[1.01] hover:border-neutral-300"} ${isToday ? "shadow-[inset_0_0_0_1px_rgba(16,185,129,0.18)]" : ""}`}
                        >
                          <div className="flex h-full flex-col items-center justify-between">
                            <div className="flex flex-col items-center">
                              <span className={`text-sm font-semibold ${inMonth ? "text-neutral-900" : "text-neutral-400"}`}>{date.getDate()}</span>
                              {isToday && <span className="mt-0.5 text-[10px] font-semibold text-emerald-500">Today</span>}
                            </div>
                            {dayEvents.length > 0 ? (
                              <div className="mt-2 flex items-center justify-center gap-1.5">
                                {hasPlanned && <span className="h-2 w-2 rounded-full bg-sky-500" />}
                                {hasConfirmed && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
                              </div>
                            ) : (
                              <span className="h-2" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 flex items-center justify-center gap-4 text-[10px] font-medium text-neutral-500">
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" /> Poll open</span>
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Confirmed</span>
                  </div>
                </div>

                <div className="flex flex-col gap-6">
                  <div className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4">
                    <div className="mb-3">
                      <div className="text-base font-bold text-neutral-900">{selectedDateLabel || "Select a date"}</div>
                      <p className="text-xs text-neutral-500">
                        {selectedDate
                          ? selectedDayEvents.length === 0
                            ? "No events scheduled"
                            : `${selectedDayEvents.length} event${selectedDayEvents.length === 1 ? "" : "s"} scheduled`
                          : "Select a date to view events and actions."}
                      </p>
                    </div>
                    <div className="space-y-3">
                      {selectedDayEvents.length
                        ? selectedDayEvents.map((entry) => renderCalendarEntry(entry, Date.now()))
                        : <p className="text-sm text-neutral-500">Select a date to view events and actions.</p>}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-neutral-800">Upcoming</h3>
                    <div className="ml-4 flex items-center gap-3">
                      <button
                        onClick={() => setShowUpcoming((v) => !v)}
                        className="rounded-full px-2 py-0.5 text-xs font-semibold text-neutral-500 hover:bg-white hover:text-neutral-800"
                      >
                        {showUpcoming ? "Hide" : "Show"}
                      </button>
                      <button
                        onClick={loadCalendar}
                        className="rounded-full px-2 py-0.5 text-xs font-semibold text-neutral-500 hover:bg-white hover:text-neutral-800"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>
                    {showUpcoming && (
                      <div className="space-y-2 max-h-[360px] overflow-auto pr-1">
                        {visibleUpcoming.length
                          ? visibleUpcoming.map((entry) => (
                              <div
                                key={`up-${entry.id}`}
                                onClick={() => navigate(`/group/${entry.groupId}`)}
                                className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-sm text-neutral-800 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-sm"
                              >
                                <div className="flex items-start gap-2">
                                  <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                                  <div className="min-w-0">
                                    <div className="truncate font-bold text-neutral-900">{titleCaseWords(entry.groupTitle)}</div>
                                    <div className="mt-0.5 text-[11px] text-neutral-600">{formatUpcomingSlot(entry.startsAt)}</div>
                                    <div className="mt-0.5 text-[10px] text-neutral-400">{timeUntil(entry.startsAt)}</div>
                                  </div>
                                </div>
                              </div>
                            ))
                          : <p className="text-sm text-neutral-500">No events scheduled yet.</p>}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-neutral-800">Past</h3>
                      <span className="text-xs font-semibold text-neutral-500">{pastEntries.length}</span>
                    </div>
                    <div className="space-y-2 max-h-[240px] overflow-auto pr-1">
                      {pastEntries.length
                        ? pastEntries.slice(0, 12).map((entry) => renderCalendarEntry(entry, Date.now()))
                        : <p className="text-sm text-neutral-500">No events scheduled yet.</p>}
                    </div>
                  </div>
                </div>
              </div>
          )}
        </section>
      )}
    </div>
  );
}
