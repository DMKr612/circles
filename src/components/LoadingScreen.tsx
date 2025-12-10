import React from "react";

type Props = {
  message?: string;
};

/**
 * Fullscreen overlay with a compact, circular video “spinner” in the center.
 * Expects `loading.mp4` (or compatible) in `public/`.
 */
export default function LoadingScreen({ message = "Loading…" }: Props) {
  return (
    <div className="fixed inset-0 z-[9999] grid place-items-center bg-black/40 backdrop-blur-sm">
      <div className="relative flex flex-col items-center gap-3 rounded-2xl bg-white/90 px-5 py-4 shadow-xl ring-1 ring-black/10">
        <div className="relative h-28 w-28 overflow-hidden rounded-full ring-2 ring-emerald-200 shadow-lg">
          <video
            className="h-full w-full object-cover"
            src="/loading.mp4"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
          />
        </div>
        <div className="text-sm font-semibold text-neutral-800">{message}</div>
      </div>
    </div>
  );
}
