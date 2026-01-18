import React from "react";
import { Star, Sparkles } from "lucide-react";

type Props = {
  name: string;
  city?: string | null;
  avatarUrl?: string | null;
  reputationScore?: number;
  personalityTraits?: any | null;
  subtitle?: string;
  onClick?: () => void;
};

function toStars(score: number | undefined) {
  const val = typeof score === "number" ? score : 0;
  return Math.round((val / 20) * 10) / 10;
}

export default function UserCard({
  name,
  city,
  avatarUrl,
  reputationScore = 0,
  personalityTraits,
  subtitle,
  onClick,
}: Props) {
  const stars = toStars(reputationScore);
  const badgeName = personalityTraits?.badge?.name ?? personalityTraits?.summary ?? null;
  const traitTag = personalityTraits?.summary ?? badgeName;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-neutral-100 bg-white px-4 py-3 shadow-sm hover:shadow-md transition"
    >
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-indigo-100 to-emerald-100 ring-1 ring-white shadow-inner">
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-sm font-bold text-neutral-700">
              {name.slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex-1 space-y-1 text-left">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-neutral-900">{name}</div>
            <div className="flex items-center gap-1 text-[13px] font-semibold text-amber-700" title={`${stars} / 5`}>
              <Star className="h-4 w-4 fill-amber-400 stroke-amber-400" />
              {stars.toFixed(1)}
              <span className="text-[11px] text-neutral-500">({Math.round(reputationScore)} pts)</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {traitTag && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                <Sparkles className="h-3 w-3" />
                {badgeName || "Social Style"} • {traitTag}
              </span>
            )}
            {city && <span className="text-xs text-neutral-500">{city}</span>}
            {subtitle && <span className="text-xs text-neutral-500">{subtitle}</span>}
          </div>
        </div>
      </div>
    </button>
  );
}
