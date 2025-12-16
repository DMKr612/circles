import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Message } from "@/types";
import { useAuth } from "@/App";
import { useGroupPresence } from "@/hooks/useGroupPresence";
import { MapPin, Paperclip, Send, X, Smile, Reply, Loader2, Trash } from "lucide-react";
import { useNavigate } from "react-router-dom";

type Profile = { user_id: string; id?: string; name: string | null; avatar_url?: string | null };
type Member = { user_id: string; name: string | null; avatar_url?: string | null };
type Reaction = { id: string; message_id: string; user_id: string; emoji: string };
type ReadRow = { message_id: string; user_id: string; read_at: string };

const relTime = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); return d === 1 ? "1d" : `${d}d`;
};

const getUUID = () => {
  const g: any = (typeof globalThis !== "undefined" && (globalThis as any).crypto)
    ? (globalThis as any).crypto
    : null;
  return g && typeof g.randomUUID === "function"
    ? g.randomUUID()
    : Math.random().toString(36).slice(2);
};

const randomName = (file: File) => {
  const id = getUUID();
  return `${id}_${file.name}`;
};

type ChatPanelProps = {
  groupId: string;
  onClose: () => void;
};

export default function ChatPanel({ groupId, onClose }: ChatPanelProps) {
  // base state
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [dismissedPollMsgs, setDismissedPollMsgs] = useState<Set<string>>(new Set());
  const [pollStatuses, setPollStatuses] = useState<Record<string, string>>({});

  const [msgs, setMsgs] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Map<string, Record<string, string[]>>>(new Map());
  const [reads, setReads] = useState<Map<string, string[]>>(new Map());

  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [memberReady, setMemberReady] = useState(false);

  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // presence/typing minimal
  const [onlineCount, setOnlineCount] = useState(0);
  const [someoneTyping, setSomeoneTyping] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  const [members, setMembers] = useState<Member[]>([]);
  const [showMembers, setShowMembers] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  // Auth hook for user info
  const { user: authUser } = useAuth();
  const me = authUser?.id || null;
  const myEmail = authUser?.email || null;
  const myProfile = me ? profiles.get(me) ?? null : null;

  // --- LOCATION PRESENCE HOOK ---
  const { isTogether } = useGroupPresence(groupId, me ?? undefined);

  // --- ONLINE PRESENCE (Realtime) ---
  useEffect(() => {
    if (!groupId) return;
    const key = me || "anon";
    const channel = supabase.channel(`presence:g:${groupId}`, {
      config: { presence: { key } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, Array<{ user_id?: string; key?: string }>>;
      const ids = new Set<string>();
      Object.values(state).forEach((arr) => {
        arr?.forEach((entry) => {
          const uid = entry.user_id || entry.key;
          if (uid) ids.add(String(uid));
        });
      });
      setOnlineIds(ids);
      setOnlineCount(Math.max(0, ids.size));
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ user_id: key, at: new Date().toISOString() });
      }
    });

    return () => {
      setOnlineIds(new Set());
      setOnlineCount(0);
      supabase.removeChannel(channel);
    };
  }, [groupId, me]);

  // load messages + profiles + reactions + reads
  useEffect(() => {
    let aborted = false;

    async function fetchMissingProfiles(ids: string[]) {
      const missing = ids.filter(id => !profiles.has(id));
      if (!missing.length) return;
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id,id,name,avatar_url")
        .in("user_id", missing);
      if (profs) {
        setProfiles(prev => {
          const next = new Map(prev);
          for (const p of profs) next.set(p.user_id, p as Profile);
          return next;
        });
      }
    }

    async function preloadReactions(messageIds: string[]) {
      if (!messageIds.length) return;
      const { data: rows } = await supabase
        .from("group_message_reactions")
        .select("message_id,user_id,emoji")
        .in("message_id", messageIds);
      if (!rows) return;
      const map = new Map<string, Record<string, string[]>>();
      for (const r of rows) {
        const obj = map.get(r.message_id) ?? {};
        const arr = obj[r.emoji] ?? [];
        if (!arr.includes(r.user_id)) arr.push(r.user_id);
        obj[r.emoji] = arr;
        map.set(r.message_id, obj);
      }
      setReactions(map);
    }

    async function preloadReads(messageIds: string[]) {
      if (!messageIds.length) return;
      const { data: rows } = await supabase
        .from("group_message_reads")
        .select("message_id,user_id,read_at")
        .in("message_id", messageIds);
      if (!rows) return;
      const map = new Map<string, string[]>();
      for (const r of rows as ReadRow[]) {
        const arr = map.get(r.message_id) ?? [];
        if (!arr.includes(r.user_id)) arr.push(r.user_id);
        map.set(r.message_id, arr);
      }
      setReads(map);
    }

    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("group_messages")
        .select("id,group_id,user_id:sender_id,content,created_at,parent_id,attachments")
        .eq("group_id", groupId)
        .order("created_at", { ascending: true });
      if (aborted) return;
      if (error) { console.error(error); setLoading(false); return; }

      const arr = (data ?? []) as Message[];
      setMsgs(arr);
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 0);

      const userIds = Array.from(new Set(arr.map(m => m.user_id)));
      await fetchMissingProfiles(userIds);
      await preloadReactions(arr.map(m => m.id));
      await preloadReads(arr.map(m => m.id));
    })();

    return () => { aborted = true; };
  }, [groupId]);

  useEffect(() => {
    let cancelled = false;
    setPollStatuses({});
    if (!groupId) return;

    const loadPolls = async () => {
      const { data, error } = await supabase
        .from("group_polls")
        .select("id,status")
        .eq("group_id", groupId);
      if (cancelled) return;
      if (error) { console.warn("[polls] load error", error); return; }
      const map: Record<string, string> = {};
      (data || []).forEach((p: any) => {
        if (p?.id && p.status === "open") map[p.id] = p.status;
      });
      setPollStatuses(map);
    };

    loadPolls();

    const ch = supabase
      .channel(`polls:${groupId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_polls", filter: `group_id=eq.${groupId}` },
        (payload) => {
          const row: any = payload.new;
          if (!row?.id) return;
          setPollStatuses(prev => {
            const next = { ...prev };
            if (row.status === "open") next[row.id] = row.status; else delete next[row.id];
            return next;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "group_polls", filter: `group_id=eq.${groupId}` },
        (payload) => {
          const row: any = payload.new;
          if (!row?.id) return;
          setPollStatuses(prev => {
            const next = { ...prev };
            if (row.status === "open") next[row.id] = row.status; else delete next[row.id];
            return next;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "group_polls", filter: `group_id=eq.${groupId}` },
        (payload) => {
          const row: any = payload.old;
          if (!row?.id) return;
          setPollStatuses(prev => {
            const next = { ...prev };
            delete next[row.id];
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [groupId]);

  const activePollBanner = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (dismissedPollMsgs.has(m.id)) continue;
      const match = m.content?.match(/^\[POLL:([^\]]+)\]\s*(.+)$/);
      if (match) {
        const pollId = match[1];
        const status = pollStatuses[pollId];
        if (status !== "open") continue;
        return { id: m.id, pollId, title: match[2].trim() };
      }
    }
    return null;
  }, [msgs, dismissedPollMsgs, pollStatuses]);

  function dismissPollBanner(id: string) {
    setDismissedPollMsgs((prev) => new Set(prev).add(id));
  }

  function handlePollClick(banner: { id: string; pollId: string }) {
    dismissPollBanner(banner.id);
    navigate(`/group/${groupId}#poll`);
  }

  // Load group members
  useEffect(() => {
    let cancelled = false;
    const loadMembers = async () => {
      const { data, error } = await supabase
        .from("group_members")
        .select("user_id, profiles(name,avatar_url)")
        .eq("group_id", groupId);
      if (error) { console.warn("[members] load error", error); return; }
      if (cancelled) return;
      const list: Member[] = (data || []).map((r: any) => ({
        user_id: r.user_id,
        name: r.profiles?.name ?? null,
        avatar_url: r.profiles?.avatar_url ?? null,
      }));
      setMembers(list);
      setProfiles(prev => {
        const next = new Map(prev);
        for (const m of list) {
          next.set(m.user_id, { user_id: m.user_id, name: m.name, avatar_url: m.avatar_url } as Profile);
        }
        return next;
      });
    };
    loadMembers();

    const ch = supabase
      .channel(`gm:${groupId}:members`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_members", filter: `group_id=eq.${groupId}` },
        () => { loadMembers(); }
      )
      .subscribe();

    return () => { cancelled = false; supabase.removeChannel(ch); };
  }, [groupId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length]);

  // realtime
  useEffect(() => {
    const ch = supabase.channel(`gm:${groupId}`);
    ch.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` },
      async (payload) => {
        const raw = payload.new as any;
        if (raw.group_id !== groupId) return;
        const m: Message = {
          id: raw.id,
          group_id: raw.group_id,
          user_id: raw.user_id ?? raw.sender_id ?? raw.author_id,
          content: raw.content,
          created_at: raw.created_at,
          parent_id: raw.parent_id ?? null,
          attachments: raw.attachments ?? []
        };
        setMsgs(prev => {
          const cutoff = Date.now() - 30_000;
          const cleaned = prev.filter(p => {
            if (!p.id.startsWith('phantom-')) return true;
            if (p.user_id !== m.user_id) return true;
            if (p.content !== m.content) return true;
            return +new Date(p.created_at) < cutoff;
          });
          if (cleaned.find(x => x.id === m.id)) return cleaned;
          const next = [...cleaned, m].sort((a,b) => +new Date(a.created_at) - +new Date(b.created_at));
          return next;
        });
        if (!profiles.get(m.user_id)) {
          const { data: p } = await supabase
            .from("profiles")
            .select("user_id,id,name,avatar_url")
            .eq("user_id", m.user_id)
           .maybeSingle();
          if (p) setProfiles(prev => new Map(prev).set(p.user_id, p));
        }
        const nearBottom = (() => {
          const el = listRef.current; if (!el) return true;
          return el.scrollHeight - el.scrollTop - el.clientHeight < 200;
        })();
        if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    ).on("postgres_changes",
      { event: "INSERT", schema: "public", table: "group_message_reactions", filter: `group_id=eq.${groupId}` },
      (payload) => {
        const r = payload.new as Reaction;
        setReactions(prev => {
          const map = new Map(prev);
          const obj = map.get(r.message_id) ?? {};
          const arr = obj[r.emoji] ?? [];
          if (!arr.includes(r.user_id)) arr.push(r.user_id);
          obj[r.emoji] = arr; map.set(r.message_id, obj);
          return map;
        });
      }
    ).on("postgres_changes",
      { event: "DELETE", schema: "public", table: "group_message_reactions", filter: `group_id=eq.${groupId}` },
      (payload) => {
        const r = payload.old as Reaction;
        setReactions(prev => {
          const map = new Map(prev);
          const obj = map.get(r.message_id) ?? {};
          const arr = (obj[r.emoji] ?? []).filter(u => u !== r.user_id);
          if (arr.length) obj[r.emoji] = arr; else delete obj[r.emoji];
          map.set(r.message_id, obj);
          return map;
        });
      }
    ).on("postgres_changes",
      { event: "INSERT", schema: "public", table: "group_message_reads" },
      (payload) => {
        const row = payload.new as ReadRow;
        setReads(prev => {
          const map = new Map(prev);
          const arr = map.get(row.message_id) ?? [];
          if (!arr.includes(row.user_id)) arr.push(row.user_id);
          map.set(row.message_id, arr);
          return map;
        });
      }
    ).on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` },
      (payload) => {
        const row = payload.old as any;
        if (row?.group_id !== groupId) return;
        const id = row.id;
        setMsgs(prev => prev.filter(m => m.id !== id));
        setReactions(prev => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        setReads(prev => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      }
    ).subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [groupId]);

  // presence
  useEffect(() => {
    const presence: any = supabase.channel(`gm:${groupId}:presence`, {
      config: { presence: { key: me || Math.random().toString(36).slice(2) } },
    });
    presence.on("presence", { event: "sync" }, () => {
      const state = presence.presenceState();
      const keys = Object.keys(state);
      setOnlineCount(keys.length);
      let anyTyping: string | null = null;
      for (const k of keys) {
        const metas = state[k] as any[]; const last = metas[metas.length - 1];
        if (last?.typing && last?.uid !== me) {
          anyTyping = last.name || "Someone"; break;
        }
      }
      setSomeoneTyping(anyTyping);
    });
    presence.subscribe((status: string) => {
      if (status === "SUBSCRIBED") {
        presence.track({ uid: me, name: myProfile?.name || (myEmail ? myEmail.split("@")[0] : undefined), typing: false });
      }
    });
    return () => { supabase.removeChannel(presence); };
  }, [groupId, me, myProfile?.name]);


  // Listen for profiles
  useEffect(() => {
    const ch = supabase
      .channel('profiles-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        (payload) => {
          const p = payload.new as { user_id: string; name: string | null; avatar_url?: string | null };
          if (!p?.user_id) return;
          setProfiles((prev) => {
            const next = new Map(prev);
            next.set(p.user_id, { user_id: p.user_id, id: p.user_id, name: p.name, avatar_url: (p as any).avatar_url ?? null });
            return next;
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Backfill profiles
  useEffect(() => {
    (async () => {
      if (!msgs.length) return;
      const unknown = Array.from(new Set(msgs.map(m => m.user_id))).filter(id => !profiles.has(id));
      if (!unknown.length) return;
      const { data: profs, error } = await supabase
        .from("profiles")
        .select("user_id,id,name,avatar_url")
        .in("user_id", unknown);
      if (error) return;
      if (profs?.length) {
        setProfiles(prev => {
          const next = new Map(prev);
          for (const p of profs) next.set(p.user_id, p as any);
          return next;
        });
      }
    })();
  }, [msgs, profiles]);


  // read receipt
  useEffect(() => {
    if (!me || !msgs.length) return;
    const el = listRef.current; if (!el) return;

    const obs = new IntersectionObserver(async (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const id = (e.target as HTMLElement).dataset.mid;
          // Skip client-only phantom messages that aren't persisted
          if (!id || id.startsWith("phantom-")) continue;
          await supabase
            .from("group_message_reads")
            .upsert({ message_id: id, user_id: me });
        }
      }
    }, { root: el, threshold: 0.6 });

    const nodes = el.querySelectorAll("[data-mid]");
    nodes.forEach(n => obs.observe(n));
    return () => obs.disconnect();
  }, [me, msgs]);


  const send = async () => {
    const text = input.trim();
    const parentId = replyTo?.id ?? null;
    const uid = me;
    if (!uid || !memberReady) return;
    if ((!text && files.length === 0) || sending || uploading) return;

    setSending(true);
    const phantomId = `phantom-${getUUID()}`;
    const phantom: Message = {
      id: phantomId,
      group_id: groupId,
      user_id: uid,
      content: text,
      created_at: new Date().toISOString(),
      parent_id: parentId,
      attachments: []
    };
    setMsgs(prev => [...prev, phantom]);
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setInput("");
    setReplyTo(null);

    let attachments: any[] = [];
    if (files.length) {
      setUploading(true);
      try {
        const ups = await Promise.all(files.map(async (f) => {
          const path = `${groupId}/${randomName(f)}`;
          const { error: uploadError } = await supabase.storage.from("chat-uploads").upload(path, f);
          if (uploadError) throw uploadError;
          const { data: signed } = await supabase.storage.from("chat-uploads").createSignedUrl(path, 60 * 60 * 24 * 7);
          return {
            bucket: "chat-uploads",
            path,
            url: signed?.signedUrl ?? null,
            name: f.name,
            size: f.size,
            type: f.type,
          };
        }));
        attachments = ups;
      } catch (e) {
        console.error(e);
        setUploading(false);
        return;
      }
      setUploading(false);
      setFiles([]);
    }

    const { error } = await supabase.rpc('send_group_message', {
  p_group_id: groupId,
  p_content: text,
  p_parent_id: parentId,
  p_attachments: attachments,
});
    setSending(false);
    if (error) {
      setMsgs(prev => prev.filter(m => m.id !== phantomId));
      alert(error.message);
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };

  useEffect(() => {
    (async () => {
      if (!me || !groupId) return;
      try {
        await supabase
          .from('group_members')
          .upsert(
            { group_id: groupId, user_id: me, role: 'member', status: 'active' },
            { onConflict: 'group_id,user_id' }
          );
        setMemberReady(true);
      } catch (e: any) {
        console.warn("membership ensure failed", e);
        setMemberReady(false);
      }
    })();
  }, [groupId, me]);

  useEffect(() => {
    (async () => {
      if (!me || !groupId) return;
      try {
        await supabase.rpc('mark_group_read', { p_group_id: groupId });
        try {
          window.dispatchEvent(new CustomEvent('group-read', { detail: { groupId } }));
        } catch {}
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .eq('user_id', me)
          .eq('payload->>group_id', groupId)
          .eq('is_read', false);
      } catch (e) {}
    })();
  }, [groupId, me]);

  useEffect(() => {
    if (!me || !groupId) return;
    const onFocus = async () => {
      try {
        await supabase.rpc('mark_group_read', { p_group_id: groupId });
        try {
          window.dispatchEvent(new CustomEvent('group-read', { detail: { groupId } }));
        } catch {}
      } catch (e) {}
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [groupId, me]);

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!me) return;
    const current = reactions.get(messageId)?.[emoji] ?? [];
    const has = current.includes(me);
    if (!has) {
      await supabase.from("group_message_reactions").insert({ message_id: messageId, emoji });
    } else {
      await supabase
        .from("group_message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", me)
        .eq("emoji", emoji);
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!me) return;
    const msg = msgs.find(m => m.id === messageId);
    if (!msg || msg.user_id !== me) return;
    if (messageId.startsWith("phantom-")) {
      setMsgs(prev => prev.filter(m => m.id !== messageId));
      return;
    }
    if (!window.confirm("Delete this message?")) return;
    setDeletingIds(prev => new Set(prev).add(messageId));
    const { error } = await supabase.from("group_messages").delete().eq("id", messageId);
    setDeletingIds(prev => {
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
    if (error) {
      console.error("delete message", error);
      alert("Could not delete message.");
      return;
    }
    setMsgs(prev => prev.filter(m => m.id !== messageId));
  };

  const displayName = (uid: string) => {
    if (uid === me) {
      const selfName = (myProfile?.name ?? "").trim();
      if (selfName) return selfName;
      if (myEmail) return myEmail.split("@")[0];
      return "You";
    }
    const p = profiles.get(uid);
    return (p?.name ?? "").trim() || members.find(m => m.user_id === uid)?.name || "Player";
  };

  const avatar = (uid: string) => {
    const p = profiles.get(uid);
    if (p?.avatar_url) return <img src={p.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover ring-2 ring-white shadow-sm" />;
    const label = (p?.name || uid.slice(0, 2)).slice(0, 2).toUpperCase();
    return <div className="h-8 w-8 rounded-full border border-neutral-200 bg-neutral-100 flex items-center justify-center text-[10px] text-neutral-600 font-bold">{label}</div>;
  };

  const onDrop = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    const fl = Array.from(ev.dataTransfer?.files || []);
    if (fl.length) setFiles(prev => [...prev, ...fl]);
  };

  const onPaste = (ev: React.ClipboardEvent<HTMLInputElement | HTMLDivElement | HTMLTextAreaElement>) => {
    const fl: File[] = [];
    const items = Array.from(ev.clipboardData?.items || []);
    for (const item of items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) fl.push(f);
      }
    }
    if (fl.length) setFiles(prev => [...prev, ...fl]);
  };

  const renderAttachments = (atts: any[]) => {
    if (!atts?.length) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {atts.map((a, idx) => {
          if (a?.type?.startsWith("image/") && a.url) {
            return <img key={idx} src={a.url} alt={a.name || ""} className="max-h-48 rounded-lg border border-neutral-100 shadow-sm" />;
          }
          return (
            <a key={idx} href={a.url || "#"} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-200">
              <Paperclip className="h-3 w-3" />
              {a.name || a.path}
            </a>
          );
        })}
      </div>
    );
  };

  // --- Main render ---
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-white">
      
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-100 bg-white/80 px-4 py-3 backdrop-blur-md z-10">
        <div className="flex flex-col">
          <div className="text-base font-bold text-neutral-900">Group Chat</div>
          <div className="flex items-center gap-2 text-[11px] font-medium text-neutral-500">
            <span className={`inline-block h-2 w-2 rounded-full ${onlineCount > 0 ? "bg-emerald-500" : "bg-neutral-300"}`} />
            {onlineCount > 0 ? `${onlineCount} online` : "Offline"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMembers(v => !v)}
            className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-200 transition-colors"
          >
            Members
          </button>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-neutral-100 text-neutral-500 hover:bg-neutral-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showMembers && (
        <div className="absolute top-[60px] right-4 z-20 w-64 rounded-2xl border border-neutral-200 bg-white p-4 shadow-xl animate-in slide-in-from-top-2">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Members ({members.length})</span>
            <button onClick={()=>setShowMembers(false)}><X className="h-3 w-3 text-neutral-400" /></button>
          </div>
          {members.length === 0 ? (
            <div className="text-xs text-neutral-400">No members yet.</div>
          ) : (
            <ul className="max-h-60 overflow-y-auto space-y-1 pr-1">
              {members.map(m => {
                const nearby = isTogether(m.user_id);
                const isOnline = onlineIds.has(m.user_id);
                return (
                  <li key={m.user_id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-neutral-50 transition-colors">
                    <div className="relative">
                      {m.avatar_url ? (
                        <img src={m.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover border border-neutral-100" />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-neutral-100 flex items-center justify-center text-[10px] font-bold text-neutral-500">
                          {(m.name || "").slice(0,2).toUpperCase() || "?"}
                        </div>
                      )}
                      {isOnline && (
                        <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 border-2 border-white" />
                      )}
                      {nearby && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 border-2 border-white opacity-80" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-semibold text-neutral-900">{(m.name && m.name.trim()) || "Player"}</div>
                      {nearby ? (
                        <div className="text-[10px] font-medium text-emerald-600 flex items-center gap-1">Here with you</div>
                      ) : (
                        isOnline && <div className="text-[10px] font-medium text-emerald-600">Online</div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-hidden bg-white">
        <div
          ref={listRef}
          className="h-full overflow-y-auto p-4 space-y-6"
          onDrop={onDrop}
          onDragOver={(e)=>e.preventDefault()}
          onClick={()=>setMenuFor(null)}
        >

          {loading && msgs.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-neutral-300" />
            </div>
          ) : msgs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center p-8">
              <div className="h-16 w-16 bg-neutral-50 rounded-full flex items-center justify-center mb-2">
                <span className="text-3xl">👋</span>
              </div>
              <h3 className="text-lg font-bold text-neutral-900">No messages yet</h3>
              <p className="text-sm text-neutral-500">Be the first to break the ice!</p>
            </div>
          ) : (
            <>
              {msgs.map((m, idx) => {
                const isMine = !!me && m.user_id === me;
                const reacts: Record<string, string[]> = reactions.get(m.id) ?? ({} as Record<string, string[]>);
                const nearby = isTogether(m.user_id);
                
                // Grouping logic (hide avatar if same sender as prev message)
                const showAvatar = !isMine && (idx === 0 || msgs[idx-1].user_id !== m.user_id || (new Date(m.created_at).getTime() - new Date(msgs[idx-1].created_at).getTime() > 300000)); // 5 mins

                return (
                  <div
                    key={m.id}
                    className={`group flex gap-3 ${isMine ? "justify-end" : "justify-start"} ${showAvatar ? 'mt-4' : 'mt-1'}`}
                    data-mid={m.id}
                  >
                    {!isMine && (
                      <div className="w-8 shrink-0 flex flex-col items-center">
                        {showAvatar && avatar(m.user_id)}
                      </div>
                    )}
                    
                    <div className={`flex max-w-[80%] flex-col ${isMine ? "items-end" : "items-start"}`}>
                      {showAvatar && !isMine && (
                        <div className="ml-1 mb-1 flex items-center gap-2">
                          <span className="text-xs font-bold text-neutral-900">
                            {displayName(m.user_id)}
                          </span>
                          {nearby && (
                            <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 bg-emerald-50 text-[9px] font-bold text-emerald-600 uppercase tracking-wide border border-emerald-100">
                              <MapPin className="h-2.5 w-2.5" /> HERE
                            </span>
                          )}
                          <span className="text-[10px] text-neutral-400 font-medium">
                            {relTime(m.created_at)}
                          </span>
                        </div>
                      )}

                      <div className="relative group/msg">
                        {/* Message Bubble */}
                        <div
                          className={`relative px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                            isMine 
                              ? "bg-neutral-900 text-white rounded-2xl rounded-tr-sm" 
                              : "bg-neutral-100 text-neutral-800 rounded-2xl rounded-tl-sm"
                          }`}
                        >
                          {m.parent_id && (() => {
                            const p = msgs.find(x => x.id === m.parent_id);
                            if (!p) return null;
                            return (
                              <div className={`mb-2 rounded-lg border-l-2 px-2 py-1 text-xs opacity-90 ${isMine ? "border-neutral-500 bg-white/10" : "border-neutral-300 bg-white"}`}>
                                <span className="font-bold block mb-0.5">{displayName(p.user_id)}</span>
                                <span className="line-clamp-1">{p.content}</span>
                              </div>
                            );
                          })()}
                          
                          <div className="whitespace-pre-wrap break-words">{m.content}</div>
                          {renderAttachments(m.attachments)}
                        </div>

                        {/* Actions (Reply/React) - Visible on Hover */}
                        <div className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover/msg:opacity-100 transition-opacity flex gap-1 ${isMine ? 'right-full mr-2' : 'left-full ml-2'}`}>
                           <button 
                             onClick={() => setReplyTo(m)}
                             className="p-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-500 hover:text-neutral-900 shadow-sm"
                           >
                             <Reply className="h-3.5 w-3.5" />
                           </button>
                           <button 
                             onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}
                             className="p-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-500 hover:text-neutral-900 shadow-sm"
                           >
                             <Smile className="h-3.5 w-3.5" />
                           </button>
                           {isMine && (
                             <button
                               onClick={() => deleteMessage(m.id)}
                               className="p-1.5 rounded-full bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 shadow-sm disabled:opacity-50"
                               disabled={deletingIds.has(m.id)}
                               title="Delete message"
                             >
                               <Trash className="h-3.5 w-3.5" />
                             </button>
                           )}
                        </div>

                        {/* Reaction Menu */}
                        {menuFor === m.id && (
                          <div className={`absolute z-20 flex gap-1 p-1.5 bg-white rounded-full shadow-lg border border-neutral-200 ${isMine ? 'right-0 top-full mt-1' : 'left-0 top-full mt-1'}`}>
                             {["👍","❤️","😂","😮","😢"].map(emoji => (
                               <button 
                                 key={emoji}
                                 onClick={() => { toggleReaction(m.id, emoji); setMenuFor(null); }}
                                 className="hover:scale-125 transition-transform text-lg px-1"
                               >
                                 {emoji}
                               </button>
                             ))}
                          </div>
                        )}
                      </div>

                      {/* Reactions Display */}
                      {Object.keys(reacts).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {Object.entries(reacts).map(([emoji, users]) => {
                            const iReacted = me ? users.includes(me) : false;
                            return (
                              <button
                                key={emoji}
                                onClick={() => toggleReaction(m.id, emoji)}
                                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border transition-colors ${
                                  iReacted 
                                    ? "bg-neutral-800 text-white border-neutral-800" 
                                    : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300"
                                }`}
                                title={users.map(u => displayName(u)).join(", ")}
                              >
                                <span>{emoji}</span>
                                <span>{users.length}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      
                      {/* Timestamp (only for own or last in group) */}
                      {isMine && (
                         <div className="mt-1 text-[9px] font-medium text-neutral-300 mr-1">
                            {relTime(m.created_at)}
                         </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} className="h-2" />
            </>
          )}
        </div>
      </div>

      {/* Typing Indicator */}
      {someoneTyping && (
        <div className="absolute bottom-[70px] left-4 z-10 animate-in fade-in slide-in-from-bottom-2">
           <div className="bg-white/90 backdrop-blur rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 shadow-sm border border-neutral-100 flex items-center gap-2">
              <div className="flex gap-0.5">
                <span className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce"></span>
              </div>
              {someoneTyping} is typing...
           </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-neutral-100 bg-white p-3 sm:p-4">
        {activePollBanner && (
          <div className="mb-3 flex items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 shadow-sm">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-emerald-700">New poll</div>
              <div className="truncate text-sm font-bold text-neutral-900">{activePollBanner.title}</div>
            </div>
            <button
              onClick={() => handlePollClick(activePollBanner)}
              className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
            >
              Vote
            </button>
            <button
              onClick={() => dismissPollBanner(activePollBanner.id)}
              className="grid h-7 w-7 place-items-center rounded-full bg-white text-neutral-400 hover:text-neutral-700 border border-neutral-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {replyTo && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-neutral-50 border border-neutral-100 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
               <Reply className="h-3 w-3 text-neutral-400" />
               <span className="text-neutral-500">Replying to <span className="font-bold text-neutral-800">{displayName(replyTo.user_id)}</span></span>
            </div>
            <button onClick={() => setReplyTo(null)} className="p-1 hover:bg-neutral-200 rounded-full"><X className="h-3 w-3 text-neutral-500" /></button>
          </div>
        )}
        
        {files.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs font-medium text-neutral-700 border border-neutral-100">
                <Paperclip className="h-3 w-3" />
                <span className="max-w-[100px] truncate">{f.name}</span>
                <button onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}><X className="h-3 w-3 hover:text-red-500" /></button>
              </div>
            ))}
          </div>
        )}
        
        <div className="flex items-end gap-2">
          <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-neutral-50 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 transition-colors">
            <Paperclip className="h-5 w-5" />
            <input type="file" multiple className="hidden" onChange={(e) => setFiles(prev => [...prev, ...Array.from(e.target.files || [])])} />
          </label>
          
          <div className="relative flex-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              onPaste={onPaste}
              autoFocus
              placeholder="Type a message..."
              rows={1}
              className="w-full resize-none rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm text-neutral-900 placeholder-neutral-400 focus:border-neutral-300 focus:bg-white focus:outline-none focus:ring-0 max-h-32 transition-all"
              style={{ minHeight: '42px' }}
            />
          </div>

          <button 
            onClick={send} 
            disabled={sending || uploading || !memberReady || (input.trim().length === 0 && files.length === 0)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white shadow-sm hover:bg-black disabled:bg-neutral-200 disabled:text-neutral-400 transition-all active:scale-95"
          >
            {uploading || sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 ml-0.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
