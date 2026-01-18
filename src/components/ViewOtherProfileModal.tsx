import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Users, MessageSquare, UserPlus, UserCheck, UserMinus, X, AlertTriangle, Unlock } from "lucide-react";
import UserCard from "./UserCard";
import { useNavigate } from "react-router-dom";

const toast = (msg: string) => alert(msg);

type FriendState = 'none' | 'pending_in' | 'pending_out' | 'accepted' | 'blocked';

interface ViewOtherProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  viewUserId: string | null;
}

export default function ViewOtherProfileModal({ isOpen, onClose, viewUserId }: ViewOtherProfileModalProps) {
  const navigate = useNavigate();
  const [uid, setUid] = useState<string | null>(null);

  const [viewName, setViewName] = useState<string>("");
  const [viewAvatar, setViewAvatar] = useState<string | null>(null);
  const [viewAllowRatings, setViewAllowRatings] = useState<boolean>(true);
  const [viewRatingAvg, setViewRatingAvg] = useState<number>(0);
  const [viewRatingCount, setViewRatingCount] = useState<number>(0);
  const [viewReputationScore, setViewReputationScore] = useState<number>(0);
  const [viewPersonality, setViewPersonality] = useState<any | null>(null);
  const [viewCity, setViewCity] = useState<string | null>(null);

  const [mutualGroupsCount, setMutualGroupsCount] = useState<number>(0);
  const [mutualGroupNames, setMutualGroupNames] = useState<string[]>([]);
  const [targetFriendCount, setTargetFriendCount] = useState<number>(0);
  const [mutualFriendsCount, setMutualFriendsCount] = useState<number>(0);

  const [myRating, setMyRating] = useState<number>(0);
  const [rateBusy, setRateBusy] = useState(false);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [viewFriendStatus, setViewFriendStatus] = useState<FriendState>('none');
  const [err, setErr] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      setUid(auth.user?.id || null);
    })();
  }, []);

  useEffect(() => {
    if (!isOpen || !viewUserId || !uid) return;

    setErr(null);
    setRateBusy(false);
    setHoverRating(null);
    setReporting(false);

    async function loadData() {
      const { data: prof } = await supabase
        .from("profiles")
        .select("name,avatar_url,allow_ratings,rating_avg,rating_count,reputation_score,personality_traits,city")
        .eq("user_id", viewUserId)
        .maybeSingle();

      setViewName((prof as any)?.name ?? "User");
      setViewAvatar((prof as any)?.avatar_url ?? null);
      setViewAllowRatings(Boolean((prof as any)?.allow_ratings ?? true));
      setViewRatingAvg(Number((prof as any)?.rating_avg ?? 0));
      setViewRatingCount(Number((prof as any)?.rating_count ?? 0));
      setViewReputationScore(Number((prof as any)?.reputation_score ?? 0));
      setViewPersonality((prof as any)?.personality_traits ?? null);
      setViewCity((prof as any)?.city ?? null);

      const { data: pair } = await supabase
        .from('rating_pairs')
        .select('stars')
        .eq('rater_id', uid)
        .eq('ratee_id', viewUserId)
        .maybeSingle();
      setMyRating(Number(pair?.stars ?? 0));

      const { data: rel } = await supabase
        .from("friendships")
        .select("status,requested_by")
        .or(`and(user_id_a.eq.${uid},user_id_b.eq.${viewUserId}),and(user_id_a.eq.${viewUserId},user_id_b.eq.${uid})`)
        .maybeSingle();

      let st: FriendState = 'none';
      if (rel) {
        if (rel.status === 'accepted') st = 'accepted';
        else if (rel.status === 'blocked') st = 'blocked';
        else if (rel.status === 'pending') {
          st = rel.requested_by === uid ? 'pending_out' : 'pending_in';
        }
      }
      setViewFriendStatus(st);

      // Mutual groups (preview)
      const { data: targetGroups } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", viewUserId)
        .eq("status", "active");
      const targetGroupIds = (targetGroups || []).map((r: any) => r.group_id);

      const { data: myGroups } = await supabase
        .from("group_members")
        .select("group_id")
        .eq("user_id", uid)
        .eq("status", "active");
      const myGroupIds = new Set((myGroups || []).map((r: any) => r.group_id));

      const mutualIds = targetGroupIds.filter(gid => myGroupIds.has(gid));
      setMutualGroupsCount(mutualIds.length);

      if (mutualIds.length > 0) {
        const { data: mutualDetails } = await supabase
          .from("groups")
          .select("title")
          .in("id", mutualIds)
          .limit(3);
        setMutualGroupNames((mutualDetails || []).map((g: any) => g.title));
      } else setMutualGroupNames([]);

      // Friend counts and mutual friends
      const { data: myFriends } = await supabase
        .from("friendships")
        .select("user_id_a,user_id_b,status")
        .or(`and(user_id_a.eq.${uid},status.eq.accepted),and(user_id_b.eq.${uid},status.eq.accepted)`);
      const myFriendIds = new Set(
        (myFriends || []).map((f: any) => (f.user_id_a === uid ? f.user_id_b : f.user_id_a))
      );

      const { data: targetFriends } = await supabase
        .from("friendships")
        .select("user_id_a,user_id_b,status")
        .or(`and(user_id_a.eq.${viewUserId},status.eq.accepted),and(user_id_b.eq.${viewUserId},status.eq.accepted)`);

      const targetIds = (targetFriends || []).map((f: any) => (f.user_id_a === viewUserId ? f.user_id_b : f.user_id_a));
      setTargetFriendCount(targetIds.length);
      setMutualFriendsCount(targetIds.filter(id => myFriendIds.has(id)).length);
    }

    loadData();
  }, [isOpen, viewUserId, uid]);

  async function handleFriendAction(action: 'add' | 'accept' | 'remove') {
    if (!viewUserId) return;
    try {
      if (action === 'add') {
        await supabase.rpc("request_friend", { target_id: viewUserId });
        setViewFriendStatus('pending_out');
      } else if (action === 'accept') {
        await supabase.rpc("accept_friend", { from_id: viewUserId });
        setViewFriendStatus('accepted');
      } else {
        await supabase.rpc("remove_friend", { other_id: viewUserId });
        setViewFriendStatus('none');
      }
    } catch (e) {}
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
      setViewFriendStatus('blocked');
      onClose();
    } catch (e: any) {
      toast("Failed to report user.");
    } finally {
      setReporting(false);
    }
  }

  async function rateUser(n: number) {
    if (!uid || !viewUserId || rateBusy || !viewAllowRatings) return;
    setRateBusy(true);
    const prev = myRating;
    setMyRating(n);
    try {
      const { error } = await supabase.rpc('submit_rating', { p_ratee: viewUserId, p_stars: n });
      if (error) throw error;
      const { data } = await supabase.from('profiles').select('rating_avg,rating_count').eq('user_id', viewUserId).single();
      if (data) {
        setViewRatingAvg(data.rating_avg);
        setViewRatingCount(data.rating_count);
      }
    } catch (e: any) {
      setMyRating(prev);
      setErr("Failed to rate.");
    } finally {
      setRateBusy(false);
    }
  }

  function goToChat() {
    if (!viewUserId) return;
    onClose();
    navigate('/chats', { state: { openDmId: viewUserId } });
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl overflow-y-auto max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-white text-neutral-500">
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4">
          <UserCard
            name={viewName || "User"}
            city={viewCity}
            avatarUrl={viewAvatar || undefined}
            reputationScore={viewReputationScore}
            personalityTraits={viewPersonality}
            subtitle={viewAllowRatings ? undefined : "Ratings disabled"}
          />
        </div>

        <div className="flex gap-3 mb-6">
          <button onClick={goToChat} className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold flex items-center justify-center gap-2">
            <MessageSquare className="h-4 w-4" /> Message
          </button>

          {viewFriendStatus === 'none' && (
            <button onClick={() => handleFriendAction('add')} className="flex-1 py-2 rounded-xl bg-black text-white text-sm font-bold flex items-center justify-center gap-2">
              <UserPlus className="h-4 w-4" /> Add
            </button>
          )}

          {viewFriendStatus === 'pending_in' && (
            <button onClick={() => handleFriendAction('accept')} className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold flex items-center justify-center gap-2">
              <UserCheck className="h-4 w-4" /> Accept
            </button>
          )}

          {viewFriendStatus === 'accepted' && (
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

          {viewFriendStatus === 'blocked' && (
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

        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="p-3 rounded-xl bg-blue-50 text-center">
            <div className="text-xl font-bold text-blue-700">{mutualGroupsCount}</div>
            <div className="text-[10px] uppercase font-bold text-blue-500 mt-1 flex items-center justify-center gap-1">
              <Users className="h-3 w-3" /> Mutual Groups
            </div>
          </div>

          <div className="p-3 rounded-xl bg-emerald-50 text-center">
            <div className="text-xl font-bold text-emerald-700">{mutualFriendsCount}</div>
            <div className="text-[10px] uppercase font-bold text-emerald-500 mt-1">Mutual Friends</div>
          </div>

          <div className="p-3 rounded-xl bg-neutral-900 text-center text-white">
            <div className="text-xl font-bold">{targetFriendCount}</div>
            <div className="text-[10px] uppercase font-bold text-neutral-200 mt-1">Friends</div>
          </div>
        </div>

        {/* Mutual Groups List (Small Preview) */}
        {mutualGroupNames.length > 0 && (
          <div className="mb-6 bg-neutral-50 rounded-xl p-3 border border-neutral-100">
            <div className="text-[10px] font-bold text-neutral-400 uppercase mb-2">You are both in:</div>
            <div className="flex flex-wrap gap-1.5">
              {mutualGroupNames.map((name, i) => (
                <span key={i} className="px-2 py-0.5 bg-white border border-neutral-200 rounded-md text-xs font-medium text-neutral-700">
                  {name}
                </span>
              ))}
              {mutualGroupsCount > 3 && (
                <span className="px-2 py-0.5 text-xs text-neutral-400">+{mutualGroupsCount - 3} more</span>
              )}
            </div>
          </div>
        )}

        {/* Rating Area */}
        {viewAllowRatings && viewFriendStatus !== 'blocked' && (
          <div className="pt-3 border-t border-neutral-100">
            <div className="text-center text-xs font-medium text-neutral-400 mb-2">Rate this player</div>
            <div className="flex justify-center gap-1">
              {Array.from({ length: 6 }).map((_, i) => {
                const n = i + 1;
                const active = (hoverRating ?? myRating) >= n;
                return (
                  <button
                    key={n}
                    disabled={rateBusy}
                    onMouseEnter={() => setHoverRating(n)}
                    onMouseLeave={() => setHoverRating(null)}
                    onClick={() => rateUser(n)}
                    className={`text-2xl transition-transform hover:scale-110 ${active ? "text-amber-400" : "text-neutral-200"}`}
                    aria-label={`Rate ${n} star${n > 1 ? 's' : ''}`}
                  >
                    ★
                  </button>
                );
              })}
            </div>
            {err && <div className="text-center text-[10px] text-red-500 mt-1">{err}</div>}
          </div>
        )}

        {/* Report Button */}
        {viewFriendStatus !== 'blocked' && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={handleReport}
              disabled={reporting}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <AlertTriangle className="h-4 w-4" />
              {reporting ? "Reporting..." : "Report & Block User"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
