import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Compass,
  Copy,
  Ellipsis,
  MapPin,
  MessageCircle,
  Pencil,
  Star,
  Users,
  UserPlus,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/App";
import { useProfile } from "@/hooks/useProfile";
import { getAvatarUrl } from "@/lib/avatar";

type CircleCard = {
  id: string;
  title: string;
  city: string | null;
  game: string | null;
  startsAt: string | null;
  place: string | null;
  members: number;
  avatars: string[];
  goingCount: number;
  goingAvatars: string[];
  canVoteNow: boolean;
  hasVoted: boolean;
  statusLabel: string | null;
};

type MeetupCard = {
  groupId: string;
  groupTitle: string;
  eventTitle: string | null;
  startsAt: string | null;
  place: string | null;
  attending: number;
  avatars: string[];
};

type RecentMeetup = {
  id: string;
  groupId: string;
  groupTitle: string;
  startsAt: string;
  place: string | null;
};

type ActivityType = "poll_created" | "meetup_created" | "mention" | "rating_needed";

type ActivityItem = {
  id: string;
  groupId: string;
  type: ActivityType;
  groupTitle: string;
  actorAvatar: string | null;
  actorSeed: string;
  title: string;
  description: string;
  at: string;
  actionLabel: "Vote" | "View" | "Open chat" | "Rate";
  actionTo: string;
};

type PublicProfile = {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
};

type FirstStep = {
  label: string;
  sub: string;
  primary: string;
  to: string;
  secondary?: string;
  secondaryTo?: string;
  optional?: boolean;
  icon: any;
};

const FIRST_STEPS: FirstStep[] = [
  {
    label: "Find or create a Circle",
    sub: "Join something nearby or start your own",
    primary: "Find nearby circles",
    to: "/browse",
    secondary: "Start a circle",
    secondaryTo: "/create",
    icon: Compass,
  },
  {
    label: "Set your city & availability",
    sub: "So we can match you to better circles",
    primary: "Open settings",
    to: "/settings",
    icon: MapPin,
  },
  {
    label: "Say hello",
    sub: "Open a chat and introduce yourself",
    primary: "Open chat",
    to: "/chats",
    icon: MessageCircle,
  },
  {
    label: "Invite one person (optional)",
    sub: "Circles grow faster with familiar faces",
    primary: "Invite someone",
    to: "/chats",
    optional: true,
    icon: UserPlus,
  },
];

function fmtWeekdayTime(iso: string | null): string {
  if (!iso) return "No time selected";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No time selected";
  return d.toLocaleString(undefined, {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtCircleTime(iso: string | null): string {
  if (!iso) return "Time TBD";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Time TBD";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtRelativeTime(iso: string): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "now";
  const diff = Date.now() - ms;
  const sec = Math.max(1, Math.floor(diff / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatEventTime(iso: string | null | undefined): string {
  if (!iso) return "Time TBD";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Time TBD";
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  const day = d.toLocaleDateString(undefined, { day: "2-digit" });
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${weekday} ${day} ${month} · ${time}`;
}

function groupInitials(title: string): string {
  const text = String(title || "Circle").trim();
  if (!text) return "C";
  const parts = text.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "C";
}

function stripUuid(value: string): string {
  return String(value || "").replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    ""
  );
}

function compactText(value: string, max = 90): string {
  const single = stripUuid(value).replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return `${single.slice(0, max - 1)}…`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMentionRegex(name: string | null | undefined): RegExp | null {
  const raw = String(name || "").trim();
  if (!raw) return null;
  const first = raw.split(/\s+/).filter(Boolean)[0] || "";
  const candidates = Array.from(new Set([raw, first].filter((v) => v.length >= 2)));
  if (!candidates.length) return null;
  const pattern = candidates.map(escapeRegExp).join("|");
  return new RegExp(`@\\s*(?:${pattern})\\b`, "i");
}

function splitVenueDetails(place: string | null | undefined, fallbackVenue: string | null | undefined): { venue: string; address: string } {
  const raw = (place || "").trim();
  const fallback = (fallbackVenue || "").trim();
  if (!raw) {
    return {
      venue: fallback || "Venue TBD",
      address: "Address TBD",
    };
  }

  const separators = [",", " - ", " | ", " / "];
  for (const sep of separators) {
    if (!raw.includes(sep)) continue;
    const parts = raw.split(sep).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        venue: parts[0],
        address: parts.slice(1).join(", "),
      };
    }
  }

  if (fallback && fallback.toLowerCase() !== raw.toLowerCase()) {
    return { venue: fallback, address: raw };
  }
  return { venue: raw, address: "Address TBD" };
}

function isNotComingLabel(label: string | null | undefined): boolean {
  const v = String(label || "").trim().toLowerCase();
  return v === "not coming" || v === "not_coming" || v === "notcoming";
}

export default function Profile() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const { data: profile, isLoading, error } = useProfile(uid);

  const [memberSince, setMemberSince] = useState("2024");
  const [circles, setCircles] = useState<CircleCard[]>([]);
  const [nextMeetup, setNextMeetup] = useState<MeetupCard | null>(null);
  const [recentMeetups, setRecentMeetups] = useState<RecentMeetup[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [meetupsCount, setMeetupsCount] = useState(0);
  const [loadingPage, setLoadingPage] = useState(true);
  const [firstStepsState, setFirstStepsState] = useState<boolean[]>([false, false, false, false]);
  const [showFirstStepsBanner, setShowFirstStepsBanner] = useState(false);
  const [firstStepsModalOpen, setFirstStepsModalOpen] = useState(false);
  const [copiedPublicId, setCopiedPublicId] = useState(false);

  const firstStepsSeenKey = useMemo(() => (uid ? `circles_first_steps_${uid}` : null), [uid]);
  const firstStepsStateKey = useMemo(() => (uid ? `circles_first_steps_state_${uid}` : null), [uid]);
  const completedFirstSteps = useMemo(() => firstStepsState.filter(Boolean).length, [firstStepsState]);
  const activeFirstStep = useMemo(() => {
    const idx = firstStepsState.findIndex((v) => !v);
    return idx === -1 ? FIRST_STEPS.length - 1 : idx;
  }, [firstStepsState]);

  useEffect(() => {
    if (!uid) {
      setShowFirstStepsBanner(false);
      setFirstStepsState([false, false, false, false]);
      return;
    }

    const seen = firstStepsSeenKey ? localStorage.getItem(firstStepsSeenKey) : null;
    setShowFirstStepsBanner(!seen);

    if (!firstStepsStateKey) {
      setFirstStepsState([false, false, false, false]);
      return;
    }

    try {
      const raw = localStorage.getItem(firstStepsStateKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === FIRST_STEPS.length) {
          setFirstStepsState(parsed.map(Boolean));
          return;
        }
      }
    } catch {}

    setFirstStepsState([false, false, false, false]);
  }, [uid, firstStepsSeenKey, firstStepsStateKey]);

  useEffect(() => {
    if (!firstStepsStateKey) return;
    localStorage.setItem(firstStepsStateKey, JSON.stringify(firstStepsState));
  }, [firstStepsState, firstStepsStateKey]);

  useEffect(() => {
    if (!firstStepsSeenKey) return;
    if (completedFirstSteps >= FIRST_STEPS.length) {
      localStorage.setItem(firstStepsSeenKey, "1");
      setShowFirstStepsBanner(false);
      setFirstStepsModalOpen(false);
    }
  }, [completedFirstSteps, firstStepsSeenKey]);

  useEffect(() => {
    const handleShow = () => {
      if (firstStepsSeenKey) localStorage.removeItem(firstStepsSeenKey);
      setShowFirstStepsBanner(true);
    };
    window.addEventListener("circles:show-checklist", handleShow as EventListener);
    return () => window.removeEventListener("circles:show-checklist", handleShow as EventListener);
  }, [firstStepsSeenKey]);

  const dismissFirstSteps = () => {
    if (firstStepsSeenKey) localStorage.setItem(firstStepsSeenKey, "1");
    setShowFirstStepsBanner(false);
    setFirstStepsModalOpen(false);
  };

  const toggleFirstStep = (idx: number) => {
    setFirstStepsState((prev) => {
      const next = [...prev];
      if (idx < 0 || idx >= next.length) return next;
      next[idx] = !next[idx];
      return next;
    });
  };

  const openFirstStepRoute = (idx: number, useSecondary = false) => {
    const step = FIRST_STEPS[idx];
    if (!step) return;
    const to = useSecondary ? step.secondaryTo : step.to;
    if (!to) return;
    setFirstStepsModalOpen(false);
    navigate(to);
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!uid) return;
      setLoadingPage(true);

      const [{ data: profileMeta }, { data: membershipRows, error: membershipErr }] = await Promise.all([
        supabase
          .from("profiles")
          .select("created_at, name")
          .eq("user_id", uid)
          .maybeSingle(),
        supabase
          .from("group_members")
          .select("group_id, groups(id, title, game, city)")
          .eq("user_id", uid)
          .in("status", ["active", "accepted"])
          .limit(16),
      ]);

      if (cancelled) return;
      if (profileMeta?.created_at) {
        const year = new Date(profileMeta.created_at).getFullYear();
        if (!Number.isNaN(year)) setMemberSince(String(year));
      }

      if (membershipErr) {
        console.warn("[profile] memberships load failed", membershipErr);
        setCircles([]);
        setNextMeetup(null);
        setRecentMeetups([]);
        setActivity([]);
        setMeetupsCount(0);
        setLoadingPage(false);
        return;
      }

      const deduped = new Map<string, { id: string; title: string; game: string | null; city: string | null }>();
      for (const row of membershipRows || []) {
        const groupObj = Array.isArray((row as any).groups) ? (row as any).groups[0] : (row as any).groups;
        if (!groupObj?.id || deduped.has(groupObj.id)) continue;
        deduped.set(groupObj.id, {
          id: groupObj.id,
          title: groupObj.title || "Circle",
          game: groupObj.game || null,
          city: groupObj.city || null,
        });
      }
      const myGroups = Array.from(deduped.values());
      const groupTitleById = new Map(myGroups.map((g) => [g.id, g.title]));
      const groupIds = myGroups.map((g) => g.id);

      if (!groupIds.length) {
        setCircles([]);
        setNextMeetup(null);
        setRecentMeetups([]);
        setActivity([]);
        setMeetupsCount(0);
        setLoadingPage(false);
        return;
      }

      const now = new Date();
      const nowTs = now.getTime();
      const nowIso = now.toISOString();
      const [eventsRes, memberRes, messagesRes, pollsRes, ratingsRes] = await Promise.all([
        supabase
          .from("group_events")
          .select("id, group_id, poll_id, option_id, title, starts_at, place, created_at")
          .in("group_id", groupIds)
          .order("starts_at", { ascending: true })
          .limit(100),
        supabase
          .from("group_members")
          .select("group_id, user_id")
          .in("group_id", groupIds)
          .in("status", ["active", "accepted"]),
        supabase
          .from("group_messages")
          .select("id, group_id, sender_id, content, created_at")
          .in("group_id", groupIds)
          .order("created_at", { ascending: false })
          .limit(240),
        supabase
          .from("group_polls")
          .select("id, group_id, title, status, closes_at, created_at")
          .in("group_id", groupIds)
          .order("created_at", { ascending: false })
          .limit(160),
        supabase
          .rpc("get_my_group_event_ratings", { p_group_ids: groupIds }),
      ]);

      if (cancelled) return;

      const memberRows = memberRes.data || [];
      const membersByGroup = new Map<string, string[]>();
      memberRows.forEach((row: any) => {
        if (!membersByGroup.has(row.group_id)) membersByGroup.set(row.group_id, []);
        membersByGroup.get(row.group_id)!.push(row.user_id);
      });

      const sortedEvents = (eventsRes.data || []).filter((e: any) => !!e.group_id);
      const nextByGroup = new Map<string, any>();
      sortedEvents.forEach((evt: any) => {
        if (nextByGroup.has(evt.group_id)) return;
        if (evt.starts_at && evt.starts_at >= nowIso) {
          nextByGroup.set(evt.group_id, evt);
        }
      });

      const pollsByGroup = new Map<string, any>();
      (pollsRes.data || []).forEach((poll: any) => {
        if (!poll?.group_id || pollsByGroup.has(poll.group_id)) return;
        pollsByGroup.set(poll.group_id, poll);
      });

      const pollIds = Array.from(
        new Set(
          [
            ...(pollsRes.data || []).map((p: any) => p.id),
            ...sortedEvents.map((evt: any) => evt.poll_id).filter(Boolean),
          ].filter(Boolean)
        )
      );

      const [pollOptionsRes, pollVotesRes] = pollIds.length
        ? await Promise.all([
            supabase
              .from("group_poll_options")
              .select("id, poll_id, label, starts_at, place, created_at")
              .in("poll_id", pollIds),
            supabase
              .from("group_votes")
              .select("poll_id, option_id, user_id")
              .in("poll_id", pollIds),
          ])
        : [
            { data: [] as any[] },
            { data: [] as any[] },
          ];

      if (cancelled) return;

      const optionMap = new Map<string, any>();
      const optionsByPoll = new Map<string, any[]>();
      (pollOptionsRes.data || []).forEach((opt: any) => {
        if (!opt?.id || !opt?.poll_id) return;
        optionMap.set(opt.id, opt);
        if (!optionsByPoll.has(opt.poll_id)) optionsByPoll.set(opt.poll_id, []);
        optionsByPoll.get(opt.poll_id)!.push(opt);
      });
      optionsByPoll.forEach((opts) => {
        opts.sort((a: any, b: any) => {
          const aAt = String(a?.starts_at || "");
          const bAt = String(b?.starts_at || "");
          return aAt.localeCompare(bAt);
        });
      });

      const votesByPoll = new Map<string, Array<{ poll_id: string; option_id: string; user_id: string }>>();
      (pollVotesRes.data || []).forEach((row: any) => {
        if (!row?.poll_id || !row?.option_id || !row?.user_id) return;
        if (!votesByPoll.has(row.poll_id)) votesByPoll.set(row.poll_id, []);
        votesByPoll.get(row.poll_id)!.push({
          poll_id: row.poll_id,
          option_id: row.option_id,
          user_id: row.user_id,
        });
      });

      const allProfileIds = Array.from(
        new Set(
          [
            ...memberRows.map((row: any) => row.user_id),
            ...(messagesRes.data || []).map((m: any) => m.sender_id).filter(Boolean),
            ...(pollVotesRes.data || []).map((v: any) => v.user_id).filter(Boolean),
          ].filter(Boolean)
        )
      );

      const { data: publicProfiles } = allProfileIds.length
        ? await supabase
            .from("profiles")
            .select("user_id, name, avatar_url")
            .in("user_id", allProfileIds)
        : { data: [] as PublicProfile[] };

      if (cancelled) return;

      const profileMap = new Map<string, PublicProfile>();
      (publicProfiles || []).forEach((row: any) => {
        profileMap.set(row.user_id, row as PublicProfile);
      });

      const builtCircles: CircleCard[] = myGroups
        .map((group) => {
          const ids = membersByGroup.get(group.id) || [];
          const avatars = ids.slice(0, 3).map((id) => getAvatarUrl(profileMap.get(id)?.avatar_url, id));
          const latestPoll = pollsByGroup.get(group.id) || null;
          const latestPollOpen =
            !!latestPoll &&
            latestPoll.status === "open" &&
            (!latestPoll.closes_at || new Date(latestPoll.closes_at).getTime() > nowTs);

          const nextEvent = nextByGroup.get(group.id) || null;
          const candidatePollId = latestPollOpen ? latestPoll.id : nextEvent?.poll_id || latestPoll?.id || null;
          const pollOptions = candidatePollId ? optionsByPoll.get(candidatePollId) || [] : [];
          const pollVotes = candidatePollId ? votesByPoll.get(candidatePollId) || [] : [];

          let selectedOptionId: string | null = null;
          let selectedStartsAt: string | null = null;
          let selectedPlace: string | null = null;

          if (latestPollOpen) {
            const scheduleOptions = pollOptions.filter((opt: any) => !!opt.starts_at && !isNotComingLabel(opt.label));
            const futureOptions = scheduleOptions.filter((opt: any) => String(opt.starts_at) >= nowIso);
            const candidateOptions = futureOptions.length ? futureOptions : scheduleOptions;
            if (candidateOptions.length) {
              const voteCountByOption = new Map<string, number>();
              pollVotes.forEach((v) => {
                voteCountByOption.set(v.option_id, (voteCountByOption.get(v.option_id) || 0) + 1);
              });
              candidateOptions.sort((a: any, b: any) => {
                const countDelta = (voteCountByOption.get(b.id) || 0) - (voteCountByOption.get(a.id) || 0);
                if (countDelta !== 0) return countDelta;
                return String(a.starts_at || "").localeCompare(String(b.starts_at || ""));
              });
              const pick = candidateOptions[0];
              selectedOptionId = pick.id;
              selectedStartsAt = pick.starts_at || null;
              selectedPlace = pick.place || null;
            }
          } else if (nextEvent) {
            selectedOptionId = nextEvent.option_id || null;
            selectedStartsAt = nextEvent.starts_at || null;
            selectedPlace = nextEvent.place || null;
          }

          if (!selectedOptionId && pollOptions.length) {
            const fallback = pollOptions.find((opt: any) => !!opt.starts_at && !isNotComingLabel(opt.label)) || null;
            if (fallback) {
              selectedOptionId = fallback.id;
              selectedStartsAt = selectedStartsAt || fallback.starts_at || null;
              selectedPlace = selectedPlace || fallback.place || null;
            }
          }

          if (!selectedStartsAt && selectedOptionId) {
            const selectedOption = optionMap.get(selectedOptionId);
            if (selectedOption?.starts_at) selectedStartsAt = selectedOption.starts_at;
            if (!selectedPlace && selectedOption?.place) selectedPlace = selectedOption.place;
          }

          const goingSet = new Set(
            pollVotes.filter((v) => v.option_id === selectedOptionId).map((v) => v.user_id)
          );
          const goingIds = ids.filter((id) => goingSet.has(id));
          const goingCount = goingIds.length;
          const goingAvatars = goingIds.slice(0, 3).map((id) => getAvatarUrl(profileMap.get(id)?.avatar_url, id));
          const hasVoted = !!uid && pollVotes.some((v) => v.user_id === uid);

          const startsAt = selectedStartsAt || null;
          const startsAtTs = startsAt ? new Date(startsAt).getTime() : NaN;
          const isOngoing = Number.isFinite(startsAtTs) && startsAtTs <= nowTs && nowTs < startsAtTs + 2 * 60 * 60 * 1000;
          const statusLabel = latestPollOpen ? (hasVoted ? "Voting ongoing" : "Vote now") : isOngoing ? "Ongoing" : null;

          return {
            id: group.id,
            title: group.title,
            city: group.city,
            game: group.game,
            startsAt,
            place: selectedPlace || group.city || null,
            members: ids.length,
            avatars,
            goingCount,
            goingAvatars,
            canVoteNow: latestPollOpen,
            hasVoted,
            statusLabel,
          };
        })
        .sort((a, b) => {
          if (a.startsAt && b.startsAt) return a.startsAt.localeCompare(b.startsAt);
          if (a.startsAt) return -1;
          if (b.startsAt) return 1;
          return a.title.localeCompare(b.title);
        });

      const upcoming = builtCircles.find((c) => c.startsAt) || builtCircles[0] || null;
      const meetupData: MeetupCard | null = upcoming
        ? {
            groupId: upcoming.id,
            groupTitle: upcoming.title,
            eventTitle: (nextByGroup.get(upcoming.id)?.title as string | undefined) || null,
            startsAt: upcoming.startsAt,
            place: upcoming.place,
            attending: upcoming.goingCount,
            avatars: upcoming.goingAvatars,
          }
        : null;

      const pastMeetups: RecentMeetup[] = sortedEvents
        .filter((ev: any) => !!ev?.starts_at)
        .filter((ev: any) => {
          const ts = new Date(ev.starts_at).getTime();
          return Number.isFinite(ts) && ts < nowTs;
        })
        .sort((a: any, b: any) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())
        .slice(0, 4)
        .map((ev: any) => ({
          id: ev.id,
          groupId: ev.group_id,
          groupTitle: compactText(groupTitleById.get(ev.group_id) || "Circle", 40),
          startsAt: ev.starts_at,
          place: ev.place || null,
        }));

      const maxAgeMs = 21 * 24 * 60 * 60 * 1000;
      const mentionRegex = buildMentionRegex(
        (profileMeta as any)?.name || user?.email?.split("@")[0] || null
      );

      const pollActivity: ActivityItem[] = (pollsRes.data || [])
        .filter((p: any) => p?.status === "open")
        .filter((p: any) => nowTs - new Date(p.created_at).getTime() <= maxAgeMs)
        .map((p: any) => {
          const groupTitle = compactText(groupTitleById.get(p.group_id) || "Circle", 36);
          return {
            id: `poll-${p.id}`,
            groupId: p.group_id,
            type: "poll_created",
            groupTitle,
            actorAvatar: null,
            actorSeed: p.group_id,
            title: `New vote in ${groupTitle}`,
            description: compactText(p.title || "Vote for the next meetup time."),
            at: p.created_at,
            actionLabel: "Vote",
            actionTo: `/group/${p.group_id}#poll`,
          };
        });

      const meetupActivity: ActivityItem[] = (eventsRes.data || [])
        .filter((ev: any) => nowTs - new Date(ev.created_at).getTime() <= maxAgeMs)
        .map((ev: any) => {
          const groupTitle = compactText(groupTitleById.get(ev.group_id) || "Circle", 36);
          const placeText = compactText(String(ev.place || ""), 38);
          return {
            id: `meetup-${ev.id}`,
            groupId: ev.group_id,
            type: "meetup_created",
            groupTitle,
            actorAvatar: null,
            actorSeed: ev.group_id,
            title: `New meetup scheduled in ${groupTitle}`,
            description: `${formatEventTime(ev.starts_at)}${placeText ? ` • ${placeText}` : ""}`,
            at: ev.created_at,
            actionLabel: "View",
            actionTo: `/group/${ev.group_id}`,
          };
        });

      const mentionActivity: ActivityItem[] = mentionRegex
        ? (messagesRes.data || [])
            .filter((m: any) => mentionRegex.test(String(m.content || "")))
            .filter((m: any) => nowTs - new Date(m.created_at).getTime() <= maxAgeMs)
            .map((m: any) => {
              const groupTitle = compactText(groupTitleById.get(m.group_id) || "Circle", 36);
              return {
                id: `mention-${m.id}`,
                groupId: m.group_id,
                type: "mention",
                groupTitle,
                actorAvatar: profileMap.get(m.sender_id)?.avatar_url || null,
                actorSeed: m.sender_id || m.group_id,
                title: `You were mentioned in ${groupTitle}`,
                description: compactText(m.content || "You were mentioned."),
                at: m.created_at,
                actionLabel: "Open chat",
                actionTo: `/chats?groupId=${m.group_id}`,
              };
            })
        : [];

      const latestPastMeetup = (eventsRes.data || [])
        .filter((ev: any) => !!ev?.starts_at)
        .filter((ev: any) => {
          const ts = new Date(ev.starts_at).getTime();
          return Number.isFinite(ts) && ts < nowTs && nowTs - ts <= 14 * 24 * 60 * 60 * 1000;
        })
        .sort((a: any, b: any) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())[0];

      const meetupRatings = ratingsRes.error ? [] : ((ratingsRes.data || []) as any[]);

      const ratedEventIds = new Set(
        meetupRatings
          .map((r) => String(r?.event_id || ""))
          .filter(Boolean)
      );

      const ratingActivity: ActivityItem[] = [];
      if (latestPastMeetup) {
        if (!ratedEventIds.has(String(latestPastMeetup.id))) {
          const groupTitle = compactText(groupTitleById.get(latestPastMeetup.group_id) || "Circle", 36);
          ratingActivity.push({
            id: `rating-${latestPastMeetup.id}`,
            groupId: latestPastMeetup.group_id,
            type: "rating_needed",
            groupTitle,
            actorAvatar: null,
            actorSeed: latestPastMeetup.group_id,
            title: "Rate your last meetup",
            description: `From ${groupTitle} • ${formatEventTime(latestPastMeetup.starts_at)}`,
            at: latestPastMeetup.created_at || latestPastMeetup.starts_at,
            actionLabel: "Rate",
            actionTo: `/events/${latestPastMeetup.id}/rate?groupId=${latestPastMeetup.group_id}`,
          });
        }
      }

      const builtActivity = [...ratingActivity, ...pollActivity, ...meetupActivity, ...mentionActivity]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 10);

      setActivity(builtActivity);

      setCircles(builtCircles);
      setNextMeetup(meetupData);
      setRecentMeetups(pastMeetups);
      setMeetupsCount(sortedEvents.filter((evt: any) => !!evt.starts_at).length);
      setLoadingPage(false);
    };

    load().catch((e) => {
      console.error("[profile] failed to build page", e);
      if (!cancelled) {
        setCircles([]);
        setNextMeetup(null);
        setRecentMeetups([]);
        setActivity([]);
        setMeetupsCount(0);
        setLoadingPage(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [uid]);

  const ratingValue = useMemo(() => Number(profile?.rating_avg ?? 0), [profile?.rating_avg]);
  const ratingCount = useMemo(() => Number(profile?.rating_count ?? 0), [profile?.rating_count]);

  useEffect(() => {
    if (!copiedPublicId) return;
    const timer = window.setTimeout(() => setCopiedPublicId(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copiedPublicId]);

  const copyPublicId = async () => {
    const value = String(profile?.public_id || "").trim();
    if (!value) return;
    const text = `@${value}`;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedPublicId(true);
    } catch {
      // Ignore clipboard failures on unsupported browsers.
    }
  };

  if (isLoading || loadingPage) {
    return <div className="mx-auto w-full max-w-6xl px-4 pt-24 text-sm text-neutral-500">Loading profile…</div>;
  }

  if (error || !profile) {
    return <div className="mx-auto w-full max-w-6xl px-4 pt-24 text-sm text-red-600">Could not load profile.</div>;
  }

  const upcomingCircles = circles.filter((circle) => !!circle.startsAt || circle.canVoteNow);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-16 md:px-6 md:pb-28 md:pt-20">
      <div className="space-y-6">
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
          <div className="flex items-center gap-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white bg-neutral-300 shadow-sm">
              <img
                src={getAvatarUrl(profile.avatar_url, uid || user?.email || "circles-user")}
                alt="Profile"
                className="h-full w-full object-cover"
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-2xl font-bold tracking-tight text-neutral-900">{profile.name || "Circle Member"}</div>
              <div className="text-sm text-neutral-600">{profile.city || "Set your city"}</div>
              {profile.public_id ? (
                <div className="mt-1 inline-flex items-center gap-2">
                  <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs font-semibold text-neutral-700">
                    @{profile.public_id}
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyPublicId()}
                    className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-neutral-700 hover:border-neutral-300"
                  >
                    {copiedPublicId ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedPublicId ? "Copied" : "Copy ID"}
                  </button>
                </div>
              ) : null}
              <div className="mt-1 text-xs text-neutral-500">Member since {memberSince}</div>
            </div>

            <button
              onClick={() => navigate("/settings")}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-neutral-300 bg-white px-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              <Pencil className="h-4 w-4" />
              Settings
            </button>
          </div>

          <div className="mt-5 grid grid-cols-3 border-t border-neutral-200 pt-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-neutral-900">{circles.length}</div>
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Circles</div>
            </div>
            <div className="border-x border-neutral-200 text-center">
              <div className="text-2xl font-bold text-neutral-900">{meetupsCount}</div>
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Meetups</div>
            </div>
            <div className="text-center">
              <div className="inline-flex items-center gap-1 text-2xl font-bold text-neutral-900">
                <Star className="h-4 w-4 fill-emerald-500 text-emerald-500" />
                {ratingValue.toFixed(1)}
              </div>
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Trust Score</div>
            </div>
          </div>
        </section>

        {showFirstStepsBanner && completedFirstSteps < FIRST_STEPS.length && (
          <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 px-4 py-3">
            <div className="flex min-h-[56px] items-center justify-between gap-3">
              <p className="truncate text-sm font-semibold text-emerald-900">
                Finish setting up your Circle ({completedFirstSteps}/{FIRST_STEPS.length})
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFirstStepsModalOpen(true)}
                  className="rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  Continue
                </button>
                <button
                  type="button"
                  onClick={dismissFirstSteps}
                  className="rounded-full p-1.5 text-emerald-700/70 hover:bg-emerald-100 hover:text-emerald-900"
                  aria-label="Dismiss setup banner"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight text-neutral-900">Next Meetup</h2>
            <Ellipsis className="h-5 w-5 text-neutral-500" />
          </div>

          {upcomingCircles.length ? (
            <div className="-mr-2 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 pr-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {upcomingCircles.map((circle) => {
                const venue = splitVenueDetails(circle.place, circle.title);
                return (
                  <Link
                    key={`meetup-${circle.id}`}
                    to={circle.canVoteNow ? `/group/${circle.id}#poll` : `/group/${circle.id}`}
                    className="w-[88%] shrink-0 snap-start rounded-2xl border border-neutral-200 bg-neutral-50 p-4 shadow-[0_6px_18px_rgba(15,23,42,0.06)] hover:bg-white sm:w-[340px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-lg font-semibold text-neutral-900">{fmtWeekdayTime(circle.startsAt)}</div>
                      {circle.statusLabel && (
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${circle.canVoteNow ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
                          {circle.statusLabel}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-base font-semibold text-neutral-900">{venue.venue}</div>
                    <div className="mt-1 flex items-center gap-2 text-sm text-neutral-700">
                      <MapPin className="h-4 w-4 text-neutral-500" />
                      <span className="truncate">{venue.address}</span>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white">
                        View Circle
                      </span>

                      <div className="flex items-center gap-2">
                        {!!circle.goingAvatars.length && (
                          <div className="flex -space-x-2">
                            {circle.goingAvatars.slice(0, 3).map((avatar, idx) => (
                              <img
                                key={`${circle.id}-${avatar}-${idx}`}
                                src={avatar}
                                alt="Member"
                                className="h-8 w-8 rounded-full border-2 border-neutral-100 object-cover"
                              />
                            ))}
                          </div>
                        )}
                        <div className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700">
                          {Math.max(0, circle.goingCount || 0)}/{Math.max(0, circle.members || 0)} are going
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-sm text-neutral-600">You don't have a meetup yet.</p>
              <Link
                to="/browse"
                className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
              >
                <Users className="mr-2 h-4 w-4" />
                Join a circle near you
              </Link>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight text-neutral-900">My Circles</h2>
            <Link to="/groups/mine" className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:text-emerald-900">
              View All
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          {circles.length ? (
            <div className="-mr-2 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 pr-6 overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {circles.map((circle) => (
                <Link
                  key={circle.id}
                  to={`/group/${circle.id}`}
                  className="w-[82%] shrink-0 snap-start rounded-2xl border border-neutral-200 bg-neutral-50 p-3 shadow-[0_6px_18px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_10px_24px_rgba(15,23,42,0.10)] sm:w-[220px]"
                >
                  <div className="truncate text-base font-bold text-neutral-900">{circle.title}</div>
                  <div className="mt-2 flex -space-x-2">
                    {circle.avatars.map((avatar, idx) => (
                      <img
                        key={`${circle.id}-${idx}`}
                        src={avatar}
                        alt="Circle member"
                        className="h-7 w-7 rounded-full border-2 border-neutral-100 object-cover"
                      />
                    ))}
                    {circle.members > circle.avatars.length && (
                      <div className="grid h-7 w-7 place-items-center rounded-full border-2 border-neutral-100 bg-white text-xs font-semibold text-neutral-700">
                        +{circle.members - circle.avatars.length}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-neutral-600">{fmtCircleTime(circle.startsAt)}</div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="w-full rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm text-neutral-600">
              No circles yet. Tap "Join a circle near you" to get started.
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
          <div className="mb-4">
            <h2 className="text-xl font-bold tracking-tight text-neutral-900">Recent Meetups</h2>
          </div>

          {recentMeetups.length ? (
            <div className="space-y-3">
              {recentMeetups.map((meetup, idx) => (
                <Link
                  key={meetup.id}
                  to={`/group/${meetup.groupId}`}
                  className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-3 hover:bg-white"
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50">
                    <Calendar className="h-4 w-4 text-emerald-600" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                      {idx === 0 ? "Last meetup attended" : "Recent meetup"}
                    </div>
                    <div className="truncate text-sm font-bold text-neutral-900">{meetup.groupTitle}</div>
                    <div className="mt-0.5 text-xs text-neutral-600">
                      {formatEventTime(meetup.startsAt)}
                      {meetup.place ? ` • ${compactText(meetup.place, 34)}` : ""}
                    </div>
                  </div>

                  <div className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                    <span className="inline-flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 fill-emerald-600 text-emerald-600" />
                      {ratingValue.toFixed(1)}
                      {ratingCount > 0 ? ` (${ratingCount})` : ""}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4">
              <p className="text-sm text-neutral-700">No meetups yet.</p>
              <p className="mt-1 text-sm text-neutral-600">Join your first meetup to start building trust.</p>
              <Link
                to="/browse"
                className="mt-3 inline-flex items-center justify-center rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-100"
              >
                Browse Circles
              </Link>
            </div>
          )}
        </section>

      </div>

      {firstStepsModalOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-emerald-100 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-neutral-900">Finish setting up your Circle</p>
                <p className="text-xs text-neutral-600">
                  {completedFirstSteps}/{FIRST_STEPS.length} completed
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFirstStepsModalOpen(false)}
                className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
                aria-label="Close onboarding"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${(completedFirstSteps / FIRST_STEPS.length) * 100}%` }}
              />
            </div>

            <div className="space-y-2.5">
              {FIRST_STEPS.map((step, idx) => {
                const done = firstStepsState[idx];
                const isActive = idx === activeFirstStep;
                return (
                  <div
                    key={step.label}
                    className={`rounded-xl border p-3 ${
                      done
                        ? "border-emerald-200 bg-emerald-50/70"
                        : isActive
                          ? "border-emerald-200 bg-emerald-50/40"
                          : "border-neutral-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => toggleFirstStep(idx)}
                        className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border ${
                          done ? "border-emerald-500 bg-emerald-500 text-white" : "border-neutral-300 bg-white text-transparent"
                        }`}
                        aria-label={done ? "Mark step incomplete" : "Mark step complete"}
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <step.icon className="h-4 w-4 text-neutral-500" />
                          <p className="truncate text-sm font-semibold text-neutral-900">{step.label}</p>
                          {step.optional && <span className="text-[10px] font-semibold text-neutral-500">Optional</span>}
                          {done && <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-600" />}
                        </div>
                        <p className="mt-1 text-xs text-neutral-600">{step.sub}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openFirstStepRoute(idx)}
                            className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                          >
                            {step.primary}
                          </button>
                          {step.secondary && step.secondaryTo && (
                            <button
                              type="button"
                              onClick={() => openFirstStepRoute(idx, true)}
                              className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                            >
                              {step.secondary}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
