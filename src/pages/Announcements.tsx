import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ANNOUNCEMENT_ADMINS, isAnnouncementVisibleForViewer, type Announcement } from "@/lib/announcements";
import { ArrowLeft, CalendarClock, Megaphone, MessageCircle, MapPin, Trash2, Edit2, Plus, Map } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { checkGroupJoinBlock, joinBlockMessage } from "@/lib/ratings";
import { geocodePlace } from "@/lib/geocode";

function formatEventRange(evt: Announcement): string {
  const start = new Date(evt.datetime);
  const end = new Date(start.getTime() + (evt.duration_minutes ?? 60) * 60 * 1000);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  return `${start.toLocaleString(undefined, opts)} – ${end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

const parseLocation = (location: string) => {
  const match = location.match(/^(.*?)(\s*\(([^)]+)\))?\s*$/);
  const label = match?.[1]?.trim() || location;
  const coords = match?.[3]?.trim() || null;
  return { label, coords };
};

const mapLinks = (location: string) => {
  const { coords, label } = parseLocation(location);
  const q = encodeURIComponent(coords || label);
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${q}`,
    apple: `http://maps.apple.com/?q=${q}`,
  };
};

const confirmAndAddEventToCalendar = (evt: Announcement) => {
  if (!window.confirm("Add this event to your calendar?")) return;
  const start = new Date(evt.datetime);
  if (Number.isNaN(start.getTime())) return;
  const end = new Date(start.getTime() + (evt.duration_minutes ?? 60) * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Circles//Announcements//EN",
    "BEGIN:VEVENT",
    `UID:${evt.id}@circles.app`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${evt.title}`,
    `DESCRIPTION:${evt.description} Activities: ${(evt.activities || []).join(" | ")}`,
    `LOCATION:${parseLocation(evt.location).label}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n");
  const blob = new Blob([ics], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${evt.id}.ics`;
  a.click();
  URL.revokeObjectURL(url);
};

const isUuid = (val?: string | null) => !!val && /^[0-9a-fA-F-]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(val.trim());

export default function AnnouncementsPage() {
  const [events, setEvents] = useState<Announcement[]>([]);
  const [joined, setJoined] = useState<Set<string>>(new Set());
  const [joinBusy, setJoinBusy] = useState<Set<string>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [viewerEmail, setViewerEmail] = useState<string | null>(null);
  const [viewerCity, setViewerCity] = useState<string | null>(null);
  const [viewerCoords, setViewerCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [form, setForm] = useState<Partial<Announcement>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [eventsErr, setEventsErr] = useState<string | null>(null);

  const createAnnouncementGroup = async (
    title: string,
    description: string,
    location: string | null,
    creatorId: string
  ): Promise<string | null> => {
    const geo = location ? await geocodePlace(location) : null;
    const groupPayload: Record<string, any> = {
      title,
      description,
      creator_id: creatorId,
      host_id: creatorId,
      city: location || null,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      is_online: false,
      capacity: null,
    };

    let insertRes = await supabase.from("groups").insert(groupPayload).select("id").maybeSingle();
    if (insertRes.error?.code === "42703") {
      const { lat: _lat, lng: _lng, ...legacyPayload } = groupPayload;
      insertRes = await supabase.from("groups").insert(legacyPayload).select("id").maybeSingle();
    }
    if (insertRes.error) throw insertRes.error;
    return insertRes.data?.id || null;
  };

  // Load joined announcements from local storage (activity calendar)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("circles.activityCalendar");
      if (raw) {
        const ids: string[] = JSON.parse(raw)?.ids || [];
        setJoined(new Set(ids));
      }
    } catch (e) { console.warn("calendar load", e); }
  }, []);

  // Check announcement admin allowlist
  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const email = (u?.user?.email || "").trim().toLowerCase();
      setUid(u?.user?.id || null);
      setViewerEmail(email || null);
      setIsAdmin(!!email && ANNOUNCEMENT_ADMINS.includes(email));

      if (u?.user?.id) {
        const full = await supabase
          .from("profiles")
          .select("city, lat, lng")
          .eq("user_id", u.user.id)
          .maybeSingle();
        if (!full.error) {
          setViewerCity(full.data?.city || null);
          if (typeof full.data?.lat === "number" && typeof full.data?.lng === "number") {
            setViewerCoords({ lat: full.data.lat, lng: full.data.lng });
          }
        } else if (full.error?.code === "42703") {
          const fallback = await supabase.from("profiles").select("city").eq("user_id", u.user.id).maybeSingle();
          if (!fallback.error) setViewerCity(fallback.data?.city || null);
        }
      }
    })();
  }, []);

  // Load announcements from DB (hidden after 15 days for non-creators)
  const loadEvents = async () => {
    setLoadingEvents(true);
    setEventsErr(null);
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('datetime', { ascending: true })
        .limit(200);
      if (error) throw error;
      let rows = (data || []) as Announcement[];

      // Auto-link missing circles if admin
      if (isAdmin && uid) {
        let mutated = false;
        for (const a of rows) {
          if (!a.group_id) {
            const newGroupId = await createAnnouncementGroup(
              a.title,
              a.description,
              a.location || null,
              uid
            );
            if (newGroupId) {
              mutated = true;
              await supabase.from('announcements').update({ group_id: newGroupId }).eq('id', a.id);
              a.group_id = newGroupId;
            }
          }
        }
        if (mutated) {
          // refresh to ensure consistency
          const { data: refreshed } = await supabase
            .from('announcements')
            .select('*')
            .order('datetime', { ascending: true })
            .limit(200);
          rows = (refreshed || rows) as Announcement[];
        }
      }

      const visibleRows = rows.filter((evt) =>
        isAnnouncementVisibleForViewer(evt, {
          viewerId: uid,
          viewerEmail,
          viewerCity,
          viewerCoords,
        })
      );
      setEvents(visibleRows);
    } catch (e: any) {
      setEventsErr(e?.message || "Failed to load announcements");
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => { loadEvents(); }, [uid, viewerEmail, viewerCity, viewerCoords, isAdmin]);

  // Persist joined announcements for the in-app activity calendar
  const persist = (ids: Set<string>) => {
    try {
      const payload = {
        ids: Array.from(ids),
        events: events.filter((e) => ids.has(e.id)).map((e) => ({
          id: e.id,
          title: e.title,
          datetime: e.datetime,
          location: e.location,
        })),
      };
      localStorage.setItem("circles.activityCalendar", JSON.stringify(payload));
    } catch (e) { console.warn("calendar save", e); }
  };

  // Lightweight reminder: schedules a notification 24h before (browser must stay open)
  const scheduleReminder = (evt: Announcement) => {
    const start = new Date(evt.datetime).getTime();
    if (Number.isNaN(start)) return;
    const reminderAt = start - 24 * 60 * 60 * 1000;
    const delay = reminderAt - Date.now();
    if (delay <= 0 || delay > 2_147_483_000) return; // skip past/very distant

    const send = () => {
      try {
        if ("Notification" in window) {
          Notification.requestPermission().then((perm) => {
            if (perm === "granted") new Notification(evt.title, { body: `${evt.location} · starts tomorrow`, tag: evt.id });
          });
        }
      } catch {}
    };
    window.setTimeout(send, delay);
  };

  const joinEvent = async (evt: Announcement) => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return;

    const busy = new Set(joinBusy);
    busy.add(evt.id);
    setJoinBusy(busy);

    try {
      // If this announcement is tied to a circle, join that group so it appears in My Groups & chat
      let groupIdToJoin: string | null = evt.group_id || null;
      if (groupIdToJoin) {
        const blockReason = await checkGroupJoinBlock(uid, groupIdToJoin);
        if (blockReason) {
          const message = joinBlockMessage(blockReason);
          window.alert(message);
          return;
        }
        const { error } = await supabase.from('group_members').insert({
          group_id: groupIdToJoin,
          user_id: uid,
          role: 'member',
          status: 'active',
          last_joined_at: new Date().toISOString(),
        });
        if (error && error.code !== '23505') throw error;
      }

      const next = new Set(joined);
      next.add(evt.id);
      setJoined(next);
      persist(next);
      addEventToCalendar(evt);
      scheduleReminder(evt);
    } finally {
      const nb = new Set(joinBusy);
      nb.delete(evt.id);
      setJoinBusy(nb);
    }
  };

  const resetForm = () => {
    setForm({});
    setEditId(null);
    setFormErr(null);
    setFormOpen(false);
  };

  const saveAnnouncement = async () => {
    if (!isAdmin) return;
    setFormErr(null);
    const title = (form.title || "").trim();
    const description = (form.description || "").trim();
    const datetime = form.datetime || "";
    const location = (form.location || "").trim();
    if (!title || !description || !datetime || !location) {
      setFormErr("Title, description, datetime, and location are required.");
      return;
    }
    const iso = (() => {
      const d = new Date(datetime);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    })();
    if (!iso) {
      setFormErr("Invalid date/time.");
      return;
    }
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id || null;
    const coords = (form.coords || "").trim() || null;
    const locationForSave = coords ? `${location} (${coords})` : location;
    const activities = Array.isArray(form.activities)
      ? form.activities
      : (form.activities as any)?.split?.("\n")?.map((s: string) => s.trim()).filter(Boolean) || [];
    const payload: any = {
      title,
      description,
      datetime: iso,
      location: locationForSave,
      duration_minutes: form.duration_minutes || null,
      activities,
      link: form.link || null,
      group_id: isUuid(form.group_id as string) ? (form.group_id as string) : null,
    };
    if (!editId && uid) payload.created_by = uid;
    try {
      // Auto-create a circle for this announcement if none linked
      if (!payload.group_id && uid) {
        const linkedGroupId = await createAnnouncementGroup(title, description, location || null, uid);
        if (linkedGroupId) payload.group_id = linkedGroupId;
      }

      const upsert = async (body: any) => {
        if (editId) {
          const { error } = await supabase.from('announcements').update(body).eq('id', editId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('announcements').insert(body);
          if (error) throw error;
        }
      };

      await upsert(payload);

      resetForm();
      await loadEvents();
    } catch (e: any) {
      setFormErr(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const deleteAnnouncement = async (id: string) => {
    if (!isAdmin) return;
    await supabase.from('announcements').delete().eq('id', id);
    if (editId === id) resetForm();
    await loadEvents();
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 pb-20 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/browse" className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200">
          <ArrowLeft className="h-4 w-4 text-neutral-700" />
        </Link>
        <div>
          <div className="text-xs font-bold uppercase text-neutral-500">Circles Official</div>
          <h1 className="text-2xl font-extrabold text-neutral-900">Announcements</h1>
          <p className="text-sm text-neutral-600">Pick an official event, add it to your calendar, and join the chat. No capacity limits.</p>
        </div>
      </div>

      <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-3 text-xs text-amber-800">
        {isAdmin
          ? "You have announcement admin access. Use the form below to create, edit, or delete announcements. Set a group ID to link a circle so joins show in My Groups and unlock chat."
          : "Only Circles official admins can create announcements. Linked circles show up in My Groups and enable chat for joiners."}
      </div>

      {isAdmin && formOpen && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-neutral-900">
              <Megaphone className="h-4 w-4 text-amber-500" />
              {editId ? "Edit announcement" : "New announcement"}
            </div>
            {editId && (
              <button
                onClick={resetForm}
                className="text-xs font-semibold text-neutral-500 hover:text-black"
              >
                Cancel
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={form.title || ""}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Title"
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            />
            <input
              type="datetime-local"
              value={form.datetime || ""}
              onChange={(e) => setForm({ ...form, datetime: e.target.value })}
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            />
            <input
              value={form.location || ""}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="Location"
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-2 text-[11px] text-neutral-600">
              <button
                type="button"
                onClick={() => {
                  if (form.location) window.open(mapLinks(form.location).google, "_blank");
                }}
                className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-1 font-semibold hover:border-neutral-300 disabled:opacity-50"
                disabled={!form.location}
              >
                Open in Google Maps
              </button>
              <button
                type="button"
                onClick={() => {
                  if (form.location) window.open(mapLinks(form.location).apple, "_blank");
                }}
                className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-1 font-semibold hover:border-neutral-300 disabled:opacity-50"
                disabled={!form.location}
              >
                Open in Apple Maps
              </button>
            </div>
            <input
              type="number"
              value={form.duration_minutes ?? ""}
              onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
              placeholder="Duration minutes"
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            />
            <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-3 text-[11px] text-neutral-700">
              Circles are auto-created when you save. Chat/My Groups will work with the generated circle. To link an existing circle, enter its Group ID below (optional).
              <div className="mt-2">
                <input
                  value={form.group_id || ""}
                  onChange={(e) => setForm({ ...form, group_id: e.target.value || null })}
                  placeholder="Group ID (optional)"
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <input
              value={form.link || ""}
              onChange={(e) => setForm({ ...form, link: e.target.value })}
              placeholder="Link (optional)"
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
            />
          </div>
          <textarea
            value={Array.isArray(form.activities) ? form.activities.join("\n") : (form.activities as any) || ""}
            onChange={(e) => setForm({ ...form, activities: e.target.value })}
            rows={3}
            placeholder="Activities (one per line)"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
          />
          <textarea
            value={form.description || ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            placeholder="Description"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={saveAnnouncement}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-full bg-black px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-neutral-800 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {editId ? (saving ? "Updating..." : "Update") : (saving ? "Saving..." : "Save")}
            </button>
            {editId && (
              <button
                onClick={() => deleteAnnouncement(editId)}
                className="inline-flex items-center gap-2 rounded-full border border-neutral-200 px-4 py-2 text-xs font-bold text-neutral-800 hover:border-neutral-300"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            )}
          </div>
          {formErr && <div className="text-xs font-semibold text-rose-600">{formErr}</div>}
        </div>
      )}

      <div className="space-y-3">
        {loadingEvents && <div className="text-sm text-neutral-500">Loading announcements...</div>}
        {eventsErr && <div className="text-sm font-semibold text-rose-600">{eventsErr}</div>}
        {!loadingEvents && events.length === 0 && (
          <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">No announcements.</div>
        )}
        {isAdmin && !formOpen && (
          <button
            onClick={() => { setFormOpen(true); setEditId(null); setForm({}); setFormErr(null); }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 p-4 text-sm font-semibold text-neutral-700 hover:border-neutral-300"
          >
            <Plus className="h-4 w-4" /> New announcement
          </button>
        )}
        {events.map((evt) => (
          <div key={evt.id} id={`announcement-${evt.id}`} className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-bold text-neutral-900">
                  <Megaphone className="h-4 w-4 text-amber-500" />
                  {evt.title}
                </div>
                <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600">
                  <CalendarClock className="h-4 w-4" />
                  {formatEventRange(evt)}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-900">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    {parseLocation(evt.location).label}
                  </span>
                  <a
                    href={mapLinks(evt.location).google}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-1 text-[11px] font-bold text-neutral-700 hover:border-neutral-300"
                  >
                    <Map className="h-3 w-3" /> Google Maps
                  </a>
                  <a
                    href={mapLinks(evt.location).apple}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-1 text-[11px] font-bold text-neutral-700 hover:border-neutral-300"
                  >
                    <Map className="h-3 w-3" /> Apple Maps
                  </a>
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600">No cap</span>
            </div>

            {isAdmin && (
              <div className="mt-2 flex gap-2 text-xs font-semibold text-neutral-600">
                <button
                  onClick={() => { setEditId(evt.id); setFormOpen(true); setForm({ ...evt, datetime: evt.datetime?.slice(0,16) }); setFormErr(null); }}
                  className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-1 hover:border-neutral-300"
                >
                  <Edit2 className="h-3 w-3" /> Edit
                </button>
                <button
                  onClick={() => deleteAnnouncement(evt.id)}
                  className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-2 py-1 text-rose-600 hover:border-rose-300"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            )}

            <p className="mt-2 text-sm text-neutral-700 leading-relaxed">{evt.description}</p>
            <ul className="mt-2 space-y-1 text-xs text-neutral-600">
              {(evt.activities || []).map((a) => (
                <li key={a} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-neutral-900"></span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => joinEvent(evt)}
                disabled={joined.has(evt.id) || joinBusy.has(evt.id)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold shadow-sm transition ${joined.has(evt.id) ? "border-neutral-200 bg-neutral-50 text-neutral-500" : "border-neutral-200 bg-white text-neutral-900 hover:border-neutral-300"}`}
              >
                <CalendarClock className="h-4 w-4" />
                {joined.has(evt.id) ? "Added to calendars" : joinBusy.has(evt.id) ? "Joining..." : "Join & add to calendar"}
              </button>
              <Link
                to={joined.has(evt.id) && evt.group_id ? `/chats?groupId=${evt.group_id}` : "#"}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold shadow-sm transition ${joined.has(evt.id) && evt.group_id ? "bg-black text-white hover:bg-neutral-800" : "bg-neutral-200 text-neutral-500"}`}
                aria-disabled={!joined.has(evt.id) || !evt.group_id}
                onClick={(e) => { if (!joined.has(evt.id) || !evt.group_id) e.preventDefault(); }}
              >
                <MessageCircle className="h-4 w-4" />
                {joined.has(evt.id)
                  ? evt.group_id ? "Open event chat" : "Chat unavailable"
                  : "Join to open chat"}
              </Link>
            </div>
            {joined.has(evt.id) && (
              <div className="mt-2 text-[11px] font-semibold text-emerald-700 space-y-1">
                <div>Added to activity calendar + system calendar. Reminder scheduled 24h before.</div>
                {evt.group_id && <div>Also added to My Groups — open it to see people and details.</div>}
                {!evt.group_id && <div className="text-amber-700">Chat/My Groups unavailable until a circle is linked (set Group ID).</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
