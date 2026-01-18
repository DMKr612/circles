import React, { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { X, Sparkles, Star } from "lucide-react";

type Question = {
  id: number;
  text: string;
  trait: TraitKey;
  reverse?: boolean;
};

type TraitKey = "extraversion" | "agreeableness" | "conscientiousness" | "neuroticism" | "openness";

const QUESTIONS: Question[] = [
  { id: 1, text: "is talkative", trait: "extraversion" },
  { id: 2, text: "is generally trusting", trait: "agreeableness" },
  { id: 3, text: "tends to be lazy", trait: "conscientiousness", reverse: true },
  { id: 4, text: "is relaxed, handles stress well", trait: "neuroticism", reverse: true },
  { id: 5, text: "has few artistic interests", trait: "openness", reverse: true },
  { id: 6, text: "is reserved", trait: "extraversion", reverse: true },
  { id: 7, text: "is considerate and kind to almost everyone", trait: "agreeableness" },
  { id: 8, text: "does things efficiently", trait: "conscientiousness" },
  { id: 9, text: "gets nervous easily", trait: "neuroticism" },
  { id: 10, text: "has an active imagination", trait: "openness" },
];

const TRAIT_ADJECTIVES: Record<TraitKey, { high: string; low: string }> = {
  extraversion: { high: "Extroverted", low: "Introverted" },
  agreeableness: { high: "Agreeable", low: "Direct" },
  conscientiousness: { high: "Organized", low: "Flexible" },
  neuroticism: { high: "Calm", low: "Vigilant" },
  openness: { high: "Curious", low: "Practical" },
};

function toStars(score: number) {
  return Math.round((score / 20) * 10) / 10;
}

function deriveBadge(topTrait: TraitKey): { name: string; description: string } {
  switch (topTrait) {
    case "conscientiousness":
      return { name: "The Architect", description: "Plans ahead and keeps groups on track." };
    case "extraversion":
      return { name: "The Socialite", description: "Energizes rooms and keeps conversations flowing." };
    case "agreeableness":
      return { name: "The Anchor", description: "Grounded, supportive, and easy to team with." };
    case "openness":
      return { name: "The Explorer", description: "Curious mind who loves new ideas." };
    default:
      return { name: "The Strategist", description: "Thoughtful, steady, and reliable." };
  }
}

function normalizeResponses(responses: Record<number, number>) {
  const sums: Record<TraitKey, number> = {
    extraversion: 0,
    agreeableness: 0,
    conscientiousness: 0,
    neuroticism: 0,
    openness: 0,
  };
  const counts: Record<TraitKey, number> = {
    extraversion: 0,
    agreeableness: 0,
    conscientiousness: 0,
    neuroticism: 0,
    openness: 0,
  };

  QUESTIONS.forEach((q) => {
    const raw = responses[q.id] ?? 3;
    const val = q.reverse ? 6 - raw : raw;
    sums[q.trait] += val;
    counts[q.trait] += 1;
  });

  const averages: Record<TraitKey, number> = {
    extraversion: sums.extraversion / Math.max(1, counts.extraversion),
    agreeableness: sums.agreeableness / Math.max(1, counts.agreeableness),
    conscientiousness: sums.conscientiousness / Math.max(1, counts.conscientiousness),
    neuroticism: sums.neuroticism / Math.max(1, counts.neuroticism),
    openness: sums.openness / Math.max(1, counts.openness),
  };

  const percents: Record<TraitKey, number> = {
    extraversion: Math.round(((averages.extraversion - 1) / 4) * 100),
    agreeableness: Math.round(((averages.agreeableness - 1) / 4) * 100),
    conscientiousness: Math.round(((averages.conscientiousness - 1) / 4) * 100),
    neuroticism: Math.round(((averages.neuroticism - 1) / 4) * 100),
    openness: Math.round(((averages.openness - 1) / 4) * 100),
  };

  const ordered = Object.entries(averages).sort((a, b) => b[1] - a[1]) as Array<[TraitKey, number]>;
  const top = ordered[0]?.[0] ?? "agreeableness";
  const second = ordered[1]?.[0] ?? "openness";

  const summary = `${averages.extraversion >= 3 ? TRAIT_ADJECTIVES.extraversion.high : TRAIT_ADJECTIVES.extraversion.low} | ${averages.agreeableness >= 3 ? TRAIT_ADJECTIVES.agreeableness.high : TRAIT_ADJECTIVES.agreeableness.low}`;
  const badge = deriveBadge(top);

  return {
    badge,
    summary,
    top,
    second,
    scores: {
      extraversion: { average: averages.extraversion, percent: percents.extraversion, adjective: averages.extraversion >= 3 ? TRAIT_ADJECTIVES.extraversion.high : TRAIT_ADJECTIVES.extraversion.low },
      agreeableness: { average: averages.agreeableness, percent: percents.agreeableness, adjective: averages.agreeableness >= 3 ? TRAIT_ADJECTIVES.agreeableness.high : TRAIT_ADJECTIVES.agreeableness.low },
      conscientiousness: { average: averages.conscientiousness, percent: percents.conscientiousness, adjective: averages.conscientiousness >= 3 ? TRAIT_ADJECTIVES.conscientiousness.high : TRAIT_ADJECTIVES.conscientiousness.low },
      neuroticism: { average: averages.neuroticism, percent: percents.neuroticism, adjective: averages.neuroticism >= 3 ? TRAIT_ADJECTIVES.neuroticism.high : TRAIT_ADJECTIVES.neuroticism.low },
      openness: { average: averages.openness, percent: percents.openness, adjective: averages.openness >= 3 ? TRAIT_ADJECTIVES.openness.high : TRAIT_ADJECTIVES.openness.low },
    },
  };
}

type Props = {
  open: boolean;
  onClose: () => void;
  currentScore?: number;
  onCompleted?: (payload: { personality_traits: any; reputation_score: number }) => void;
};

export default function PersonalityQuizModal({ open, onClose, onCompleted, currentScore = 0 }: Props) {
  const [responses, setResponses] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const preview = useMemo(() => normalizeResponses(responses), [responses]);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        ...preview,
        completed_at: new Date().toISOString(),
        raw_answers: responses,
      };
      const { data, error } = await supabase.rpc("save_personality_traits", { p_traits: payload });
      if (error) throw error;
      const prof = Array.isArray(data) ? data[0] : data;
      if (onCompleted && prof) {
        onCompleted({
          personality_traits: (prof as any)?.personality_traits ?? payload,
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

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl ring-1 ring-neutral-200/80 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-neutral-100 px-6 py-4">
          <div>
            <div className="flex items-center gap-2 text-lg font-bold text-neutral-900">
              <Sparkles className="h-5 w-5 text-amber-500" />
              Discover your Social Style
            </div>
            <p className="text-sm text-neutral-600">10 quick questions. Earn +20 rating and unlock your badge.</p>
          </div>
          <button onClick={onClose} className="rounded-full bg-neutral-100 p-2 text-neutral-500 hover:text-neutral-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-6 p-6 md:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            {QUESTIONS.map((q) => (
              <div key={q.id} className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Q{q.id}</div>
                    <div className="text-sm font-semibold text-neutral-900">I see myself as someone who {q.text}.</div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                    <span>Disagree</span>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={responses[q.id] ?? 3}
                      onChange={(e) => setResponses((prev) => ({ ...prev, [q.id]: Number(e.target.value) }))}
                      className="accent-emerald-600"
                    />
                    <span>Agree</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-neutral-100 bg-white/80 p-4 shadow-inner">
            <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4">
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700 mb-1">Your Badge</div>
              <div className="text-xl font-bold text-neutral-900">{preview.badge.name}</div>
              <div className="text-sm text-neutral-600">{preview.badge.description}</div>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-100">
                <Sparkles className="h-3.5 w-3.5" /> +20 Rating boost
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-100 bg-neutral-50/80 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-neutral-600 mb-2">Summary</div>
              <div className="text-sm font-semibold text-neutral-900">{preview.summary}</div>
              <div className="mt-3 space-y-2 text-sm text-neutral-700">
                {(Object.keys(preview.scores) as TraitKey[]).map((t) => (
                  <div key={t} className="flex items-center justify-between gap-2">
                    <span className="capitalize text-neutral-600">{t}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-28 rounded-full bg-neutral-200 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600"
                          style={{ width: `${preview.scores[t].percent}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-neutral-800">{preview.scores[t].adjective}</span>
                    </div>
                  </div>
                ))}
              </div>
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

            {err && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

            <button
              onClick={submit}
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? "Saving..." : "Save my Social Style"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
