import React, { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { daysUntilReconnect, isLowRatingBlock, LOW_RATING_BLOCK_THRESHOLD } from "@/lib/ratings";
import { MessageSquare, UserPlus, UserCheck, UserMinus, X, AlertTriangle, Unlock, ChevronLeft, Check, Star } from "lucide-react";
import UserCard from "./UserCard";
import { useNavigate } from "react-router-dom";

const toast = (msg: string) => alert(msg);

type FriendState = 'none' | 'pending_in' | 'pending_out' | 'accepted' | 'blocked_by_me' | 'blocked_by_them';
type ActivitySnapshotItem = { id: string; at: string; text: string };

interface ViewOtherProfileModalProps {
  isOpen?: boolean;
  onClose: () => void;
  viewUserId: string | null;
  mode?: "modal" | "page";
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Active recently";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "Active recently";
  const diffMs = Date.now() - ts;
  if (diffMs < 60 * 1000) return "Active just now";
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 60) return `Active ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Active ${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Active ${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `Active ${years} year${years === 1 ? "" : "s"} ago`;
}

function yearFromIso(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  const year = new Date(iso).getFullYear();
  return Number.isFinite(year) ? String(year) : "Unknown";
}

function trustLevelFromMvp(attendedMeetups: number, ratingAvg: number): "New" | "Building" | "Reliable" {
  // TODO: Upgrade trust system after pilot phase using real behavioral data.
  if (attendedMeetups <= 0) return "New";
  if (attendedMeetups <= 2) return "Building";
  if (attendedMeetups >= 3 && ratingAvg >= 4) return "Reliable";
  return "Building";
}

export default function ViewOtherProfileModal({ isOpen = true, onClose, viewUserId, mode = "modal" }: ViewOtherProfileModalProps) {
  const navigate = useNavigate();
  const isPage = mode === "page";
  const isVisible = isPage ? !!viewUserId : isOpen;
  const [uid, setUid] = useState<string | null>(null);

  const [viewName, setViewName] = useState<string>("");
  const [viewAvatar, setViewAvatar] = useState<string | null>(null);
  const [viewAllowRatings, setViewAllowRatings] = useState<boolean>(true);
  const [viewRatingAvg, setViewRatingAvg] = useState<number>(0);
  const [viewRatingCount, setViewRatingCount] = useState<number>(0);
  const [viewPersonality, setViewPersonality] = useState<any | null>(null);
  const [viewCity, setViewCity] = useState<string | null>(null);
  const [viewBio, setViewBio] = useState<string>("");
  const [viewInterests, setViewInterests] = useState<string[]>([]);
  const [memberSince, setMemberSince] = useState<string>("Unknown");
  const [lastActiveAt, setLastActiveAt] = useState<string | null>(null);
  const [activitySnapshot, setActivitySnapshot] = useState<ActivitySnapshotItem[]>([]);
  const [reportsReceived, setReportsReceived] = useState<number>(0);
  const [confirmedMeetups, setConfirmedMeetups] = useState<number>(0);
  const [attendedMeetups, setAttendedMeetups] = useState<number>(0);
  const [ratingBreakdown, setRatingBreakdown] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [ratingBreakdownOpen, setRatingBreakdownOpen] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);

  const [mutualGroupsCount, setMutualGroupsCount] = useState<number>(0);
  const [mutualGroupNames, setMutualGroupNames] = useState<string[]>([]);
  const [targetFriendCount, setTargetFriendCount] = useState<number>(0);
  const [mutualFriendsCount, setMutualFriendsCount] = useState<number>(0);

  const [myRating, setMyRating] = useState<number>(0);
  const [rateBusy, setRateBusy] = useState(false);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [pendingRating, setPendingRating] = useState<number | null>(null);
  const [animatingStar, setAnimatingStar] = useState<number | null>(null);
  const ratingAnimTimeout = useRef<number | null>(null);
  const [viewFriendStatus, setViewFriendStatus] = useState<FriendState>('none');
  const [err, setErr] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [ratedLowByView, setRatedLowByView] = useState(false);
  const [reconnectRequest, setReconnectRequest] = useState<any | null>(null);
  const [reconnectMessage, setReconnectMessage] = useState("");
  const [reconnectErr, setReconnectErr] = useState<string | null>(null);
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const [reconnectDaysLeft, setReconnectDaysLeft] = useState(0);
  const blockedByMe = viewFriendStatus === 'blocked_by_me';
  const blockedByThem = viewFriendStatus === 'blocked_by_them';
  const isBlocked = blockedByMe || blockedByThem;
  const canMessageUser = viewFriendStatus === "accepted" && !isBlocked;
  const canRateNow = viewAllowRatings && !isBlocked && myRating === 0;
  const showUpRate = confirmedMeetups > 0 ? Math.round((attendedMeetups / confirmedMeetups) * 100) : 0;
  const trustLevel = trustLevelFromMvp(attendedMeetups, viewRatingAvg);
  const fullBio = viewBio.trim();
  const isBioLong = fullBio.length > 180;
  const visibleBio = !isBioLong || bioExpanded ? fullBio : `${fullBio.slice(0, 180).trimEnd()}...`;

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      setUid(auth.user?.id || null);
    })();
  }, []);

  useEffect(() => {
    if (!isVisible || !viewUserId || !uid) return;

    setErr(null);
    setRateBusy(false);
    setHoverRating(null);
    setPendingRating(null);
    setAnimatingStar(null);
    setReporting(false);
    setReconnectErr(null);
    setReconnectMessage("");
    setRatingBreakdownOpen(false);
    setBioExpanded(false);
    setActivitySnapshot([]);
    setReportsReceived(0);
    setConfirmedMeetups(0);
    setAttendedMeetups(0);
    setRatingBreakdown([0, 0, 0, 0, 0, 0]);

    async function loadData() {
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", viewUserId)
          .maybeSingle();

        const profileRow = (prof as any) || {};
        const rawInterests = Array.isArray(profileRow?.interests)
          ? profileRow.interests
          : typeof profileRow?.interests === "string"
            ? profileRow.interests.split(",")
            : [];

        setViewName(profileRow?.name ?? "User");
        setViewAvatar(profileRow?.avatar_url ?? null);
        setViewAllowRatings(Boolean(profileRow?.allow_ratings ?? true));
        setViewRatingAvg(Number(profileRow?.rating_avg ?? 0));
        setViewRatingCount(Number(profileRow?.rating_count ?? 0));
        setViewPersonality(profileRow?.personality_traits ?? null);
        setViewCity(profileRow?.city ?? null);
        setViewBio(String(profileRow?.bio || "").trim());
        setViewInterests(
          rawInterests
            .map((tag: any) => String(tag || "").trim())
            .filter(Boolean)
            .slice(0, 8)
        );
        setMemberSince(yearFromIso(profileRow?.created_at));

        const { data: pair } = await supabase
          .from("rating_pairs")
          .select("stars")
          .eq("rater_id", uid)
          .eq("ratee_id", viewUserId)
          .maybeSingle();
        setMyRating(Number(pair?.stars ?? 0));

        const { data: ratedBy } = await supabase
          .from("rating_pairs")
          .select("stars")
          .eq("rater_id", viewUserId)
          .eq("ratee_id", uid)
          .maybeSingle();
        setRatedLowByView(isLowRatingBlock(Number(ratedBy?.stars ?? 0)));

        const { data: ratingRows } = await supabase
          .from("rating_pairs")
          .select("stars")
          .eq("ratee_id", viewUserId);
        const breakdown = [0, 0, 0, 0, 0, 0];
        (ratingRows || []).forEach((row: any) => {
          const stars = Number(row?.stars || 0);
          if (stars >= 1 && stars <= 6) breakdown[stars - 1] += 1;
        });
        setRatingBreakdown(breakdown);

        const { data: lastReq } = await supabase
          .from("reconnect_requests")
          .select("id,status,created_at,message")
          .eq("requester_id", uid)
          .eq("target_id", viewUserId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        setReconnectRequest(lastReq ?? null);

        const { data: rel } = await supabase
          .from("friendships")
          .select("status,requested_by")
          .or(`and(user_id_a.eq.${uid},user_id_b.eq.${viewUserId}),and(user_id_a.eq.${viewUserId},user_id_b.eq.${uid})`)
          .maybeSingle();

        let st: FriendState = "none";
        if (rel) {
          if (rel.status === "accepted") st = "accepted";
          else if (rel.status === "blocked") st = rel.requested_by === uid ? "blocked_by_me" : "blocked_by_them";
          else if (rel.status === "pending") st = rel.requested_by === uid ? "pending_out" : "pending_in";
        }
        setViewFriendStatus(st);

        const { data: targetGroups } = await supabase
          .from("group_members")
          .select("group_id")
          .eq("user_id", viewUserId)
          .eq("status", "active");
        const targetGroupIds = (targetGroups || []).map((r: any) => String(r.group_id || "")).filter(Boolean);

        const { data: myGroups } = await supabase
          .from("group_members")
          .select("group_id")
          .eq("user_id", uid)
          .eq("status", "active");
        const myGroupIds = new Set((myGroups || []).map((r: any) => String(r.group_id || "")));

        const mutualIds = targetGroupIds.filter((gid) => myGroupIds.has(gid));
        setMutualGroupsCount(mutualIds.length);

        if (mutualIds.length > 0) {
          const { data: mutualDetails } = await supabase
            .from("groups")
            .select("title")
            .in("id", mutualIds)
            .limit(3);
          setMutualGroupNames((mutualDetails || []).map((g: any) => g.title));
        } else {
          setMutualGroupNames([]);
        }

        const { data: myFriends } = await supabase
          .from("friendships")
          .select("user_id_a,user_id_b,status")
          .or(`and(user_id_a.eq.${uid},status.eq.accepted),and(user_id_b.eq.${uid},status.eq.accepted)`);
        const myFriendIds = new Set((myFriends || []).map((f: any) => (f.user_id_a === uid ? f.user_id_b : f.user_id_a)));

        const { data: targetFriends } = await supabase
          .from("friendships")
          .select("user_id_a,user_id_b,status")
          .or(`and(user_id_a.eq.${viewUserId},status.eq.accepted),and(user_id_b.eq.${viewUserId},status.eq.accepted)`);
        const targetIds = (targetFriends || []).map((f: any) =>
          f.user_id_a === viewUserId ? f.user_id_b : f.user_id_a
        );
        setTargetFriendCount(targetIds.length);
        setMutualFriendsCount(targetIds.filter((id) => myFriendIds.has(id)).length);

        const uniqueTargetGroupIds = Array.from(new Set(targetGroupIds));
        const nowIso = new Date().toISOString();

        let groupTitleById = new Map<string, string>();
        if (uniqueTargetGroupIds.length > 0) {
          const { data: groups } = await supabase.from("groups").select("id,title").in("id", uniqueTargetGroupIds).limit(280);
          groupTitleById = new Map((groups || []).map((g: any) => [String(g.id), String(g.title || "Circle")]));
        }

        let pastEvents: any[] = [];
        if (uniqueTargetGroupIds.length > 0) {
          const { data: events } = await supabase
            .from("group_events")
            .select("id,group_id,poll_id,option_id,starts_at,created_at")
            .in("group_id", uniqueTargetGroupIds)
            .not("starts_at", "is", null)
            .lt("starts_at", nowIso)
            .order("starts_at", { ascending: false })
            .limit(220);
          pastEvents = events || [];
        }

        const pollIds = Array.from(new Set(pastEvents.map((ev: any) => String(ev?.poll_id || "")).filter(Boolean)));

        let userVotes: any[] = [];
        if (pollIds.length > 0) {
          const { data: votes } = await supabase
            .from("group_votes")
            .select("poll_id,option_id,created_at")
            .eq("user_id", viewUserId)
            .in("poll_id", pollIds)
            .order("created_at", { ascending: false })
            .limit(400);
          userVotes = votes || [];
        }

        let recentMessages: any[] = [];
        if (uniqueTargetGroupIds.length > 0) {
          const { data: messages } = await supabase
            .from("group_messages")
            .select("group_id,created_at")
            .eq("sender_id", viewUserId)
            .in("group_id", uniqueTargetGroupIds)
            .order("created_at", { ascending: false })
            .limit(400);
          recentMessages = messages || [];
        }

        let pollsById = new Map<string, any>();
        if (pollIds.length > 0) {
          const { data: polls } = await supabase
            .from("group_polls")
            .select("id,group_id,title")
            .in("id", pollIds)
            .limit(320);
          pollsById = new Map((polls || []).map((p: any) => [String(p.id), p]));
        }

        const voteOptionIdsByPoll = new Map<string, Set<string>>();
        userVotes.forEach((vote: any) => {
          const pollId = String(vote?.poll_id || "");
          const optionId = String(vote?.option_id || "");
          if (!pollId || !optionId) return;
          if (!voteOptionIdsByPoll.has(pollId)) voteOptionIdsByPoll.set(pollId, new Set());
          voteOptionIdsByPoll.get(pollId)!.add(optionId);
        });

        const confirmedEvents = pastEvents.filter((ev: any) => {
          const pollId = String(ev?.poll_id || "");
          const optionId = String(ev?.option_id || "");
          if (!pollId || !optionId) return false;
          return voteOptionIdsByPoll.get(pollId)?.has(optionId) || false;
        });

        setConfirmedMeetups(confirmedEvents.length);

        const messageTimesByGroup = new Map<string, number[]>();
        recentMessages.forEach((msg: any) => {
          const groupId = String(msg?.group_id || "");
          const ts = new Date(msg?.created_at || "").getTime();
          if (!groupId || !Number.isFinite(ts)) return;
          if (!messageTimesByGroup.has(groupId)) messageTimesByGroup.set(groupId, []);
          messageTimesByGroup.get(groupId)!.push(ts);
        });

        const attendedEstimate = recentMessages.length
          ? confirmedEvents.filter((ev: any) => {
              const groupId = String(ev?.group_id || "");
              const eventTs = new Date(ev?.starts_at || "").getTime();
              if (!groupId || !Number.isFinite(eventTs)) return false;
              const hits = messageTimesByGroup.get(groupId) || [];
              return hits.some((ts) => ts >= eventTs - 6 * 60 * 60 * 1000 && ts <= eventTs + 30 * 60 * 60 * 1000);
            }).length
          : confirmedEvents.length;
        setAttendedMeetups(attendedEstimate);

        try {
          const { count } = await supabase
            .from("reports")
            .select("id", { head: true, count: "exact" })
            .eq("reported_id", viewUserId);
          setReportsReceived(Number(count || 0));
        } catch {
          setReportsReceived(0);
        }

        const activityRows: ActivitySnapshotItem[] = [];
        confirmedEvents.slice(0, 2).forEach((ev: any) => {
          const gid = String(ev?.group_id || "");
          const title = groupTitleById.get(gid) || "a circle";
          activityRows.push({
            id: `attended-${ev.id}`,
            at: String(ev?.starts_at || ev?.created_at || ""),
            text: `Attended ${title} meetup`,
          });
        });
        userVotes.slice(0, 4).forEach((vote: any, idx: number) => {
          const poll = pollsById.get(String(vote?.poll_id || ""));
          const gid = String(poll?.group_id || "");
          const title = groupTitleById.get(gid) || String(poll?.title || "a circle");
          activityRows.push({
            id: `vote-${vote?.poll_id || idx}-${vote?.option_id || ""}`,
            at: String(vote?.created_at || ""),
            text: `Voted in ${title} poll`,
          });
        });

        const seen = new Set<string>();
        const mergedActivity = activityRows
          .filter((row) => row.text && !seen.has(row.text) && seen.add(row.text))
          .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
          .slice(0, 3);
        setActivitySnapshot(mergedActivity);

        const activityTimestamps = [
          profileRow?.last_active_at,
          profileRow?.updated_at,
          profileRow?.created_at,
          ...recentMessages.map((msg: any) => msg?.created_at),
          ...userVotes.map((vote: any) => vote?.created_at),
          ...confirmedEvents.map((ev: any) => ev?.starts_at),
        ]
          .map((value: any) => ({ value, ts: new Date(String(value || "")).getTime() }))
          .filter((row: any) => Number.isFinite(row.ts))
          .sort((a: any, b: any) => b.ts - a.ts);
        setLastActiveAt(activityTimestamps[0]?.value || null);
      } catch (e: any) {
        console.error("[view-profile] loadData failed", e?.message || e);
      }
    }

    loadData();
  }, [isVisible, viewUserId, uid]);

  useEffect(() => {
    setReconnectDaysLeft(daysUntilReconnect(reconnectRequest?.created_at));
  }, [reconnectRequest]);

  useEffect(() => {
    return () => {
      if (ratingAnimTimeout.current) window.clearTimeout(ratingAnimTimeout.current);
    };
  }, []);

  async function handleFriendAction(action: 'add' | 'accept' | 'remove') {
    if (!viewUserId) return;
    setErr(null);
    try {
      if (action === 'add') {
        const { error } = await supabase.rpc("request_friend", { target_id: viewUserId });
        if (error) throw error;
        setViewFriendStatus('pending_out');
      } else if (action === 'accept') {
        const { error } = await supabase.rpc("accept_friend", { from_id: viewUserId });
        if (error) throw error;
        setViewFriendStatus('accepted');
      } else {
        const { error } = await supabase.rpc("remove_friend", { other_id: viewUserId });
        if (error) throw error;
        setViewFriendStatus('none');
      }
    } catch (e: any) {
      const msg = String(e?.message || "Friend action failed.");
      if (/already/i.test(msg)) setErr("Friend request already exists.");
      else if (/not authenticated/i.test(msg)) setErr("Please sign in again.");
      else setErr("Could not update friend request.");
    }
  }

  async function handleReport() {
    if (!uid || !viewUserId) return;
    if (!window.confirm("Are you sure you want to report and block this user? They will not be able to contact you.")) return;
    
    setReporting(true);
    try {
      const { error: repErr } = await supabase.from('reports').insert({
        reporter_id: uid,
        reported_id: viewUserId,
        reason: 'User Reported via Profile'
      });
      if (repErr) throw repErr;

      const { error: blockErr } = await supabase.rpc('block_user', { target_id: viewUserId });
      if (blockErr) throw blockErr;

      toast("User reported and blocked.");
      setViewFriendStatus('blocked_by_me');
      onClose();
    } catch (e: any) {
      toast("Failed to report user.");
    } finally {
      setReporting(false);
    }
  }

  async function rateUser(n: number): Promise<boolean> {
    if (!uid || !viewUserId || rateBusy || !viewAllowRatings) return false;
    setRateBusy(true);
    const prev = myRating;
    setMyRating(n);
    try {
      const { error } = await supabase.rpc('submit_rating', { p_ratee: viewUserId, p_stars: n });
      if (error) throw error;
      if (isLowRatingBlock(n)) {
        await supabase
          .from("reconnect_requests")
          .delete()
          .eq("requester_id", viewUserId)
          .eq("target_id", uid);
        await supabase.rpc("remove_friend", { other_id: viewUserId });
        const { error: blockErr } = await supabase.rpc("block_user", { target_id: viewUserId });
        if (blockErr) console.warn("Auto-block failed after low rating:", blockErr);
        setViewFriendStatus("blocked_by_me");
        toast(`Rated ${LOW_RATING_BLOCK_THRESHOLD} stars or below. Matching with this user is now blocked.`);
      }
      const { data } = await supabase.from('profiles').select('rating_avg,rating_count').eq('user_id', viewUserId).single();
      if (data) {
        setViewRatingAvg(data.rating_avg);
        setViewRatingCount(data.rating_count);
      }
      const { data: distRows } = await supabase.from("rating_pairs").select("stars").eq("ratee_id", viewUserId);
      const nextBreakdown = [0, 0, 0, 0, 0, 0];
      (distRows || []).forEach((row: any) => {
        const stars = Number(row?.stars || 0);
        if (stars >= 1 && stars <= 6) nextBreakdown[stars - 1] += 1;
      });
      setRatingBreakdown(nextBreakdown);
      return true;
    } catch (e: any) {
      setMyRating(prev);
      setErr("Failed to rate.");
      return false;
    } finally {
      setRateBusy(false);
    }
  }

  function selectRating(n: number) {
    if (rateBusy || !canRateNow) return;
    setErr(null);
    setPendingRating(n);
    setAnimatingStar(n);
    if (ratingAnimTimeout.current) window.clearTimeout(ratingAnimTimeout.current);
    ratingAnimTimeout.current = window.setTimeout(() => {
      setAnimatingStar((prev) => (prev === n ? null : prev));
    }, 220);
  }

  async function confirmRating() {
    if (pendingRating == null || rateBusy || !canRateNow) return;
    const label = `${pendingRating} star${pendingRating === 1 ? "" : "s"}`;
    if (!window.confirm(`Confirm ${label} for ${viewName || "this user"}?`)) return;
    const ok = await rateUser(pendingRating);
    if (ok) setPendingRating(null);
  }

  async function sendReconnectRequest() {
    if (!uid || !viewUserId || reconnectBusy) return;
    if (!ratedLowByView) return;
    if (reconnectDaysLeft > 0) return;
    if (reconnectRequest?.status === "pending" || reconnectRequest?.status === "accepted") return;
    setReconnectBusy(true);
    setReconnectErr(null);
    try {
      const { error } = await supabase
        .from("reconnect_requests")
        .insert({
          requester_id: uid,
          target_id: viewUserId,
          status: "pending",
          message: reconnectMessage.trim() || null,
        });
      if (error) throw error;
      const createdAt = new Date().toISOString();
      setReconnectRequest({
        id: `local-${uid}-${viewUserId}-${createdAt}`,
        status: "pending",
        created_at: createdAt,
        message: reconnectMessage.trim() || null,
      });
      setReconnectMessage("");
      toast("Reconnect request sent.");
    } catch (e: any) {
      setReconnectErr(e?.message || "Could not send reconnect request.");
    } finally {
      setReconnectBusy(false);
    }
  }

  function goToChat() {
    if (!viewUserId) return;
    if (!canMessageUser) {
      toast("Add this user as a friend to start chatting.");
      return;
    }
    if (!isPage) onClose();
    navigate('/chats', { state: { openDmId: viewUserId } });
  }

  if (!isVisible) return null;

  return (
    <div
      className={
        isPage
          ? "mx-auto w-full max-w-xl px-4 py-8 pb-32"
          : "fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto px-4 py-6 md:items-center"
      }
      onClick={isPage ? undefined : onClose}
    >
      {!isPage && <div className="absolute inset-0 bg-black/60" />}
      <div
        className={
          isPage
            ? "relative w-full rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm"
            : "relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl overflow-y-auto max-h-[calc(100dvh-3rem)]"
        }
        onClick={isPage ? undefined : (e) => e.stopPropagation()}
      >
        {isPage ? (
          <div className="mb-4 flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-full border border-neutral-200 bg-white p-2 text-neutral-600 hover:bg-neutral-50"
              aria-label="Back"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-sm font-bold text-neutral-900">Profile</div>
          </div>
        ) : (
          <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-white text-neutral-500">
            <X className="h-5 w-5" />
          </button>
        )}

        <div className="mb-4">
          <UserCard
            name={viewName || "User"}
            city={viewCity}
            avatarUrl={viewAvatar || undefined}
            avatarSeed={viewUserId}
            ratingAvg={viewRatingAvg}
            ratingCount={viewRatingCount}
            personalityTraits={viewPersonality}
            subtitle={`${formatRelativeTime(lastActiveAt)}${viewAllowRatings ? "" : " · Ratings disabled"}`}
            hideRating
          />
        </div>

        <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setRatingBreakdownOpen(true)}
            disabled={viewRatingCount <= 0}
            className={`flex w-full items-center justify-between text-left ${
              viewRatingCount > 0 ? "cursor-pointer" : "cursor-default"
            }`}
          >
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              {viewRatingAvg.toFixed(1)} · {viewRatingCount} rating{viewRatingCount === 1 ? "" : "s"}
            </span>
            {viewRatingCount > 0 && <span className="text-[11px] text-neutral-500">View breakdown</span>}
          </button>
          <div className="mt-0.5 text-[11px] text-neutral-500">Based on {viewRatingCount} rating{viewRatingCount === 1 ? "" : "s"}</div>
        </div>

        <div className="mb-4 rounded-xl border border-neutral-200 bg-white px-3 py-3">
          <div className="text-xs font-bold uppercase tracking-wide text-neutral-500">Trust Summary</div>
          <div className="mt-2 space-y-1 text-xs text-neutral-700">
            <div>Attended: {attendedMeetups} meetups</div>
            <div>Show-up rate: {showUpRate}%</div>
            <div>Member since: {memberSince}</div>
            <div>Reports: {reportsReceived}</div>
          </div>
          <div className="mt-2 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            Trust Level: {trustLevel}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            Based on meetup attendance and peer ratings.
          </div>
        </div>

        <div className="flex gap-3 mb-6">
          <button
            onClick={goToChat}
            disabled={!canMessageUser}
            className={`flex-1 py-2 rounded-xl text-sm font-bold flex items-center justify-center gap-2 ${
              !canMessageUser
                ? "bg-neutral-200 text-neutral-500 cursor-not-allowed"
                : "bg-indigo-600 text-white"
            }`}
          >
            <MessageSquare className="h-4 w-4" /> Message
          </button>

          {viewFriendStatus === 'none' && !isBlocked && (
            <button onClick={() => handleFriendAction('add')} className="flex-1 py-2 rounded-xl bg-black text-white text-sm font-bold flex items-center justify-center gap-2">
              <UserPlus className="h-4 w-4" /> Add
            </button>
          )}

          {viewFriendStatus === 'pending_in' && !isBlocked && (
            <button onClick={() => handleFriendAction('accept')} className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold flex items-center justify-center gap-2">
              <UserCheck className="h-4 w-4" /> Accept
            </button>
          )}

          {viewFriendStatus === 'accepted' && !isBlocked && (
            <button
              onClick={() => {
                if (window.confirm("Are you sure you want to unfriend this user?")) {
                  handleFriendAction('remove');
                }
              }}
              className="flex-1 py-2 rounded-xl bg-neutral-100 text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 text-sm font-bold flex items-center justify-center gap-2 transition-all"
            >
              <UserMinus className="h-4 w-4" /> Unfriend
            </button>
          )}

          {blockedByMe && (
            <button 
              onClick={() => {
                if (window.confirm("Unblock this user? They will be able to request you again.")) {
                  // 'remove' deletes the friendship row, effectively unblocking them
                  handleFriendAction('remove');
                }
              }}
              className="flex-1 py-2 rounded-xl bg-neutral-800 text-white text-sm font-bold flex items-center justify-center gap-2 hover:bg-neutral-900 transition-all"
            >
              <Unlock className="h-4 w-4" /> Unblock
            </button>
          )}
        </div>
        {!canMessageUser && !isBlocked && (
          <div className="-mt-3 mb-4 text-center text-xs text-neutral-500">
            Add as friend to unlock direct messages.
          </div>
        )}
        {err && <div className="mb-4 text-center text-xs font-medium text-red-500">{err}</div>}

        <div className="mb-4 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-700">
          {mutualGroupsCount} Mutual Group{mutualGroupsCount === 1 ? "" : "s"} · {mutualFriendsCount} Mutual Friend
          {mutualFriendsCount === 1 ? "" : "s"} · {targetFriendCount} Friend{targetFriendCount === 1 ? "" : "s"}
        </div>

        {mutualGroupNames.length > 0 && (
          <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500">You are both in</div>
            <div className="flex flex-wrap gap-1.5">
              {mutualGroupNames.map((name, i) => (
                <span key={i} className="rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-xs font-medium text-neutral-700">
                  {name}
                </span>
              ))}
              {mutualGroupsCount > 3 && (
                <span className="px-2 py-0.5 text-xs text-neutral-400">+{mutualGroupsCount - 3} more</span>
              )}
            </div>
          </div>
        )}

        <div className="mb-4 rounded-xl border border-neutral-200 bg-white px-3 py-3">
          <div className="text-xs font-bold uppercase tracking-wide text-neutral-500">About</div>
          {fullBio ? (
            <>
              <p className="mt-2 text-sm leading-6 text-neutral-700">{visibleBio}</p>
              {isBioLong && (
                <button
                  type="button"
                  onClick={() => setBioExpanded((v) => !v)}
                  className="mt-1 text-xs font-semibold text-neutral-600 hover:text-neutral-900"
                >
                  {bioExpanded ? "Show less" : "Expand"}
                </button>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-neutral-500">No bio yet.</p>
          )}
        </div>

        <div className="mb-4 rounded-xl border border-neutral-200 bg-white px-3 py-3">
          <div className="text-xs font-bold uppercase tracking-wide text-neutral-500">Interests</div>
          {viewInterests.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {viewInterests.map((tag) => (
                <button
                  type="button"
                  key={tag}
                  onClick={() => {
                    if (!isPage) onClose();
                    navigate(`/groups?q=${encodeURIComponent(tag)}`);
                  }}
                  className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:border-neutral-300 hover:bg-neutral-100"
                >
                  #{tag.replace(/^#/, "")}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-neutral-500">No interests listed.</p>
          )}
        </div>

        <div className="mb-4 rounded-xl border border-neutral-200 bg-white px-3 py-3">
          <div className="text-xs font-bold uppercase tracking-wide text-neutral-500">Recent Activity</div>
          {activitySnapshot.length > 0 ? (
            <div className="mt-2 space-y-1.5 text-sm text-neutral-700">
              {activitySnapshot.map((item) => (
                <div key={item.id} className="truncate">
                  • {item.text}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-neutral-500">No recent activity yet.</p>
          )}
        </div>

        {viewAllowRatings && !isBlocked && (
          <div className="border-t border-neutral-100 pt-4">
            <div className="text-xs font-bold uppercase tracking-wide text-neutral-500">Rate User</div>
            {myRating > 0 && pendingRating == null ? (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                <Check className="h-3.5 w-3.5" />
                You rated this user {myRating}★
              </div>
            ) : (
              <>
                <div className="mt-2 flex justify-center gap-1">
                  {Array.from({ length: 6 }).map((_, i) => {
                    const n = i + 1;
                    const active = (hoverRating ?? pendingRating ?? myRating) >= n;
                    return (
                      <button
                        key={n}
                        disabled={rateBusy || !canRateNow}
                        onMouseEnter={() => setHoverRating(n)}
                        onMouseLeave={() => setHoverRating(null)}
                        onClick={() => selectRating(n)}
                        className={`text-2xl transition-all duration-150 ${
                          active ? "text-amber-400" : "text-neutral-200"
                        } ${animatingStar === n ? "scale-125 -translate-y-0.5" : "hover:scale-110"} disabled:cursor-not-allowed`}
                        aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
                      >
                        ★
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center justify-center gap-2">
                  <button
                    onClick={confirmRating}
                    disabled={rateBusy || pendingRating == null}
                    className="rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {rateBusy ? "Saving..." : `Confirm${pendingRating != null ? ` ${pendingRating}★` : ""}`}
                  </button>
                  {pendingRating != null && (
                    <button
                      onClick={() => setPendingRating(null)}
                      disabled={rateBusy}
                      className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-[11px] font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="mt-1 text-center text-[10px] text-neutral-500">
                  {pendingRating != null
                    ? `Selected ${pendingRating} star${pendingRating === 1 ? "" : "s"}`
                    : "Select stars and confirm"}
                </div>
              </>
            )}
            {err && <div className="mt-1 text-center text-[10px] text-red-500">{err}</div>}
          </div>
        )}

        {ratedLowByView && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Reconnect letter</div>
            <div className="mt-1 text-xs text-amber-700">
              You were rated 1-2 stars by this user. You can send one request every 7 days.
            </div>
            {reconnectRequest?.status === "accepted" ? (
              <div className="mt-2 text-xs font-semibold text-emerald-700">
                Request accepted. You can meet again.
              </div>
            ) : reconnectRequest?.status === "pending" ? (
              <div className="mt-2 text-xs text-neutral-600">
                Request pending. We will notify you when they respond.
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <textarea
                  value={reconnectMessage}
                  onChange={(e) => setReconnectMessage(e.target.value)}
                  placeholder="Write a short note (optional)"
                  rows={3}
                  maxLength={240}
                  className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-neutral-800 outline-none focus:border-amber-300"
                />
                <div className="flex items-center justify-between text-[10px] text-amber-700">
                  <span>{reconnectMessage.length}/240</span>
                  {reconnectDaysLeft > 0 && (
                    <span>Try again in {reconnectDaysLeft} day{reconnectDaysLeft === 1 ? "" : "s"}</span>
                  )}
                </div>
                <button
                  onClick={sendReconnectRequest}
                  disabled={reconnectBusy || reconnectDaysLeft > 0}
                  className="w-full rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {reconnectBusy ? "Sending..." : "Send reconnect request"}
                </button>
                {reconnectErr && <div className="text-[10px] text-red-600">{reconnectErr}</div>}
              </div>
            )}
          </div>
        )}

        {!blockedByMe && (
          <div className="mt-6 flex justify-center border-t border-neutral-100 pt-4">
            <button
              onClick={handleReport}
              disabled={reporting}
              className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {reporting ? "Reporting..." : "Report & Block User"}
            </button>
          </div>
        )}

        {ratingBreakdownOpen && (
          <div
            className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4"
            onClick={() => setRatingBreakdownOpen(false)}
          >
            <div
              className="w-full max-w-xs rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-neutral-900">Rating Breakdown</div>
                  <div className="text-[11px] text-neutral-500">{viewRatingCount} total ratings</div>
                </div>
                <button
                  type="button"
                  onClick={() => setRatingBreakdownOpen(false)}
                  className="rounded-full border border-neutral-200 bg-white p-1.5 text-neutral-500 hover:bg-neutral-50"
                  aria-label="Close rating breakdown"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-1.5">
                {[6, 5, 4, 3, 2, 1].map((stars) => (
                  <div key={stars} className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-2.5 py-1.5 text-xs">
                    <span className="font-semibold text-neutral-700">{stars}★</span>
                    <span className="text-neutral-500">{ratingBreakdown[stars - 1] || 0} people</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
