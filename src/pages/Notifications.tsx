import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MessageCircle, CheckSquare, UserPlus, Mail, Users, X } from "lucide-react";
import { useAuth } from "@/App";

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

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  
  // Raw Data
  const [friendReqs, setFriendReqs] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [polls, setPolls] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [votes, setVotes] = useState<any[]>([]);

  // UI State
  const [showOlder, setShowOlder] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
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

  useEffect(() => {
    if (!user) return;

    const userId = user.id;

    async function loadData() {
      setLoading(true);

      try {
        const { data: rpcData } = await supabase.rpc("get_my_friend_requests");

        const friendRequests = (rpcData || []).map((r: any) => ({
          id: r.id,
          // We map sender_id to user_id_a so the existing Accept button works
          user_id_a: r.sender_id, 
          created_at: r.created_at,
          profiles: {
            name: r.sender_name,
            avatar_url: r.sender_avatar
          }
        }));

        const { data: inv } = await supabase
          .from("group_members" as any)
          .select("group_id, created_at, groups(title)")
          .eq("user_id", userId)
          .eq("status", "invited")
          .order("created_at", { ascending: false });

        const { data: myGroups } = await supabase
          .from("group_members" as any)
          .select("group_id")
          .eq("user_id", userId)
          .in("status", ["active", "accepted"]);

        const gIds = myGroups?.map((g: any) => g.group_id) || [];

        let fetchedPolls: any[] = [];
        let fetchedMsgs: any[] = [];
        let fetchedVotes: any[] = [];

        if (gIds.length > 0) {
          const { data: p } = await supabase
            .from("group_polls" as any)
            .select("id, title, group_id, created_at, groups(title)")
            .in("group_id", gIds)
            .eq("status", "open")
            .order("created_at", { ascending: false });
          fetchedPolls = p || [];

          const { data: m } = await supabase
            .from("group_messages" as any)
            .select("group_id, created_at, groups(title)")
            .in("group_id", gIds)
            .neq("sender_id", userId)
            .order("created_at", { ascending: false })
            .limit(50);
          fetchedMsgs = m || [];

          const { data: v } = await supabase
            .from("group_votes" as any)
            .select("poll_id, option_id, created_at, group_polls(id, title, group_id, groups(title)), group_poll_options(id, label)")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(200);
          fetchedVotes = v || [];
        }

        setFriendReqs(friendRequests || []);
        setInvites(inv || []);
        setPolls(fetchedPolls);
        setMessages(fetchedMsgs);
        setVotes(fetchedVotes);
      } catch (e) {
        console.error("Error loading notifications", e);
      } finally {
        setLoading(false);
      }
    }

    loadData();
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
    if (!user) return;
    loadCalendar();
  }, [user, loadCalendar]);

  useEffect(() => {
    if (calendarOpen) {
      const today = new Date();
      setSelectedDate(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`);
    }
  }, [calendarOpen]);

  const pad = (n: number) => String(n).padStart(2, "0");
  const keyFromDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const keyFromISO = (iso: string) => keyFromDate(new Date(iso));

  // --- Process Data (Grouping & Sorting) ---

  const processedEvents = useMemo(() => {
    const events: any[] = [];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // A. Friend Requests
    friendReqs.forEach(r => {
      events.push({
        id: `fr-${r.id}`,
        type: 'friend_req',
        date: new Date(r.created_at),
        data: r
      });
    });

    // B. Group Invites
    invites.forEach(i => {
      events.push({
        id: `inv-${i.group_id}`,
        type: 'invite',
        date: new Date(i.created_at),
        data: i
      });
    });

    // C. Polls (Deduplicated by ID)
    const uniquePolls = new Map();
    polls.forEach(p => {
      if (!uniquePolls.has(p.id)) {
        uniquePolls.set(p.id, p);
      }
    });
    
    Array.from(uniquePolls.values()).forEach((p: any) => {
      events.push({
        id: `poll-${p.id}`,
        type: 'poll',
        date: new Date(p.created_at),
        data: p
      });
    });

    // D. Messages (WHATSAPP STYLE AGGREGATION)
    // Group messages by Group ID. Instead of showing 5 rows, show "5 new messages"
    const msgGroups: Record<string, { count: number, latest: Date, groupName: string }> = {};
    
    messages.forEach(m => {
      const gid = m.group_id;
      if (!msgGroups[gid]) {
        msgGroups[gid] = { 
          count: 0, 
          latest: new Date(m.created_at), 
          groupName: m.groups?.title || "Unknown Group" 
        };
      }
      msgGroups[gid].count++;
      // keep track of newest message time for sorting
      const mDate = new Date(m.created_at);
      if (mDate > msgGroups[gid].latest) msgGroups[gid].latest = mDate;
    });

    Object.keys(msgGroups).forEach(gid => {
      events.push({
        id: `msg-group-${gid}`,
        type: 'message_summary',
        date: msgGroups[gid].latest,
        data: { 
          group_id: gid, 
          title: msgGroups[gid].groupName, 
          count: msgGroups[gid].count 
        }
      });
    });

    // E. Votes (always show own votes regardless of poll create time)
    votes.forEach(v => {
      events.push({
        id: `vote-${v.poll_id}-${v.option_id}-${v.created_at}`,
        type: 'vote',
        date: new Date(v.created_at),
        data: v
      });
    });

    // Sort all by date descending
    events.sort((a, b) => b.date.getTime() - a.date.getTime());

    // Split into same-day vs older (based on local midnight)
    const recent = events.filter(e => e.date.getTime() >= startOfToday.getTime());
    const older = events.filter(e => e.date.getTime() < startOfToday.getTime());

    return { recent, older };
  }, [friendReqs, invites, polls, messages, votes]);

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

  // --- Handlers ---

  async function handleAcceptFriend(id: string, fromId: string) {
    await supabase.rpc("accept_friend", { from_id: fromId });
    setFriendReqs(prev => prev.filter(r => r.id !== id));
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

  // --- Render Helpers ---

  const renderEvent = (e: any) => {
    const isRecent = (Date.now() - e.date.getTime()) < (24 * 60 * 60 * 1000);
    
    return (
      <div key={e.id} className="bg-white border border-neutral-100 p-3 rounded-2xl flex items-center gap-3 shadow-sm mb-3 animate-in fade-in slide-in-from-bottom-2">
        {/* Icon Column */}
        <div className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center ${
          e.type === 'friend_req' ? 'bg-purple-100 text-purple-600' :
          e.type === 'invite' ? 'bg-amber-100 text-amber-600' :
          e.type === 'poll' ? 'bg-blue-100 text-blue-600' :
          e.type === 'vote' ? 'bg-emerald-100 text-emerald-600' :
          'bg-emerald-100 text-emerald-600'
        }`}>
          {e.type === 'friend_req' && <UserPlus className="h-5 w-5" />}
          {e.type === 'invite' && <Mail className="h-5 w-5" />}
          {e.type === 'poll' && <CheckSquare className="h-5 w-5" />}
          {e.type === 'vote' && <CheckSquare className="h-5 w-5" />}
          {e.type === 'message_summary' && <MessageCircle className="h-5 w-5" />}
        </div>

        {/* Content Column */}
        <div className="flex-1 min-w-0">
          
          {/* Friend Request */}
          {e.type === 'friend_req' && (
            <>
              <div className="text-sm font-bold text-neutral-900">{e.data.profiles?.name || "User"}</div>
              <div className="text-xs text-neutral-500">Sent you a friend request</div>
              <div className="mt-2 flex gap-2">
                <button onClick={() => handleAcceptFriend(e.data.id, e.data.user_id_a)} className="bg-black text-white px-3 py-1 rounded-full text-xs font-bold">Accept</button>
              </div>
            </>
          )}

          {/* Group Invite */}
          {e.type === 'invite' && (
            <>
              <div className="text-sm font-bold text-neutral-900">{e.data.groups?.title}</div>
              <div className="text-xs text-neutral-500">You were invited to join</div>
              <div className="mt-2 flex gap-2">
                <button onClick={() => handleJoinGroup(e.data.group_id)} className="bg-black text-white px-3 py-1 rounded-full text-xs font-bold">Join</button>
              </div>
            </>
          )}

          {/* Poll */}
          {e.type === 'poll' && (
            <div onClick={() => navigate(`/group/${e.data.group_id}`)} className="cursor-pointer">
              <div className="text-sm font-bold text-neutral-900">{e.data.title}</div>
              <div className="text-xs text-neutral-500 flex items-center gap-1">
                Vote in <span className="font-medium text-neutral-700">{e.data.groups?.title}</span>
              </div>
            </div>
          )}

          {/* Vote */}
          {e.type === 'vote' && (
            <div onClick={() => navigate(`/group/${e.data.group_polls?.group_id || e.data.group_polls?.group_id}`)} className="cursor-pointer">
              <div className="text-sm font-bold text-neutral-900">You voted</div>
              <div className="text-xs text-neutral-500">
                {e.data.group_polls?.title ? `Poll: ${e.data.group_polls.title}` : 'Poll'}
              </div>
              <div className="text-xs text-neutral-500">
                {e.data.group_poll_options?.label ? `Choice: ${e.data.group_poll_options.label}` : ''}
              </div>
              <div className="text-xs text-neutral-500">
                {e.data.group_polls?.groups?.title ? `Group: ${e.data.group_polls.groups.title}` : ''}
              </div>
            </div>
          )}

          {/* Message Summary (WhatsApp Style) */}
          {e.type === 'message_summary' && (
            <div onClick={() => navigate(`/group/${e.data.group_id}`)} className="cursor-pointer">
              <div className="text-sm font-bold text-neutral-900">{e.data.title}</div>
              <div className="text-xs text-neutral-500 font-medium">
                {e.data.count} new message{e.data.count > 1 ? 's' : ''}
              </div>
            </div>
          )}
        </div>

        {/* Time Column */}
        <div className="text-[10px] text-neutral-400 whitespace-nowrap self-start">
       {isRecent ? e.date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : e.date.toLocaleDateString()}
        </div>
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

  const { recent, older } = processedEvents;
  const isEmpty = recent.length === 0 && older.length === 0;

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 pb-32">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-neutral-900">Activity</h1>
        <button
          onClick={() => {
            setCalendarOpen(true);
            if (!calendarEntries.length) loadCalendar();
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-bold text-neutral-800 shadow-sm transition-all hover:-translate-y-[1px] hover:shadow-md"
        >
          <Calendar className="h-4 w-4" />
          Calendar
        </button>
      </div>

      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="h-16 w-16 bg-neutral-100 rounded-full flex items-center justify-center mb-4">
            <span className="text-2xl">💤</span>
          </div>
          <h3 className="text-neutral-900 font-bold">All caught up</h3>
          <p className="text-neutral-500 text-sm">No activity yet.</p>
        </div>
      )}

      {/* Recent Section */}
      {recent.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3">New</h2>
          {recent.map(renderEvent)}
        </div>
      )}

      {/* Older Section (Collapsible) */}
      {older.length > 0 && (
        <div>
          <button 
            onClick={() => setShowOlder(!showOlder)}
            className="flex items-center gap-2 text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3 hover:text-neutral-600 transition-colors w-full"
          >
            {showOlder ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}
            Earlier ({older.length})
          </button>
          
          {showOlder && (
            <div className="animate-in slide-in-from-top-2 fade-in duration-300">
              {older.map(renderEvent)}
            </div>
          )}
        </div>
      )}

      {calendarOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6">
          <div className="relative w-full max-w-4xl rounded-3xl bg-white p-6 shadow-2xl">
            <button
              onClick={() => setCalendarOpen(false)}
              className="absolute right-3 top-3 rounded-full p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="mb-4">
              <div className="text-lg font-bold text-neutral-900">Activity Calendar</div>
              <p className="text-sm text-neutral-500">Poll suggestions (blue) and confirmed dates (green) at a glance.</p>
            </div>

            {calendarError && (
              <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                {calendarError}
              </div>
            )}

            {calendarLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-neutral-500">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-700" />
                Kalender wird geladen...
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                <div className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => changeMonth(-1)}
                        className="rounded-full border border-neutral-200 bg-white p-2 text-neutral-600 hover:bg-neutral-100"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <div className="text-lg font-bold text-neutral-900">{monthLabel}</div>
                      <button
                        onClick={() => changeMonth(1)}
                        className="rounded-full border border-neutral-200 bg-white p-2 text-neutral-600 hover:bg-neutral-100"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-neutral-500">
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" /> Poll open</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Confirmed</span>
                    </div>
                    <button
                      onClick={resetToCurrentMonth}
                      className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-bold text-neutral-700 hover:bg-neutral-100"
                    >
                      Today
                    </button>
                  </div>

                  <div className="mb-2 grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    {weekdayLabels.map((w) => (
                      <div key={w} className="py-1">{w}</div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-2">
                    {monthDays.map(({ date, key, inMonth }) => {
                      const dayEvents = eventsByDay[key] || [];
                      const isToday = key === todayKey;
                      const isSelected = selectedDate === key;
                      return (
                        <button
                          key={key}
                          onClick={() => setSelectedDate(key)}
                          className={`min-h-[88px] rounded-xl border bg-white p-2 text-left transition-all ${
                            inMonth ? "border-neutral-200" : "border-neutral-100 text-neutral-400"
                          } ${isSelected ? "ring-2 ring-neutral-900 border-neutral-300" : "hover:border-neutral-300"} ${isToday ? "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]" : ""}`}
                        >
                          <div className="mb-1 flex items-center justify-between text-xs font-semibold">
                            <span className={`${inMonth ? "text-neutral-900" : "text-neutral-400"}`}>{date.getDate()}</span>
                            {isToday && <span className="rounded-full bg-neutral-900 px-2 py-[2px] text-[10px] font-bold text-white">Heute</span>}
                          </div>
                          <div className="space-y-1">
                            {dayEvents.slice(0, 3).map((ev) => (
                              <div key={ev.id} className="flex items-center gap-1 rounded-lg bg-neutral-50 px-2 py-1 text-[11px] font-semibold text-neutral-700">
                                <span className={`h-2 w-2 rounded-full ${ev.phase === "confirmed" ? "bg-emerald-500" : "bg-sky-500"}`} />
                                <span className="truncate">{ev.title}</span>
                              </div>
                            ))}
                            {dayEvents.length > 3 && (
                              <div className="text-[10px] font-semibold text-neutral-500">+{dayEvents.length - 3} mehr</div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-neutral-800">Selected Day</h3>
                      {selectedDate && (
                        <span className="text-xs font-semibold text-neutral-500">
                          {new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                        </span>
                      )}
                    </div>
                    <div className="space-y-3">
                      {selectedDayEvents.length
                        ? selectedDayEvents.map((entry) => renderCalendarEntry(entry, Date.now()))
                        : <p className="text-sm text-neutral-500">Choose a date to see details.</p>}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-neutral-800">Upcoming</h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowUpcoming((v) => !v)}
                        className="text-xs font-semibold text-neutral-500 hover:text-neutral-800"
                      >
                        {showUpcoming ? "Hide" : "Show"}
                      </button>
                      <button
                        onClick={loadCalendar}
                        className="text-xs font-semibold text-neutral-500 hover:text-neutral-800"
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
                                className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 hover:border-neutral-300"
                              >
                                <div className="min-w-0">
                                  <div className="font-semibold truncate">{entry.title}</div>
                                  <div className="text-[11px] text-neutral-500 truncate">
                                    {new Date(entry.startsAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                    {" • "}
                                    {timeUntil(entry.startsAt)}
                                  </div>
                                </div>
                                <span className={`ml-2 h-2 w-2 rounded-full ${entry.phase === "confirmed" ? "bg-emerald-500" : "bg-sky-500"}`} />
                              </div>
                            ))
                          : <p className="text-sm text-neutral-500">No scheduled activities.</p>}
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
                        : <p className="text-sm text-neutral-500">Nothing yet.</p>}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
