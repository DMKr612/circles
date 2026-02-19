import { useMemo } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import PersonalityQuizModal from "@/components/PersonalityQuizModal";
import { useAuth } from "@/App";
import { useProfile } from "@/hooks/useProfile";

export default function PersonalityQuizPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const { data: profile } = useProfile(uid);

  const currentReputation = useMemo(() => Number(profile?.reputation_score ?? 0), [profile?.reputation_score]);

  function goBack() {
    if (window.history.length > 1) navigate(-1);
    else navigate("/settings");
  }

  function onCompleted() {
    if (uid) queryClient.invalidateQueries({ queryKey: ["profile", uid] });
    navigate("/settings", { replace: true });
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-24 pt-12 md:px-6 md:pt-14">
      <header className="mb-5 rounded-3xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex w-fit items-center gap-1 rounded-xl px-2 py-1 text-sm font-semibold text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <h1 className="text-center text-2xl font-bold tracking-tight text-neutral-900">
            Social Rhythm Quiz
          </h1>
          <div />
        </div>
      </header>

      <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
        <div className="inline-flex items-center gap-2 font-semibold">
          <Sparkles className="h-4 w-4" />
          8-question social rhythm profile
        </div>
        <p className="mt-1 text-xs text-emerald-800/90">
          Your answers help Circles suggest better people, settings, and meetup formats.
        </p>
      </div>

      <PersonalityQuizModal
        open
        mode="page"
        onClose={goBack}
        onCompleted={onCompleted}
        currentScore={currentReputation}
      />
    </div>
  );
}
