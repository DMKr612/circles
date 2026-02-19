import { useEffect, useState, useRef, lazy, Suspense, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { MessageSquare, Users, ArrowLeft, Send, Search as SearchIcon, Filter, Heart, Megaphone } from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import ViewOtherProfileModal from "@/components/ViewOtherProfileModal";
import { getAvatarUrl } from "@/lib/avatar";
import { isAnnouncementVisibleForViewer } from "@/lib/announcements";

// Lazy load the existing group chat component
const ChatPanel = lazy(() => import("../components/ChatPanel"));

type ChatItem = {
  type: 'group' | 'dm' | 'announcement';
  id: string; 
  name: string;
  avatar_url: string | null;
  subtitle: string;
  isFavorite?: boolean;
  category?: 'announcement' | 'group';
};

type DMMsg = {
  id: string;
  sender: string;
  receiver: string;
  content: string;
  created_at: string;
};

export default function Chats() {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<string | null>(null);
  const [list, setList] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Selection State
  const [selected, setSelected] = useState<ChatItem | null>(null);

  // Profile Modal State
  const [viewProfileId, setViewProfileId] = useState<string | null>(null);

  // DM Specific State
  const [dmMessages, setDmMessages] = useState<DMMsg[]>([]);
  const [dmInput, setDmInput] = useState("");
  const [dmLoading, setDmLoading] = useState(false);
  const dmListRef = useRef<HTMLDivElement>(null);
  const dmInputRef = useRef<HTMLInputElement>(null);

  const [filter, setFilter] = useState<"all" | "groups" | "dms" | "fav">("all");
  const [search, setSearch] = useState("");
  const shellStyle: CSSProperties = {
    "--chat-surface": "rgba(255, 255, 255, 0.78)",
    "--chat-surface-strong": "rgba(255, 255, 255, 0.96)",
    "--chat-border": "rgba(148, 163, 184, 0.35)",
    "--chat-accent": "#0f766e",
    "--chat-accent-strong": "#0d9488",
    "--chat-accent-wash": "rgba(13, 148, 136, 0.16)",
  };
  const listItemStagger = (index: number): CSSProperties => ({
    animationDelay: `${Math.min(index, 10) * 40}ms`,
    animationFillMode: "both",
  });
  const shouldFocusDmInput = () =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
  const focusDmInput = () => {
    if (!shouldFocusDmInput()) return;
    const el = dmInputRef.current;
    if (!el) return;
    requestAnimationFrame(() => el.focus({ preventScroll: true }));
  };
  const scrollDmToBottom = () => {
    const el = dmListRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  // 1. Load User & List (Groups + Friends)
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setMe(user.id);
      const viewerEmail = user.email ?? null;

      // Load Favorites from LocalStorage
      const favs = new Set(JSON.parse(localStorage.getItem("chat_favorites") || "[]"));

      const [{ data: groups }, { data: friends }] = await Promise.all([
        supabase
          .from("group_members")
          .select("group_id, groups(id, title, category)")
          .eq("user_id", user.id)
          .in("status", ["active", "accepted"]),
        supabase
          .from("friendships")
          .select("user_id_a, user_id_b")
          .or(`user_id_a.eq.${user.id},user_id_b.eq.${user.id}`)
          .eq("status", "accepted")
      ]);

      const items: ChatItem[] = [];

      // Process Groups
      (groups || []).forEach((g: any) => {
        if (g.groups) {
          items.push({
            type: 'group',
            id: g.groups.id,
            name: g.groups.title || "Group",
            avatar_url: null,
            subtitle: g.groups.category || 'Group',
            isFavorite: favs.has(g.groups.id)
          });
        }
      });

      // Process Announcements (linked circles) for quick access
      let viewerCity: string | null = null;
      let viewerCoords: { lat: number; lng: number } | null = null;
      const profileRes = await supabase
        .from("profiles")
        .select("city, lat, lng")
        .eq("user_id", user.id)
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
          .eq("user_id", user.id)
          .maybeSingle();
        if (!fallbackProfile.error) viewerCity = fallbackProfile.data?.city || null;
      }

      const { data: anns } = await supabase
        .from("announcements")
        .select("id, group_id, title, description, datetime, created_at, created_by, scope_type, country, city, lat, lng, radius_km")
        .not("group_id", "is", null)
        .order("datetime", { ascending: false })
        .limit(50);
      (anns || [])
        .filter((a: any) =>
          isAnnouncementVisibleForViewer(a, {
            viewerId: user.id,
            viewerEmail,
            viewerCity,
            viewerCoords,
          })
        )
        .forEach((a: any) => {
          if (!a.group_id) return;
          // Avoid duplicates if already in list
          if (items.find(i => i.type === 'group' && i.id === a.group_id)) return;
          items.push({
            type: 'announcement',
            id: a.group_id,
            name: a.title || "Announcement",
            avatar_url: null,
            subtitle: "Announcement",
            isFavorite: false,
            category: 'announcement',
          });
        });

      // Process Friends
      if (friends?.length) {
        const friendIds = Array.from(new Set(friends.map((f: any) => 
          f.user_id_a === user.id ? f.user_id_b : f.user_id_a
        )));
        if (friendIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("user_id, name, avatar_url")
            .in("user_id", friendIds);
          
          profiles?.forEach((p: any) => {
            items.push({
              type: 'dm',
              id: p.user_id,
              name: p.name || "User",
              avatar_url: p.avatar_url,
              subtitle: "Direct Message",
              isFavorite: favs.has(p.user_id)
            });
          });
        }
      }

      items.sort((a, b) => {
        // Announcements always on top
        const aAnn = a.type === 'announcement' ? 1 : 0;
        const bAnn = b.type === 'announcement' ? 1 : 0;
        if (aAnn !== bAnn) return bAnn - aAnn;
        // Favorites next
        if (a.isFavorite && !b.isFavorite) return -1;
        if (!a.isFavorite && b.isFavorite) return 1;
        return a.name.localeCompare(b.name);
      });
      setList(items);
      setLoading(false);
    }
    load();
  }, []);

  // Auto-select a group when opened with ?groupId=...
  useEffect(() => {
    if (!location.search || list.length === 0 || selected) return;
    const params = new URLSearchParams(location.search);
    const gid = params.get("groupId");
    if (!gid) return;
    const found = list.find((i) => i.type === 'group' && i.id === gid);
    if (found) setSelected(found);
  }, [location.search, list, selected]);

  // Toggle Favorite Handler
  const toggleFavorite = (id: string) => {
    const favs = new Set(JSON.parse(localStorage.getItem("chat_favorites") || "[]"));
    let isFav = false;
    
    if (favs.has(id)) {
      favs.delete(id);
      isFav = false;
    } else {
      favs.add(id);
      isFav = true;
    }
    
    // Persist
    localStorage.setItem("chat_favorites", JSON.stringify(Array.from(favs)));

    // Update List State
    setList(prev => prev.map(item => 
      item.id === id ? { ...item, isFavorite: isFav } : item
    ).sort((a, b) => {
        // Re-sort on toggle
        if (a.isFavorite && !b.isFavorite) return -1;
        if (!a.isFavorite && b.isFavorite) return 1;
        return a.name.localeCompare(b.name);
    }));

    // Update Selected State if active
    if (selected && selected.id === id) {
      setSelected(prev => prev ? { ...prev, isFavorite: isFav } : null);
    }
  };

  // Auto-select DM if location.state?.openDmId is provided
  useEffect(() => {
    const openId = location.state?.openDmId;
    if (openId && list.length > 0 && !selected) {
      const found = list.find(i => i.id === openId && i.type === 'dm');
      if (found) {
        setSelected(found);
      } else {
        (async () => {
          const { data: p } = await supabase
            .from("profiles")
            .select("name, avatar_url")
            .eq("user_id", openId)
            .single();
          if (p) {
            const favs = new Set(JSON.parse(localStorage.getItem("chat_favorites") || "[]"));
            const newChat: ChatItem = {
              type: "dm",
              id: openId,
              name: p.name || "User",
              avatar_url: p.avatar_url,
              subtitle: "Direct Message",
              isFavorite: favs.has(openId)
            };
            setList((prev) => [newChat, ...prev]);
            setSelected(newChat);
          }
        })();
      }
      window.history.replaceState({}, "");
    }
  }, [location.state, list, selected]);

  // 2. Load DM Messages when a Friend is selected
  useEffect(() => {
    if (!me || !selected || selected.type !== 'dm') return;

    let sub: any = null;
    
    async function loadDMs() {
      setDmLoading(true);
      const otherId = selected!.id;
      
      const { data } = await supabase
        .from("direct_messages")
        .select("id, sender, receiver, content, created_at")
        .or(`and(sender.eq.${me},receiver.eq.${otherId}),and(sender.eq.${otherId},receiver.eq.${me})`)
        .order("created_at", { ascending: true })
        .limit(100);
      
      setDmMessages(data || []);
      setDmLoading(false);
      setTimeout(() => scrollDmToBottom(), 100);

      sub = supabase.channel(`dm:${otherId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `or(and(sender.eq.${me},receiver.eq.${otherId}),and(sender.eq.${otherId},receiver.eq.${me}))` },
          (payload) => {
            const newMsg = payload.new as DMMsg;
            const isMatch = 
              (newMsg.sender === me && newMsg.receiver === otherId) ||
              (newMsg.sender === otherId && newMsg.receiver === me);

            if (isMatch) {
              setDmMessages(prev => [...prev, newMsg]);
              setTimeout(() => scrollDmToBottom(), 100);
            }
          }
        )
        .subscribe();
    }

    const refreshOnFocus = async () => {
      if (!me || !selected || selected.type !== 'dm') return;
      const otherId = selected.id;
      const { data } = await supabase
        .from("direct_messages")
        .select("id, sender, receiver, content, created_at")
        .or(`and(sender.eq.${me},receiver.eq.${otherId}),and(sender.eq.${otherId},receiver.eq.${me})`)
        .order("created_at", { ascending: true })
        .limit(100);
      if (data) setDmMessages(data);
    };

    loadDMs();
    window.addEventListener('focus', refreshOnFocus);

    return () => {
      if (sub) supabase.removeChannel(sub);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [selected, me]);

  // Keep DM input focused when switching threads
  useEffect(() => {
    if (selected?.type !== 'dm') return;
    focusDmInput();
  }, [selected]);

  // 3. Send DM
  const sendDM = async (preset?: string) => {
    const text = (preset ?? dmInput).trim();
    if (!text || !me || !selected || selected.type !== 'dm') return;
    setDmInput("");
    focusDmInput();
    await supabase.from("direct_messages").insert({
      sender: me,
      receiver: selected.id,
      content: text
    });
  };

  const getFilteredList = () => {
    return list.filter(item => {
      if(filter === "groups" && item.type !== "group") return false;
      if(filter === "dms" && item.type !== "dm") return false;
      if(filter === "private" && item.type !== "dm") return false; // legacy fallback
      if(filter === "fav" && !item.isFavorite) return false;
      if (!item.name) return false;
      if(!item.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  };

  const filteredList = getFilteredList();

  const FilterPill = ({ id, label }: { id: string; label: string }) => (
    <button
      onClick={() => setFilter(id)}
      className={`
        whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all border
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30
        ${filter === id
          ? "bg-gradient-to-r from-neutral-900 via-neutral-800 to-emerald-700 text-white border-transparent shadow-[0_10px_25px_rgba(5,150,105,0.25)]"
          : "bg-white/70 text-neutral-600 border-[color:var(--chat-border)] hover:bg-white hover:text-neutral-900"}
      `}
    >
      {label}
    </button>
  );

  // Component: The Chat List (Sidebar)
  const ChatList = () => (
    <div className={`relative flex h-full min-h-0 flex-col w-full md:w-[340px] lg:w-[400px] ${selected ? 'hidden md:flex' : 'flex'} bg-[color:var(--chat-surface)] backdrop-blur-xl border border-[color:var(--chat-border)] md:rounded-[28px] shadow-none md:shadow-[0_30px_80px_rgba(15,23,42,0.12)] overflow-hidden`}>
      <div className="p-5 pt-6 pb-4 border-b border-[color:var(--chat-border)] bg-[color:var(--chat-surface-strong)] backdrop-blur-xl sticky top-0 z-20 md:rounded-t-[28px]">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700/70">Inbox</p>
            <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Chats</h1>
          </div>
          {loading && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500/20 border-t-emerald-600" />
          )}
        </div>

        <div className="relative mb-4 group">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400 group-focus-within:text-emerald-600 transition-colors">
            <SearchIcon className="h-4 w-4" />
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="block w-full pl-10 pr-3 py-2.5 border border-[color:var(--chat-border)] rounded-2xl leading-5 bg-white/70 placeholder-neutral-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm font-medium shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          <FilterPill id="all" label="All" />
          <FilterPill id="groups" label="Groups" />
          <FilterPill id="dms" label="DMs" />
          <FilterPill id="fav" label="Favorites" />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="p-8 flex justify-center"><Spinner /></div>
        ) : filteredList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-neutral-400 px-6 text-center">
            <div className="w-16 h-16 bg-white/80 rounded-2xl flex items-center justify-center mb-4 shadow-sm border border-white/70">
              <Filter className="h-6 w-6 opacity-30" />
            </div>
            <p className="text-sm font-semibold text-neutral-700">No chats found.</p>
            <p className="text-xs mt-1 text-neutral-500">Try adjusting your filters or search.</p>
          </div>
        ) : (
          <div className="px-3 py-3 space-y-2">
            {filteredList.map((item, index) => (
              <div
                key={item.type + item.id}
                className="group relative page-transition"
                style={listItemStagger(index)}
              >
                <span
                  className={`
                    absolute left-2 top-1/2 -translate-y-1/2 h-8 w-1 rounded-full bg-gradient-to-b from-emerald-500 to-teal-400 transition-opacity
                    ${selected?.id === item.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}
                  `}
                />
                <button
                  onClick={() => setSelected(item)}
                  className={`
                    w-full flex items-center gap-3 p-3 pl-5 rounded-2xl text-left transition-all duration-200 border
                    ${selected?.id === item.id
                      ? 'bg-white shadow-[0_12px_30px_rgba(15,23,42,0.08)] border-emerald-100/80'
                      : 'bg-white/40 border-transparent hover:bg-white/70 hover:border-white/70'}
                  `}
                >
                  <div className={`
                    h-12 w-12 rounded-2xl flex items-center justify-center text-lg font-bold shrink-0 shadow-sm ring-1 ring-white/70
                    ${item.type === 'announcement'
                      ? 'bg-gradient-to-br from-amber-100 to-amber-200 text-amber-700'
                      : item.type === 'group'
                        ? 'bg-gradient-to-br from-sky-100 to-sky-200 text-sky-700'
                        : 'bg-gradient-to-br from-neutral-100 to-neutral-200 text-neutral-600'}
                  `}>
                    {item.type === 'dm' ? (
                      <img src={getAvatarUrl(item.avatar_url, item.id)} alt={item.name} className="h-full w-full object-cover rounded-2xl" />
                    ) : (
                      item.type === 'group' ? <Users className="h-5 w-5" /> : item.type === 'announcement' ? <Megaphone className="h-5 w-5" /> : item.name.slice(0,1).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pr-10">
                    <div className={`truncate text-[15px] font-semibold ${selected?.id === item.id ? 'text-emerald-900' : 'text-neutral-900'}`}>
                      {item.name}
                    </div>
                    <div className="text-xs text-neutral-500 truncate mt-0.5">
                      {item.subtitle}
                    </div>
                  </div>
                </button>

                <button
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(item.id); }}
                  className={`
                    absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full transition-all duration-200
                    bg-white/80 shadow-sm ring-1 ring-white/70
                    ${item.isFavorite
                      ? 'opacity-100 text-rose-500'
                      : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 text-neutral-300 hover:text-rose-400'}
                  `}
                  title={item.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                >
                  <Heart className={`h-4 w-4 ${item.isFavorite ? 'fill-current' : ''}`} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // Component: The Active Window (Right Pane)
  const ActiveChat = () => {
    if (!selected) {
      return (
        <div className="hidden md:flex flex-1 items-center justify-center">
          <div className="relative flex max-w-md flex-col items-center gap-5 rounded-[28px] border border-[color:var(--chat-border)] bg-[color:var(--chat-surface)] p-8 text-center shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <div className="absolute -top-10 h-20 w-20 rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.25),transparent_70%)] blur-xl" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-md ring-1 ring-white/70">
              <MessageSquare className="h-8 w-8 text-emerald-500/70" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-neutral-900">Select a conversation</h3>
              <p className="text-sm text-neutral-500 mt-1">Choose a group or friend to start chatting.</p>
            </div>
          </div>
        </div>
      );
    }

    // 3. Helper to handle clicks on header
    const handleHeaderClick = () => {
      if (selected.type === 'group' || selected.type === 'announcement') {
        navigate(`/group/${selected.id}`);
      } else if (selected.type === 'dm') {
        setViewProfileId(selected.id);
      }
    };

    return (
      <div className="fixed inset-0 z-50 md:static md:inset-auto md:flex-1 flex h-full min-h-0 flex-col bg-[color:var(--chat-surface-strong)] pb-[calc(96px+env(safe-area-inset-bottom))] md:bg-[color:var(--chat-surface)] md:pb-0 md:backdrop-blur-xl md:border md:border-[color:var(--chat-border)] md:rounded-[28px] md:shadow-[0_35px_90px_rgba(15,23,42,0.14)] overflow-hidden">
        {/* Header */}
        <div className="relative h-[76px] border-b border-[color:var(--chat-border)] flex items-center px-4 gap-4 bg-[color:var(--chat-surface-strong)] backdrop-blur-xl shrink-0 z-20 md:rounded-t-[28px]">
          <div className="absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent" />
          <button onClick={() => setSelected(null)} className="md:hidden p-2 -ml-2 rounded-full hover:bg-white/80 transition-colors">
            <ArrowLeft className="h-5 w-5 text-neutral-600" />
          </button>

          <div
            onClick={handleHeaderClick}
            className="flex items-center gap-4 flex-1 min-w-0 cursor-pointer hover:opacity-80 transition-opacity"
            title={`View ${selected.type === 'group' ? 'Group' : 'Profile'}`}
          >
            <div className={`h-11 w-11 rounded-2xl flex items-center justify-center text-sm font-bold shadow-sm ring-1 ring-white/70 ${
              selected.type === 'group'
                ? 'bg-sky-100 text-sky-700'
                : selected.type === 'announcement'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-neutral-100 text-neutral-600'
            }`}>
              {selected.type === 'dm' ? (
                <img src={getAvatarUrl(selected.avatar_url, selected.id)} alt={selected.name} className="h-full w-full object-cover rounded-2xl" />
              ) : (
                selected.type === 'group' ? '#' : selected.type === 'announcement' ? '!' : selected.name.slice(0,1)
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="font-bold text-neutral-900 truncate text-base">{selected.name}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shadow-sm ${
                  selected.type === 'group' ? 'bg-sky-500' : selected.type === 'announcement' ? 'bg-amber-500' : 'bg-emerald-500'
                }`}></span>
                {selected.type === 'group' ? 'Group Chat' : selected.type === 'announcement' ? 'Announcement Chat' : 'Direct Message'}
              </div>
            </div>
          </div>

          <button
            onClick={() => toggleFavorite(selected.id)}
            className="p-2 rounded-full bg-white/70 shadow-sm ring-1 ring-white/70 hover:bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-200"
            title={selected.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
          >
            <Heart
              className={`h-5 w-5 transition-colors ${selected.isFavorite ? 'fill-rose-500 text-rose-500' : 'text-neutral-400'}`}
            />
          </button>
        </div>

        {/* Content Area */}
        <div
          className="flex-1 min-h-0 overflow-hidden relative"
          style={{
            background:
              "radial-gradient(circle at 20% 20%, rgba(16,185,129,0.08), transparent 55%), radial-gradient(circle at 85% 0%, rgba(14,116,144,0.08), transparent 50%)",
          }}
        >
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 right-[-8rem] h-56 w-56 rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.18),transparent_70%)] blur-2xl" />
            <div className="absolute bottom-[-6rem] left-[-4rem] h-56 w-56 rounded-full bg-[radial-gradient(circle_at_center,rgba(251,191,36,0.2),transparent_70%)] blur-2xl" />
          </div>
          <div
            className="absolute inset-0 opacity-[0.04] pointer-events-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%230f172a' fill-opacity='1' fill-rule='evenodd'%3E%3Ccircle cx='3' cy='3' r='1'/%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />

          {selected.type === 'group' || selected.type === 'announcement' ? (
            <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><Spinner /></div>}>
              <div className="h-full w-full relative z-10">
                <ChatPanel 
                  groupId={selected.id} 
                  onClose={() => setSelected(null)} 
                />
              </div>
            </Suspense>
          ) : (
            // Custom DM Interface
            <div className="flex h-full min-h-0 flex-col relative z-10">
              <div ref={dmListRef} className="flex-1 min-h-0 overflow-y-auto p-4 md:px-8 md:py-6">
                <div className="mx-auto w-full max-w-3xl space-y-5">
                  {dmLoading && (
                    <div className="flex justify-center py-4">
                      <div className="bg-white/80 px-4 py-1.5 rounded-full text-xs font-semibold text-neutral-600 shadow-sm border border-white/70">
                        Loading history...
                      </div>
                    </div>
                  )}
                  {!dmLoading && dmMessages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-neutral-400 space-y-4 text-center py-6">
                      <div className="w-16 h-16 bg-white/90 rounded-2xl shadow-md flex items-center justify-center ring-1 ring-white/70">
                        <MessageSquare className="h-8 w-8 text-emerald-200" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-neutral-700">No messages yet. Break the ice.</div>
                        <p className="text-xs text-neutral-500">Pick a starter and we’ll drop it in.</p>
                      </div>
                      <div className="flex flex-wrap justify-center gap-2">
                        {[
                          "👋 Hey! I’m glad we matched here.",
                          "🗳 Want to pick a time to meet?",
                          "📍 Any favorite spot in town?",
                        ].map((msg) => (
                          <button
                            key={msg}
                            onClick={() => sendDM(msg)}
                            className="rounded-full border border-white/70 bg-white/80 px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm hover:border-emerald-200 hover:text-emerald-700"
                          >
                            {msg}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {dmMessages.map((m, idx) => {
                    const isMine = m.sender === me;
                    const showAvatar = !isMine && (idx === 0 || dmMessages[idx-1].sender !== m.sender);

                    return (
                      <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} group animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                        <div className={`flex max-w-[80%] md:max-w-[70%] ${isMine ? 'flex-row-reverse' : 'flex-row'} items-end gap-2`}>
                          {!isMine && (
                            <div className="w-6 h-6 shrink-0 mb-1">
                              {showAvatar && (
                                <img
                                  src={getAvatarUrl(selected.avatar_url, selected.id)}
                                  alt={selected.name}
                                  className="w-6 h-6 rounded-full object-cover shadow-sm ring-1 ring-white/70"
                                />
                              )}
                            </div>
                          )}

                          <div className={`
                            px-4 py-2.5 text-sm shadow-sm relative
                            ${isMine
                              ? 'bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 text-white rounded-[20px] rounded-tr-sm shadow-[0_12px_30px_rgba(16,185,129,0.25)]'
                              : 'bg-white/90 text-neutral-800 border border-white/70 rounded-[20px] rounded-tl-sm shadow-[0_8px_24px_rgba(15,23,42,0.08)]'}
                          `}>
                            {m.content}
                            <div className={`text-[10px] mt-1 text-right font-semibold tracking-wide opacity-70 ${isMine ? 'text-emerald-50' : 'text-neutral-400'}`}>
                              {new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  
                </div>
              </div>

              {/* DM Input */}
              <div className="p-4 bg-[color:var(--chat-surface-strong)] border-t border-[color:var(--chat-border)] backdrop-blur-xl">
                <div className="flex items-center gap-2 max-w-3xl mx-auto bg-white/75 border border-white/70 rounded-full px-2 py-2 focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:border-emerald-400 transition-all shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)]">
                  <input
                    ref={dmInputRef}
                    value={dmInput}
                    onChange={(e) => setDmInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendDM()}
                    placeholder="Type a message..."
                    className="flex-1 bg-transparent border-0 px-4 py-1 text-sm focus:ring-0 text-neutral-900 placeholder-neutral-400 outline-none"
                  />
                  <button
                    onClick={sendDM}
                    disabled={!dmInput.trim()}
                    className={`
                      p-2.5 rounded-full transition-all duration-200 flex items-center justify-center shadow-sm
                      ${dmInput.trim()
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white hover:brightness-105 hover:scale-105 active:scale-95 shadow-[0_12px_24px_rgba(16,185,129,0.3)]'
                        : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'}
                    `}
                  >
                    <Send className="h-4 w-4 ml-0.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Main Layout
  return (
    <>
      <div
        className="relative w-full h-dvh overflow-hidden pb-[calc(96px+env(safe-area-inset-bottom))]"
        style={shellStyle}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.16),transparent_70%)] blur-3xl" />
          <div className="absolute bottom-[-10rem] right-[-6rem] h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,rgba(14,116,144,0.16),transparent_70%)] blur-3xl" />
        </div>
        <div className="relative flex w-full h-full min-h-0 gap-0 md:gap-5 lg:gap-7 px-0 md:px-6 py-0 md:py-6 page-transition">
          <ChatList />
          <ActiveChat />
        </div>
      </div>
      
      {/* 4. Render the Modal */}
      <ViewOtherProfileModal
        isOpen={!!viewProfileId}
        onClose={() => setViewProfileId(null)}
        viewUserId={viewProfileId}
      />
    </>
  );
}
