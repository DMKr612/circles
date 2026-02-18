const DICEBEAR_STYLE = "avataaars";
const DICEBEAR_BG = "b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf";

type ResolveAvatarOptions = {
  avatarUrl?: string | null;
  seed?: string | null;
  size?: number;
};

export function resolveAvatarUrl({ avatarUrl, seed, size = 96 }: ResolveAvatarOptions) {
  const uploaded = String(avatarUrl || "").trim();
  if (uploaded) return uploaded;

  const fallbackSeed = String(seed || "circles-user").trim() || "circles-user";
  const encodedSeed = encodeURIComponent(fallbackSeed);
  return `https://api.dicebear.com/7.x/${DICEBEAR_STYLE}/svg?seed=${encodedSeed}&size=${size}&backgroundColor=${DICEBEAR_BG}`;
}

export function getAvatarUrl(avatarUrl: string | null | undefined, seed: string | null | undefined, size?: number) {
  return resolveAvatarUrl({ avatarUrl, seed, size });
}
