import React, { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CheckCircle2, Sparkles, Star, X } from "lucide-react";
import {
  computeSocialRhythmResult,
  isQuizCompleteByResponses,
  responsesToAnswersObject,
  type QuizAnswer,
  type SocialRhythmResult,
} from "@/lib/socialRhythmQuiz";

type Question = {
  id: number;
  title: string;
  scenario: string;
  measure: string;
  options: Array<{
    key: QuizAnswer;
    text: string;
  }>;
};

const QUESTIONS: Question[] = [
  {
    id: 1,
    title: "The Energy Reflex",
    scenario:
      "It’s Friday evening. You just finished a long, mentally exhausting week. A Circle near you is hosting a lively meetup tonight. Your immediate reaction is:",
    measure: "Baseline arousal & stimulation tolerance",
    options: [
      { key: "A", text: "I feel my body sink a bit. I need quiet time first." },
      { key: "B", text: "I’m tired, but I could go for a short while." },
      { key: "C", text: "I feel a small boost of energy. This might wake me up." },
    ],
  },
  {
    id: 2,
    title: "Group Size Comfort",
    scenario: "You arrive at a meetup and see 7 people already talking. You naturally:",
    measure: "Group-size comfort & social entry behavior",
    options: [
      { key: "A", text: "Look for one person to connect with first." },
      { key: "B", text: "Join a smaller cluster within the group." },
      { key: "C", text: "Jump into the group conversation directly." },
    ],
  },
  {
    id: 3,
    title: "Social Endurance",
    scenario: "After 90 minutes at a meetup, you usually feel:",
    measure: "Social stamina duration",
    options: [
      { key: "A", text: "Ready to head home and recharge." },
      { key: "B", text: "Comfortable but nearing my limit." },
      { key: "C", text: "Just getting warmed up." },
    ],
  },
  {
    id: 4,
    title: "Noise & Environment Sensitivity",
    scenario: "At a crowded, loud location:",
    measure: "Environmental stimulation tolerance",
    options: [
      { key: "A", text: "I struggle to focus and feel overstimulated." },
      { key: "B", text: "I can manage if conversations are clear." },
      { key: "C", text: "I enjoy the buzz and energy." },
    ],
  },
  {
    id: 5,
    title: "Planning vs Spontaneity",
    scenario: "A Circle suggests moving the meetup to a new place last minute. You:",
    measure: "Structure need & predictability tolerance",
    options: [
      { key: "A", text: "Feel uneasy and prefer sticking to the plan." },
      { key: "B", text: "Adjust if it makes sense." },
      { key: "C", text: "Like the spontaneity." },
    ],
  },
  {
    id: 6,
    title: "Conversation Depth",
    scenario: "In social settings, you prefer conversations that are:",
    measure: "Conversation depth preference",
    options: [
      { key: "A", text: "Meaningful and focused." },
      { key: "B", text: "A mix of meaningful and light." },
      { key: "C", text: "Playful, fast-paced, and humorous." },
    ],
  },
  {
    id: 7,
    title: "New Social Situations",
    scenario: "When meeting new people in a Circle:",
    measure: "Social initiation speed",
    options: [
      { key: "A", text: "I observe first before engaging." },
      { key: "B", text: "I engage gradually as comfort builds." },
      { key: "C", text: "I initiate interaction quickly." },
    ],
  },
  {
    id: 8,
    title: "Recovery Pattern",
    scenario: "After attending a 2-hour meetup, you usually:",
    measure: "Recovery mechanism (true battery effect)",
    options: [
      { key: "A", text: "Need alone time to reset." },
      { key: "B", text: "Need a short break but can continue the evening." },
      { key: "C", text: "Feel energized and open to more." },
    ],
  },
];

const DIMENSION_ROWS: Array<{
  key: keyof SocialRhythmResult["dimensions"];
  label: string;
  unitLabel: (r: SocialRhythmResult) => string;
}> = [
  { key: "stim", label: "Stimulation", unitLabel: (r) => r.labels.stim },
  { key: "group_size", label: "Group Size", unitLabel: (r) => r.labels.group_size },
  { key: "endurance", label: "Endurance", unitLabel: (r) => r.labels.endurance },
  { key: "structure", label: "Planning", unitLabel: (r) => r.labels.structure },
  { key: "connection", label: "Conversation", unitLabel: (r) => r.labels.connection },
];

function toStars(score: number) {
  return Math.round((score / 20) * 10) / 10;
}

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

type Props = {
  open: boolean;
  onClose: () => void;
  currentScore?: number;
  onCompleted?: (payload: { personality_traits: any; reputation_score: number }) => void;
  mode?: "modal" | "page";
};

export default function PersonalityQuizModal({
  open,
  onClose,
  onCompleted,
  currentScore = 0,
  mode = "modal",
}: Props) {
  const [responses, setResponses] = useState<Record<number, QuizAnswer>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const answeredCount = useMemo(
    () =>
      Object.values(responses).filter((v) => v === "A" || v === "B" || v === "C")
        .length,
    [responses]
  );
  const isComplete = useMemo(() => isQuizCompleteByResponses(responses), [responses]);

  const preview = useMemo(() => {
    const answers = responsesToAnswersObject(responses);
    if (!answers) return null;
    return computeSocialRhythmResult(answers, null);
  }, [responses]);

  async function submit() {
    setErr(null);
    const answers = responsesToAnswersObject(responses);
    if (!answers) {
      setErr("Please answer all 8 questions.");
      return;
    }

    setBusy(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) throw new Error("Sign in required.");

      const { data: profileRow, error: profileError } = await supabase
        .from("profiles")
        .select("name, city, bio, age")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profileError) throw profileError;

      const meta = (user.user_metadata || {}) as Record<string, unknown>;
      const name = String((profileRow as any)?.name || meta.name || meta.full_name || "").trim();
      const city = String((profileRow as any)?.city || meta.city || "").trim();
      const bio = String((profileRow as any)?.bio || meta.bio || "").trim();
      const email = String(user.email || "").trim();
      const ageRaw = (profileRow as any)?.age ?? meta.age ?? null;
      const ageNum = Number(ageRaw);
      const age = Number.isFinite(ageNum) ? Math.round(ageNum) : null;

      if (!email) throw new Error("Email is required. Please sign in again.");
      if (name.length < 2) throw new Error("Please add your name in Settings first.");
      if (!city) throw new Error("Please add your city in Settings first.");
      if (!bio) throw new Error("Please add your bio in Settings first.");
      if (countWords(bio) < 10) throw new Error("Your bio must be at least 10 words.");
      if (age === null || age < 13 || age > 120) {
        throw new Error("Please add a valid age (13-120) in Settings first.");
      }

      const finalResult = computeSocialRhythmResult(answers, user.id);
      const traitsPayload = {
        ...finalResult,
        completed_at: finalResult.timestamp,
      };

      const { data, error } = await supabase.rpc("save_personality_traits", {
        p_traits: traitsPayload,
      });
      if (error) throw error;

      // Required backend processing: stores quiz_results + sends result email.
      const fnRes = await supabase.functions.invoke("submit-quiz-result", {
        body: {
          answers,
          participant: {
            name,
            email,
            age,
            city,
            bio,
          },
        },
      });
      if (fnRes.error) {
        let detail = fnRes.error.message;
        const context = (fnRes.error as any)?.context;
        if (context && typeof context.clone === "function") {
          try {
            const raw = await context.clone().text();
            if (raw) detail = `${detail} | ${raw}`;
          } catch {
            // ignore body parse errors
          }
        }
        throw new Error(`Saved profile, but failed to send quiz result: ${detail}`);
      }
      if (!fnRes.data?.ok) {
        const detail = typeof fnRes.data?.error === "string" ? fnRes.data.error : "Unknown function error";
        throw new Error(`Saved profile, but quiz result function failed: ${detail}`);
      }
      if (fnRes.data?.email_sent === false) {
        const detail =
          typeof fnRes.data?.email_error === "string" && fnRes.data.email_error.trim()
            ? fnRes.data.email_error.trim()
            : "email_send_failed";
        throw new Error(`Saved profile, but email could not be sent: ${detail}`);
      }

      const prof = Array.isArray(data) ? data[0] : data;
      if (onCompleted && prof) {
        onCompleted({
          personality_traits: (prof as any)?.personality_traits ?? traitsPayload,
          reputation_score: Number((prof as any)?.reputation_score ?? 0),
        });
      }
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Failed to save quiz");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const panel = (
    <div className="w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-neutral-200/80">
      <div className="flex items-start justify-between border-b border-neutral-100 px-6 py-4">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold text-neutral-900">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Social Rhythm Quiz
          </div>
          <p className="text-sm text-neutral-600">8 scenario questions. Pick A, B, or C.</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-full bg-neutral-100 p-2 text-neutral-500 hover:text-neutral-800"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="grid gap-6 p-6 md:grid-cols-[1.25fr_0.75fr]">
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          {QUESTIONS.map((q) => (
            <div key={q.id} className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4 shadow-sm">
              <div className="mb-2">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
                  Q{q.id} · {q.title}
                </div>
                <div className="mt-1 text-sm font-semibold text-neutral-900">{q.scenario}</div>
                <div className="mt-1 text-xs text-neutral-500">Measures: {q.measure}</div>
              </div>

              <div className="space-y-2">
                {q.options.map((opt) => {
                  const active = responses[q.id] === opt.key;
                  return (
                    <button
                      key={`${q.id}-${opt.key}`}
                      type="button"
                      onClick={() => setResponses((prev) => ({ ...prev, [q.id]: opt.key }))}
                      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2 text-left transition ${
                        active
                          ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                          : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                      }`}
                    >
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                          active ? "bg-emerald-600 text-white" : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {opt.key}
                      </span>
                      <span className="text-sm">{opt.text}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-neutral-100 bg-white/80 p-4 shadow-inner">
          <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4">
            <div className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">
              Social Rhythm Profile
            </div>
            <div className="text-xl font-bold text-neutral-900">{preview?.style || "Answer all questions"}</div>
            <div className="text-sm text-neutral-600">
              {preview
                ? `Energy: ${preview.labels.stim} · Group size: ${preview.labels.group_size}`
                : "Results appear after all 8 questions are answered."}
            </div>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-100">
              <Sparkles className="h-3.5 w-3.5" /> +20 Rating boost
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-100 bg-neutral-50/80 p-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-neutral-600">5 Dimensions</div>
            {!preview ? (
              <p className="text-sm text-neutral-600">Complete all answers to calculate your dimension scores.</p>
            ) : (
              <div className="space-y-2 text-sm text-neutral-700">
                {DIMENSION_ROWS.map((row) => {
                  const value = preview.dimensions[row.key];
                  return (
                    <div key={row.key} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-neutral-600">{row.label}</span>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-neutral-200">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600"
                            style={{ width: `${value}%` }}
                          />
                        </div>
                        <span className="text-[11px] font-semibold text-neutral-700">
                          {value} · {row.unitLabel(preview)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/80 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
              <Star className="h-4 w-4 text-indigo-600" /> Your projected Rating
            </div>
            <div className="mt-2 flex items-center gap-2 text-lg font-bold text-neutral-900">
              {toStars(currentScore).toFixed(1)} → {toStars(Math.min(100, currentScore + 20)).toFixed(1)}★
            </div>
            <p className="text-xs text-neutral-600">Boost applies immediately after saving.</p>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600">
            {isComplete ? (
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                All questions answered
              </span>
            ) : (
              <span>{answeredCount}/{QUESTIONS.length} answered</span>
            )}
          </div>

          {err && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
          )}

          <button
            onClick={submit}
            disabled={busy || !isComplete}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? "Saving..." : "Save my Social Rhythm"}
          </button>
        </div>
      </div>
    </div>
  );

  if (mode === "page") {
    return <div className="mx-auto w-full max-w-4xl">{panel}</div>;
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-6 md:items-center"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{panel}</div>
    </div>
  );
}
