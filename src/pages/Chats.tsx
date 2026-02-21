import { useEffect, useMemo, useState, useRef, lazy, Suspense, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { MessageSquare, Users, ArrowLeft, Send, Search as SearchIcon, Filter, Heart, Megaphone, Sparkles } from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import AvatarImage from "@/components/ui/AvatarImage";
import { isAnnouncementVisibleForViewer } from "@/lib/announcements";
import { ROUTES, routeToGroup, routeToUser } from "@/constants/routes";

// Lazy load the existing group chat component
const ChatPanel = lazy(() => import("../components/ChatPanel"));

type ChatItem = {
  type: 'group' | 'dm' | 'announcement';
  id: string; 
  name: string;
  avatar_url: string | null;
  public_id?: string | null;
  subtitle: string;
  last_seen_at?: string | null;
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

type ChatFilter = "all" | "unread" | "groups" | "dms";
type PersistedSelection = { type: ChatItem["type"]; id: string };
type ChatMeta = {
  preview: string;
  lastAt: string | null;
  unreadCount: number;
  isTyping: boolean;
  meetupAt: string | null;
};

const sameChatItem = (a: Pick<ChatItem, "id" | "type"> | null, b: Pick<ChatItem, "id" | "type"> | null) =>
  !!a && !!b && a.id === b.id && a.type === b.type;

const CHAT_SELECTION_KEY = "circles.chats.selected";
const CHAT_DM_LAST_SEEN_KEY = "circles.chats.dm.lastSeen";

function readPersistedSelection(): PersistedSelection | null {
  try {
    const raw = localStorage.getItem(CHAT_SELECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSelection;
    if (!parsed?.id) return null;
    if (parsed.type !== "group" && parsed.type !== "dm" && parsed.type !== "announcement") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedSelection(next: PersistedSelection | null) {
  try {
    if (!next) {
      localStorage.removeItem(CHAT_SELECTION_KEY);
      return;
    }
    localStorage.setItem(CHAT_SELECTION_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

function readDmSeenMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CHAT_DM_LAST_SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeDmSeenMap(next: Record<string, string>) {
  try {
    localStorage.setItem(CHAT_DM_LAST_SEEN_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

function relLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 45) return "now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 172800) return "Yesterday";
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

function sanitizePreview(value: string | null | undefined, fallback = ""): string {
  const text = String(value || "").replace(/^\[POLL:[^\]]+\]\s*/i, "Poll: ").replace(/\s+/g, " ").trim();
  if (text) return text;
  return fallback;
}

function meetupCountdownLabel(iso: string | null): string | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const diffMs = ts - Date.now();
  if (diffMs <= 0) return "Meetup started";
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `Meetup in ${Math.max(1, mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `Meetup in ${hours}h`;
  return `Meetup ${new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

const chatMetaKey = (item: Pick<ChatItem, "id" | "type">) => `${item.type}:${item.id}`;

const sortChatItems = (a: ChatItem, b: ChatItem) => {
  // Announcements first
  const aAnn = a.type === "announcement" ? 1 : 0;
  const bAnn = b.type === "announcement" ? 1 : 0;
  if (aAnn !== bAnn) return bAnn - aAnn;
  // Favorites second
  if (a.isFavorite && !b.isFavorite) return -1;
  if (!a.isFavorite && b.isFavorite) return 1;
  return a.name.localeCompare(b.name);
};

async function isAcceptedFriendship(userA: string, userB: string) {
  const { data, error } = await supabase
    .from("friendships")
    .select("status")
    .or(`and(user_id_a.eq.${userA},user_id_b.eq.${userB}),and(user_id_a.eq.${userB},user_id_b.eq.${userA})`)
    .maybeSingle();
  if (error) {
    console.warn("[chats] friendship check failed", error);
    return false;
  }
  return data?.status === "accepted";
}

export default function Chats() {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<string | null>(null);
  const [list, setList] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Selection State
  const [selected, setSelected] = useState<ChatItem | null>(null);

  // DM Specific State
  const [dmMessages, setDmMessages] = useState<DMMsg[]>([]);
  const [dmInput, setDmInput] = useState("");
  const [dmLoading, setDmLoading] = useState(false);
  const [dmError, setDmError] = useState<string | null>(null);
  const dmListRef = useRef<HTMLDivElement>(null);
  const dmInputRef = useRef<HTMLInputElement>(null);
  const dmDraftsRef = useRef<Record<string, string>>({});
  const dmTypingChannelRef = useRef<any>(null);
  const dmTypingIdleRef = useRef<number | null>(null);
  const deepLinkAppliedRef = useRef<string | null>(null);
  const [chatMeta, setChatMeta] = useState<Record<string, ChatMeta>>({});
  const [lobbyOnlineIds, setLobbyOnlineIds] = useState<Set<string>>(new Set());
  const [lobbyOnlineCount, setLobbyOnlineCount] = useState(0);

  const [filter, setFilter] = useState<ChatFilter>("all");
  const [search, setSearch] = useState("");
  const shellStyle: CSSProperties & Record<`--${string}`, string> = {
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
  const appendDmMessage = (msg: DMMsg) => {
    setDmMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      const next = [...prev, msg];
      next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return next;
    });
  };
  const selectedDmId = selected?.type === "dm" ? selected.id : null;
  const markDmSeen = (otherId: string, atIso?: string) => {
    const next = readDmSeenMap();
    next[otherId] = atIso || new Date().toISOString();
    writeDmSeenMap(next);
  };
  const setMetaPatch = (key: string, patch: Partial<ChatMeta>) => {
    setChatMeta((prev) => {
      const curr = prev[key] || {
        preview: "",
        lastAt: null,
        unreadCount: 0,
        isTyping: false,
        meetupAt: null,
      };
      return {
        ...prev,
        [key]: {
          ...curr,
          ...patch,
        },
      };
    });
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
      const seenKeys = new Set<string>();
      const pushUnique = (item: ChatItem) => {
        const key = `${item.type}:${item.id}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        items.push(item);
      };

      // Process Groups
      (groups || []).forEach((g: any) => {
        if (g.groups) {
          pushUnique({
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
          // Keep one thread entry per group id
          if (items.find(i => i.id === a.group_id && (i.type === 'group' || i.type === 'announcement'))) return;
          pushUnique({
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
            .select("user_id, name, public_id, avatar_url, updated_at")
            .in("user_id", friendIds);
          
          profiles?.forEach((p: any) => {
            pushUnique({
              type: 'dm',
              id: p.user_id,
              name: p.name || "User",
              public_id: p.public_id || null,
              avatar_url: p.avatar_url,
              subtitle: "Direct Message",
              last_seen_at: p.updated_at ?? null,
              isFavorite: favs.has(p.user_id)
            });
          });
        }
      }

      items.sort(sortChatItems);
      setList(items);
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    setSelected((prev) => {
      if (!prev) return prev;
      const stillExists = list.some((item) => sameChatItem(item, prev));
      return stillExists ? prev : null;
    });
  }, [list]);

  // Load list metadata: previews, unread counts, timestamps, and upcoming meetups.
  useEffect(() => {
    if (!me) {
      setChatMeta({});
      return;
    }
    if (list.length === 0) {
      setChatMeta({});
      return;
    }

    let cancelled = false;
    const dmIds = list.filter((i) => i.type === "dm").map((i) => i.id);
    const groupIds = Array.from(
      new Set(
        list
          .filter((i) => i.type === "group" || i.type === "announcement")
          .map((i) => i.id)
          .filter(Boolean)
      )
    );
    const typeByGroupId = new Map(
      list
        .filter((i) => i.type === "group" || i.type === "announcement")
        .map((i) => [i.id, i.type] as const)
    );

    const loadMeta = async () => {
      const next: Record<string, ChatMeta> = {};
      list.forEach((item) => {
        next[chatMetaKey(item)] = {
          preview: item.subtitle,
          lastAt: item.last_seen_at ?? null,
          unreadCount: 0,
          isTyping: false,
          meetupAt: null,
        };
      });

      if (groupIds.length) {
        const [groupMsgsRes, readsRes, eventsRes] = await Promise.all([
          supabase
            .from("group_messages")
            .select("group_id, sender_id, content, created_at")
            .in("group_id", groupIds)
            .order("created_at", { ascending: false })
            .limit(Math.max(groupIds.length * 40, 120)),
          supabase
            .from("group_reads")
            .select("group_id, last_read_at")
            .eq("user_id", me)
            .in("group_id", groupIds),
          supabase
            .from("group_events")
            .select("group_id, starts_at")
            .in("group_id", groupIds)
            .not("starts_at", "is", null)
            .gte("starts_at", new Date().toISOString())
            .order("starts_at", { ascending: true })
            .limit(Math.max(groupIds.length * 3, 24)),
        ]);

        const readMap = new Map<string, string>();
        (readsRes.data || []).forEach((r: any) => {
          if (!r?.group_id || !r?.last_read_at) return;
          readMap.set(String(r.group_id), String(r.last_read_at));
        });

        const firstMeetup = new Map<string, string>();
        (eventsRes.data || []).forEach((row: any) => {
          const gid = String(row?.group_id || "");
          const startsAt = String(row?.starts_at || "");
          if (!gid || !startsAt || firstMeetup.has(gid)) return;
          firstMeetup.set(gid, startsAt);
        });

        const latestByGroup = new Map<string, { content: string | null; created_at: string; sender_id: string | null }>();
        const unreadByGroup: Record<string, number> = {};
        (groupMsgsRes.data || []).forEach((row: any) => {
          const gid = String(row?.group_id || "");
          const createdAt = String(row?.created_at || "");
          const senderId = row?.sender_id ? String(row.sender_id) : null;
          if (!gid || !createdAt) return;
          if (!latestByGroup.has(gid)) {
            latestByGroup.set(gid, {
              content: row?.content ?? null,
              created_at: createdAt,
              sender_id: senderId,
            });
          }
          if (senderId === me) return;
          const lastRead = readMap.get(gid);
          if (!lastRead || createdAt > lastRead) {
            unreadByGroup[gid] = (unreadByGroup[gid] || 0) + 1;
          }
        });

        groupIds.forEach((gid) => {
          const threadType = typeByGroupId.get(gid) || "group";
          const key = `${threadType}:${gid}`;
          const latest = latestByGroup.get(gid);
          const fallback = threadType === "announcement" ? "Announcement" : "Group chat";
          next[key] = {
            ...(next[key] || {
              preview: fallback,
              lastAt: null,
              unreadCount: 0,
              isTyping: false,
              meetupAt: null,
            }),
            preview: sanitizePreview(latest?.content, fallback),
            lastAt: latest?.created_at || next[key]?.lastAt || null,
            unreadCount: unreadByGroup[gid] || 0,
            meetupAt: firstMeetup.get(gid) || null,
          };
        });
      }

      if (dmIds.length) {
        const dmSet = new Set(dmIds);
        const seenMap = readDmSeenMap();
        const dmRes = await supabase
          .from("direct_messages")
          .select("sender, receiver, content, created_at")
          .or(`sender.eq.${me},receiver.eq.${me}`)
          .order("created_at", { ascending: false })
          .limit(450);

        const latestByDm = new Map<string, { content: string | null; created_at: string }>();
        const unreadByDm: Record<string, number> = {};

        (dmRes.data || []).forEach((row: any) => {
          const sender = String(row?.sender || "");
          const receiver = String(row?.receiver || "");
          const createdAt = String(row?.created_at || "");
          if (!sender || !receiver || !createdAt) return;
          const otherId = sender === me ? receiver : sender;
          if (!dmSet.has(otherId)) return;
          if (!latestByDm.has(otherId)) {
            latestByDm.set(otherId, { content: row?.content ?? null, created_at: createdAt });
          }
          if (receiver !== me) return;
          const seenAt = seenMap[otherId];
          if (!seenAt || createdAt > seenAt) {
            unreadByDm[otherId] = (unreadByDm[otherId] || 0) + 1;
          }
        });

        dmIds.forEach((uid) => {
          const key = `dm:${uid}`;
          const latest = latestByDm.get(uid);
          const listItem = list.find((item) => item.type === "dm" && item.id === uid);
          next[key] = {
            ...(next[key] || {
              preview: "Direct Message",
              lastAt: null,
              unreadCount: 0,
              isTyping: false,
              meetupAt: null,
            }),
            preview: sanitizePreview(latest?.content, "Direct Message"),
            lastAt: latest?.created_at || listItem?.last_seen_at || null,
            unreadCount: unreadByDm[uid] || 0,
          };
        });
      }

      if (cancelled) return;
      setChatMeta((prev) => {
        const merged: Record<string, ChatMeta> = {};
        Object.keys(next).forEach((key) => {
          const prevEntry = prev[key];
          merged[key] = {
            ...next[key],
            isTyping: prevEntry?.isTyping ?? next[key].isTyping,
          };
        });
        return merged;
      });
    };

    void loadMeta();
    const onFocus = () => {
      void loadMeta();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [me, list]);

  // Live "who is online in chats" presence.
  useEffect(() => {
    if (!me) return;

    const channel = supabase.channel("presence:chats:lobby", {
      config: { presence: { key: me } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, Array<{ user_id?: string; key?: string }>>;
      const ids = new Set<string>();
      Object.entries(state).forEach(([key, entries]) => {
        if (!entries?.length) {
          ids.add(String(key));
          return;
        }
        entries.forEach((entry) => {
          const uid = entry?.user_id || entry?.key || key;
          if (uid) ids.add(String(uid));
        });
      });
      setLobbyOnlineIds(ids);
      setLobbyOnlineCount(Math.max(0, ids.size - (ids.has(me) ? 1 : 0)));
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          user_id: me,
          route: "chats",
          at: new Date().toISOString(),
        });
      }
    });

    return () => {
      setLobbyOnlineIds(new Set());
      setLobbyOnlineCount(0);
      supabase.removeChannel(channel);
    };
  }, [me]);

  // Per-DM typing presence for live "Typing..." previews.
  useEffect(() => {
    if (!me || !selectedDmId) return;
    const roomKey = [me, selectedDmId].sort().join(":");
    const channel = supabase.channel(`presence:dm:${roomKey}`, {
      config: { presence: { key: me } },
    });
    dmTypingChannelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, Array<{ uid?: string; typing?: boolean }>>;
      let otherTyping = false;
      Object.entries(state).forEach(([key, entries]) => {
        const entry = entries?.[entries.length - 1];
        const uid = entry?.uid || key;
        if (uid !== selectedDmId) return;
        if (entry?.typing) otherTyping = true;
      });
      setMetaPatch(`dm:${selectedDmId}`, { isTyping: otherTyping });
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          uid: me,
          typing: false,
          at: new Date().toISOString(),
        });
      }
    });

    return () => {
      if (dmTypingChannelRef.current === channel) dmTypingChannelRef.current = null;
      setMetaPatch(`dm:${selectedDmId}`, { isTyping: false });
      supabase.removeChannel(channel);
    };
  }, [me, selectedDmId]);

  useEffect(() => {
    if (!selectedDmId || !me) return;
    const channel = dmTypingChannelRef.current;
    if (!channel) return;

    const typing = dmInput.trim().length > 0;
    void channel.track({
      uid: me,
      typing,
      at: new Date().toISOString(),
    });

    if (dmTypingIdleRef.current) {
      window.clearTimeout(dmTypingIdleRef.current);
      dmTypingIdleRef.current = null;
    }
    if (typing) {
      dmTypingIdleRef.current = window.setTimeout(() => {
        void channel.track({
          uid: me,
          typing: false,
          at: new Date().toISOString(),
        });
      }, 1800);
    }

    return () => {
      if (dmTypingIdleRef.current) {
        window.clearTimeout(dmTypingIdleRef.current);
        dmTypingIdleRef.current = null;
      }
    };
  }, [dmInput, selectedDmId, me]);

  useEffect(() => {
    if (!selected) return;
    setMetaPatch(chatMetaKey(selected), { unreadCount: 0 });
    if (selected.type === "dm") {
      const latest = dmMessages[dmMessages.length - 1];
      markDmSeen(selected.id, latest?.created_at);
    }
  }, [selected?.id, selected?.type, dmMessages]);

  // Realtime list metadata updates.
  useEffect(() => {
    if (!me || list.length === 0) return;
    const dmSet = new Set(list.filter((item) => item.type === "dm").map((item) => item.id));
    const groupTypeById = new Map(
      list
        .filter((item) => item.type === "group" || item.type === "announcement")
        .map((item) => [item.id, item.type] as const)
    );

    const channel = supabase.channel(`chats:list-meta:${me}`);

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "group_messages" },
      (payload) => {
        const row = payload.new as any;
        const gid = String(row?.group_id || "");
        const threadType = groupTypeById.get(gid);
        if (!gid || !threadType) return;
        const senderId = String(row?.sender_id || row?.user_id || "");
        const isOpen =
          !!selected &&
          selected.id === gid &&
          (selected.type === "group" || selected.type === "announcement");
        const key = `${threadType}:${gid}`;
        setChatMeta((prev) => {
          const curr = prev[key] || {
            preview: threadType === "announcement" ? "Announcement" : "Group chat",
            lastAt: null,
            unreadCount: 0,
            isTyping: false,
            meetupAt: null,
          };
          return {
            ...prev,
            [key]: {
              ...curr,
              preview: sanitizePreview(row?.content, curr.preview),
              lastAt: String(row?.created_at || curr.lastAt || ""),
              unreadCount:
                senderId && senderId !== me && !isOpen
                  ? Math.min(99, (curr.unreadCount || 0) + 1)
                  : curr.unreadCount || 0,
            },
          };
        });
      }
    );

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "direct_messages" },
      (payload) => {
        const row = payload.new as DMMsg;
        if (!row?.sender || !row?.receiver) return;
        if (row.sender !== me && row.receiver !== me) return;
        const otherId = row.sender === me ? row.receiver : row.sender;
        if (!dmSet.has(otherId)) return;
        const isIncoming = row.receiver === me;
        const isOpen = selected?.type === "dm" && selected.id === otherId;
        const key = `dm:${otherId}`;
        setChatMeta((prev) => {
          const curr = prev[key] || {
            preview: "Direct Message",
            lastAt: null,
            unreadCount: 0,
            isTyping: false,
            meetupAt: null,
          };
          return {
            ...prev,
            [key]: {
              ...curr,
              preview: sanitizePreview(row.content, curr.preview),
              lastAt: row.created_at || curr.lastAt,
              unreadCount: isIncoming && !isOpen ? Math.min(99, (curr.unreadCount || 0) + 1) : 0,
            },
          };
        });
      }
    );

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [me, list, selected?.id, selected?.type]);

  // Auto-select chat when opened with ?chatType=...&chatId=...
  // Legacy fallback still supports ?groupId=...
  useEffect(() => {
    if (list.length === 0) return;

    const params = new URLSearchParams(location.search);
    const chatType = params.get("chatType");
    const chatId = params.get("chatId");
    const legacyGroupId = params.get("groupId");
    const deepLinkKey = chatId
      ? `${chatType ?? "any"}:${chatId}`
      : legacyGroupId
        ? `group:${legacyGroupId}`
        : null;

    // 1) Deep-link path first
    if (deepLinkKey) {
      if (deepLinkAppliedRef.current === deepLinkKey) return;

      let found: ChatItem | undefined;
      if (chatId) {
        if (chatType === "group" || chatType === "dm" || chatType === "announcement") {
          found = list.find((i) => i.type === chatType && i.id === chatId);
        } else {
          found = list.find((i) => i.id === chatId);
        }
      } else if (legacyGroupId) {
        found = list.find((i) => (i.type === "group" || i.type === "announcement") && i.id === legacyGroupId);
      }

      if (!found) return;

      setSelected((prev) => (sameChatItem(prev, found) ? prev : found));
      deepLinkAppliedRef.current = deepLinkKey;
      navigate(ROUTES.CHATS, { replace: true });
      return;
    }

    // 2) No deep-link path
    deepLinkAppliedRef.current = null;

    // Manual selection guard applies only when no deep-link is present
    if (selected?.id) return;

    const persisted = readPersistedSelection();
    if (!persisted) return;
    const found = list.find((i) => i.type === persisted.type && i.id === persisted.id);
    if (!found) return;
    setSelected((prev) => (sameChatItem(prev, found) ? prev : found));
  }, [location.search, list, navigate]);

  useEffect(() => {
    if (!selected) {
      writePersistedSelection(null);
      return;
    }
    writePersistedSelection({ type: selected.type, id: selected.id });
  }, [selected?.id, selected?.type]);

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
    ).sort(sortChatItems));

    // Update Selected State if active
    if (selected && selected.id === id) {
      setSelected(prev => prev ? { ...prev, isFavorite: isFav } : null);
    }
  };

  // Auto-select DM if location.state?.openDmId is provided
  useEffect(() => {
    const openId = (location.state as { openDmId?: string } | null)?.openDmId;
    if (!openId || selected || !me || loading) return;
    let cancelled = false;

    (async () => {
      if (openId === me) {
        navigate(`${location.pathname}${location.search}${location.hash}`, {
          replace: true,
          state: null,
        });
        return;
      }

      const canDm = await isAcceptedFriendship(me, openId);
      if (cancelled) return;
      if (!canDm) {
        setDmError("Add this user as a friend before starting a direct message.");
        window.alert("Add this user as a friend before starting a direct message.");
        navigate(`${location.pathname}${location.search}${location.hash}`, {
          replace: true,
          state: null,
        });
        return;
      }

      const found = list.find((i) => i.id === openId && i.type === "dm");
      if (found) {
        setSelected(found);
      } else {
        const { data: p } = await supabase
          .from("profiles")
          .select("name, public_id, avatar_url")
          .eq("user_id", openId)
          .single();
        if (cancelled) return;
        if (p) {
          const favs = new Set(JSON.parse(localStorage.getItem("chat_favorites") || "[]"));
          const newChat: ChatItem = {
            type: "dm",
            id: openId,
            name: p.name || "User",
            public_id: p.public_id || null,
            avatar_url: p.avatar_url,
            subtitle: "Direct Message",
            isFavorite: favs.has(openId),
          };
          setList((prev) => [newChat, ...prev]);
          setSelected(newChat);
        }
      }

      navigate(`${location.pathname}${location.search}${location.hash}`, {
        replace: true,
        state: null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [location.state, location.pathname, location.search, location.hash, navigate, list, selected, me, loading]);

  useEffect(() => {
    if (!selectedDmId) return;
    setDmError(null);
    setDmInput(dmDraftsRef.current[selectedDmId] ?? "");
    markDmSeen(selectedDmId);
    setMetaPatch(`dm:${selectedDmId}`, { unreadCount: 0 });
    focusDmInput();
  }, [selectedDmId]);

  // 2. Load DM Messages when a Friend is selected
  useEffect(() => {
    if (!me || !selectedDmId) return;

    let sub: any = null;
    const otherId = selectedDmId;
    
    async function loadDMs() {
      setDmLoading(true);

      const { data } = await supabase
        .from("direct_messages")
        .select("id, sender, receiver, content, created_at")
        .or(`and(sender.eq.${me},receiver.eq.${otherId}),and(sender.eq.${otherId},receiver.eq.${me})`)
        .order("created_at", { ascending: true })
        .limit(100);

      const sorted = (data || []).slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      setDmMessages(sorted);
      const latest = sorted[sorted.length - 1];
      if (latest) {
        setMetaPatch(`dm:${otherId}`, {
          preview: sanitizePreview(latest.content, "Direct Message"),
          lastAt: latest.created_at,
          unreadCount: 0,
        });
        markDmSeen(otherId, latest.created_at);
      }
      setDmLoading(false);
      setTimeout(() => scrollDmToBottom(), 100);

      sub = supabase.channel(`dm:${otherId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'direct_messages' },
          (payload) => {
            const newMsg = payload.new as DMMsg;
            const isMatch = 
              (newMsg.sender === me && newMsg.receiver === otherId) ||
              (newMsg.sender === otherId && newMsg.receiver === me);

            if (isMatch) {
              appendDmMessage(newMsg);
              setMetaPatch(`dm:${otherId}`, {
                preview: sanitizePreview(newMsg.content, "Direct Message"),
                lastAt: newMsg.created_at,
                unreadCount: 0,
              });
              markDmSeen(otherId, newMsg.created_at);
              setTimeout(() => scrollDmToBottom(), 100);
            }
          }
        )
        .subscribe();
    }

    const refreshOnFocus = async () => {
      if (!me || !selectedDmId) return;
      const { data } = await supabase
        .from("direct_messages")
        .select("id, sender, receiver, content, created_at")
        .or(`and(sender.eq.${me},receiver.eq.${otherId}),and(sender.eq.${otherId},receiver.eq.${me})`)
        .order("created_at", { ascending: true })
        .limit(100);
      if (data) {
        const sorted = data.slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        setDmMessages(sorted);
        const latest = sorted[sorted.length - 1];
        if (latest) {
          setMetaPatch(`dm:${otherId}`, {
            preview: sanitizePreview(latest.content, "Direct Message"),
            lastAt: latest.created_at,
            unreadCount: 0,
          });
          markDmSeen(otherId, latest.created_at);
        }
      }
    };

    loadDMs();
    window.addEventListener('focus', refreshOnFocus);

    return () => {
      if (sub) supabase.removeChannel(sub);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [selectedDmId, me]);

  // 3. Send DM
  const sendDM = async (preset?: string) => {
    const text = (preset ?? dmInput).trim();
    if (!text || !me || !selectedDmId) return;
    const canDm = await isAcceptedFriendship(me, selectedDmId);
    if (!canDm) {
      setDmError("You can only message accepted friends.");
      window.alert("You can only message accepted friends.");
      return;
    }

    setDmInput("");
    dmDraftsRef.current[selectedDmId] = "";
    focusDmInput();
    const { data, error } = await supabase
      .from("direct_messages")
      .insert({
        sender: me,
        receiver: selectedDmId,
        content: text,
      })
      .select("id, sender, receiver, content, created_at")
      .single();

    if (error) {
      setDmInput(text);
      dmDraftsRef.current[selectedDmId] = text;
      setDmError(error.message || "Could not send message.");
      focusDmInput();
      return;
    }

    setDmError(null);
    if (data) {
      appendDmMessage(data as DMMsg);
      setMetaPatch(`dm:${selectedDmId}`, {
        preview: sanitizePreview(data.content, "Direct Message"),
        lastAt: data.created_at,
        unreadCount: 0,
      });
      markDmSeen(selectedDmId, data.created_at);
      setTimeout(() => scrollDmToBottom(), 100);
    }
  };

  const totalUnreadCount = useMemo(
    () =>
      list.reduce((sum, item) => {
        const unread = chatMeta[chatMetaKey(item)]?.unreadCount || 0;
        return sum + unread;
      }, 0),
    [list, chatMeta]
  );

  const unreadThreadCount = useMemo(
    () =>
      list.reduce((sum, item) => {
        const unread = chatMeta[chatMetaKey(item)]?.unreadCount || 0;
        return sum + (unread > 0 ? 1 : 0);
      }, 0),
    [list, chatMeta]
  );

  const filterCounts = useMemo(
    () => ({
      all: list.length,
      unread: unreadThreadCount,
      groups: list.filter((item) => item.type === "group" || item.type === "announcement").length,
      dms: list.filter((item) => item.type === "dm").length,
    }),
    [list, unreadThreadCount]
  );

  const filteredList = useMemo(
    () =>
      list.filter((item) => {
        if (filter === "groups" && item.type !== "group" && item.type !== "announcement") return false;
        if (filter === "dms" && item.type !== "dm") return false;
        if (filter === "unread" && (chatMeta[chatMetaKey(item)]?.unreadCount || 0) <= 0) return false;
        if (!item.name) return false;
        if (!item.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [list, filter, search, chatMeta]
  );

  const FilterPill = ({ id, label, count }: { id: ChatFilter; label: string; count?: number }) => (
    <button
      onClick={() => setFilter(id)}
      className={`
        whitespace-nowrap px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all border inline-flex items-center gap-1.5
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30
        ${filter === id
          ? "bg-gradient-to-r from-neutral-900 via-neutral-800 to-emerald-700 text-white border-transparent shadow-[0_10px_25px_rgba(5,150,105,0.25)]"
          : "bg-white/70 text-neutral-600 border-[color:var(--chat-border)] hover:bg-white hover:text-neutral-900"}
      `}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
            filter === id
              ? "bg-white/20 text-white"
              : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );

  // Render: The Chat List (Sidebar)
  const renderChatList = () => (
    <div className={`relative flex h-full min-h-0 flex-col w-full md:w-[370px] lg:w-[430px] ${selected ? 'hidden md:flex' : 'flex'} bg-[color:var(--chat-surface)] backdrop-blur-xl border border-[color:var(--chat-border)] md:rounded-[30px] shadow-none md:shadow-[0_30px_80px_rgba(15,23,42,0.12)] overflow-hidden`}>
      <div className="p-5 pt-6 pb-4 border-b border-[color:var(--chat-border)] bg-[color:var(--chat-surface-strong)] backdrop-blur-xl sticky top-0 z-20 md:rounded-t-[28px]">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700/70">
              Inbox ({unreadThreadCount})
            </p>
            <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Chats</h1>
            <p className="mt-0.5 text-[11px] font-medium text-neutral-500">
              {lobbyOnlineCount > 0 ? `${lobbyOnlineCount} people online now` : "No one online right now"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {totalUnreadCount > 0 && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                {totalUnreadCount > 99 ? "99+" : totalUnreadCount} unread
              </span>
            )}
            {loading && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500/20 border-t-emerald-600" />
            )}
          </div>
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
          <FilterPill id="all" label="All" count={filterCounts.all} />
          <FilterPill id="unread" label="Unread" count={filterCounts.unread} />
          <FilterPill id="groups" label="Groups" count={filterCounts.groups} />
          <FilterPill id="dms" label="DMs" count={filterCounts.dms} />
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
            <p className="text-sm font-semibold text-neutral-700">
              {filter === "unread" ? "No unread chats." : "No chats found."}
            </p>
            <p className="text-xs mt-1 text-neutral-500">
              {filter === "unread" ? "You're all caught up." : "Try adjusting your filters or search."}
            </p>
          </div>
        ) : (
          <div className="px-3 py-3 space-y-2">
            {filteredList.map((item, index) => (
              (() => {
                const key = chatMetaKey(item);
                const meta = chatMeta[key];
                const active = sameChatItem(selected, item);
                const unread = meta?.unreadCount || 0;
                const isTyping = !!meta?.isTyping;
                const online = item.type === "dm" && lobbyOnlineIds.has(item.id);
                const lastLabel = isTyping ? "typing..." : online ? "online" : relLabel(meta?.lastAt);
                const preview = isTyping ? "Typing..." : sanitizePreview(meta?.preview, item.subtitle);
                const meetupLabel = meetupCountdownLabel(meta?.meetupAt || null);
                const meetupSoon = !!meta?.meetupAt && (() => {
                  const ts = new Date(meta.meetupAt as string).getTime();
                  return Number.isFinite(ts) && ts > Date.now() && ts - Date.now() <= 6 * 60 * 60 * 1000;
                })();

                return (
                  <div
                    key={key}
                    className="group relative page-transition"
                    style={listItemStagger(index)}
                  >
                    <button
                      onClick={() => setSelected(item)}
                      className={`
                        relative w-full flex items-center gap-3 p-3.5 rounded-2xl text-left transition-all duration-200 border
                        ${active
                          ? "border-emerald-200/90 bg-gradient-to-r from-emerald-50/90 via-white to-teal-50/80 shadow-[0_18px_34px_rgba(16,185,129,0.14)]"
                          : meetupSoon
                            ? "border-emerald-100/70 bg-white/55 hover:bg-white/85 hover:border-emerald-200 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(15,23,42,0.1)]"
                            : "border-transparent bg-white/45 hover:bg-white/85 hover:border-white/80 hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(15,23,42,0.09)]"}
                      `}
                    >
                      <div className={`
                        relative h-12 w-12 rounded-2xl flex items-center justify-center text-lg font-bold shrink-0 shadow-sm ring-1 ring-white/70
                        ${unread > 0 ? "shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" : ""}
                        ${item.type === 'announcement'
                          ? 'bg-gradient-to-br from-amber-100 to-amber-200 text-amber-700'
                          : item.type === 'group'
                            ? 'bg-gradient-to-br from-sky-100 to-sky-200 text-sky-700'
                            : 'bg-gradient-to-br from-neutral-100 to-neutral-200 text-neutral-600'}
                      `}>
                        {item.type === 'dm' ? (
                          <AvatarImage
                            avatarUrl={item.avatar_url}
                            seed={item.id}
                            alt={item.name}
                            className="h-full w-full object-cover rounded-2xl"
                          />
                        ) : (
                          item.type === 'group' ? <Users className="h-5 w-5" /> : item.type === 'announcement' ? <Megaphone className="h-5 w-5" /> : item.name.slice(0,1).toUpperCase()
                        )}
                        {online && (
                          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className={`truncate text-[15px] font-semibold ${active ? 'text-emerald-950' : 'text-neutral-900'}`}>
                            {item.name}
                          </div>
                          <div className="shrink-0 text-[11px] font-medium text-neutral-400">
                            {lastLabel || ""}
                          </div>
                        </div>
                        <div className={`text-xs truncate mt-0.5 ${isTyping ? "text-emerald-700 font-semibold" : "text-neutral-500"}`}>
                          {item.type === "dm" && item.public_id ? `@${item.public_id} · ` : ""}
                          {preview}
                        </div>
                        {(meetupLabel || unread > 0) && (
                          <div className="mt-2 flex items-center gap-2">
                            {meetupLabel && item.type !== "dm" && (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                {meetupLabel}
                              </span>
                            )}
                            {unread > 0 && (
                              <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-[0_4px_14px_rgba(16,185,129,0.4)]">
                                {unread > 99 ? "99+" : unread} unread
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>

                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(item.id); }}
                      className={`
                        absolute right-2 top-2 p-1.5 rounded-full transition-all duration-200
                        bg-white/85 shadow-sm ring-1 ring-white/70
                        ${item.isFavorite
                          ? 'opacity-100 text-rose-500'
                          : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 text-neutral-300 hover:text-rose-400'}
                      `}
                      title={item.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                    >
                      <Heart className={`h-3.5 w-3.5 ${item.isFavorite ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                );
              })()
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // Render: The Active Window (Right Pane)
  const renderActiveChat = () => {
    const closeActiveChat = () => {
      setSelected(null);
    };

    if (!selected) {
      return (
        <div className="hidden md:flex flex-1 items-center justify-center">
          <div className="relative flex max-w-lg flex-col items-center gap-5 rounded-[30px] border border-[color:var(--chat-border)] bg-[color:var(--chat-surface)] p-10 text-center shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <div className="absolute inset-0 rounded-[30px] bg-[radial-gradient(circle_at_50%_25%,rgba(16,185,129,0.16),transparent_60%)] pointer-events-none" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-[24px] bg-white shadow-md ring-1 ring-white/70 animate-pulse">
              <MessageSquare className="h-9 w-9 text-emerald-500/80" />
              <Sparkles className="absolute -right-2 -top-2 h-4 w-4 text-emerald-500/70" />
            </div>
            <div className="relative">
              <h3 className="text-3xl font-semibold text-neutral-900 leading-tight">Start a real conversation.</h3>
              <p className="text-base text-neutral-500 mt-2">Small groups. Real plans. Real people.</p>
            </div>
            <button
              onClick={() => navigate(ROUTES.BROWSE)}
              className="relative rounded-full bg-gradient-to-r from-emerald-600 to-teal-500 px-8 py-3 text-base font-semibold text-white shadow-[0_18px_30px_rgba(16,185,129,0.3)] hover:brightness-105 active:scale-[0.99] transition-all"
            >
              Find your circle
            </button>
          </div>
        </div>
      );
    }

    // 3. Helper to handle clicks on header
    const handleHeaderClick = () => {
      if (selected.type === 'group' || selected.type === 'announcement') {
        navigate(routeToGroup(selected.id));
      } else if (selected.type === 'dm') {
        navigate(routeToUser(selected.id), {
          state: { from: `${location.pathname}${location.search}${location.hash}` },
        });
      }
    };
    const selectedMeta = chatMeta[chatMetaKey(selected)];
    const selectedOnline = selected.type === "dm" && lobbyOnlineIds.has(selected.id);
    const selectedTyping = selected.type === "dm" && !!selectedMeta?.isTyping;
    const selectedMeetup = meetupCountdownLabel(selectedMeta?.meetupAt || null);
    const selectedActivityLabel =
      selectedTyping
        ? "Typing..."
        : selectedOnline
          ? "Online now"
          : relLabel(selectedMeta?.lastAt) || "Recently active";

    return (
      <div className="fixed inset-0 z-50 md:static md:inset-auto md:flex-1 flex h-full min-h-0 flex-col bg-[color:var(--chat-surface-strong)] pb-[calc(96px+env(safe-area-inset-bottom))] md:bg-[color:var(--chat-surface)] md:pb-0 md:backdrop-blur-xl md:border md:border-[color:var(--chat-border)] md:rounded-[28px] md:shadow-[0_35px_90px_rgba(15,23,42,0.14)] overflow-hidden">
        {/* Header */}
        <div className="relative h-[76px] border-b border-[color:var(--chat-border)] flex items-center px-4 gap-4 bg-[color:var(--chat-surface-strong)] backdrop-blur-xl shrink-0 z-20 md:rounded-t-[28px]">
          <div className="absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent" />
          <button onClick={closeActiveChat} className="md:hidden p-2 -ml-2 rounded-full hover:bg-white/80 transition-colors">
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
                <AvatarImage
                  avatarUrl={selected.avatar_url}
                  seed={selected.id}
                  alt={selected.name}
                  className="h-full w-full object-cover rounded-2xl"
                />
              ) : (
                selected.type === 'group' ? '#' : selected.type === 'announcement' ? '!' : selected.name.slice(0,1)
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="font-bold text-neutral-900 truncate text-base">{selected.name}</div>
              {selected.type === "dm" && selected.public_id ? (
                <div className="text-[11px] font-semibold text-neutral-500">@{selected.public_id}</div>
              ) : null}
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shadow-sm ${
                  selected.type === 'group'
                    ? 'bg-sky-500'
                    : selected.type === 'announcement'
                      ? 'bg-amber-500'
                      : selectedOnline
                        ? 'bg-emerald-500'
                        : 'bg-neutral-300'
                }`}></span>
                {selected.type === 'group' ? 'Group Chat' : selected.type === 'announcement' ? 'Announcement Chat' : 'Direct Message'}
                <span className={`normal-case tracking-normal font-medium ${selectedTyping ? "text-emerald-600" : "text-neutral-500"}`}>
                  · {selectedActivityLabel}
                </span>
                {selectedMeetup && selected.type !== "dm" && (
                  <span className="normal-case tracking-normal rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    {selectedMeetup}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={() => toggleFavorite(selected.id)}
            className="rounded-xl border border-neutral-200 bg-white p-2 text-neutral-500 shadow-sm hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-emerald-200"
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

          <div
            key={`${selected.type}:${selected.id}`}
            className="absolute inset-0 z-10 animate-in fade-in slide-in-from-right-2 duration-300"
          >
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
                  <div className="mx-auto w-full max-w-2xl space-y-4">
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
                                  <AvatarImage
                                    avatarUrl={selected.avatar_url}
                                    seed={selected.id}
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
                                : 'bg-white text-neutral-800 border border-neutral-200 rounded-[20px] rounded-tl-sm shadow-[0_8px_20px_rgba(15,23,42,0.08)]'}
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
                  {dmError && (
                    <div className="mx-auto mb-2 max-w-2xl rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                      {dmError}
                    </div>
                  )}
                  <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-full border border-neutral-200 bg-white px-2 py-2 shadow-sm transition-all focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-500/20">
                    <input
                      ref={dmInputRef}
                      value={dmInput}
                      onChange={(e) => {
                        const next = e.target.value;
                        setDmInput(next);
                        if (selectedDmId) dmDraftsRef.current[selectedDmId] = next;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void sendDM();
                      }}
                      placeholder="Type a message..."
                      className="flex-1 bg-transparent border-0 px-4 py-1 text-sm focus:ring-0 text-neutral-900 placeholder-neutral-400 outline-none"
                    />
                    <button
                      onClick={() => { void sendDM(); }}
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
      </div>
    );
  };

  // Main Layout
  return (
    <div
      className="relative w-full h-dvh overflow-hidden pb-[calc(96px+env(safe-area-inset-bottom))]"
      style={shellStyle}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(148,163,184,0.2),transparent_42%),radial-gradient(circle_at_75%_20%,rgba(16,185,129,0.15),transparent_45%),radial-gradient(circle_at_35%_90%,rgba(14,165,233,0.14),transparent_40%)]" />
        <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.16),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-[-10rem] right-[-6rem] h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,rgba(14,116,144,0.16),transparent_70%)] blur-3xl" />
      </div>
      <div className="relative flex w-full h-full min-h-0 gap-0 md:gap-4 lg:gap-6 px-0 md:px-4 lg:px-5 py-0 md:py-5 page-transition">
        {renderChatList()}
        {renderActiveChat()}
      </div>
    </div>
  );
}
