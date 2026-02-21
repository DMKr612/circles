export const PUBLIC_ID_PATTERN = /^[a-z0-9_]{2,24}[0-9]{4}$/i;
export const MENTION_CANDIDATE_PATTERN = /^[a-z0-9_]{2,40}$/i;

export type MentionQuery = {
  atIndex: number;
  cursor: number;
  query: string;
};

export function normalizePublicId(input: string | null | undefined): string {
  return String(input || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function isValidPublicId(input: string | null | undefined): boolean {
  return PUBLIC_ID_PATTERN.test(normalizePublicId(input));
}

export function extractMentionCandidates(text: string | null | undefined): string[] {
  const found = new Set<string>();
  const value = String(text || "");
  const regex = /@([a-z0-9_]{2,40})/gi;
  for (const match of value.matchAll(regex)) {
    const next = normalizePublicId(match[1]);
    if (!next || !MENTION_CANDIDATE_PATTERN.test(next)) continue;
    found.add(next);
  }
  return Array.from(found);
}

export function extractTaggedPublicIds(text: string | null | undefined): string[] {
  return extractMentionCandidates(text).filter((token) => token !== "all");
}

export function resolveMentionCandidate(
  candidate: string,
  allowedPublicIds: Array<string | null | undefined>
): { resolved: string | null; ambiguous: boolean } {
  const raw = normalizePublicId(candidate);
  if (!raw || !MENTION_CANDIDATE_PATTERN.test(raw)) {
    return { resolved: null, ambiguous: false };
  }

  const ids = Array.from(
    new Set(
      allowedPublicIds
        .map((id) => normalizePublicId(id))
        .filter((id) => !!id)
    )
  );

  if (!ids.length) return { resolved: null, ambiguous: false };
  if (raw === "all") return { resolved: "all", ambiguous: false };

  const exact = ids.filter((id) => id === raw);
  if (exact.length === 1) return { resolved: exact[0], ambiguous: false };
  if (exact.length > 1) return { resolved: null, ambiguous: true };

  const fuzzy = ids.filter((id) => id.startsWith(raw) || raw.startsWith(id));
  if (fuzzy.length === 1) return { resolved: fuzzy[0], ambiguous: false };
  if (fuzzy.length > 1) return { resolved: null, ambiguous: true };

  return { resolved: null, ambiguous: false };
}

export function replaceMentionToken(message: string, inputToken: string, canonicalToken: string): string {
  const raw = normalizePublicId(inputToken);
  const canonical = normalizePublicId(canonicalToken);
  if (!raw || !canonical || raw === canonical) return message;
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`@${escaped}(?=\\b)`, "gi");
  return message.replace(pattern, `@${canonical}`);
}

export function detectMentionQuery(text: string, cursor: number): MentionQuery | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, safeCursor);
  const match = before.match(/(?:^|\s)@([a-z0-9_]*)$/i);
  if (!match) return null;
  const query = String(match[1] || "").toLowerCase();
  if (query.length > 40) return null;
  const atIndex = before.lastIndexOf("@");
  if (atIndex < 0) return null;
  return {
    atIndex,
    cursor: safeCursor,
    query,
  };
}

export function applyMentionAtCursor(
  text: string,
  cursor: number,
  mentionQuery: MentionQuery,
  publicId: string
): { nextText: string; nextCursor: number } {
  const safeMention = normalizePublicId(publicId);
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const start = Math.max(0, mentionQuery.atIndex);
  const before = text.slice(0, start);
  const after = text.slice(safeCursor);
  const insertion = `@${safeMention} `;
  const nextText = `${before}${insertion}${after}`;
  const nextCursor = before.length + insertion.length;
  return { nextText, nextCursor };
}
