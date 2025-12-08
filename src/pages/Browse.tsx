import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CATEGORIES, GAME_LIST } from "@/lib/constants";
import { Search, Users, Tag, MapPin, Globe, Loader2 } from "lucide-react";
import type { BrowseGroupRow } from "@/types";

type MomentCard = {
  id: string;
  photo_url: string;
  caption?: string | null;
  verified: boolean;
  min_view_level: number | null;
  created_at: string;
  group_id: string;
  groups?: { title?: string | null; city?: string | null } | null;
};

/**
 * BrowsePage
 * Modern, mobile-optimized browse screen.
 * "Filter by Game" removed. "Recent Groups" is collapsible and shows location context.
 */

export default function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState<string>(params.get("q") ?? "");
  const [debouncedQ, setDebouncedQ] = useState<string>(params.get("q") ?? "");
  const [cat, setCat] = useState<typeof CATEGORIES[number]>(
    (params.get("category") as typeof CATEGORIES[number]) ?? "All"
  );
  const [tab, setTab] = useState<"discover" | "moments">("discover");
  const [slide, setSlide] = useState<0 | 1>(0);

  const [nearGroups, setNearGroups] = useState<BrowseGroupRow[]>([]);
  const [nearLoading, setNearLoading] = useState(false);
  const [radiusKm, setRadiusKm] = useState<number>(10);
  const [geoStatus, setGeoStatus] = useState<"idle" | "pending" | "granted" | "denied">("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoPaused, setGeoPaused] = useState(false);

  // Stats
  const [groupCountByGame, setGroupCountByGame] = useState<Record<string, number>>({});
  const [memberCountByGame, setMemberCountByGame] = useState<Record<string, number>>({});
  const [totalOnlineLive, setTotalOnlineLive] = useState<number>(0);

  // User's city for the "recent groups" button label context
  const [userCity, setUserCity] = useState<string | null>(null);
  const [myVerificationLevel, setMyVerificationLevel] = useState<number>(1);
  const [moments, setMoments] = useState<MomentCard[]>([]);
  const [momentsLoading, setMomentsLoading] = useState(false);
  const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL || "support@circles.app";

  // Request Modal
  const [showReq, setShowReq] = useState(false);
  const [reqName, setReqName] = useState("");
  const [reqNote, setReqNote] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const [reqMsg, setReqMsg] = useState<string | null>(null);

  // Sync URL
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (cat && cat !== "All") next.set("category", cat); else next.delete("category");
    if (q) next.set("q", q); else next.delete("q");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [q, cat]);

  // Debounce search to avoid unnecessary filtering work
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 220);
    return () => clearTimeout(t);
  }, [q]);

  // Load User City (for the dropdown label)
  useEffect(() => {
    (async () => {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;
        const { data: prof } = await supabase.from('profiles').select('city, verification_level').eq('user_id', u.user.id).maybeSingle();
        if (prof?.city) setUserCity(prof.city);
        if (prof?.verification_level) setMyVerificationLevel(prof.verification_level);
    })();
  }, []);

  const requestLocation = () => {
    if (!("geolocation" in navigator)) {
      setGeoStatus("denied");
      return;
    }
    setGeoStatus("pending");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus("granted");
      },
      () => setGeoStatus("denied"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // Auto-request once when user switches to Nearby
  useEffect(() => {
    if (tab !== "discover" || slide !== 1 || geoPaused) return;
    if (geoStatus === "idle") requestLocation();
  }, [tab, slide, geoStatus, geoPaused]);

  // When returning to "All groups", stop location tracking and clear nearby list
  useEffect(() => {
    if (slide !== 0) return;
    setCoords(null);
    setGeoStatus("idle");
    setGeoPaused(true);
    setNearGroups([]);
  }, [slide]);

  // If permission is denied, ensure everything is off
  useEffect(() => {
    if (geoStatus !== "denied") return;
    setCoords(null);
    setNearGroups([]);
    setGeoPaused(true);
  }, [geoStatus]);

  const fallbackCity = userCity || "Freiburg";

  // Load Nearby (city-based fallback; radius widens to all groups if increased)
  useEffect(() => {
    if (tab !== "discover" || slide !== 1) return;
    let cancelled = false;
    (async () => {
      setNearLoading(true);
      try {
        let query = supabase
          .from("groups")
          .select("id, title, description, city, category, game, capacity, created_at, code")
          .order("created_at", { ascending: false })
          .limit(50);

        // If user has a city and radius is small, constrain to that city (fallback proximity)
        if (radiusKm <= 20) {
          query = query.eq("city", fallbackCity);
        }

        const { data, error } = await query;
        if (cancelled) return;
        if (error) {
          console.error(error);
          setNearGroups([]);
        } else {
          setNearGroups(data || []);
        }
      } finally {
        if (!cancelled) setNearLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, slide, userCity, radiusKm]);
  // Load Stats
  useEffect(() => {
    let mounted = true;
    (async () => {
      // FIX: Added 'group_id' to selection so we can distinguish unique groups
      const { data: gm } = await supabase.from("group_members").select("user_id, group_id, groups(game)");
      if (!mounted || !gm) return;
      
      const uniqueGroups: Record<string, Set<string>> = {}; // To count unique groups
      const mc: Record<string, number> = {}; // To count total members
      const users = new Set<string>();

      gm.forEach((r: any) => {
         const g = (r.groups?.game || "").toLowerCase();
         const gid = r.group_id;

         if (g && gid) {
             // 1. Member Count: Increment for every row
             mc[g] = (mc[g] || 0) + 1;

             // 2. Group Count: Add ID to Set (automatically handles duplicates)
             if (!uniqueGroups[g]) uniqueGroups[g] = new Set();
             uniqueGroups[g].add(gid);
         }
         if (r.user_id) users.add(r.user_id);
      });

      // Convert Sets to numbers for the state
      const gc: Record<string, number> = {};
      Object.keys(uniqueGroups).forEach(k => {
        gc[k] = uniqueGroups[k].size;
      });

      setGroupCountByGame(gc);
      setMemberCountByGame(mc);
      setTotalOnlineLive(users.size);
    })();
    return () => { mounted = false; };
  }, []);

  // Online now (unique users with live locations updated in last 5 minutes)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data, error } = await supabase.rpc("count_online_users", { p_since: since });
      if (!cancelled) {
        if (error) {
          console.warn("online count fallback", error.message);
          const { data: rows } = await supabase
            .from("group_live_locations")
            .select("user_id")
            .gte("updated_at", since);
          if (rows) {
            const uniq = new Set((rows as any[]).map(r => r.user_id).filter(Boolean));
            setTotalOnlineLive(uniq.size);
          }
        } else if (typeof data === "number") {
          setTotalOnlineLive(data);
        }
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (tab !== "moments") return;
    let mounted = true;
    (async () => {
      setMomentsLoading(true);
      const { data, error } = await supabase
        .from("group_moments")
        .select("id, photo_url, caption, verified, min_view_level, created_at, group_id, groups(title, city)")
        .order("created_at", { ascending: false })
        .limit(20);
      if (!mounted) return;
      if (!error) setMoments((data as MomentCard[]) ?? []);
      setMomentsLoading(false);
    })();
    return () => { mounted = false; };
  }, [tab]);

  async function reportMoment(m: MomentCard) {
    const { data: auth } = await supabase.auth.getUser();
    const reporter = auth?.user?.id ? `Reporter: ${auth.user.id}` : "Reporter: anonymous";
    const subject = encodeURIComponent(`Moment review request ${m.id}`);
    const body = encodeURIComponent(
      [
        `Moment ID: ${m.id}`,
        `Group ID: ${m.group_id}`,
        `Group title: ${m.groups?.title || ""}`,
        reporter,
        "",
        "Reason: "
      ].join("\n")
    );
    window.location.href = `mailto:${supportEmail}?subject=${subject}&body=${body}`;
  }

  // Filter games for the dropdown based on search/category
  const filteredGames = useMemo(() => {
    const byCat = cat === "All" ? GAME_LIST : GAME_LIST.filter(g => g.tag === cat);
    const mapped = byCat.map((g) => ({
      ...g,
      groups: groupCountByGame[g.id] || 0,
      members: memberCountByGame[g.id] || 0
    }));
    mapped.sort((a, b) => (b.members - a.members) || (b.groups - a.groups) || a.name.localeCompare(b.name));
    if (!debouncedQ) return mapped;
    return mapped.filter(g => g.name.toLowerCase().includes(debouncedQ.toLowerCase()));
  }, [debouncedQ, cat, groupCountByGame, memberCountByGame]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 pb-32">
      
      {/* Header Area */}
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-neutral-900 tracking-tight">Discover</h1>
        
        <div className="mt-3 flex items-center justify-between">
           <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              {totalOnlineLive} Online Now
           </div>
           <div className="flex items-center gap-2">
             <button onClick={() => setShowReq(true)} className="text-sm font-semibold text-neutral-500 hover:text-black underline">
                Request Game
             </button>
           </div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab("discover")}
          className={`rounded-full px-4 py-2 text-sm font-bold border ${tab === "discover" ? "bg-black text-white border-black" : "bg-white text-neutral-700 border-neutral-200"}`}
        >
          Circles
        </button>
        <button
          onClick={() => setTab("moments")}
          className={`rounded-full px-4 py-2 text-sm font-bold border ${tab === "moments" ? "bg-black text-white border-black" : "bg-white text-neutral-700 border-neutral-200"}`}
        >
          Moments
        </button>
      </div>

      {tab === "moments" ? (
        <div className="space-y-4">
          {momentsLoading && <div className="text-sm text-neutral-500">Loading meetups...</div>}
          {!momentsLoading && moments.length === 0 && (
            <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-6 text-center text-sm text-neutral-500">
              No verified meetups yet. Be the first to share a Moment.
            </div>
          )}
          <div className="grid gap-4">
            {moments.map((m) => {
              const needsReview = !m.verified || myVerificationLevel < (m.min_view_level ?? 1);
              return (
                <div key={m.id} className="overflow-hidden rounded-2xl border border-neutral-100 bg-white shadow-sm">
                  <div className="relative">
                    <img src={m.photo_url} className="h-56 w-full object-cover" loading="lazy" />
                    <div className="absolute top-3 left-3 rounded-full bg-black/70 text-white text-[10px] font-bold px-2 py-1">
                      {m.verified ? "Verified meetup" : "Unverified"} • {m.id.slice(0, 8)}
                    </div>
                    {needsReview && (
                      <div className="absolute inset-0 flex items-end justify-start p-3">
                        <button
                          type="button"
                          onClick={() => reportMoment(m)}
                          className="rounded-lg bg-white/90 text-[11px] font-bold text-neutral-800 px-3 py-1.5 shadow-sm border border-neutral-200 hover:bg-white"
                        >
                          Not yet reviewed — report if inappropriate
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="p-3 space-y-1">
                    <div className="text-sm font-bold text-neutral-900">{m.groups?.title || "Circle"}</div>
                    <div className="text-xs text-neutral-500">{m.groups?.city || "Anywhere"} • {new Date(m.created_at).toLocaleDateString()}</div>
                    {m.caption && <div className="text-xs text-neutral-600">{m.caption}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          {/* Search & Filter Bar */}
          <div className="sticky top-0 z-30 bg-neutral-50/95 py-3 backdrop-blur-md mb-6 -mx-4 px-4 border-b border-neutral-100 transition-all">
            <div className="relative mb-3">
              <Search className="absolute left-3.5 top-3 h-5 w-5 text-neutral-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search games or categories..."
                className="w-full h-11 rounded-xl border border-neutral-200 bg-white pl-11 pr-4 text-sm shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black transition-all placeholder:text-neutral-400"
              />
            </div>
            
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {CATEGORIES.map(c => (
                <button
                  key={c}
                  onClick={() => { setCat(c); }} 
                  className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                    cat === c 
                      ? "bg-neutral-900 text-white shadow-md scale-105" 
                      : "bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-100"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Slides: All vs Nearby */}
          <div className="mb-4 flex items-center gap-2">
            <button
              onClick={() => setSlide(0)}
              className={`rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${slide === 0 ? "bg-black text-white border-black" : "bg-white text-neutral-700 border-neutral-200 hover:border-neutral-300"}`}
            >
              All groups
            </button>
            <button
              onClick={() => setSlide(1)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${slide === 1 ? "bg-black text-white border-black" : "bg-white text-neutral-700 border-neutral-200 hover:border-neutral-300"}`}
            >
              Nearby
              <span
                className={`h-2.5 w-2.5 rounded-full border ${geoStatus === "granted" ? "bg-emerald-500 border-emerald-600" : geoStatus === "pending" ? "bg-amber-400 border-amber-500" : "bg-rose-500 border-rose-600"}`}
                title={geoStatus === "granted" ? "Location on" : geoStatus === "pending" ? "Locating..." : "Location off"}
              />
            </button>
          </div>

          {slide === 1 && (
            <div className="mb-5 rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-neutral-900">Nearby groups</div>
                <div className="text-xs text-neutral-500">
                  {userCity ? `Using ${userCity}${coords ? " + GPS" : ""} · ${radiusKm} km` : `Using ${fallbackCity} · ${radiusKm} km (set your city for accuracy)`}
                </div>
              </div>
              <button
                onClick={() => {
                  if (geoStatus === "granted" || geoStatus === "pending") {
                    setCoords(null);
                    setGeoStatus("idle");
                    setNearGroups([]);
                    setGeoPaused(true);
                  } else {
                    setGeoPaused(false);
                    requestLocation();
                  }
                }}
                className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:border-neutral-300"
              >
                {geoStatus === "granted"
                  ? "Location on — turn off"
                  : geoStatus === "pending"
                    ? "Locating..."
                    : "Use my location"}
              </button>
            </div>
              <div>
                <label className="text-xs font-medium text-neutral-500">Radius: {radiusKm} km</label>
                <input
                  type="range"
                  min={5}
                  max={50}
                  step={5}
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value))}
                  className="w-full accent-black"
                />
                <p className="text-[11px] text-neutral-500 mt-1">
                  {radiusKm <= 20 && userCity ? `Showing circles in ${userCity}` : "Showing wider results"}
                </p>
                {geoStatus === "denied" && (
                  <p className="text-[11px] text-rose-600 mt-1">
                    Location permission blocked. Enable it in your browser to filter by GPS.
                  </p>
                )}
              </div>
              <div className="space-y-3">
                {nearLoading && (
                  <div className="flex items-center gap-2 text-sm text-neutral-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading nearby circles…
                  </div>
                )}
                {!nearLoading && nearGroups.length === 0 && (
                  <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
                    No nearby circles yet. Try increasing the radius.
                  </div>
                )}
                {!nearLoading && nearGroups.length > 0 && (
                  <div className="grid gap-3">
                    {nearGroups.map(g => (
                      <Link to={`/group/${g.id}`} key={g.id} className="block group">
                        <div className="relative overflow-hidden rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm transition-all hover:shadow-md hover:border-neutral-200 active:scale-[0.99]">
                          <div className="flex justify-between items-start">
                            <div className="flex-1 min-w-0 pr-4">
                              <h3 className="font-bold text-neutral-900 text-base truncate">{g.title}</h3>
                              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-neutral-500 font-medium">
                                <span className="capitalize text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-bold">{g.game || g.category}</span>
                                <span className="flex items-center gap-1">
                                  {g.city ? <MapPin className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                                  {g.city || "Online"}
                                </span>
                              </div>
                            </div>
                          </div>
                          {g.description && (
                            <p className="mt-3 text-sm text-neutral-600 line-clamp-2 leading-relaxed">{g.description}</p>
                          )}
                          {g.code && (
                            <div className="mt-3 pt-3 border-t border-neutral-50 flex items-center gap-2">
                              <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Invite Code</span>
                              <span className="font-mono text-xs font-bold text-neutral-700 bg-neutral-100 px-1.5 py-0.5 rounded">{g.code}</span>
                            </div>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION: Games Grid (hidden on Nearby) */}
          {slide === 0 && (
            <section>
              <h2 className="text-lg font-bold text-neutral-900 mb-4">Browse by Category</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {filteredGames.map(g => (
                   <Link to={`/groups/game/${g.id}`} key={g.id} className="block group">
                      <div className="flex items-center p-5 rounded-2xl border border-neutral-100 bg-gradient-to-r from-white via-neutral-50 to-white shadow-sm transition-all hover:shadow-lg hover:-translate-y-0.5 hover:border-neutral-200 active:scale-[0.98]">
                         <div className="h-14 w-14 flex items-center justify-center text-3xl rounded-2xl mr-4 shadow-inner ring-2 ring-black/5 bg-white">
                            {g.image}
                         </div>
                         <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                               <h3 className="font-extrabold text-neutral-900 truncate">{g.name}</h3>
                               <span className="text-[10px] font-bold bg-neutral-900 text-white px-2 py-0.5 rounded-full uppercase tracking-wide">
                                  {g.tag}
                               </span>
                            </div>
                            <p className="text-xs text-neutral-600 truncate mt-1">{g.blurb}</p>
                            <div className="flex items-center gap-3 mt-2 text-[11px] font-semibold text-neutral-500">
                               <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {memberCountByGame[g.id] || 0}</span>
                               <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {groupCountByGame[g.id] || 0} groups</span>
                            </div>
                         </div>
                      </div>
                   </Link>
                ))}
              </div>
              {filteredGames.length === 0 && (
                  <div className="py-12 text-center text-neutral-500">
                      No games found. Try a different search.
                  </div>
              )}
            </section>
          )}
        </>
      )}

      {/* Request Modal */}
      {showReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowReq(false)} />
           <div className="relative w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl animate-in zoom-in-95 duration-200">
              <h3 className="text-xl font-bold text-neutral-900 mb-2">Request Game</h3>
              <p className="text-sm text-neutral-500 mb-6">Don't see your favorite game? Let us know.</p>
              
              <div className="space-y-4">
                 <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-1">Game Name</label>
                    <input 
                       value={reqName}
                       onChange={e => setReqName(e.target.value)}
                       className="w-full rounded-xl border-2 border-neutral-100 px-4 py-3 text-sm font-bold focus:border-black focus:ring-0 outline-none transition-colors"
                       placeholder="e.g. Catan"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-1">Why?</label>
                    <textarea 
                       value={reqNote}
                       onChange={e => setReqNote(e.target.value)}
                       className="w-full rounded-xl border-2 border-neutral-100 px-4 py-3 text-sm focus:border-black focus:ring-0 outline-none transition-colors resize-none"
                       rows={3}
                       placeholder="It's super popular..."
                    />
                 </div>
                 
                 {reqMsg && <p className="text-sm font-medium text-emerald-600 text-center">{reqMsg}</p>}

                 <div className="flex gap-3 pt-2">
                    <button onClick={() => setShowReq(false)} className="flex-1 rounded-xl font-bold text-neutral-500 hover:bg-neutral-50 py-3 text-sm transition-colors">Cancel</button>
                    <button 
                       disabled={reqBusy || !reqName}
                       onClick={async () => {
                          setReqBusy(true);
                          const { data: u } = await supabase.auth.getUser();
                          await supabase.from("category_requests").insert({
                              name: reqName, note: reqNote, requested_by: u.user?.id
                          });
                          setReqMsg("Request sent! Thanks.");
                          setTimeout(() => { setShowReq(false); setReqMsg(null); setReqName(""); }, 1500);
                          setReqBusy(false);
                       }}
                       className="flex-1 rounded-xl bg-black text-white font-bold py-3 text-sm shadow-lg active:scale-95 transition-all disabled:opacity-50 disabled:scale-100"
                    >
                       {reqBusy ? "Sending..." : "Submit"}
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
