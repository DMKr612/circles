import { getGroupRatingDisplay } from "@/lib/groupRatings";

type GroupRatingBadgeProps = {
  groupMembersCount: number | null | undefined;
  groupRatingAvg: number | null | undefined;
  groupRatingCount: number | null | undefined;
  className?: string;
};

export function GroupRatingBadge({
  groupMembersCount,
  groupRatingAvg,
  groupRatingCount,
  className = "",
}: GroupRatingBadgeProps) {
  const rating = getGroupRatingDisplay({
    groupMembersCount,
    groupRatingAvg,
    groupRatingCount,
  });

  if (rating.kind === "new") {
    return (
      <span
        title="Not enough ratings yet"
        className={`inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700 ${className}`.trim()}
      >
        {rating.label}
      </span>
    );
  }

  if (rating.kind === "low_confidence") {
    return (
      <span
        title="Low confidence rating"
        className={`inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-800 ${className}`.trim()}
      >
        <span aria-hidden="true">★</span>
        <span>{rating.scoreText}</span>
        <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
          {rating.label}
        </span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 ${className}`.trim()}
    >
      <span aria-hidden="true">★</span>
      <span>{rating.scoreText}</span>
      <span>({rating.ratingCount})</span>
    </span>
  );
}
