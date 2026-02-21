import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Calendar, ChevronLeft, Loader2, MapPin, Star } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/App";
import AvatarImage from "@/components/ui/AvatarImage";
import {
  applyMentionAtCursor,
  detectMentionQuery,
  extractMentionCandidates,
  normalizePublicId,
  replaceMentionToken,
  resolveMentionCandidate,
} from "@/lib/mentions";
import { ROUTES, routeToGroup } from "@/constants/routes";

type EventRatingRow = {
  id: string;
  group_id: string;
  title: string | null;
  starts_at: string | null;
  place: string | null;
  groups?: { title?: string | null } | null;
};

type ExistingRatingRow = {
  stars: number;
  feedback: string | null;
  created_at: string;
  updated_at: string;
};

type TaggableUser = {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
  public_id: string | null;
};

const MAX_FEEDBACK_TAGS = 5;

function formatEventDateTime(iso: string | null): string {
  if (!iso) return "Time TBD";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Time TBD";
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  const day = d.toLocaleDateString(undefined, { day: "2-digit" });
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${weekday} ${day} ${month} · ${time}`;
}

function parseError(msg: string): string {
  if (/event_not_finished/i.test(msg)) return "You can rate after the meetup starts.";
  if (/event_not_found/i.test(msg)) return "Meetup not found.";
  if (/not_group_member/i.test(msg)) return "Only group members can rate this meetup.";
  if (/invalid_stars/i.test(msg)) return "Please choose a rating between 1 and 6.";
  if (/feedback_too_long/i.test(msg)) return "Feedback is too long (max 500 characters).";
  if (/too_many_feedback_tags/i.test(msg)) return `You can tag up to ${MAX_FEEDBACK_TAGS} participants.`;
  if (/invalid_feedback_tag/i.test(msg)) return "One or more tagged users are not participants of this meetup.";
  return "Could not save your rating. Please try again.";
}

export default function EventRatingPage() {
  const { user } = useAuth();
  const { eventId } = useParams<{ eventId: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [eventRow, setEventRow] = useState<EventRatingRow | null>(null);
  const [stars, setStars] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [participants, setParticipants] = useState<TaggableUser[]>([]);
  const [mentionQuery, setMentionQuery] = useState<ReturnType<typeof detectMentionQuery> | null>(null);
  const feedbackRef = useRef<HTMLTextAreaElement | null>(null);

  const fallbackGroupId = searchParams.get("groupId") || null;
  const backFromState = (location.state as { from?: string } | null)?.from || null;

  useEffect(() => {
    if (!user || !eventId) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setErr(null);
      const [
        { data: eventData, error: eventError },
        { data: existing, error: existingError },
        { data: taggableUsers, error: taggableError },
      ] = await Promise.all([
        supabase
          .from("group_events")
          .select("id, group_id, title, starts_at, place, groups(title)")
          .eq("id", eventId)
          .maybeSingle(),
        supabase.rpc("get_my_group_event_rating", { p_event_id: eventId }),
        supabase.rpc("get_event_feedback_taggable_users", { p_event_id: eventId }),
      ]);

      if (cancelled) return;
      if (eventError) {
        setErr("Could not load meetup details.");
        setLoading(false);
        return;
      }
      if (!eventData) {
        setErr("Meetup not found.");
        setLoading(false);
        return;
      }
      setEventRow(eventData as EventRatingRow);
      if (!taggableError) {
        const rows = Array.isArray(taggableUsers) ? (taggableUsers as TaggableUser[]) : [];
        setParticipants(rows.filter((u) => !!normalizePublicId(u.public_id)));
      } else {
        setParticipants([]);
      }

      if (existingError) {
        setErr("Could not load your previous rating.");
      } else if (Array.isArray(existing) && existing.length) {
        const row = existing[0] as ExistingRatingRow;
        setStars(Number(row.stars || 0));
        setFeedback(String(row.feedback || ""));
        setSavedAt(row.updated_at || row.created_at || null);
      }

      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [user, eventId]);

  const groupId = eventRow?.group_id || fallbackGroupId;
  const groupTitle = String(eventRow?.groups?.title || "Circle");
  const startsAt = eventRow?.starts_at || null;
  const eventTs = startsAt ? new Date(startsAt).getTime() : NaN;
  const eventHasStarted = Number.isFinite(eventTs) ? eventTs <= Date.now() : false;
  const backTo = useMemo(() => {
    if (backFromState && typeof backFromState === "string") return backFromState;
    if (groupId) return routeToGroup(groupId);
    return ROUTES.NOTIFICATIONS;
  }, [backFromState, groupId]);

  const canSubmit = !!eventId && stars >= 1 && stars <= 6 && eventHasStarted && !busy;
  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery) return [] as TaggableUser[];
    const q = normalizePublicId(mentionQuery.query);
    if (!q) return participants.slice(0, 8);
    const exact = participants.filter((p) => normalizePublicId(p.public_id) === q);
    if (exact.length) return exact.slice(0, 8);
    return participants
      .filter((p) => {
        const pid = normalizePublicId(p.public_id);
        const name = String(p.name || "").toLowerCase();
        return pid.includes(q) || q.startsWith(pid) || name.includes(q);
      })
      .slice(0, 8);
  }, [mentionQuery, participants]);

  const refreshMentionQuery = (value: string, explicitCursor?: number) => {
    const cursor = explicitCursor ?? feedbackRef.current?.selectionStart ?? value.length;
    setMentionQuery(detectMentionQuery(value, cursor));
  };

  const applyParticipantMention = (user: TaggableUser) => {
    const publicId = normalizePublicId(user.public_id);
    if (!publicId) return;
    const cursor = feedbackRef.current?.selectionStart ?? feedback.length;
    const query = mentionQuery || detectMentionQuery(feedback, cursor);
    if (!query) return;
    const { nextText, nextCursor } = applyMentionAtCursor(feedback, cursor, query, publicId);
    setFeedback(nextText.slice(0, 500));
    setMentionQuery(null);
    requestAnimationFrame(() => {
      if (!feedbackRef.current) return;
      feedbackRef.current.focus({ preventScroll: true });
      feedbackRef.current.selectionStart = nextCursor;
      feedbackRef.current.selectionEnd = nextCursor;
    });
  };

  const submit = async () => {
    if (!user || !eventId || !canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const participantIds = participants.map((p) => normalizePublicId(p.public_id));
      const mentionCandidates = extractMentionCandidates(feedback).filter((token) => token !== "all");
      const resolvedTagIds = new Set<string>();
      let finalFeedback = feedback;

      for (const candidate of mentionCandidates) {
        const { resolved, ambiguous } = resolveMentionCandidate(candidate, participantIds);
        if (!resolved) {
          setErr(
            ambiguous
              ? `@${candidate} matches multiple participants. Pick from the mention list.`
              : `@${candidate} is not marked as a participant for this meetup.`
          );
          setBusy(false);
          return;
        }
        resolvedTagIds.add(resolved);
        finalFeedback = replaceMentionToken(finalFeedback, candidate, resolved);
      }

      if (resolvedTagIds.size > MAX_FEEDBACK_TAGS) {
        setErr(`You can tag up to ${MAX_FEEDBACK_TAGS} participants.`);
        setBusy(false);
        return;
      }

      const payload = {
        p_event_id: eventId,
        p_stars: stars,
        p_feedback: finalFeedback.trim() ? finalFeedback.trim() : null,
      };
      const { data, error } = await supabase.rpc("submit_group_event_rating", payload);
      if (error) throw error;

      const row = data as ExistingRatingRow | null;
      setSavedAt(row?.updated_at || row?.created_at || new Date().toISOString());
    } catch (e: any) {
      setErr(parseError(String(e?.message || e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6 md:px-6">
      <div className="mb-4">
        <button
          type="button"
          onClick={() => navigate(backTo)}
          className="inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back
        </button>
      </div>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
        {loading ? (
          <div className="flex items-center justify-center py-14 text-neutral-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">Loading meetup...</span>
          </div>
        ) : err && !eventRow ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
        ) : (
          <>
            <h1 className="text-2xl font-black tracking-tight text-neutral-900">Rate your meetup</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Your rating helps improve meetup quality for everyone in {groupTitle}.
            </p>

            <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="text-base font-bold text-neutral-900">{eventRow?.title || groupTitle}</div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-neutral-700">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-4 w-4 text-neutral-500" />
                  {formatEventDateTime(startsAt)}
                </span>
                {eventRow?.place && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-4 w-4 text-neutral-500" />
                    {eventRow.place}
                  </span>
                )}
              </div>
            </div>

            {!eventHasStarted && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                You can submit a rating after the meetup starts.
              </div>
            )}

            <div className="mt-6">
              <div className="text-sm font-semibold text-neutral-800">How was this meetup?</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {Array.from({ length: 6 }).map((_, i) => {
                  const n = i + 1;
                  const active = n <= stars;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setStars(n)}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                        active
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : "border-neutral-300 bg-white text-neutral-600 hover:border-neutral-400"
                      }`}
                    >
                      <Star className={`h-4 w-4 ${active ? "fill-amber-500 text-amber-500" : "text-neutral-400"}`} />
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5">
              <label htmlFor="event-feedback" className="text-sm font-semibold text-neutral-800">
                Optional feedback
              </label>
              <div className="relative mt-2">
                <textarea
                  id="event-feedback"
                  ref={feedbackRef}
                  value={feedback}
                  onChange={(e) => {
                    const next = e.target.value.slice(0, 500);
                    setFeedback(next);
                    refreshMentionQuery(next, e.target.selectionStart ?? next.length);
                  }}
                  onClick={(e) => refreshMentionQuery(feedback, e.currentTarget.selectionStart ?? feedback.length)}
                  onKeyUp={(e) => refreshMentionQuery(feedback, e.currentTarget.selectionStart ?? feedback.length)}
                  onFocus={(e) => refreshMentionQuery(feedback, e.currentTarget.selectionStart ?? feedback.length)}
                  onBlur={() => {
                    window.setTimeout(() => setMentionQuery(null), 120);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && mentionQuery) {
                      e.preventDefault();
                      setMentionQuery(null);
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey && mentionQuery && mentionSuggestions.length > 0) {
                      e.preventDefault();
                      applyParticipantMention(mentionSuggestions[0]);
                    }
                  }}
                  placeholder="What went well? What could be better? Use @publicID to reference attendees."
                  className="w-full min-h-[120px] rounded-2xl border border-neutral-300 bg-white px-4 py-3 text-sm text-neutral-900 placeholder-neutral-400 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200"
                />
                {mentionQuery && mentionSuggestions.length > 0 && (
                  <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-20 max-h-56 overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-xl">
                    {mentionSuggestions.map((participant) => {
                      const pid = normalizePublicId(participant.public_id);
                      return (
                        <button
                          key={`${participant.user_id}:${pid}`}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyParticipantMention(participant);
                          }}
                          className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-neutral-50"
                        >
                          <AvatarImage
                            avatarUrl={participant.avatar_url}
                            seed={participant.user_id}
                            alt={participant.name || "Participant"}
                            className="h-7 w-7 rounded-full object-cover border border-neutral-100"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold text-neutral-900">{participant.name || "Participant"}</div>
                            <div className="truncate text-[11px] font-semibold text-emerald-700">@{pid}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="mt-1 text-xs text-neutral-500">You can tag up to {MAX_FEEDBACK_TAGS} attendees with @publicID.</div>
              <div className="mt-1 text-right text-xs text-neutral-500">{feedback.length}/500</div>
            </div>

            {err && eventRow && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
            )}

            {savedAt && (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Saved {new Date(savedAt).toLocaleString()}.
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
                className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Saving..." : "Save rating"}
              </button>
              <Link
                to={backTo}
                className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                Done
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
