import { useEffect, useState, useRef, lazy, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { MessageSquare, Users, ArrowLeft, Send, Search as SearchIcon, Filter, Heart, Megaphone } from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import ViewOtherProfileModal from "@/components/ViewOtherProfileModal";

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
  const dmEndRef = useRef<HTMLDivElement>(null);
  const dmInputRef = useRef<HTMLInputElement>(null);

  const [filter, setFilter] = useState<"all" | "groups" | "dms" | "fav">("all");
  const [search, setSearch] = useState("");

  // 1. Load User & List (Groups + Friends)
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setMe(user.id);

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
      const { data: anns } = await supabase
        .from("announcements")
        .select("id, group_id, title, description")
        .not("group_id", "is", null)
        .order("datetime", { ascending: false })
        .limit(20);
      (anns || []).forEach((a: any) => {
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
      setTimeout(() => dmEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

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
              setTimeout(() => dmEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
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
    if (selected?.type === 'dm') {
      dmInputRef.current?.focus();
    }
  }, [selected]);

  // 3. Send DM
  const sendDM = async () => {
    if (!dmInput.trim() || !me || !selected || selected.type !== 'dm') return;
    const text = dmInput.trim();
    setDmInput("");
    dmInputRef.current?.focus();
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
        whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-semibold transition-all border
        ${filter === id 
          ? "bg-neutral-900 text-white border-neutral-900 shadow-md transform scale-105" 
          : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300"}
      `}
    >
      {label}
    </button>
  );

  // Component: The Chat List (Sidebar)
  const ChatList = () => (
    <div className={`flex flex-col min-h-[calc(100dvh-140px)] bg-white border-r border-neutral-200 ${selected ? 'hidden md:flex' : 'flex'} w-full md:w-80 lg:w-96`}>
      <div className="p-5 border-b border-neutral-100 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Chats</h1>
          {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-neutral-900"></div>}
        </div>
        
        <div className="relative mb-4 group">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400 group-focus-within:text-emerald-600 transition-colors">
            <SearchIcon className="h-4 w-4" />
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="block w-full pl-10 pr-3 py-2.5 border border-neutral-200 rounded-xl leading-5 bg-neutral-50 placeholder-neutral-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm font-medium"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <FilterPill id="all" label="All" />
          <FilterPill id="groups" label="Groups" />
          <FilterPill id="dms" label="DMs" />
          <FilterPill id="fav" label="Favorites" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 flex justify-center"><Spinner /></div>
        ) : filteredList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-neutral-400 px-6 text-center">
            <div className="w-16 h-16 bg-neutral-50 rounded-full flex items-center justify-center mb-4">
              <Filter className="h-6 w-6 opacity-30" />
            </div>
            <p className="text-sm font-medium">No chats found.</p>
            <p className="text-xs mt-1 opacity-70">Try adjusting your filters or search.</p>
          </div>
        ) : (
          <div className="px-2 py-2 space-y-1">
            {filteredList.map(item => (
              // THIS IS THE LIST ITEM
              <div 
                key={item.type + item.id} 
                className="group relative"
              >
                <button
                  onClick={() => setSelected(item)}
                  className={`
                    w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all duration-200
                    ${selected?.id === item.id 
                      ? 'bg-emerald-50 shadow-sm ring-1 ring-emerald-100' 
                      : 'hover:bg-neutral-50'}
                  `}
                >
                  <div className={`
                    h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold shrink-0 shadow-sm
                    ${item.type === 'announcement'
                      ? 'bg-gradient-to-br from-amber-100 to-amber-200 text-amber-700'
                      : item.type === 'group'
                        ? 'bg-gradient-to-br from-indigo-100 to-indigo-200 text-indigo-700'
                        : 'bg-gradient-to-br from-neutral-100 to-neutral-200 text-neutral-600'}
                  `}>
                    {item.type === 'dm' && item.avatar_url ? (
                      <img src={item.avatar_url} alt="" className="h-full w-full object-cover rounded-full" />
                    ) : (
                      item.type === 'group' ? <Users className="h-5 w-5" /> : item.type === 'announcement' ? <Megaphone className="h-5 w-5" /> : item.name.slice(0,1).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pr-8">
                    <div className={`font-semibold truncate ${selected?.id === item.id ? 'text-emerald-900' : 'text-neutral-900'}`}>
                      {item.name}
                    </div>
                    <div className="text-xs text-neutral-500 truncate mt-0.5">
                      {item.subtitle}
                    </div>
                  </div>
                </button>

                {/* HEART BUTTON IN LIST - VISIBLE ON HOVER OR IF FAVORITED */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(item.id); }}
                  className={`
                    absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full transition-all duration-200
                    hover:bg-white hover:shadow-sm
                    ${item.isFavorite 
                      ? 'opacity-100 text-rose-500' 
                      : 'opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-rose-400'}
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
        <div className="hidden md:flex flex-1 items-center justify-center bg-neutral-50/50 flex-col gap-6">
          <div className="bg-white p-6 rounded-full shadow-sm ring-1 ring-black/5">
            <MessageSquare className="h-12 w-12 text-emerald-500/50" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold text-neutral-900">Select a conversation</h3>
            <p className="text-sm text-neutral-500 mt-1">Choose a group or friend to start chatting</p>
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
      <div className="fixed inset-0 z-50 pb-0 md:static md:inset-auto md:flex-1 bg-white flex flex-col h-full">
        {/* Header */}
        <div className="h-[72px] border-b border-neutral-200 flex items-center px-4 gap-4 bg-white/95 backdrop-blur-sm shrink-0 shadow-sm z-20">
          <button onClick={() => setSelected(null)} className="md:hidden p-2 -ml-2 rounded-full hover:bg-neutral-100 transition-colors">
            <ArrowLeft className="h-5 w-5 text-neutral-600" />
          </button>
          
          <div 
            onClick={handleHeaderClick} 
            className="flex items-center gap-4 flex-1 min-w-0 cursor-pointer hover:opacity-70 transition-opacity"
            title={`View ${selected.type === 'group' ? 'Group' : 'Profile'}`}
          >
            <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shadow-sm ${
              selected.type === 'group'
                ? 'bg-indigo-100 text-indigo-700'
                : selected.type === 'announcement'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-neutral-100 text-neutral-600'
            }`}>
               {selected.type === 'dm' && selected.avatar_url ? (
                 <img src={selected.avatar_url} alt="" className="h-full w-full object-cover rounded-full" />
               ) : (
                 selected.type === 'group' ? '#' : selected.type === 'announcement' ? '!' : selected.name.slice(0,1)
               )}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="font-bold text-neutral-900 truncate text-base">{selected.name}</div>
              <div className="text-xs text-neutral-500 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  selected.type === 'group' ? 'bg-indigo-500' : selected.type === 'announcement' ? 'bg-amber-500' : 'bg-emerald-500'
                }`}></span>
                {selected.type === 'group' ? 'Group Chat' : selected.type === 'announcement' ? 'Announcement Chat' : 'Direct Message'}
              </div>
            </div>
          </div>

          <button 
            onClick={() => toggleFavorite(selected.id)}
            className="p-2 rounded-full hover:bg-neutral-100 transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-200"
            title={selected.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
          >
            <Heart 
              className={`h-5 w-5 transition-colors ${selected.isFavorite ? 'fill-rose-500 text-rose-500' : 'text-neutral-400'}`} 
            />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative bg-neutral-50"> 
          {/* Background Pattern */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
             style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23000000' fill-opacity='1' fill-rule='evenodd'%3E%3Ccircle cx='3' cy='3' r='1'/%3E%3C/g%3E%3C/svg%3E")` }}>
        </div>

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
            <div className="flex flex-col h-full relative z-10">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {dmLoading && (
                  <div className="flex justify-center py-4">
                    <div className="bg-white/80 px-4 py-1.5 rounded-full text-xs font-medium text-neutral-500 shadow-sm border border-neutral-100">
                      Loading history...
                    </div>
                  </div>
                )}
                {!dmLoading && dmMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-neutral-400 space-y-3">
                    <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center">
                      <MessageSquare className="h-8 w-8 text-neutral-200" />
                    </div>
                    <div className="text-sm">No messages yet. Say hi! 👋</div>
                  </div>
                )}
                
                {dmMessages.map((m, idx) => {
                  const isMine = m.sender === me;
                  const showAvatar = !isMine && (idx === 0 || dmMessages[idx-1].sender !== m.sender);
                  
                  return (
                    <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'} group animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                      <div className={`flex max-w-[80%] md:max-w-[70%] ${isMine ? 'flex-row-reverse' : 'flex-row'} items-end gap-2`}>
                        {/* Avatar placeholder for friend side */}
                        {!isMine && (
                          <div className="w-6 h-6 shrink-0 mb-1">
                            {showAvatar && (
                              selected.avatar_url ? 
                              <img src={selected.avatar_url} className="w-6 h-6 rounded-full object-cover shadow-sm" /> :
                              <div className="w-6 h-6 rounded-full bg-neutral-200 flex items-center justify-center text-[9px] font-bold text-neutral-500">
                                {selected.name.slice(0,1)}
                              </div>
                            )}
                          </div>
                        )}

                        <div className={`
                          px-4 py-2.5 text-sm shadow-sm relative
                          ${isMine 
                            ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white rounded-2xl rounded-tr-sm' 
                            : 'bg-white text-neutral-800 border border-neutral-100 rounded-2xl rounded-tl-sm'}
                        `}>
                          {m.content}
                          <div className={`text-[9px] mt-1 text-right opacity-70 ${isMine ? 'text-emerald-100' : 'text-neutral-400'}`}>
                            {new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={dmEndRef} />
              </div>
              
              {/* DM Input */}
              <div className="p-4 bg-white border-t border-neutral-200/80 backdrop-blur-md">
                <div className="flex items-center gap-2 max-w-4xl mx-auto bg-neutral-50 border border-neutral-200 rounded-full px-2 py-2 focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:border-emerald-500 transition-all shadow-inner">
                  <input
                    ref={dmInputRef}
                    value={dmInput}
                    onChange={(e) => setDmInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendDM()}
                    autoFocus
                    placeholder="Type a message..."
                    className="flex-1 bg-transparent border-0 px-4 py-1 text-sm focus:ring-0 text-neutral-900 placeholder-neutral-400 outline-none"
                  />
                  <button 
                    onClick={sendDM}
                    disabled={!dmInput.trim()}
                    className={`
                      p-2.5 rounded-full transition-all duration-200 flex items-center justify-center shadow-sm
                      ${dmInput.trim() 
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700 hover:scale-105 active:scale-95' 
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
      <div className="flex w-full min-h-dvh overflow-hidden bg-white pb-[calc(96px+env(safe-area-inset-bottom))]">
        <ChatList />
        <ActiveChat />
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
