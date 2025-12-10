import React from "react";

type GameStat = { game: string; count: number };

interface GamesPlayedModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameStats: GameStat[];
  gamesTotal: number;
}

export default function GamesPlayedModal({ isOpen, onClose, gameStats, gamesTotal }: GamesPlayedModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-w-[92vw] rounded-2xl border border-black/10 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-base font-semibold text-neutral-900">Games Played</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-black/10 px-2 py-1 text-sm"
          >
            Close
          </button>
        </div>
        <div className="mb-2 text-sm text-neutral-700">
          Total sessions joined: <span className="font-medium text-neutral-900">{gamesTotal}</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {gameStats.length === 0 ? (
            <div className="text-sm text-neutral-600">No games yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-500">
                  <th className="py-1 pr-2">Game</th>
                  <th className="py-1 pr-2">Times</th>
                  <th className="py-1 pr-2">Share</th>
                </tr>
              </thead>
              <tbody>
                {gameStats.map((g) => {
                  const pct = gamesTotal > 0 ? Math.round((g.count / gamesTotal) * 100) : 0;
                  return (
                    <tr key={g.game} className="border-t border-black/5">
                      <td className="py-1 pr-2 text-neutral-900">{g.game}</td>
                      <td className="py-1 pr-2">{g.count}</td>
                      <td className="py-1 pr-2 text-neutral-600">{pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
