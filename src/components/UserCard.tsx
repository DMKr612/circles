import React from "react";
import { Star, Sparkles } from "lucide-react";
import { getAvatarUrl } from "@/lib/avatar";

type Props = {
  name: string;
  city?: string | null;
  avatarUrl?: string | null;
  avatarSeed?: string | null;
  ratingAvg?: number;
  ratingCount?: number;
  personalityTraits?: any | null;
  subtitle?: string;
  hideRating?: boolean;
  onClick?: () => void;
};

const traitKeyLabel = (key: string) => key.replaceAll("_", " ");

function scalarText(value: any): string | null {
  if (typeof value === "string") {
    const v = value.trim();
    return v || null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function summarizeTraitBlock(value: any): string | null {
  const scalar = scalarText(value);
  if (scalar) return scalar;
  if (!value) return null;

  if (Array.isArray(value)) {
    const list = value.map((item) => scalarText(item)).filter(Boolean) as string[];
    return list.length ? list.join(", ") : null;
  }

  if (typeof value === "object") {
    const preferredKeys = ["energy", "planning", "group_size", "conversation", "meetup_length"];
    const preferredParts = preferredKeys
      .map((key) => {
        const text = scalarText((value as any)[key]);
        if (!text) return null;
        return `${traitKeyLabel(key)}: ${text}`;
      })
      .filter(Boolean) as string[];
    if (preferredParts.length) return preferredParts.join(" · ");

    const genericParts = Object.entries(value)
      .map(([key, val]) => {
        const text = scalarText(val);
        if (!text) return null;
        return `${traitKeyLabel(key)}: ${text}`;
      })
      .filter(Boolean) as string[];
    if (genericParts.length) return genericParts.join(" · ");
  }

  return null;
}

export default function UserCard({
  name,
  city,
  avatarUrl,
  avatarSeed,
  ratingAvg,
  ratingCount,
  personalityTraits,
  subtitle,
  hideRating = false,
  onClick,
}: Props) {
  const avg = typeof ratingAvg === "number" ? ratingAvg : 0;
  const count = typeof ratingCount === "number" ? ratingCount : 0;
  const badgeName =
    scalarText(personalityTraits?.badge?.name) ||
    scalarText(personalityTraits?.style) ||
    scalarText(personalityTraits?.label) ||
    null;
  const traitTag =
    summarizeTraitBlock(personalityTraits?.summary) ||
    summarizeTraitBlock(personalityTraits?.labels) ||
    null;
  const detailTag = traitTag && traitTag !== badgeName ? traitTag : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-neutral-100 bg-white px-4 py-3 shadow-sm hover:shadow-md transition"
    >
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-indigo-100 to-emerald-100 ring-1 ring-white shadow-inner">
          <img src={getAvatarUrl(avatarUrl, avatarSeed || name)} alt={name} className="h-full w-full object-cover" />
        </div>
        <div className="flex-1 space-y-1 text-left">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-neutral-900">{name}</div>
            {!hideRating && (
              <div className="flex items-center gap-1 text-[13px] font-semibold text-amber-700" title={`${avg.toFixed(1)} / 6`}>
                <Star className="h-4 w-4 fill-amber-400 stroke-amber-400" />
                {avg.toFixed(1)}
                <span className="text-[11px] text-neutral-500">· {count} rating{count === 1 ? "" : "s"}</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {traitTag && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                <Sparkles className="h-3 w-3" />
                {badgeName || "Social Style"}
                {detailTag ? ` • ${detailTag}` : ""}
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
