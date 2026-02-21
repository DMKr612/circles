import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from "../../lib/supabase";
import { checkGroupJoinBlock, joinBlockMessage } from "../../lib/ratings";
import { Search, MapPin, ArrowLeft, Clock, HelpCircle, Lightbulb } from "lucide-react";
import { GAME_LIST } from "../../lib/constants";
import { useAuth } from "../../App";

type Group = {
  id: string;
  title: string | null;
  description: string | null;
  game: string | null;
  category: string | null;
  is_online: boolean | null;
  online_link: string | null;
  city: string | null;
  created_at: string | null;
  code?: string | null;
  capacity?: number | null;
  requires_verification_level?: number | null;
};

const GROUP_LIST_FIELDS = [
  "id",
  "title",
  "description",
  "game",
  "category",
  "is_online",
  "online_link",
  "city",
  "created_at",
  "code",
  "capacity",
  "requires_verification_level",
].join(",");

function fmtDate(d?: string | null) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString(); } catch { return ''; }
}

function normCity(s?: string | null) {
  if (!s) return '';
  try {
    return s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  } catch {
    return s.toLowerCase().trim();
  }
}

export default function GroupsByGame() {
  const { user } = useAuth();
  const userId = user?.id || null;

  const { game = '' } = useParams();
  const key = (game || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
  const gameMeta = useMemo(() => GAME_LIST.find(g => g.id === key) || null, [key]);
  const display = (game || '').replace(/-/g, ' ').trim();
  const displayName = gameMeta?.name || display || 'Game';
  const howTo = useMemo(() => {
    const raw = gameMeta?.howTo;
    if (!raw) return [] as string[];
    return (Array.isArray(raw) ? raw : [raw]).map((s) => s.trim()).filter(Boolean);
  }, [gameMeta]);

  const [rows, setRows] = useState<Group[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [memberOf, setMemberOf] = useState<Set<string>>(new Set());
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinedCount, setJoinedCount] = useState<number>(0);
  const [myVerificationLevel, setMyVerificationLevel] = useState<number>(1);
  const MAX_GROUPS = 7;

  const [sortBy, setSortBy] = useState<'new' | 'online'>('new');
  const [onlineCounts, setOnlineCounts] = useState<Record<string, number>>({});
  
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cityMode, setCityMode] = useState<'all' | 'mine'>('all');
  const [myCity, setMyCity] = useState<string | null>(null);
  const [myCityLoading, setMyCityLoading] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    setShowGuide(false);
  }, [key]);

  // Fetch User's City
  async function refreshMyCity() {
    try {
      setMyCityLoading(true);
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id ?? null;
      if (!uid) { setMyCity(null); setMyCityLoading(false); return; }
      
      const { data: prof } = await supabase
        .from('profiles')
        .select('city')
        .eq('user_id', uid)
        .maybeSingle();
        
      const val = (prof?.city as string) || null;
      const normalized = val && typeof val === 'string' ? val.trim() : null;
      setMyCity(normalized);
    } catch {
      setMyCity(null);
    } finally {
      setMyCityLoading(false);
    }
  }

  // Initial Data Load
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      
      // Build query: Find groups for this game OR match the code directly if user typed a code
      let q = supabase
        .from('groups')
        .select(GROUP_LIST_FIELDS)
        .order('created_at', { ascending: false })
        .limit(100);

      // Basic filter: Match the game slug/title
      // We fetch mostly everything for this game, then filter in memory for search
      // If the user searches for a specific code globally, we handle that in memory below
      // or you could make a separate query if you want global code search.
      // For now, let's assume we are browsing groups FOR THIS GAME.
      q = q.or(`game_slug.eq.${key},game.ilike.${display}`);

      const { data, error } = await q;
      
      if (!mounted) return;
      if (error) {
        setErr(error.message);
      } else {
        const gs = (data ?? []) as Group[];
        setRows(gs);
        
        // Fetch online counts
        try {
          const ids = gs.map((g) => g.id).filter(Boolean);
          if (ids.length) {
            const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            const { data: reads } = await supabase
              .from('group_reads')
              .select('group_id')
              .in('group_id', ids)
              .gt('last_read_at', since);
            
            const map: Record<string, number> = {};
            (reads ?? []).forEach((r: any) => {
              const k = String(r.group_id);
              map[k] = (map[k] ?? 0) + 1;
            });
            setOnlineCounts(map);
          }
        } catch (e) { console.warn(e); }
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [key, display]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!userId) { 
        setMemberOf(new Set());
        setJoinedCount(0);
        setMyVerificationLevel(1);
        return;
      }
      try {
        const { data: prof } = await supabase.from('profiles').select('verification_level').eq('user_id', userId).maybeSingle();
        if (active) setMyVerificationLevel(prof?.verification_level ?? 1);
      } catch {
        if (active) setMyVerificationLevel(1);
      }
      const { data, count } = await supabase
        .from('group_members')
        .select('group_id', { count: 'exact' })
        .eq('user_id', userId)
        .eq('status', 'active');
      if (!active) return;
      const ids = new Set((data ?? []).map((r: any) => r.group_id));
      setMemberOf(ids);
      setJoinedCount(count ?? (data?.length ?? 0));
    })();
    return () => { active = false; };
  }, [userId]);

  async function joinGroup(group: Group) {
    if (!userId) { setErr('Sign in required'); return; }
    if (joinedCount >= MAX_GROUPS) { setErr('You can only be in 7 circles at a time. Leave one to join another.'); return; }

    const requiredLevel = Number(group.requires_verification_level ?? 1);
    if (myVerificationLevel < requiredLevel) {
      setErr('This circle is for verified members only. Increase your verification level to join.');
      return;
    }
    const blockReason = await checkGroupJoinBlock(userId, group.id);
    if (blockReason) {
      const message = joinBlockMessage(blockReason);
      window.alert(message);
      setErr(message);
      return;
    }

    setJoiningId(group.id);
    const { error } = await supabase.from('group_members').insert({ group_id: group.id, user_id: userId, role: 'member', status: 'active', last_joined_at: new Date().toISOString() });
    setJoiningId(null);
    
    if (!error || error.code === '23505') {
      const next = new Set(memberOf);
      next.add(group.id);
      setMemberOf(next);
      setJoinedCount((c) => Math.min(MAX_GROUPS, c + (memberOf.has(group.id) ? 0 : 1)));
    } else {
      const text = (error.message || '').toLowerCase();
      if (text.includes('group_join_limit')) setErr('You can only be in 7 circles at a time. Leave one to join another.');
      else if (text.includes('verification')) setErr('This circle is for verified members only.');
      else setErr(error.message);
    }
  }

  // Filter & Sort
  const visibleRows = useMemo(() => {
    let list = [...rows];

    // 1. City Mode Filter
    if (cityMode === 'mine' && myCity) {
      const mc = normCity(myCity);
      list = list.filter(r => normCity(r.city).includes(mc));
    }

    // 2. Search Query (City OR Code OR Title)
    const q = searchQuery.trim().toLowerCase();
    if (q) {
        list = list.filter(r => 
            normCity(r.city).includes(q) || 
            (r.code && r.code.toLowerCase().includes(q)) || // SEARCH BY CODE
            (r.title && r.title.toLowerCase().includes(q))
        );
    }

    // 3. Sort
    if (sortBy === 'online') {
      list.sort((a, b) => (onlineCounts[b.id] ?? 0) - (onlineCounts[a.id] ?? 0));
    } else {
      list.sort((a, b) =>
        new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime()
      );
    }
    return list;
  }, [rows, cityMode, myCity, searchQuery, sortBy, onlineCounts]);

  // Trigger my-city fetch if needed
  useEffect(() => {
    if (cityMode === 'mine' && !myCity && !myCityLoading) {
      refreshMyCity();
    }
  }, [cityMode]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 pb-32">
      
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
             <Link to="/browse" className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200 transition-colors">
               <ArrowLeft className="h-4 w-4 text-neutral-700" />
             </Link>
            <span className="text-sm font-semibold text-neutral-500 uppercase tracking-wider">Game</span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900 capitalize">{displayName}</h1>
        <p className="mt-2 text-neutral-600">
            {rows.length} active group{rows.length !== 1 && 's'} found.
        </p>
        <p className="mt-1 text-xs font-semibold text-neutral-500">Joined {joinedCount}/{MAX_GROUPS} circles.</p>
        {howTo.length > 0 && (
          <div className="mt-3 space-y-2">
            <button
              onClick={() => setShowGuide((v) => !v)}
              className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 text-xs font-bold text-neutral-800 shadow-sm hover:border-neutral-300"
            >
              <HelpCircle className="h-4 w-4" />
              {showGuide ? "Hide how to play" : "How to play"}
            </button>
            {showGuide && (
              <div className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm">
                <div className="flex gap-3">
                  <div className="mt-0.5"><Lightbulb className="h-5 w-5 text-amber-500" /></div>
                  <div className="flex-1 space-y-2 text-sm text-neutral-700 leading-relaxed">
                    {howTo.map((line, idx) => (
                      <div key={idx} className="flex gap-3">
                        <span className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-neutral-900 text-[11px] font-bold text-white">{idx + 1}</span>
                        <p className="flex-1">{line}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {err && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
            {err}
            <button onClick={() => setErr(null)} className="text-red-500 hover:text-red-700">×</button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="sticky top-0 z-20 mb-6 flex flex-col gap-3 bg-neutral-50/95 py-2 backdrop-blur-sm sm:flex-row sm:items-center">
          <div className="relative flex-1">
             <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
             <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search city, title, or code..."
              className="w-full rounded-xl border border-neutral-200 bg-white py-2 pl-9 pr-4 text-sm outline-none focus:border-black focus:ring-1 focus:ring-black"
            />
          </div>
          
          <div className="flex gap-2">
            <select
              value={cityMode}
              onChange={(e) => setCityMode(e.target.value as 'all' | 'mine')}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-black"
            >
              <option value="all">All Cities</option>
              <option value="mine">My City {myCity ? `(${myCity})` : ''}</option>
            </select>
            
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium outline-none focus:border-black"
            >
              <option value="new">Newest</option>
              <option value="online">Active</option>
            </select>
          </div>
      </div>

      {/* List */}
      <ul className="space-y-3">
        {visibleRows.map(g => (
            <li key={g.id} className="group relative overflow-hidden rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm transition-all hover:shadow-md active:scale-[0.99]">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <h2 className="truncate text-base font-bold text-neutral-900">
                                {g.title || "Untitled Group"}
                            </h2>
                            {g.is_online && (
                                <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-100">
                                    ONLINE
                                </span>
                            )}
                        </div>
                        
                        <p className="line-clamp-1 text-sm text-neutral-600 mb-3">
                            {g.description || "No description"}
                        </p>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500 font-medium">
                            <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {g.city || "Anywhere"}
                            </span>
                            <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {fmtDate(g.created_at)}
                            </span>
                            {g.code && (
                                <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-600">
                                    #{g.code}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                         {memberOf.has(g.id) ? (
                             <Link 
                                to={`/group/${g.id}`}
                                className="rounded-full border border-neutral-200 bg-white px-4 py-1.5 text-xs font-bold text-neutral-900 hover:bg-neutral-50 transition-colors"
                             >
                                Open
                             </Link>
                         ) : (
                             <button 
                                onClick={() => joinGroup(g)}
                                disabled={joiningId === g.id || joinedCount >= MAX_GROUPS}
                                className="rounded-full bg-black px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-neutral-800 disabled:opacity-50 transition-all"
                             >
                                {joiningId === g.id ? "Joining..." : joinedCount >= MAX_GROUPS ? "Limit Reached" : "Join"}
                             </button>
                         )}
                    </div>
                </div>
            </li>
        ))}
      </ul>
      {!loading && !err && visibleRows.length === 0 && (
        <div className="py-10 text-center text-neutral-500">No groups found.</div>
      )}
    </main>
  );
}
